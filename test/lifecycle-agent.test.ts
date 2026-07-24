import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const windowsTest = process.platform === "win32" ? test : test.skip;

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
    writeFileSync(join(installRoot, "dist", "index.js"), '#!/usr/bin/env node\nconsole.log("0.60.0");\n');
    chmodSync(join(installRoot, "dist", "index.js"), 0o755);
    const version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
    execNpm(["pack", "--pack-destination", root]);
    const archive = join(root, "apexcn-cli.tgz");
    cpSync(join(root, `apexcn-cli-${version}.tgz`), archive);
    const checksums = join(root, "checksums.txt");
    const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(checksums, `${digest}  apexcn-cli.tgz\n`);
    const olderPackageRoot = join(root, "older-package");
    const olderArchive = join(root, "apexcn-cli-older.tgz");
    const olderChecksums = join(root, "older-checksums.txt");
    mkdirSync(olderPackageRoot);
    execFileSync("tar", ["-xzf", archive, "-C", olderPackageRoot]);
    const olderPackageJsonPath = join(olderPackageRoot, "package", "package.json");
    const olderPackageJson = JSON.parse(readFileSync(olderPackageJsonPath, "utf8")) as { version: string };
    olderPackageJson.version = "1.0.3";
    writeFileSync(olderPackageJsonPath, `${JSON.stringify(olderPackageJson, null, 2)}\n`);
    execFileSync("tar", ["-czf", olderArchive, "-C", olderPackageRoot, "package"]);
    const olderDigest = createHash("sha256").update(readFileSync(olderArchive)).digest("hex");
    writeFileSync(olderChecksums, `${olderDigest}  apexcn-cli.tgz\n`);

    const common = {
      cwd: repoRoot,
      encoding: "utf8" as const
    };
    const environmentFor = (
      activeBinDir: string,
      packageArtifact = archive,
      checksumsArtifact = checksums
    ) => ({
      ...process.env,
      HOME: home,
      APEXCN_CLI_PACKAGE_URL: `file://${packageArtifact}`,
      APEXCN_CLI_CHECKSUMS_URL: `file://${checksumsArtifact}`,
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
    expect(lstatSync(join(freshBinDir, "apexcn")).isSymbolicLink()).toBe(true);
    expect(execFileSync(join(freshBinDir, "apexcn"), ["--version"], {
      env: environmentFor(freshBinDir),
      encoding: "utf8"
    })).toBe(`${version}\n`);

    const customBackupRoot = join(root, "fresh-backups");
    const customUpgrade = spawnSync("bash", [
      join(freshInstallRoot, "package", "scripts", "lifecycle-agent.sh"),
      "upgrade",
      "--backup-root", customBackupRoot
    ], { ...common, env: environmentFor(freshBinDir) });
    expect(customUpgrade.status, customUpgrade.stderr).toBe(0);
    expect(customUpgrade.stdout).toContain("Upgrade complete");
    expect(lstatSync(join(freshBinDir, "apexcn")).isSymbolicLink()).toBe(true);

    const downgradeBackupRoot = join(root, "downgrade-backups");
    const rejectedDowngrade = spawnSync("bash", [
      join(freshInstallRoot, "package", "scripts", "lifecycle-agent.sh"),
      "upgrade",
      "--backup-root", downgradeBackupRoot
    ], {
      ...common,
      env: environmentFor(freshBinDir, olderArchive, olderChecksums)
    });
    expect(rejectedDowngrade.status).toBe(1);
    expect(rejectedDowngrade.stderr).toContain(`Refusing downgrade from ${version} to 1.0.3`);
    expect(execFileSync(join(freshBinDir, "apexcn"), ["--version"], {
      env: environmentFor(freshBinDir),
      encoding: "utf8"
    })).toBe(`${version}\n`);

    const downgradeBackups = readdirSync(downgradeBackupRoot);
    expect(downgradeBackups).toHaveLength(1);
    const customRollback = spawnSync("bash", [
      join(freshInstallRoot, "package", "scripts", "lifecycle-agent.sh"),
      "rollback",
      "--backup", join(downgradeBackupRoot, downgradeBackups[0]),
      "--yes"
    ], { ...common, env: environmentFor(freshBinDir) });
    expect(customRollback.status, customRollback.stderr).toBe(0);
    expect(customRollback.stdout).toContain(`Rollback complete: ${version}`);
    expect(execFileSync(join(freshBinDir, "apexcn"), ["--version"], {
      env: environmentFor(freshBinDir),
      encoding: "utf8"
    })).toBe(`${version}\n`);

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
    expect(lstatSync(join(binDir, "apexcn")).isSymbolicLink()).toBe(true);
    expect(execFileSync(join(binDir, "apexcn"), ["--version"], {
      env: environmentFor(binDir),
      encoding: "utf8"
    })).toBe("0.60.0\n");

    const uninstalled = spawnSync("bash", [
      "scripts/lifecycle-agent.sh",
      "uninstall",
      "--install-root", installRoot,
      "--bin-dir", binDir,
      "--yes"
    ], { ...common, env: environmentFor(binDir) });
    expect(uninstalled.status, uninstalled.stderr).toBe(0);
    expect(uninstalled.stdout).toContain("Auth configuration was preserved");
    expect(existsSync(join(binDir, "apexcn"))).toBe(false);
  }, 60_000);

  test("PowerShell lifecycle has the same guarded operations and recovery path", () => {
    const script = readFileSync(join(repoRoot, "scripts/lifecycle-agent.ps1"), "utf8");

    expect(script).toContain('ValidateSet("install", "upgrade", "rollback", "uninstall")');
    expect(script).toContain("New-Backup");
    expect(script).toContain("Restore-Backup");
    expect(script).toContain('Rollback requires -Yes.');
    expect(script).toContain('Uninstall requires -Yes.');
    expect(script).toContain("Auth configuration was preserved");
    expect(script).toContain(".apexcn-install-root");
    expect(script).toContain(".apexcn-bin-dir");
  });

  windowsTest("PowerShell performs install, upgrade, failed-upgrade recovery, rollback, and uninstall", () => {
    const powershell = process.env.APEXCN_TEST_POWERSHELL ?? "pwsh.exe";
    const shellProbe = spawnSync(powershell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8"
    });
    expect(shellProbe.status, shellProbe.stderr).toBe(0);

    const root = mkdtempSync(join(tmpdir(), "apexcn-windows-lifecycle-"));
    const installRoot = join(root, "install");
    const binDir = join(root, "bin");
    const backupRoot = join(root, "backups");
    const home = join(root, "home");
    const localAppData = join(root, "local");
    const configPath = join(home, ".apexcn", "config.json");
    const configText = '{"profiles":{"preserved":{"baseUrl":"https://example.invalid","token":"not-a-real-token"}}}\n';
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, configText);

    try {
      const artifacts = prepareWindowsLifecyclePackages(root);
      const env = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        LOCALAPPDATA: localAppData,
        APEXCN_CLI_INSTALL_ROOT: installRoot,
        APEXCN_CLI_BIN_DIR: binDir,
        APEXCN_CLI_BACKUP_ROOT: backupRoot,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
      };
      const lifecycle = join(repoRoot, "scripts", "lifecycle-agent.ps1");
      const install = runPowerShell(powershell, lifecycle, [
        "install",
        "-InstallRoot", installRoot,
        "-BinDir", binDir,
        "-PackageUrl", pathToFileURL(artifacts.olderArchive).href,
        "-ChecksumsUrl", pathToFileURL(artifacts.olderChecksums).href
      ], env);
      expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(installedPackageVersion(installRoot)).toBe(artifacts.olderVersion);
      expect(existsSync(join(binDir, "apexcn.cmd"))).toBe(true);
      expect(readFileSync(configPath, "utf8")).toBe(configText);

      const installedLifecycle = join(installRoot, "package", "scripts", "lifecycle-agent.ps1");
      const upgrade = runPowerShell(powershell, installedLifecycle, [
        "upgrade",
        "-BackupRoot", backupRoot,
        "-PackageUrl", pathToFileURL(artifacts.currentArchive).href,
        "-ChecksumsUrl", pathToFileURL(artifacts.currentChecksums).href
      ], env);
      expect(upgrade.status, `${upgrade.stdout}\n${upgrade.stderr}`).toBe(0);
      expect(upgrade.stdout).toContain("Upgrade complete");
      expect(installedPackageVersion(installRoot)).toBe(artifacts.currentVersion);
      expect(readFileSync(configPath, "utf8")).toBe(configText);

      const failedUpgrade = runPowerShell(powershell, installedLifecycle, [
        "upgrade",
        "-BackupRoot", backupRoot,
        "-PackageUrl", pathToFileURL(artifacts.currentArchive).href,
        "-ChecksumsUrl", pathToFileURL(artifacts.invalidChecksums).href
      ], env);
      expect(failedUpgrade.status).not.toBe(0);
      expect(`${failedUpgrade.stdout}\n${failedUpgrade.stderr}`).toContain("Checksum verification failed");
      expect(installedPackageVersion(installRoot)).toBe(artifacts.currentVersion);
      expect(existsSync(join(binDir, "apexcn.cmd"))).toBe(true);
      expect(readFileSync(configPath, "utf8")).toBe(configText);

      const rollbackBackup = readdirSync(backupRoot)
        .map((name) => join(backupRoot, name))
        .find((path) => installedPackageVersion(path) === artifacts.olderVersion);
      expect(rollbackBackup).toBeDefined();
      const rollback = runPowerShell(powershell, installedLifecycle, [
        "rollback",
        "-Backup", rollbackBackup as string,
        "-Yes"
      ], env);
      expect(rollback.status, `${rollback.stdout}\n${rollback.stderr}`).toBe(0);
      expect(rollback.stdout).toContain(`Rollback complete: ${artifacts.olderVersion}`);
      expect(installedPackageVersion(installRoot)).toBe(artifacts.olderVersion);
      expect(readFileSync(configPath, "utf8")).toBe(configText);

      const restoredLifecycle = join(installRoot, "package", "scripts", "lifecycle-agent.ps1");
      const uninstall = runPowerShell(powershell, restoredLifecycle, ["uninstall", "-Yes"], env);
      expect(uninstall.status, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
      expect(uninstall.stdout).toContain("Auth configuration was preserved");
      expect(existsSync(installRoot)).toBe(false);
      expect(existsSync(join(binDir, "apexcn.cmd"))).toBe(false);
      expect(readFileSync(configPath, "utf8")).toBe(configText);

      writeWindowsLifecycleReport({
        shell: powershell,
        shellVersion: shellProbe.stdout.trim(),
        currentVersion: artifacts.currentVersion,
        stages: ["install", "upgrade", "failed-upgrade-recovery", "rollback", "uninstall"],
        authConfigurationPreserved: true
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});

function prepareWindowsLifecyclePackages(root: string): {
  currentVersion: string;
  olderVersion: string;
  currentArchive: string;
  currentChecksums: string;
  olderArchive: string;
  olderChecksums: string;
  invalidChecksums: string;
} {
  const currentVersion = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  const olderVersion = patch > 0 ? `${major}.${minor}.${patch - 1}` : `${major}.${Math.max(0, minor - 1)}.0`;
  execNpm(["pack", "--pack-destination", root]);
  const currentArchive = join(root, "apexcn-cli-current.tgz");
  cpSync(join(root, `apexcn-cli-${currentVersion}.tgz`), currentArchive);
  const currentChecksums = checksumFile(root, "current-checksums.txt", currentArchive);

  const olderRoot = join(root, "older");
  mkdirSync(olderRoot);
  execFileSync("tar", ["-xzf", currentArchive, "-C", olderRoot]);
  const olderPackagePath = join(olderRoot, "package", "package.json");
  const olderPackage = JSON.parse(readFileSync(olderPackagePath, "utf8")) as { version: string };
  olderPackage.version = olderVersion;
  writeFileSync(olderPackagePath, `${JSON.stringify(olderPackage, null, 2)}\n`);
  const olderArchive = join(root, "apexcn-cli-older.tgz");
  execFileSync("tar", ["-czf", olderArchive, "-C", olderRoot, "package"]);
  const olderChecksums = checksumFile(root, "older-checksums.txt", olderArchive);
  const invalidChecksums = join(root, "invalid-checksums.txt");
  writeFileSync(invalidChecksums, `${"0".repeat(64)}  apexcn-cli.tgz\n`);
  return {
    currentVersion,
    olderVersion,
    currentArchive,
    currentChecksums,
    olderArchive,
    olderChecksums,
    invalidChecksums
  };
}

function checksumFile(root: string, name: string, archive: string): string {
  const path = join(root, name);
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(path, `${digest}  apexcn-cli.tgz\n`);
  return path;
}

function runPowerShell(
  executable: string,
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ReturnType<typeof spawnSync> {
  return spawnSync(executable, [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    ...args
  ], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 120_000
  });
}

function installedPackageVersion(installRoot: string): string {
  const packagePath = existsSync(join(installRoot, "package.json"))
    ? join(installRoot, "package.json")
    : join(installRoot, "package", "package.json");
  return (JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }).version;
}

function writeWindowsLifecycleReport(report: Record<string, unknown>): void {
  const configuredPath = process.env.APEXCN_WINDOWS_REPORT_PATH;
  if (!configuredPath) {
    return;
  }
  const output = isAbsolute(configuredPath) ? configuredPath : join(repoRoot, configuredPath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    kind: "windows-lifecycle-qualification",
    schemaVersion: 1,
    runner: "windows-2022",
    ...report,
    ok: true
  }, null, 2)}\n`);
}
