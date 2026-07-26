import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

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
    writeFileSync(join(dir, "apexcn-cli.tgz"), "tgz");
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
      verifiedProvenanceSubjects: 4
    }));
    expect(JSON.parse(readFileSync(join(dir, "apexcn-cli.spdx.json"), "utf8"))).toEqual(
      expect.objectContaining({ spdxVersion: "SPDX-2.3" })
    );
  });

  test("final release verification rejects provenance from a dirty source tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-dirty-provenance-"));
    writeFileSync(join(dir, "apexcn-cli.tgz"), "tgz");
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
    } finally {
      spawnSync("rm", ["-rf", dir]);
    }
  }, 30000);
});
