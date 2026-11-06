import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeManifest } from "./runtime-manifest.mjs";

const candidateSha = "57823150cd639f8d89c6a355525d09931119d147ae1be280e64604460eb20734";
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
const report = { schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version, shell, expectedCandidateSha256: candidateSha, expectedPriorSha256: priorSha, installedChecks: [], steps: [], ok: false, cleaned: false };
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const manifestSha = (manifest) => createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
function run(label, args, expectFailure = false) {
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  const step = { label, expectedOutcome: expectFailure ? "failure" : "success", status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message };
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
function recordInstalled(label, expectedVersion) {
  const cliRoot = installedRoot();
  assert.ok(cliRoot, "installed package root missing");
  const entry = join(cliRoot, "dist", "index.js");
  const entrySha256 = sha(entry);
  const launcherSha256 = sha(launcher);
  const metadata = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
  const dependencies = Object.fromEntries(Object.keys(metadata.dependencies ?? {}).sort().map((name) => [name,
    existsSync(join(cliRoot, "node_modules", name, "package.json"))]));
  const observation = { label, expectedVersion, actualVersion: metadata.version, installationRoot: cliRoot,
    entryPath: entry, launcherPath: launcher, entrySha256, launcherSha256, dependencies };
  report.installedChecks.push(observation);
  let actualManifest;
  try { actualManifest = runtimeManifest(cliRoot); }
  catch (error) { observation.runtimeManifestError = error instanceof Error ? error.message : String(error); throw error; }
  observation.runtimeManifest = actualManifest;
  observation.runtimeManifestSha256 = manifestSha(actualManifest);
  observation.runtimeFileCount = actualManifest.files.length;
  const candidateVersion = expectedVersion === "1.3.0";
  assert.equal(metadata.version, expectedVersion, `${label}: installed package version mismatch`);
  assert.equal(entrySha256, candidateVersion ? report.expectedEntrySha256 : report.expectedPriorEntrySha256, `${label}: installed entry digest mismatch`);
  assert.equal(observation.runtimeManifestSha256, candidateVersion ? report.expectedRuntimeManifestSha256 : report.expectedPriorRuntimeManifestSha256, `${label}: installed runtime tree mismatch`);
  assert.equal(readFileSync(launcher, "ascii").replace(/\r\n/g, "\n").trimEnd(),
    `@echo off\nnode "${entry}" %*`, `${label}: launcher content mismatch`);
  const launcherKey = candidateVersion ? "expectedLauncherSha256" : "expectedPriorLauncherSha256";
  if (report[launcherKey] === undefined) report[launcherKey] = launcherSha256;
  assert.equal(launcherSha256, report[launcherKey], `${label}: launcher digest changed`);
  for (const [dependency, present] of Object.entries(dependencies)) {
    assert.ok(present, `${label}: ${dependency} missing`);
  }
}
try {
  assert.equal(process.platform, "win32", "Real Windows is required");
  assert.equal(process.version, "v20.20.2", "Node 20.20.2 is required for this matrix");
  assert.ok(expectedShell === "5.1" || expectedShell === "7", "Expected PowerShell version is required");
  report.nodeExecutablePath = process.execPath;
  report.nodeExecutableSha256 = sha(process.execPath);
  report.actualCandidateSha256 = sha(candidate);
  assert.equal(report.actualCandidateSha256, candidateSha, "candidate digest mismatch");
  report.expectedEntrySha256 = readFileSync(join(assets, "candidate-entry.sha256"), "utf8").trim();
  assert.match(report.expectedEntrySha256, /^[0-9a-f]{64}$/, "candidate entry digest missing or invalid");
  const entryFromArchive = spawnSync("tar.exe", ["-xOzf", candidate, "package/dist/index.js"], {
    cwd: root, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  if (entryFromArchive.error || entryFromArchive.signal) report.cleanupDeferred = true;
  report.archiveEntryExtraction = { status: entryFromArchive.status, signal: entryFromArchive.signal,
    error: entryFromArchive.error?.message, stderr: entryFromArchive.stderr?.toString("utf8") ?? "" };
  assert.equal(entryFromArchive.status, 0, "candidate entry extraction failed");
  assert.ok(!entryFromArchive.error && !entryFromArchive.signal, "candidate entry extraction was incomplete");
  report.windowsArchiveEntrySha256 = createHash("sha256").update(entryFromArchive.stdout).digest("hex");
  assert.equal(report.windowsArchiveEntrySha256, report.expectedEntrySha256, "candidate archive entry digest mismatch");
  const reference = join(root, "candidate-reference");
  mkdirSync(reference);
  const extracted = spawnSync("tar.exe", ["-xzf", candidate, "-C", reference], {
    cwd: root, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  if (extracted.error || extracted.signal) report.cleanupDeferred = true;
  report.archiveExtraction = { status: extracted.status, signal: extracted.signal,
    error: extracted.error?.message, stderr: extracted.stderr?.toString("utf8") ?? "" };
  assert.equal(extracted.status, 0, "candidate archive extraction failed");
  assert.ok(!extracted.error && !extracted.signal, "candidate archive extraction was incomplete");
  const archiveManifest = runtimeManifest(join(reference, "package"));
  const ubuntuManifest = JSON.parse(readFileSync(join(assets, "runtime-manifest.json"), "utf8"));
  report.archiveRuntimeManifest = archiveManifest;
  report.expectedRuntimeManifestSha256 = manifestSha(archiveManifest);
  report.ubuntuRuntimeManifestSha256 = manifestSha(ubuntuManifest);
  report.expectedRuntimeFileCount = archiveManifest.files.length;
  assert.equal(report.expectedRuntimeManifestSha256, report.ubuntuRuntimeManifestSha256, "archive runtime tree differs between Windows and Ubuntu");
  report.actualPriorSha256 = sha(prior);
  assert.equal(report.actualPriorSha256, priorSha, "prior digest mismatch");
  const priorReference = join(root, "prior-reference");
  mkdirSync(priorReference);
  const extractedPrior = spawnSync("tar.exe", ["-xzf", prior, "-C", priorReference], {
    cwd: root, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  if (extractedPrior.error || extractedPrior.signal) report.cleanupDeferred = true;
  report.priorArchiveExtraction = { status: extractedPrior.status, signal: extractedPrior.signal,
    error: extractedPrior.error?.message, stderr: extractedPrior.stderr?.toString("utf8") ?? "" };
  assert.equal(extractedPrior.status, 0, "prior archive extraction failed");
  assert.ok(!extractedPrior.error && !extractedPrior.signal, "prior archive extraction was incomplete");
  const priorManifest = runtimeManifest(join(priorReference, "package"));
  const ubuntuPriorManifest = JSON.parse(readFileSync(join(assets, "prior", "runtime-manifest.json"), "utf8"));
  report.priorArchiveRuntimeManifest = priorManifest;
  report.expectedPriorRuntimeManifestSha256 = manifestSha(priorManifest);
  report.ubuntuPriorRuntimeManifestSha256 = manifestSha(ubuntuPriorManifest);
  report.expectedPriorEntrySha256 = priorManifest.files.find((file) => file.path === "dist/index.js").sha256;
  assert.equal(report.expectedPriorRuntimeManifestSha256, report.ubuntuPriorRuntimeManifestSha256, "prior archive runtime tree differs between Windows and Ubuntu");
  const shellVersion = run("shell version", ["-Command", "$PSVersionTable.PSVersion.ToString()"]);
  report.shellVersion = shellVersion.stdout.trim();
  assert.match(report.shellVersion, expectedShell === "5.1" ? /^5\.1(?:\.|$)/ : /^7(?:\.|$)/, "PowerShell version mismatch");
  const launcherNode = run("launcher node identity", ["-Command", "& $env:ComSpec /d /c 'node -p process.execPath'; exit $LASTEXITCODE"]);
  report.launcherNodeExecutablePath = launcherNode.stdout.trim();
  report.launcherNodeExecutableSha256 = sha(report.launcherNodeExecutablePath);
  assert.equal(report.launcherNodeExecutableSha256, report.nodeExecutableSha256, "launcher Node executable SHA mismatch");
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, configText);
  const priorChecksums = join(root, "prior-checksums.txt");
  const candidateChecksums = join(root, "candidate-checksums.txt");
  writeFileSync(priorChecksums, `${priorSha}  apexcn-cli.tgz\n`);
  writeFileSync(candidateChecksums, `${candidateSha}  apexcn-cli.tgz\n`);

  setArchive(prior, priorChecksums);
  run("install 1.2.2", ["-File", installer]);
  assert.equal(invokeLauncher("prior version", "--version").stdout.trim(), "1.2.2");
  recordInstalled("install prior", "1.2.2");
  assert.equal(readFileSync(config, "utf8"), configText);

  setArchive(candidate, candidateChecksums);
  invokeLauncher("upgrade 1.2.2 to candidate", "update");
  assert.equal(invokeLauncher("candidate version", "--version").stdout.trim(), "1.3.0");
  recordInstalled("upgrade to candidate", "1.3.0");
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
  recordInstalled("after failed update", "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);

  const lifecycle = () => {
    const cliRoot = installedRoot();
    assert.ok(cliRoot, "installed package root missing");
    return join(cliRoot, "scripts", "lifecycle-agent.ps1");
  };
  run("rollback to 1.2.2", ["-File", lifecycle(), "rollback", "-Backup", join(backups, previous), "-Yes"]);
  assert.equal(invokeLauncher("version after rollback", "--version").stdout.trim(), "1.2.2");
  recordInstalled("after rollback", "1.2.2");
  assert.equal(readFileSync(config, "utf8"), configText);

  setArchive(candidate, candidateChecksums);
  run("shell-native upgrade to candidate", ["-File", lifecycle(), "upgrade"]);
  assert.equal(invokeLauncher("shell-native upgraded version", "--version").stdout.trim(), "1.3.0");
  recordInstalled("shell-native upgrade", "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);
  setArchive(candidate, badChecksums);
  const shellFailed = run("shell-native failed checksum upgrade", ["-File", lifecycle(), "upgrade"], true);
  assert.match(shellFailed.stdout + shellFailed.stderr, /Checksum verification failed/i);
  assert.equal(invokeLauncher("version after shell-native failed upgrade", "--version").stdout.trim(), "1.3.0");
  recordInstalled("after shell-native failed upgrade", "1.3.0");
  assert.equal(readFileSync(config, "utf8"), configText);
  setArchive(candidate, candidateChecksums);
  run("reinstall candidate", ["-File", installer]);
  assert.equal(invokeLauncher("reinstalled candidate version", "--version").stdout.trim(), "1.3.0");
  recordInstalled("reinstall candidate", "1.3.0");
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
  process.stdout.write(`${JSON.stringify({
    ok: report.ok, cleaned: report.cleaned, shell, shellVersion: report.shellVersion,
    node: report.node, nodeExecutablePath: report.nodeExecutablePath, nodeExecutableSha256: report.nodeExecutableSha256,
    launcherNodeExecutablePath: report.launcherNodeExecutablePath, launcherNodeExecutableSha256: report.launcherNodeExecutableSha256,
    expectedCandidateSha256: report.expectedCandidateSha256, actualCandidateSha256: report.actualCandidateSha256,
    expectedPriorSha256: report.expectedPriorSha256, actualPriorSha256: report.actualPriorSha256,
    expectedEntrySha256: report.expectedEntrySha256, windowsArchiveEntrySha256: report.windowsArchiveEntrySha256,
    archiveEntryExtraction: report.archiveEntryExtraction, archiveExtraction: report.archiveExtraction, priorArchiveExtraction: report.priorArchiveExtraction,
    expectedRuntimeManifestSha256: report.expectedRuntimeManifestSha256, ubuntuRuntimeManifestSha256: report.ubuntuRuntimeManifestSha256,
    expectedRuntimeFileCount: report.expectedRuntimeFileCount, expectedPriorRuntimeManifestSha256: report.expectedPriorRuntimeManifestSha256,
    ubuntuPriorRuntimeManifestSha256: report.ubuntuPriorRuntimeManifestSha256,
    expectedLauncherSha256: report.expectedLauncherSha256, expectedPriorLauncherSha256: report.expectedPriorLauncherSha256,
    installedChecks: report.installedChecks.map(({ runtimeManifest: _manifest, ...summary }) => summary),
    steps: report.steps.map((step) => ({ ...step, stdout: step.stdout.slice(0, 4096), stderr: step.stderr.slice(0, 4096) })),
    error: report.error, cleanupDeferred: report.cleanupDeferred
  })}\n`);
}
