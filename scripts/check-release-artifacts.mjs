#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const expectedVersion = args.expectedVersion ?? readJson("package.json").version;
const artifactsDir = args.artifactsDir ? join(repoRoot, args.artifactsDir) : mkdtempSync(join(tmpdir(), "apexcn-release-"));
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
  mkdirSync(artifactsDir, { recursive: true });
  const pack = runNpmPack();
  renameSync(join(artifactsDir, pack.filename), archivePath);
  cpSync(join(repoRoot, "scripts/install-agent.sh"), join(artifactsDir, "install-agent.sh"));
  cpSync(join(repoRoot, "scripts/install-agent.ps1"), join(artifactsDir, "install-agent.ps1"));
}

function runNpmPack() {
  try {
    const output = execFileSync("npm", ["pack", "--json", "--pack-destination", artifactsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const pack = JSON.parse(output)[0];
    const expectedFilename = `apexcn-cli-${expectedVersion}.tgz`;
    if (pack.filename !== expectedFilename) {
      throw new Error(`npm pack filename: expected ${expectedFilename}, got ${String(pack.filename)}`);
    }
    return pack;
  } catch (error) {
    throw new Error(`Unable to build release package with npm pack. Run npm ci and npm run build before release checks. ${error instanceof Error ? error.message : String(error)}`);
  }
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
    "package/package.json",
    "package/agent-skill/SKILL.md",
    "package/docs/quickstart.md",
    "package/eval/rag/questions.zh.jsonl",
    "package/eval/rag/expected-references.jsonl",
    "package/dist/index.js",
    "package/dist/version.js",
    "package/node_modules/commander/package.json",
    "package/scripts/eval-rag.mjs",
    "package/scripts/install-agent.sh",
    "package/scripts/install-agent.ps1"
  ];
  for (const file of requiredFiles) {
    if (!entries.has(file)) {
      throw new Error(`release package missing ${file}`);
    }
  }

  const forbiddenPrefixes = ["package/.git/", "package/.github/", "package/artifacts/", "package/coverage/", "package/src/", "package/test/"];
  const forbiddenFiles = [
    "package/scripts/check-release-version.mjs",
    "package/scripts/check-release-artifacts.mjs",
    "package/tsconfig.json",
    "package/vitest.config.ts"
  ];
  for (const entry of entries) {
    if (forbiddenPrefixes.some((prefix) => entry.startsWith(prefix))) {
      throw new Error(`release package contains forbidden path ${entry}`);
    }
    if (forbiddenFiles.includes(entry)) {
      throw new Error(`release package contains forbidden file ${entry}`);
    }
  }

  const packageJson = JSON.parse(execFileSync("tar", ["-xOzf", archivePath, "package/package.json"], {
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
