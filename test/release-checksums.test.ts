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

  test("install scripts contain checksum verification and explicit skip controls", () => {
    const shell = readFileSync(join(repoRoot, "scripts/install-agent.sh"), "utf8");
    const pwsh = readFileSync(join(repoRoot, "scripts/install-agent.ps1"), "utf8");

    expect(shell).toContain("APEXCN_CLI_SKIP_CHECKSUM");
    expect(shell).toContain("verify_package_checksum");
    expect(shell).toContain("Checksum verification failed");
    expect(pwsh).toContain("APEXCN_CLI_SKIP_CHECKSUM");
    expect(pwsh).toContain("Test-PackageChecksum");
    expect(pwsh).toContain("Checksum verification failed");
  });

  test("release artifact check creates checksums.txt", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-checksum-test-"));
    try {
      execFileSync("node", ["scripts/check-release-artifacts.mjs", "--artifacts-dir", dir], { cwd: repoRoot, encoding: "utf8" });
      expect(readFileSync(join(dir, "checksums.txt"), "utf8")).toContain("apexcn-cli.tgz");
      expect(readFileSync(join(dir, "apexcn-cli.tgz.sha256"), "utf8")).toContain("apexcn-cli.tgz");
      expect(readFileSync(join(dir, "install-agent.sh.sha256"), "utf8")).toContain("install-agent.sh");
      expect(readFileSync(join(dir, "install-agent.ps1.sha256"), "utf8")).toContain("install-agent.ps1");
    } finally {
      spawnSync("rm", ["-rf", dir]);
    }
  }, 30000);
});
