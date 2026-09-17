import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.platform, "win32", "This qualification requires real Windows");
const shell = process.env.APEXCN_TEST_POWERSHELL ?? "pwsh.exe";
const assets = resolve("release-assets");
const tag = process.env.APEXCN_TEST_RELEASE_TAG;
const expectedSha256 = process.env.APEXCN_TEST_ARCHIVE_SHA256;
assert.match(tag ?? "", /^v\d+\.\d+\.\d+$/, "An explicit stable release tag is required");
assert.match(expectedSha256 ?? "", /^[a-f0-9]{64}$/, "An explicit candidate checksum is required");
const version = tag.slice(1);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(sha256(join(assets, "apexcn-cli.tgz")), expectedSha256);
for (const line of readFileSync(join(assets, "checksums.txt"), "utf8").trim().split(/\r?\n/)) {
  const match = /^([a-f0-9]{64})\s+\*?([a-zA-Z0-9.-]+)$/.exec(line);
  assert.ok(match, "Invalid checksum entry");
  assert.equal(sha256(join(assets, match[2])), match[1]);
}

const root = mkdtempSync(join(tmpdir(), "apexcn windows release "));
const home = join(root, "home");
const install = join(root, "install");
const bin = join(root, "bin");
const backups = join(root, "backups");
const config = join(home, ".apexcn", "config.json");
const configText = '{"profiles":{"test":{"baseUrl":"https://example.invalid","token":"synthetic-only"}}}\n';
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: join(root, "local"),
  APEXCN_CONFIG_PATH: config,
  APEXCN_CLI_SKILL_HOME: home,
  APEXCN_CLI_INSTALL_ROOT: install,
  APEXCN_CLI_BIN_DIR: bin,
  APEXCN_CLI_BACKUP_ROOT: backups,
  APEXCN_CLI_PACKAGE_URL: pathToFileURL(join(assets, "apexcn-cli.tgz")).href,
  APEXCN_CLI_CHECKSUMS_URL: pathToFileURL(join(assets, "checksums.txt")).href,
  APEXCN_QUALIFICATION_LAUNCHER: join(bin, "apexcn.cmd")
};
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;
const evidence = [];
function run(label, args, expectedCode = 0) {
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", ...args], {
    env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024
  });
  evidence.push({ label, status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message });
  if (expectedCode === "failure") assert.ok(result.status !== null && result.status !== 0, JSON.stringify(evidence.at(-1)));
  else assert.equal(result.status, expectedCode, JSON.stringify(evidence.at(-1)));
  return result.stdout.trim();
}
let ok = false;
try {
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, configText);
  run("install published archive", ["-ExecutionPolicy", "Bypass", "-File", join(assets, "install-agent.ps1")]);
  assert.equal(run("installed version", ["-Command", "& $env:APEXCN_QUALIFICATION_LAUNCHER --version; exit $LASTEXITCODE"]), version);
  run("apexcn update", ["-Command", "& $env:APEXCN_QUALIFICATION_LAUNCHER update; exit $LASTEXITCODE"]);
  assert.ok(readdirSync(backups).length > 0);
  assert.equal(readFileSync(config, "utf8"), configText);
  const badChecksum = join(root, "bad-checksums.txt");
  writeFileSync(badChecksum, `${"0".repeat(64)}  apexcn-cli.tgz\n`);
  env.APEXCN_CLI_CHECKSUMS_URL = pathToFileURL(badChecksum).href;
  run("failed update preserves installation", ["-Command", "& $env:APEXCN_QUALIFICATION_LAUNCHER update; exit $LASTEXITCODE"], "failure");
  assert.match(evidence.at(-1).stdout + evidence.at(-1).stderr, /Checksum verification failed/);
  assert.equal(run("version after rejected update", ["-Command", "& $env:APEXCN_QUALIFICATION_LAUNCHER --version; exit $LASTEXITCODE"]), version);
  assert.equal(readFileSync(config, "utf8"), configText);
  ok = true;
} finally {
  rmSync(root, { recursive: true, force: true });
  const output = resolve(process.env.APEXCN_WINDOWS_RELEASE_REPORT ?? "reports/windows-release.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ version, archiveSha256: expectedSha256, platform: process.platform, arch: process.arch, node: process.version, shell, ok, cleaned: !existsSync(root), evidence }, null, 2) + "\n");
}
