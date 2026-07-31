#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNpmPackResult } from "./npm-pack-json.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const expectedVersion = args.expectedVersion ?? readJson("package.json").version;
const artifactsDir = args.artifactsDir ? resolveArtifactsDir(args.artifactsDir) : join(repoRoot, "artifacts");
const archivePath = join(artifactsDir, "apexcn-cli.tgz");

buildArtifacts();
verifyArtifacts();

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

function resolveArtifactsDir(path) {
  return isAbsolute(path) ? path : join(repoRoot, path);
}

function buildArtifacts() {
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });
  const pack = runNpmPack();
  renameSync(join(artifactsDir, pack.filename), archivePath);
  cpSync(join(repoRoot, "scripts/install-agent.sh"), join(artifactsDir, "install-agent.sh"));
  cpSync(join(repoRoot, "scripts/install-agent.ps1"), join(artifactsDir, "install-agent.ps1"));
  execFileSync("node", ["scripts/generate-release-supply-chain.mjs", artifactsDir], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  execFileSync("node", ["scripts/generate-release-checksums.mjs", artifactsDir], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runNpmPack() {
  try {
    const output = execNpm(["pack", "--json", "--pack-destination", artifactsDir], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const pack = parseNpmPackResult(output);
    const expectedFilename = `apexcn-cli-${expectedVersion}.tgz`;
    if (pack.filename !== expectedFilename) {
      throw new Error(`npm pack filename: expected ${expectedFilename}, got ${String(pack.filename)}`);
    }
    return pack;
  } catch (error) {
    throw new Error(`Unable to build release package with npm pack. Run npm ci and npm run build before release checks. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function execNpm(npmArgs, options) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], options);
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, options);
}

function verifyArtifacts() {
  const requiredAssets = [
    "apexcn-cli.tgz",
    "install-agent.sh",
    "install-agent.ps1",
    "apexcn-cli.spdx.json",
    "release-provenance.json",
    "checksums.txt",
    "apexcn-cli.tgz.sha256",
    "install-agent.sh.sha256",
    "install-agent.ps1.sha256",
    "apexcn-cli.spdx.json.sha256",
    "release-provenance.json.sha256"
  ];
  for (const asset of requiredAssets) {
    readFileSync(join(artifactsDir, asset));
  }

  const entries = new Set(execFileSync("tar", ["-tzf", archivePath], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, "").replaceAll("\\", "/")));

  const requiredFiles = [
    "package/package.json",
    "package/README.md",
    "package/agent-skill/SKILL.md",
    "package/docs/cli-manual.en.md",
    "package/docs/cli-manual.zh.md",
    "package/docs/security-model.md",
    "package/docs/user-guide.en.md",
    "package/docs/user-guide.zh.md",
    "package/dist/index.js",
    "package/dist/version.js",
    "package/dist/core/capability-compatibility.js",
    "package/dist/core/credential-store.js",
    "package/dist/core/doctor-snapshot.js",
    "package/dist/core/issue-routing.js",
    "package/dist/core/runtime-session.js",
    "package/dist/core/workflow-plan.js",
    "package/node_modules/commander/package.json",
    "package/eval/qualification/tasks.v2.jsonl",
    "package/qualification/ga/README.md",
    "package/qualification/ga/fixtures-v1.json",
    "package/qualification/ga/harness-manifest-v1.json",
    "package/qualification/ga/public-surface-v2.json",
    "package/qualification/ga/qualification-contract-v2.json",
    "package/qualification/ga/support-matrix-v2.json",
    "package/qualification/ga/task-plan-v1.jsonl",
    "package/qualification/releases/1.1.0/public-surface-v1.json",
    "package/qualification/releases/1.1.0/qualification-contract-v1.json",
    "package/qualification/releases/1.1.0/tasks-v1.jsonl",
    "package/scripts/ga-qualification-recorder.mjs",
    "package/scripts/ga-qualification-score.mjs",
    "package/scripts/install-agent.sh",
    "package/scripts/install-agent.ps1",
    "package/scripts/lifecycle-agent.sh",
    "package/scripts/lifecycle-agent.ps1",
    "package/scripts/verify-release-supply-chain.mjs"
  ];
  for (const file of requiredFiles) {
    if (!entries.has(file)) {
      throw new Error(`release package missing ${file}`);
    }
  }

  const forbiddenPrefixes = ["package/.git/", "package/.github/", "package/artifacts/", "package/coverage/", "package/eval/", "package/reports/", "package/src/", "package/test/"];
  const allowedQualificationFiles = new Set([
    "package/eval/qualification/tasks.v2.jsonl"
  ]);
  const forbiddenFiles = [
    "package/issues.json",
    "package/roadmap.json",
    "package/scripts/baseline-report.mjs",
    "package/scripts/check-release-version.mjs",
    "package/scripts/check-release-artifacts.mjs",
    "package/tsconfig.json",
    "package/vitest.config.ts"
  ];
  for (const entry of entries) {
    if (/^package\/dist\/(?:mcp\/|commands\/mcp\.|schemas\/mcp\.)/.test(entry)) {
      throw new Error(`release package contains removed MCP output ${entry}`);
    }
    if (forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)) && !allowedQualificationFiles.has(entry)) {
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
  verifyPackagedQualificationHarness(entries, archivePath);
  verifyPackagedReleaseQualification(entries, archivePath, expectedVersion);

  execFileSync("node", ["scripts/verify-release-supply-chain.mjs", artifactsDir], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function verifyPackagedReleaseQualification(entries, archivePath, expectedVersion) {
  const contractEntry = `package/qualification/releases/${expectedVersion}/qualification-contract-v1.json`;
  if (!entries.has(contractEntry)) throw new Error(`release package qualification contract missing ${contractEntry}`);
  const contract = JSON.parse(execFileSync("tar", ["-xOzf", archivePath, contractEntry], {
    cwd: repoRoot,
    encoding: "utf8"
  }));
  if (contract.targetVersion !== expectedVersion
    || contract.current?.exactTaskCount !== 200
    || contract.approvedAdditions?.length !== 1
    || contract.approvedAdditions[0]?.commandId !== "admin.operations") {
    throw new Error("release package current qualification identity or denominator is invalid");
  }
  for (const path of [contract.current.surfacePath, contract.current.datasetPath]) {
    if (!entries.has(`package/${path}`)) throw new Error(`release package qualification asset missing package/${path}`);
  }
  const surface = JSON.parse(execFileSync("tar", ["-xOzf", archivePath, `package/${contract.current.surfacePath}`], {
    cwd: repoRoot,
    encoding: "utf8"
  }));
  if (surface.frozenForVersion !== expectedVersion
    || surface.commandManifest?.commands?.length !== contract.current.expectedCommandCount
    || Object.keys(surface.jsonSchemas ?? {}).length !== contract.current.expectedSchemaCount
    || surface.api?.supportedOperations?.length !== contract.current.expectedApiOperationCount) {
    throw new Error("release package current public surface differs from its qualification contract");
  }
  const tasks = execFileSync("tar", ["-xOzf", archivePath, `package/${contract.current.datasetPath}`], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim().split("\n").filter(Boolean);
  if (tasks.length !== contract.current.exactTaskCount) {
    throw new Error("release package current qualification task denominator is invalid");
  }
}

function verifyPackagedQualificationHarness(entries, archivePath) {
  const frozenQualificationTarget = "1.0.10";
  const manifestEntry = "package/qualification/ga/harness-manifest-v1.json";
  const manifest = JSON.parse(execFileSync("tar", ["-xOzf", archivePath, manifestEntry], {
    cwd: repoRoot,
    encoding: "utf8"
  }));
  if (manifest.targetVersion !== frozenQualificationTarget || manifest.taskPlan?.taskCount !== 200) {
    throw new Error("release package qualification harness target or denominator is invalid");
  }
  if (manifest.lifecyclePlan?.expectedCells !== 36
    || manifest.lifecyclePlan?.waivers?.length !== 0) {
    throw new Error("release package qualification lifecycle plan is incomplete or waived");
  }
  for (const asset of Object.values(manifest.assetDigests ?? {})) {
    const entry = `package/${asset.path}`;
    if (!entries.has(entry)) throw new Error(`release package qualification asset missing ${entry}`);
    const content = execFileSync("tar", ["-xOzf", archivePath, entry], {
      cwd: repoRoot,
      encoding: null
    });
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== asset.sha256) throw new Error(`release package qualification asset digest mismatch ${entry}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}
