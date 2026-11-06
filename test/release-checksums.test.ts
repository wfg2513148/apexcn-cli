import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

function createSyntheticArchive(dir: string) {
  const root = join(dir, "synthetic");
  const pkg = join(root, "package");
  mkdirSync(join(pkg, "node_modules"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(pkg, "package.json"));
  for (const name of ["commander", "lossless-json"]) {
    cpSync(join(repoRoot, "node_modules", name), join(pkg, "node_modules", name), { recursive: true });
  }
  execFileSync("tar", ["-czf", join(dir, "apexcn-cli.tgz"), "-C", root, "package"]);
}

describe("release checksums", () => {
  test("generate-release-checksums writes stable checksum files", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-checksums-"));
    writeFileSync(join(dir, "apexcn-cli.tgz"), "tgz");
    writeFileSync(join(dir, "install-agent.sh"), "sh");
    writeFileSync(join(dir, "install-agent.ps1"), "ps1");

    const output = execFileSync("node", ["scripts/generate-release-checksums.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    const checksums = readFileSync(join(dir, "checksums.txt"), "utf8");

    expect(JSON.parse(output)).toEqual(expect.objectContaining({ kind: "release-checksums" }));
    expect(checksums.trim().split("\n")).toHaveLength(3);
    expect(checksums).toContain("apexcn-cli.tgz");
    expect(readFileSync(join(dir, "apexcn-cli.tgz.sha256"), "utf8")).toContain("apexcn-cli.tgz");
  });

  test("release supply-chain metadata is covered by checksums and verifies offline", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-supply-chain-"));
    createSyntheticArchive(dir);
    writeFileSync(join(dir, "install-agent.sh"), "sh");
    writeFileSync(join(dir, "install-agent.ps1"), "ps1");

    execFileSync("node", ["scripts/generate-release-supply-chain.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    execFileSync("node", ["scripts/generate-release-checksums.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    const verification = JSON.parse(execFileSync("node", ["scripts/verify-release-supply-chain.mjs", dir], {
      cwd: repoRoot,
      encoding: "utf8"
    }));

    expect(verification).toEqual(expect.objectContaining({
      kind: "apexcn-release-supply-chain-verification",
      ok: true,
      verifiedChecksumAssets: 5,
      verifiedProvenanceSubjects: 4,
      dependencyReference: "verifier-installation",
      authenticityVerified: false,
      runtimeExecutionVerified: false
    }));
    const sbom = JSON.parse(readFileSync(join(dir, "apexcn-cli.spdx.json"), "utf8"));
    expect(sbom).toEqual(expect.objectContaining({
      spdxVersion: "SPDX-2.3",
      packages: expect.arrayContaining([expect.objectContaining({ name: "lossless-json", versionInfo: "4.3.3" })]),
      relationships: expect.arrayContaining([expect.objectContaining({ relatedSpdxElement: "SPDXRef-Package-lossless-json", relationshipType: "DEPENDS_ON" })])
    }));
    sbom.packages = sbom.packages.filter((item: { name: string }) => item.name !== "lossless-json");
    writeFileSync(join(dir, "apexcn-cli.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
    execFileSync("node", ["scripts/generate-release-checksums.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    const missingDependency = spawnSync("node", ["scripts/verify-release-supply-chain.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    expect(missingDependency.status).toBe(1);
    expect(missingDependency.stderr).toContain("SBOM is missing the bundled lossless-json dependency");
  });

  test("final release verification rejects provenance from a dirty source tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-dirty-provenance-"));
    createSyntheticArchive(dir);
    writeFileSync(join(dir, "install-agent.sh"), "sh");
    writeFileSync(join(dir, "install-agent.ps1"), "ps1");
    execFileSync("node", ["scripts/generate-release-supply-chain.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    const provenancePath = join(dir, "release-provenance.json");
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    provenance.predicate.buildDefinition.internalParameters.sourceTreeDirty = true;
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
    execFileSync("node", ["scripts/generate-release-checksums.mjs", dir], { cwd: repoRoot, encoding: "utf8" });

    const result = spawnSync("node", ["scripts/verify-release-supply-chain.mjs", dir, "--require-clean"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dirty source tree");
  });

  test("generate-release-checksums accepts npm pack project-root layout", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-checksums-root-"));
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, `apexcn-cli-${packageJson.version}.tgz`), "tgz");
    writeFileSync(join(dir, "scripts/install-agent.sh"), "sh");
    writeFileSync(join(dir, "scripts/install-agent.ps1"), "ps1");

    execFileSync("node", ["scripts/generate-release-checksums.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
    const checksums = readFileSync(join(dir, "checksums.txt"), "utf8");

    expect(checksums).toContain("apexcn-cli.tgz");
    expect(checksums).toContain("install-agent.sh");
    expect(checksums).toContain("install-agent.ps1");
  });

  test("install scripts contain mandatory checksum verification without skip controls", () => {
    const shell = readFileSync(join(repoRoot, "scripts/install-agent.sh"), "utf8");
    const pwsh = readFileSync(join(repoRoot, "scripts/install-agent.ps1"), "utf8");

    expect(shell).toContain("checksums.txt");
    expect(shell).toContain("Checksum verification failed");
    expect(shell).not.toContain("SKIP_CHECKSUM");
    expect(pwsh).toContain("checksums.txt");
    expect(pwsh).toContain("Checksum verification failed");
    expect(pwsh).not.toContain("SKIP_CHECKSUM");
  });

  test("release artifact check creates checksums.txt", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-checksum-test-"));
    try {
      execFileSync("node", ["scripts/check-release-artifacts.mjs", "--artifacts-dir", dir], { cwd: repoRoot, encoding: "utf8" });
      expect(readFileSync(join(dir, "checksums.txt"), "utf8")).toContain("apexcn-cli.tgz");
      expect(readFileSync(join(dir, "apexcn-cli.tgz.sha256"), "utf8")).toContain("apexcn-cli.tgz");
      expect(readFileSync(join(dir, "install-agent.sh.sha256"), "utf8")).toContain("install-agent.sh");
      expect(readFileSync(join(dir, "install-agent.ps1.sha256"), "utf8")).toContain("install-agent.ps1");
      expect(readFileSync(join(dir, "apexcn-cli.spdx.json.sha256"), "utf8")).toContain("apexcn-cli.spdx.json");
      expect(readFileSync(join(dir, "release-provenance.json.sha256"), "utf8")).toContain("release-provenance.json");
      const archiveBefore = readFileSync(join(dir, "apexcn-cli.tgz"));
      const provenanceBefore = readFileSync(join(dir, "release-provenance.json"));
      execFileSync("node", ["scripts/check-release-artifacts.mjs", "--verify-only", "--artifacts-dir", dir], { cwd: repoRoot, encoding: "utf8" });
      const installed = join(dir, "unpacked");
      mkdirSync(installed);
      execFileSync("tar", ["-xzf", join(dir, "apexcn-cli.tgz"), "-C", installed]);
      const standalone = spawnSync(process.execPath, [join(installed, "package/scripts/verify-release-supply-chain.mjs"), dir], { encoding: "utf8" });
      expect(standalone.status, standalone.stderr).toBe(0);
      const launcher = spawnSync(process.execPath, [join(installed, "package/dist/index.js"), "--version"], { encoding: "utf8", env: { PATH: process.env.PATH } });
      expect(launcher.status, launcher.stderr).toBe(0);
      expect(launcher.stdout.trim()).toBe(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version);
      expect(readFileSync(join(dir, "apexcn-cli.tgz"))).toEqual(archiveBefore);
      expect(readFileSync(join(dir, "release-provenance.json"))).toEqual(provenanceBefore);
      writeFileSync(join(dir, "checksums.txt"), `${"0".repeat(64)}  apexcn-cli.tgz\n`);
      const rejected = spawnSync("node", ["scripts/check-release-artifacts.mjs", "--verify-only", "--artifacts-dir", dir], { cwd: repoRoot, encoding: "utf8" });
      expect(rejected.status).toBe(1);
      expect(readFileSync(join(dir, "apexcn-cli.tgz"))).toEqual(archiveBefore);
    } finally {
      spawnSync("rm", ["-rf", dir]);
    }
  }, 30000);

  test("rejects bundled dependency version drift and a missing runtime module", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-dependency-tamper-"));
    const unpacked = join(dir, "unpacked");
    const archive = join(dir, "apexcn-cli.tgz");
    try {
      execFileSync("node", ["scripts/check-release-artifacts.mjs", "--artifacts-dir", dir], { cwd: repoRoot, encoding: "utf8" });
      const original = readFileSync(archive);
      const prepare = () => {
        rmSync(unpacked, { recursive: true, force: true });
        mkdirSync(unpacked);
        writeFileSync(archive, original);
        execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
      };
      const refreshAndCheck = () => {
        execFileSync("node", ["scripts/generate-release-supply-chain.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
        execFileSync("node", ["scripts/generate-release-checksums.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
        return spawnSync("node", ["scripts/check-release-artifacts.mjs", "--verify-only", "--artifacts-dir", dir], { cwd: repoRoot, encoding: "utf8" });
      };
      const repackAndCheck = () => {
        const files: string[] = [];
        const walk = (path: string) => {
          for (const entry of readdirSync(join(unpacked, path), { withFileTypes: true })) {
            const child = `${path}/${entry.name}`;
            if (entry.isDirectory()) walk(child);
            else if (entry.isFile()) files.push(child);
          }
        };
        walk("package");
        const list = join(dir, "members.txt");
        writeFileSync(list, `${files.sort().join("\n")}\n`);
        execFileSync("tar", ["-czf", archive, "-C", unpacked, "-T", list]);
        return refreshAndCheck();
      };
      prepare();
      const metadataPath = join(unpacked, "package/node_modules/lossless-json/package.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      metadata.version = "0.0.0";
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      const wrongVersion = repackAndCheck();
      expect(wrongVersion.status).toBe(1);
      expect(wrongVersion.stderr).toMatch(/lossless-json.*(?:version|differ)/i);

      prepare();
      rmSync(join(unpacked, "package/node_modules/lossless-json/lib/esm/index.js"));
      const missingModule = repackAndCheck();
      expect(missingModule.status).toBe(1);
      expect(missingModule.stderr).toMatch(/lossless-json.*(?:missing|differ)/i);
      const standaloneMissing = spawnSync("node", ["scripts/verify-release-supply-chain.mjs", dir], { cwd: repoRoot, encoding: "utf8" });
      expect(standaloneMissing.status).toBe(1);
      expect(standaloneMissing.stderr).toMatch(/lossless-json.*missing/i);

      prepare();
      const packagePath = join(unpacked, "package/package.json");
      const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
      delete manifest.dependencies["lossless-json"];
      writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
      const missingDeclaration = repackAndCheck();
      expect(missingDeclaration.status).toBe(1);
      expect(missingDeclaration.stderr).toMatch(/runtime dependencies.*differ/i);

      const duplicateRoot = join(dir, "duplicate");
      mkdirSync(join(duplicateRoot, "package/node_modules/lossless-json/lib/esm"), { recursive: true });
      writeFileSync(join(duplicateRoot, "package/node_modules/lossless-json/lib/esm/index.js"), "");
      for (const duplicatePath of ["package/node_modules/lossless-json/lib/esm/index.js", "package/./node_modules/lossless-json/lib/esm/index.js"]) {
        const uncompressed = join(dir, "duplicate.tar");
        writeFileSync(uncompressed, gunzipSync(original));
        execFileSync("tar", ["-rf", uncompressed, "-C", duplicateRoot, duplicatePath]);
        writeFileSync(archive, gzipSync(readFileSync(uncompressed)));
        const duplicate = refreshAndCheck();
        expect(duplicate.status).toBe(1);
        expect(duplicate.stderr).toMatch(/(?:duplicate|noncanonical).*lossless-json/i);
      }
      if (process.platform !== "win32") {
        const links = join(dir, "links");
        mkdirSync(join(links, "package"), { recursive: true });
        symlinkSync("dist/index.js", join(links, "package/unexpected-link"));
        const uncompressed = join(dir, "symlink.tar");
        writeFileSync(uncompressed, gunzipSync(original));
        execFileSync("tar", ["-rf", uncompressed, "-C", links, "package/unexpected-link"]);
        writeFileSync(archive, gzipSync(readFileSync(uncompressed)));
        const link = refreshAndCheck();
        expect(link.status).toBe(1);
        expect(link.stderr).toMatch(/unsupported.*(?:type|entry)/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
