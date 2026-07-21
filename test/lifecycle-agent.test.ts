import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

function execNpm(args: string[]): string {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repoRoot,
      encoding: "utf8"
    });
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

describe("cross-platform lifecycle assets", () => {
  test("shell lifecycle performs install, upgrade, rollback, and uninstall with a preserved backup", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-lifecycle-"));
    const freshInstallRoot = join(root, "fresh-install");
    const freshBinDir = join(root, "fresh-bin");
    const installRoot = join(root, "install");
    const binDir = join(root, "bin");
    const backupRoot = join(root, "backups");
    const home = join(root, "home");
    mkdirSync(join(installRoot, "dist"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(installRoot, "package.json"), '{"name":"apexcn-cli","version":"0.60.0","type":"module"}\n');
    writeFileSync(join(installRoot, "dist", "index.js"), 'console.log("0.60.0");\n');
    const version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
    execNpm(["pack", "--pack-destination", root]);
    const archive = join(root, "apexcn-cli.tgz");
    cpSync(join(root, `apexcn-cli-${version}.tgz`), archive);
    const checksums = join(root, "checksums.txt");
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(checksums, `${digest}  apexcn-cli.tgz\n`);

    const common = {
      cwd: repoRoot,
      encoding: "utf8" as const
    };
    const environmentFor = (activeBinDir: string) => ({
      ...process.env,
      HOME: home,
      APEXCN_CLI_PACKAGE_URL: `file://${archive}`,
      APEXCN_CLI_CHECKSUMS_URL: `file://${checksums}`,
      PATH: `${activeBinDir}${delimiter}${process.env.PATH ?? ""}`
    });
    const installed = spawnSync("bash", [
      "scripts/lifecycle-agent.sh",
      "install",
      "--install-root", freshInstallRoot,
      "--bin-dir", freshBinDir
    ], { ...common, env: environmentFor(freshBinDir) });
    expect(installed.status, installed.stderr).toBe(0);
    expect((JSON.parse(readFileSync(join(freshInstallRoot, "package", "package.json"), "utf8")) as { version: string }).version)
      .toBe(version);

    const upgraded = spawnSync("bash", [
      "scripts/lifecycle-agent.sh",
      "upgrade",
      "--install-root", installRoot,
      "--bin-dir", binDir,
      "--backup-root", backupRoot
    ], { ...common, env: environmentFor(binDir) });
    expect(upgraded.status, upgraded.stderr).toBe(0);
    const currentVersion = (JSON.parse(readFileSync(join(installRoot, "package", "package.json"), "utf8")) as { version: string }).version;
    expect(currentVersion).toBe(version);

    const backups = readdirSync(backupRoot);
    expect(backups).toHaveLength(1);
    const backupPath = join(backupRoot, backups[0]);
    expect((JSON.parse(readFileSync(join(backupPath, "package.json"), "utf8")) as { version: string }).version).toBe("0.60.0");

    const rolledBack = spawnSync("bash", [
      "scripts/lifecycle-agent.sh",
      "rollback",
      "--install-root", installRoot,
      "--bin-dir", binDir,
      "--backup", backupPath,
      "--yes"
    ], { ...common, env: environmentFor(binDir) });
    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(rolledBack.stdout).toContain("Rollback complete: 0.60.0");

    const uninstalled = spawnSync("bash", [
      "scripts/lifecycle-agent.sh",
      "uninstall",
      "--install-root", installRoot,
      "--bin-dir", binDir,
      "--yes"
    ], { ...common, env: environmentFor(binDir) });
    expect(uninstalled.status, uninstalled.stderr).toBe(0);
    expect(uninstalled.stdout).toContain("Auth configuration was preserved");
  }, 60_000);

  test("PowerShell lifecycle has the same guarded operations and recovery path", () => {
    const script = readFileSync(join(repoRoot, "scripts/lifecycle-agent.ps1"), "utf8");

    expect(script).toContain('ValidateSet("install", "upgrade", "rollback", "uninstall")');
    expect(script).toContain("New-Backup");
    expect(script).toContain("Restore-Backup");
    expect(script).toContain('Rollback requires -Yes.');
    expect(script).toContain('Uninstall requires -Yes.');
    expect(script).toContain("Auth configuration was preserved");
  });
});
