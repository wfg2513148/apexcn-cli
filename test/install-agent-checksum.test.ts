import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

function execNpm(args: string[]): string {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    });
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
}

describe("install-agent checksum verification", () => {
  test("shell installer accepts a package when checksums.txt matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-ok-"));
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    const tarball = `apexcn-cli-${packageJson.version}.tgz`;
    execNpm(["pack", "--pack-destination", dir]);
    const tgzPath = join(dir, tarball);
    cpSync(tgzPath, join(dir, "apexcn-cli.tgz"));
    const actual = createHash("sha256").update(readFileSync(join(dir, "apexcn-cli.tgz"))).digest("hex");
    writeFileSync(join(dir, "checksums.txt"), `${actual}  apexcn-cli.tgz\n`);

    const result = spawnSync("bash", [
      "scripts/install-agent.sh",
      "--package-url", `file://${join(dir, "apexcn-cli.tgz")}`,
      "--install-root", join(dir, "install"),
      "--bin-dir", join(dir, "bin"),
      "--yes"
    ], {
      cwd: repoRoot,
      env: { ...process.env, APEXCN_CLI_CHECKSUMS_URL: `file://${join(dir, "checksums.txt")}` },
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified package checksum.");
  }, 30000);

  test("shell installer fails when checksums.txt is missing unless explicitly skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-missing-"));
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    const tarball = `apexcn-cli-${packageJson.version}.tgz`;
    execNpm(["pack", "--pack-destination", dir]);
    cpSync(join(dir, tarball), join(dir, "apexcn-cli.tgz"));
    const missingChecksumsUrl = `file://${join(dir, "missing-checksums.txt")}`;

    const failed = spawnSync("bash", [
      "scripts/install-agent.sh",
      "--package-url", `file://${join(dir, "apexcn-cli.tgz")}`,
      "--install-root", join(dir, "install-failed"),
      "--bin-dir", join(dir, "bin-failed"),
      "--yes"
    ], {
      cwd: repoRoot,
      env: { ...process.env, APEXCN_CLI_CHECKSUMS_URL: missingChecksumsUrl },
      encoding: "utf8"
    });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("Unable to download checksums.txt");

    const skipped = spawnSync("bash", [
      "scripts/install-agent.sh",
      "--package-url", `file://${join(dir, "apexcn-cli.tgz")}`,
      "--install-root", join(dir, "install-skipped"),
      "--bin-dir", join(dir, "bin-skipped"),
      "--yes"
    ], {
      cwd: repoRoot,
      env: { ...process.env, APEXCN_CLI_CHECKSUMS_URL: missingChecksumsUrl, APEXCN_CLI_SKIP_CHECKSUM: "1" },
      encoding: "utf8"
    });
    expect(skipped.status).toBe(0);
    expect(skipped.stderr).toContain("WARNING");
    expect(skipped.stderr).toContain("APEXCN_CLI_SKIP_CHECKSUM=1");
  }, 30000);

  test("shell installer rejects a package when checksums.txt does not match", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-install-checksum-"));
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
    const tarball = `apexcn-cli-${packageJson.version}.tgz`;
    execNpm(["pack", "--pack-destination", dir]);
    const tgzPath = join(dir, tarball);
    const actual = createHash("sha256").update(readFileSync(tgzPath)).digest("hex");
    const wrong = `${actual.slice(0, -1)}${actual.endsWith("0") ? "1" : "0"}`;
    writeFileSync(join(dir, "checksums.txt"), `${wrong}  apexcn-cli.tgz\n`);
    cpSync(tgzPath, join(dir, "apexcn-cli.tgz"));

    const result = spawnSync("bash", [
      "scripts/install-agent.sh",
      "--package-url", `file://${join(dir, "apexcn-cli.tgz")}`,
      "--install-root", join(dir, "install"),
      "--bin-dir", join(dir, "bin"),
      "--yes"
    ], {
      cwd: repoRoot,
      env: { ...process.env, APEXCN_CLI_CHECKSUMS_URL: `file://${join(dir, "checksums.txt")}` },
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Checksum verification failed");
  }, 30000);

  test("PowerShell installer contains equivalent checksum enforcement", () => {
    const script = readFileSync(join(repoRoot, "scripts/install-agent.ps1"), "utf8");

    expect(script).toContain("APEXCN_CLI_SKIP_CHECKSUM");
    expect(script).toContain("checksums.txt");
    expect(script).toContain("Checksum verification failed");
    expect(script).toContain("Write-WarningStep");
  });
});
