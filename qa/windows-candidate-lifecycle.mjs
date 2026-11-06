import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const candidateSha = "f93e951e54780f713b9b43f4b9fed13f9eebb30960ab1a54d6059f165cc8abaa";
const priorSha = "bd3ed6cae470af9710397805b609c6b93e479995295dbb74f0fb15b32656b852";
const assets = resolve("candidate-assets");
const candidate = join(assets, "apexcn-cli.tgz");
const prior = join(assets, "prior", "apexcn-cli.tgz");
const installer = join(assets, "install-agent.ps1");
const reportPath = resolve(process.env.APEXCN_QA_REPORT ?? "reports/windows-candidate-lifecycle.json");
const shell = process.env.APEXCN_QA_SHELL ?? "pwsh.exe";
const expectedShell = process.env.APEXCN_QA_EXPECTED_SHELL;
let root;
try {
  root = mkdtempSync(join(tmpdir(), "apexcn-independent-windows-"));
} catch (error) {
  const failure = { ok: false, stage: "create-temp", error: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
  } catch (reportError) {
    process.stderr.write(`Report write failed: ${reportError instanceof Error ? reportError.message : String(reportError)}\n`);
  }
  process.exit(1);
}
const install = join(root, "install");
const bin = join(root, "bin");
const backups = join(root, "backups");
const config = join(root, "config", "config.json");
const launcher = join(bin, "apexcn.cmd");
const configText = '{"current":"test","profiles":{"test":{"baseUrl":"https://example.invalid/ords","token":"synthetic-only-not-a-credential"}}}\n';
const env = {};
for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT", "COMSPEC", "LOCALAPPDATA", "APPDATA", "OS"]) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
Object.assign(env, {
  APEXCN_CONFIG_PATH: config,
  APEXCN_CLI_SKILL_HOME: join(root, "skill-home"),
  APEXCN_CLI_INSTALL_ROOT: install,
  APEXCN_CLI_BIN_DIR: bin,
  APEXCN_CLI_BACKUP_ROOT: backups,
  APEXCN_QA_LAUNCHER: launcher
});
const report = { schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version, shell, candidateSha256: candidateSha, priorSha256: priorSha, steps: [], ok: false, cleaned: false };
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function run(label, args, expectFailure = false) {
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  const step = { label, status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message };
  report.steps.push(step);
  if (result.error || result.signal) report.cleanupDeferred = true;
  const expected = expectFailure ? result.status !== null && result.status !== 0 && !result.error && !result.signal
    : result.status === 0 && !result.error && !result.signal;
  if (!expected) process.stderr.write(`${JSON.stringify({ stage: "unexpected-subprocess-result", ...step })}\n`);
  assert.ok(expected, expectFailure ? `${label} should fail normally` : `${label} failed`);
  return step;
}
function invokeLauncher(label, command, expectFailure = false) {
  return run(label, ["-Command", `& $env:APEXCN_QA_LAUNCHER ${command}; exit $LASTEXITCODE`], expectFailure);
}
function setArchive(path, checksumPath) {
  env.APEXCN_CLI_PACKAGE_URL = pathToFileURL(path).href;
  env.APEXCN_CLI_CHECKSUMS_URL = pathToFileURL(checksumPath).href;
}
function installedRoot() {
  return [install, join(install, "package"), join(install, "cli")].find((path) => existsSync(join(path, "package.json")));
}
try {
  assert.equal(process.platform, "win32", "Real Windows is required");
  assert.equal(process.version, "v20.20.2", "Node 20.20.2 is required for this matrix");
  assert.ok(expectedShell === "5.1" || expectedShell === "7", "Expected PowerShell version is required");
  assert.equal(sha(candidate), candidateSha, "candidate digest mismatch");
  assert.equal(sha(prior), priorSha, "prior digest mismatch");
  const shellVersion = run("shell version", ["-Command", "$PSVersionTable.PSVersion.ToString()"]);
  report.shellVersion = shellVersion.stdout.trim();
  assert.match(report.shellVersion, expectedShell === "5.1" ? /^5\.1(?:\.|$)/ : /^7(?:\.|$)/, "PowerShell version mismatch");
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, configText);
  const priorChecksums = join(root, "prior-checksums.txt");
  const candidateChecksums = join(root, "candidate-checksums.txt");
  writeFileSync(priorChecksums, `${priorSha}  apexcn-cli.tgz\n`);
  writeFileSync(candidateChecksums, `${candidateSha}  apexcn-cli.tgz\n`);

  setArchive(prior, priorChecksums);
  run("install 1.2.2", ["-File", installer]);
  assert.equal(invokeLauncher("prior version", "--version").stdout.trim(), "1.2.2");
  assert.equal(readFileSync(config, "utf8"), configText);

  setArchive(candidate, candidateChecksums);
  invokeLauncher("upgrade 1.2.2 to candidate", "update");
  assert.equal(invokeLauncher("candidate version", "--version").stdout.trim(), "1.3.0");
  assert.match(invokeLauncher("candidate v2 help", "admin operations-v2 --help").stdout, /--user-id/);
  assert.equal(readFileSync(config, "utf8"), configText);
  const previous = readdirSync(backups).find((name) => name.startsWith("1.2.2-"));
  assert.ok(previous, "previous-version backup missing");

  const badChecksums = join(root, "bad-checksums.txt");
  writeFileSync(badChecksums, `${"0".repeat(64)}  apexcn-cli.tgz\n`);
  setArchive(candidate, badChecksums);
  const failed = invokeLauncher("failed checksum update", "update", true);
  assert.match(failed.stdout + failed.stderr, /Checksum verification failed/i);
  assert.equal(invokeLauncher("version after failed update", "--version").stdout.trim(), "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);

  const lifecycle = () => {
    const cliRoot = installedRoot();
    assert.ok(cliRoot, "installed package root missing");
    return join(cliRoot, "scripts", "lifecycle-agent.ps1");
  };
  run("rollback to 1.2.2", ["-File", lifecycle(), "rollback", "-Backup", join(backups, previous), "-Yes"]);
  assert.equal(invokeLauncher("version after rollback", "--version").stdout.trim(), "1.2.2");
  assert.equal(readFileSync(config, "utf8"), configText);

  setArchive(candidate, candidateChecksums);
  run("shell-native upgrade to candidate", ["-File", lifecycle(), "upgrade"]);
  assert.equal(invokeLauncher("shell-native upgraded version", "--version").stdout.trim(), "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);
  setArchive(candidate, badChecksums);
  const shellFailed = run("shell-native failed checksum upgrade", ["-File", lifecycle(), "upgrade"], true);
  assert.match(shellFailed.stdout + shellFailed.stderr, /Checksum verification failed/i);
  assert.equal(invokeLauncher("version after shell-native failed upgrade", "--version").stdout.trim(), "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);
  setArchive(candidate, candidateChecksums);
  run("reinstall candidate", ["-File", installer]);
  assert.equal(invokeLauncher("reinstalled candidate version", "--version").stdout.trim(), "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);
  run("uninstall candidate", ["-File", lifecycle(), "uninstall", "-Yes"]);
  assert.equal(existsSync(launcher), false, "launcher still exists after uninstall");
  assert.equal(existsSync(install), false, "installation still exists after uninstall");
  assert.equal(readFileSync(config, "utf8"), configText);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, stage: "lifecycle", error: report.error })}\n`);
  process.exitCode = 1;
} finally {
  if (!report.cleanupDeferred) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      report.cleanupError = error instanceof Error ? error.message : String(error);
      report.ok = false;
      process.exitCode = 1;
    }
  }
  if (report.cleanupDeferred) report.retainedRoot = root;
  report.cleaned = !existsSync(root);
  if (!report.cleaned) {
    report.ok = false;
    process.exitCode = 1;
  }
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ reportWriteError: error instanceof Error ? error.message : String(error), firstError: report.error })}\n`);
    report.ok = false;
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify({ ok: report.ok, cleaned: report.cleaned, shell, steps: report.steps.length, error: report.error })}\n`);
}
