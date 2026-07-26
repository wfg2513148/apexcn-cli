#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const artifactsDir = resolve(args.find((arg) => !arg.startsWith("--")) ?? join(repoRoot, "artifacts"));
const requireClean = args.includes("--require-clean");
const packageJson = readJson(join(repoRoot, "package.json"));
const requiredSubjects = [
  "apexcn-cli.tgz",
  "install-agent.sh",
  "install-agent.ps1",
  "apexcn-cli.spdx.json"
];
const failures = [];

const checksumRows = parseChecksums(readText("checksums.txt"));
for (const name of [...requiredSubjects, "release-provenance.json"]) {
  const actual = sha256(name);
  const expected = checksumRows.get(name);
  if (expected !== actual) {
    failures.push(`${name} checksum mismatch: expected ${String(expected)}, got ${actual}`);
  }
  const detached = parseDetachedChecksum(name);
  if (detached !== actual) {
    failures.push(`${name}.sha256 mismatch: expected ${actual}, got ${String(detached)}`);
  }
}

const sbom = readJson(join(artifactsDir, "apexcn-cli.spdx.json"));
if (sbom.spdxVersion !== "SPDX-2.3" || sbom.SPDXID !== "SPDXRef-DOCUMENT") {
  failures.push("SBOM is not an SPDX 2.3 document");
}
const describedPackage = Array.isArray(sbom.packages)
  ? sbom.packages.find((item) => item?.SPDXID === "SPDXRef-Package-apexcn-cli")
  : undefined;
if (describedPackage?.versionInfo !== packageJson.version) {
  failures.push(`SBOM apexcn-cli version mismatch: expected ${packageJson.version}, got ${String(describedPackage?.versionInfo)}`);
}
const commanderPackage = Array.isArray(sbom.packages)
  ? sbom.packages.find((item) => item?.SPDXID === "SPDXRef-Package-commander")
  : undefined;
if (!commanderPackage?.versionInfo) {
  failures.push("SBOM is missing the bundled commander dependency");
}

const provenance = readJson(join(artifactsDir, "release-provenance.json"));
if (provenance._type !== "https://in-toto.io/Statement/v1") {
  failures.push("provenance is not an in-toto Statement v1");
}
if (provenance.predicateType !== "https://slsa.dev/provenance/v1") {
  failures.push("provenance does not use the SLSA provenance v1 predicate");
}
const provenanceSubjects = new Map(
  Array.isArray(provenance.subject)
    ? provenance.subject.map((subject) => [subject?.name, subject?.digest?.sha256])
    : []
);
for (const name of requiredSubjects) {
  const actual = sha256(name);
  if (provenanceSubjects.get(name) !== actual) {
    failures.push(`provenance subject mismatch for ${name}`);
  }
}
const sourceCommit = provenance.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.gitCommit;
if (typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  failures.push("provenance source commit is missing or invalid");
}
if (provenance.predicate?.buildDefinition?.externalParameters?.version !== packageJson.version) {
  failures.push("provenance version does not match package.json");
}
const sourceTreeDirty = provenance.predicate?.buildDefinition?.internalParameters?.sourceTreeDirty;
const sourceTreeSha256 = provenance.predicate?.buildDefinition?.internalParameters?.sourceTreeSha256;
if (typeof sourceTreeDirty !== "boolean" || typeof sourceTreeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(sourceTreeSha256)) {
  failures.push("provenance source tree state is missing or invalid");
}
if (requireClean && sourceTreeDirty) {
  failures.push("release provenance records a dirty source tree");
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  kind: "apexcn-release-supply-chain-verification",
  schemaVersion: 1,
  ok: true,
  version: packageJson.version,
  artifactsDir: basename(artifactsDir),
  verifiedChecksumAssets: checksumRows.size,
  verifiedProvenanceSubjects: requiredSubjects.length,
  sbomPackageCount: sbom.packages.length,
  sourceCommit,
  sourceTreeDirty,
  sourceTreeSha256
}, null, 2)}\n`);

function parseChecksums(text) {
  const rows = new Map();
  for (const line of text.trim().split("\n")) {
    const match = /^([0-9a-f]{64})  ([^\s]+)$/.exec(line);
    if (!match) {
      failures.push(`invalid checksums.txt row: ${line}`);
      continue;
    }
    rows.set(match[2], match[1]);
  }
  return rows;
}

function parseDetachedChecksum(name) {
  const match = /^([0-9a-f]{64})  ([^\s]+)\n?$/.exec(readText(`${name}.sha256`));
  return match?.[2] === name ? match[1] : undefined;
}

function sha256(name) {
  return createHash("sha256").update(readFileSync(join(artifactsDir, name))).digest("hex");
}

function readText(name) {
  return readFileSync(join(artifactsDir, name), "utf8");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
