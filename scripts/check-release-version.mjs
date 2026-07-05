#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const expectedVersion = parseExpectedVersion(args) ?? readJson("package.json").version;
const expectedTag = `v${expectedVersion}`;
const releaseBase = "https://github.com/wfg2513148/apexcn-cli/releases/download";
const expectedReleasePackageUrl = `${releaseBase}/${expectedTag}/apexcn-cli.tgz`;
const allowedReleaseAssets = new Set([
  "apexcn-cli.tgz",
  "install-agent.sh",
  "install-agent.ps1",
  "checksums.txt",
  "apexcn-cli.tgz.sha256",
  "install-agent.sh.sha256",
  "install-agent.ps1.sha256"
]);
const failures = [];

checkJsonField("package.json", "version", expectedVersion);
checkJsonField("package.json", "name", "apexcn-cli");
checkJsonField("package-lock.json", "version", expectedVersion);
checkJsonField("package-lock.json", 'packages[""].version', expectedVersion);
checkSourceConstant("src/version.ts", "CLI_VERSION", expectedVersion);
checkSourceConstant("src/version.ts", "DEFAULT_USER_AGENT", `apexcn-cli/${expectedVersion}`);
checkShellInstallerDefaultUrl("scripts/install-agent.sh");
checkPowerShellInstallerDefaultUrl("scripts/install-agent.ps1");
checkMarkdownReleaseUrls(trackedMarkdownFiles());
checkCiWorkflow();
checkReleaseWorkflow();
checkIssuesBacklog();
checkPackageFiles();
checkNpmPackFilename();
checkReleaseArtifacts();

if (failures.length > 0) {
  console.error(`Release version check failed for expected version ${expectedVersion}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Release version check passed for ${expectedVersion}`);

function parseExpectedVersion(values) {
  if (values.length === 0) {
    return undefined;
  }
  if (values.length === 2 && values[0] === "--expected-version") {
    return values[1];
  }
  console.error("Usage: node scripts/check-release-version.mjs [--expected-version <version>]");
  process.exit(2);
}

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function getJsonField(object, fieldPath) {
  if (fieldPath === 'packages[""].version') {
    return object.packages?.[""]?.version;
  }
  return object[fieldPath];
}

function checkJsonField(path, fieldPath, expected) {
  const actual = getJsonField(readJson(path), fieldPath);
  if (actual !== expected) {
    failures.push(`${path} ${fieldPath}: expected ${expected}, got ${String(actual)}`);
  }
}

function checkSourceConstant(path, name, expected) {
  const match = new RegExp(`export const ${name} = "([^"]+)";`).exec(readText(path));
  const actual = match?.[1];
  if (actual !== expected) {
    failures.push(`${path} ${name}: expected ${expected}, got ${String(actual)}`);
  }
}

function checkShellInstallerDefaultUrl(path) {
  const text = readText(path);
  const match = /^package_url="\$\{APEXCN_CLI_PACKAGE_URL:-([^}]+)}"/m.exec(text);
  const actual = match?.[1];
  if (actual !== expectedReleasePackageUrl) {
    failures.push(`${path} default package URL: expected ${expectedReleasePackageUrl}, got ${String(actual)}`);
  }
}

function checkPowerShellInstallerDefaultUrl(path) {
  const text = readText(path);
  const match = /\[string]\$PackageUrl = \$\(if \(\$env:APEXCN_CLI_PACKAGE_URL\) \{ \$env:APEXCN_CLI_PACKAGE_URL \} else \{ "([^"]+)" \}\)/.exec(text);
  const actual = match?.[1];
  if (actual !== expectedReleasePackageUrl) {
    failures.push(`${path} default package URL: expected ${expectedReleasePackageUrl}, got ${String(actual)}`);
  }
}

function trackedMarkdownFiles() {
  const output = execFileSync("git", ["ls-files", "README.md", "docs"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output.split("\n").filter((path) => path.endsWith(".md")).sort();
}

function checkMarkdownReleaseUrls(paths) {
  const pattern = /https:\/\/github\.com\/wfg2513148\/apexcn-cli\/releases\/download\/([^/\s)"`]+)\/([^\s)"`]+)/g;
  for (const path of paths) {
    const text = readText(path);
    for (const match of text.matchAll(pattern)) {
      const [, tag, asset] = match;
      if (tag !== expectedTag) {
        failures.push(`${path} release URL tag: expected ${expectedTag}, got ${tag}`);
      }
      if (!allowedReleaseAssets.has(asset)) {
        failures.push(`${path} release URL asset: unexpected ${asset}`);
      }
    }
  }
}

function checkReleaseWorkflow() {
  const path = ".github/workflows/release.yml";
  const text = readText(path);
  const checkIndex = text.indexOf("npm run check:release");
  const artifactIndex = text.indexOf("scripts/check-release-artifacts.mjs");
  const releaseIndex = text.indexOf('gh release create "$GITHUB_REF_NAME"');
  if (checkIndex === -1) {
    failures.push(`${path}: missing npm run check:release`);
  }
  if (artifactIndex === -1) {
    failures.push(`${path}: missing scripts/check-release-artifacts.mjs`);
  }
  if (releaseIndex === -1) {
    failures.push(`${path}: missing gh release create "$GITHUB_REF_NAME"`);
  }
  if (checkIndex !== -1 && releaseIndex !== -1 && checkIndex > releaseIndex) {
    failures.push(`${path}: npm run check:release must run before gh release create`);
  }
  if (artifactIndex !== -1 && releaseIndex !== -1 && artifactIndex > releaseIndex) {
    failures.push(`${path}: release artifacts must be checked before gh release create`);
  }

  const releaseCommand = /gh release create "\$GITHUB_REF_NAME" \\\r?\n([\s\S]*?)\r?\n\s*--title/.exec(text);
  if (!releaseCommand) {
    failures.push(`${path}: unable to parse gh release create assets`);
    return;
  }
  const assets = releaseCommand[1]
    .split(/\\\r?\n/)
    .map((line) => line.trim().replace(/\s*\\$/, ""))
    .filter(Boolean);
  const expectedAssets = [
    "artifacts/apexcn-cli.tgz",
    "artifacts/install-agent.sh",
    "artifacts/install-agent.ps1",
    "artifacts/checksums.txt",
    "artifacts/apexcn-cli.tgz.sha256",
    "artifacts/install-agent.sh.sha256",
    "artifacts/install-agent.ps1.sha256"
  ];
  for (const asset of expectedAssets) {
    if (!assets.includes(asset)) {
      failures.push(`${path}: release assets missing ${asset}`);
    }
  }
  for (const asset of assets) {
    if (!expectedAssets.includes(asset)) {
      failures.push(`${path}: release assets include unexpected ${asset}`);
    }
  }
}

function checkCiWorkflow() {
  const path = ".github/workflows/ci.yml";
  const text = readText(path);
  const testIndex = text.indexOf("npm test");
  const releaseCheckIndex = text.indexOf("npm run check:release");
  if (releaseCheckIndex === -1) {
    failures.push(`${path}: missing npm run check:release`);
  }
  if (testIndex !== -1 && releaseCheckIndex !== -1 && releaseCheckIndex < testIndex) {
    failures.push(`${path}: npm run check:release must run after npm test`);
  }
  if (!text.includes("windows-latest")) {
    failures.push(`${path}: missing windows-latest installer coverage`);
  }
  if (!text.includes("test/install-agent.test.ts test/release-version.test.ts")) {
    failures.push(`${path}: missing focused Windows installer/release tests`);
  }
}

function checkIssuesBacklog() {
  const path = "issues.md";
  const text = readText(path);
  if (/No open CLI backlog items\./.test(text)) {
    failures.push(`${path}: backlog cannot claim there are no open CLI backlog items while roadmap tracks active hardening work`);
  }
}

function checkPackageFiles() {
  const packageJson = readJson("package.json");
  const files = Array.isArray(packageJson.files) ? packageJson.files : [];
  const required = [
    "agent-skill/",
    "dist/",
    "docs/",
    "eval/rag/",
    "scripts/baseline-report.mjs",
    "scripts/eval-rag.mjs",
    "scripts/generate-release-checksums.mjs",
    "scripts/install-agent.sh",
    "scripts/install-agent.ps1",
    "README.md"
  ];
  for (const file of required) {
    if (!files.includes(file)) {
      failures.push(`package.json files missing ${file}`);
    }
  }
}

function checkNpmPackFilename() {
  const expected = `apexcn-cli-${expectedVersion}.tgz`;
  let output;
  try {
    output = execNpm(["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    failures.push(`npm pack --dry-run --json failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const pack = JSON.parse(output)[0];
  if (pack.filename !== expected) {
    failures.push(`npm pack filename: expected ${expected}, got ${String(pack.filename)}`);
  }
}

function execNpm(npmArgs, options) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], options);
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, options);
}

function checkReleaseArtifacts() {
  const tempArtifactsDir = mkdtempSync(join(tmpdir(), "apexcn-release-version-"));
  try {
    execFileSync("node", ["scripts/check-release-artifacts.mjs", "--expected-version", expectedVersion, "--artifacts-dir", tempArtifactsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    failures.push(`release artifact check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(tempArtifactsDir, { recursive: true, force: true });
  }
}
