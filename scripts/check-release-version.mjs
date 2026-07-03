#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const expectedVersion = parseExpectedVersion(args) ?? readJson("package.json").version;
const expectedTag = `v${expectedVersion}`;
const releaseBase = "https://github.com/wfg2513148/apexcn-cli/releases/download";
const expectedReleasePackageUrl = `${releaseBase}/${expectedTag}/apexcn-cli.tgz`;
const allowedReleaseAssets = new Set(["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1"]);
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
checkReleaseWorkflow();
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

  const releaseCommand = /gh release create "\$GITHUB_REF_NAME" \\\n([\s\S]*?)\n\s*--title/.exec(text);
  if (!releaseCommand) {
    failures.push(`${path}: unable to parse gh release create assets`);
    return;
  }
  const assets = releaseCommand[1]
    .split("\\\n")
    .map((line) => line.trim().replace(/\s*\\$/, ""))
    .filter(Boolean);
  const expectedAssets = ["artifacts/apexcn-cli.tgz", "artifacts/install-agent.sh", "artifacts/install-agent.ps1"];
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

function checkNpmPackFilename() {
  const expected = `apexcn-cli-${expectedVersion}.tgz`;
  let output;
  try {
    output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
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

function checkReleaseArtifacts() {
  try {
    execFileSync("node", ["scripts/check-release-artifacts.mjs", "--expected-version", expectedVersion], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    failures.push(`release artifact check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
