#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const expectedVersion = args.expectedVersion ?? readJson("package.json").version;
const artifactsDir = args.artifactsDir ? join(repoRoot, args.artifactsDir) : mkdtempSync(join(tmpdir(), "apexcn-release-"));
const packageDir = join(artifactsDir, "package");
const archivePath = join(artifactsDir, "apexcn-cli.tgz");

buildArtifacts();
verifyArtifacts();

if (!args.artifactsDir) {
  rmSync(artifactsDir, { recursive: true, force: true });
}

console.log(`Release artifact check passed for ${expectedVersion}`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--expected-version") {
      parsed.expectedVersion = values[index + 1];
      index += 1;
      continue;
    }
    if (value === "--artifacts-dir") {
      parsed.artifactsDir = values[index + 1];
      index += 1;
      continue;
    }
    console.error("Usage: node scripts/check-release-artifacts.mjs [--expected-version <version>] [--artifacts-dir <path>]");
    process.exit(2);
  }
  return parsed;
}

function buildArtifacts() {
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });

  for (const path of trackedReleaseFiles()) {
    const source = join(repoRoot, path);
    const target = join(packageDir, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, dereference: false });
  }
  copyRequired("dist", "dist");
  copyRequired("node_modules/commander", "node_modules/commander");

  execFileSync("tar", ["-czf", archivePath, "-C", packageDir, "."], { cwd: repoRoot });
  cpSync(join(repoRoot, "scripts/install-agent.sh"), join(artifactsDir, "install-agent.sh"));
  cpSync(join(repoRoot, "scripts/install-agent.ps1"), join(artifactsDir, "install-agent.ps1"));
}

function copyRequired(sourcePath, targetPath) {
  const source = join(repoRoot, sourcePath);
  const target = join(packageDir, targetPath);
  mkdirSync(dirname(target), { recursive: true });
  try {
    cpSync(source, target, { recursive: true, dereference: false });
  } catch (error) {
    throw new Error(`Unable to copy ${sourcePath}. Run npm ci and npm run build before release checks. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function trackedReleaseFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot });
  return output.toString("utf8").split("\0").filter((path) =>
    path.length > 0 &&
    !path.startsWith(".github/") &&
    !path.startsWith("artifacts/") &&
    !path.startsWith("coverage/") &&
    !path.includes("/.DS_Store")
  );
}

function verifyArtifacts() {
  const requiredAssets = ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1"];
  for (const asset of requiredAssets) {
    readFileSync(join(artifactsDir, asset));
  }

  const entries = new Set(execFileSync("tar", ["-tzf", archivePath], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, "")));

  const requiredFiles = [
    "package.json",
    "package-lock.json",
    "agent-skill/SKILL.md",
    "docs/quickstart.md",
    "dist/index.js",
    "dist/version.js",
    "node_modules/commander/package.json",
    "scripts/install-agent.sh",
    "scripts/install-agent.ps1"
  ];
  for (const file of requiredFiles) {
    if (!entries.has(file)) {
      throw new Error(`release package missing ${file}`);
    }
  }

  const forbiddenPrefixes = [".git/", ".github/", "artifacts/", "coverage/"];
  for (const entry of entries) {
    if (forbiddenPrefixes.some((prefix) => entry.startsWith(prefix))) {
      throw new Error(`release package contains forbidden path ${entry}`);
    }
  }

  const packageJson = JSON.parse(execFileSync("tar", ["-xOzf", archivePath, "./package.json"], {
    cwd: repoRoot,
    encoding: "utf8"
  }));
  if (packageJson.name !== "apexcn-cli") {
    throw new Error(`release package name: expected apexcn-cli, got ${String(packageJson.name)}`);
  }
  if (packageJson.version !== expectedVersion) {
    throw new Error(`release package version: expected ${expectedVersion}, got ${String(packageJson.version)}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}
