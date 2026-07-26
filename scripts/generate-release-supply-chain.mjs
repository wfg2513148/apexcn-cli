#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactsDir = resolve(process.argv[2] ?? join(repoRoot, "artifacts"));
const packageJson = readJson(join(repoRoot, "package.json"));
const packageLock = readJson(join(repoRoot, "package-lock.json"));
const version = packageJson.version;
const sourceCommit = git(["rev-parse", "HEAD"]);
const sourceTimestamp = git(["show", "-s", "--format=%cI", sourceCommit]);
const sourceTreeDirty = git(["status", "--porcelain=v1", "--untracked-files=all"]).length > 0;
const sourceTreeSha256 = hashSourceTree();
const primaryAssets = ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1"];

const primarySubjects = primaryAssets.map(subjectFor);
const commander = packageLock.packages?.["node_modules/commander"];
if (!commander?.version) {
  throw new Error("package-lock.json is missing bundled commander metadata");
}

const sbomName = "apexcn-cli.spdx.json";
const sbom = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `apexcn-cli-${version}`,
  documentNamespace: `https://github.com/wfg2513148/apexcn-cli/releases/tag/v${version}/sbom/${primarySubjects[0].digest.sha256}`,
  creationInfo: {
    created: new Date(sourceTimestamp).toISOString(),
    creators: ["Tool: apexcn-cli/scripts/generate-release-supply-chain.mjs"]
  },
  documentDescribes: ["SPDXRef-Package-apexcn-cli"],
  packages: [
    {
      SPDXID: "SPDXRef-Package-apexcn-cli",
      name: "apexcn-cli",
      versionInfo: version,
      downloadLocation: `https://github.com/wfg2513148/apexcn-cli/releases/download/v${version}/apexcn-cli.tgz`,
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      checksums: [{ algorithm: "SHA256", checksumValue: primarySubjects[0].digest.sha256 }],
      externalRefs: [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/apexcn-cli@${version}`
      }]
    },
    {
      SPDXID: "SPDXRef-Package-commander",
      name: "commander",
      versionInfo: commander.version,
      downloadLocation: commander.resolved ?? "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: commander.license ?? "NOASSERTION",
      licenseDeclared: commander.license ?? "NOASSERTION",
      copyrightText: "NOASSERTION",
      externalRefs: [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/commander@${commander.version}`
      }]
    }
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: "SPDXRef-Package-apexcn-cli"
    },
    {
      spdxElementId: "SPDXRef-Package-apexcn-cli",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-Package-commander"
    }
  ]
};
writeJson(join(artifactsDir, sbomName), sbom);

const provenanceName = "release-provenance.json";
const subjects = [...primarySubjects, subjectFor(sbomName)];
const provenance = {
  _type: "https://in-toto.io/Statement/v1",
  subject: subjects,
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://github.com/wfg2513148/apexcn-cli/blob/main/docs/ga-support-policy.md#release-build",
      externalParameters: {
        version,
        releaseTag: `v${version}`,
        primaryAssets
      },
      internalParameters: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        sourceTreeDirty,
        sourceTreeSha256
      },
      resolvedDependencies: [{
        uri: "git+https://github.com/wfg2513148/apexcn-cli.git",
        digest: { gitCommit: sourceCommit }
      }]
    },
    runDetails: {
      builder: {
        id: "https://github.com/wfg2513148/apexcn-cli/blob/main/scripts/check-release-artifacts.mjs"
      },
      metadata: {
        invocationId: `${sourceCommit}:v${version}`,
        startedOn: new Date(sourceTimestamp).toISOString(),
        finishedOn: new Date(sourceTimestamp).toISOString()
      }
    }
  }
};
writeJson(join(artifactsDir, provenanceName), provenance);

process.stdout.write(`${JSON.stringify({
  kind: "apexcn-release-supply-chain",
  schemaVersion: 1,
  version,
  sourceCommit,
  sourceTreeDirty,
  sourceTreeSha256,
  artifactsDir: basename(artifactsDir),
  primaryAssets,
  sbom: sbomName,
  provenance: provenanceName,
  subjects
}, null, 2)}\n`);

function subjectFor(name) {
  const bytes = readFileSync(join(artifactsDir, name));
  return { name, digest: { sha256: createHash("sha256").update(bytes).digest("hex") } };
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function hashSourceTree() {
  const paths = git(["ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(repoRoot, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
}
