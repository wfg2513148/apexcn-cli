#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname as pathDirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const readme = readText("README.md");
const releaseWorkflow = readText(".github/workflows/release.yml");
const ciWorkflow = readText(".github/workflows/ci.yml");
const mcpCommand = readText("src/commands/mcp.ts");
const commandRegistry = readText("src/core/command-registry.ts");
const issues = readJson("issues.json");
const problems = [];

const readmeReleaseUrls = [...new Set([...readme.matchAll(/releases\/(?:download\/(v\d+\.\d+\.\d+)|latest\/download)\//g)].map((match) => match[1] ?? "latest"))];
const packageLockVersion = packageLock.packages?.[""]?.version ?? packageLock.version;
const descriptors = [...commandRegistry.matchAll(/descriptor\("([^"]+)",\s*\[[^\]]+\],\s*"[^"]+",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*(true|false),\s*"([^"]+)"/g)]
  .map((match) => ({
    id: match[1],
    capability: match[2],
    apiEffect: match[3],
    riskLevel: match[4],
    authRequired: match[5] === "true",
    mcpExposure: match[6]
  }));
const releaseAssets = [
  "apexcn-cli.tgz",
  "install-agent.sh",
  "install-agent.ps1",
  "checksums.txt",
  "apexcn-cli.tgz.sha256",
  "install-agent.sh.sha256",
  "install-agent.ps1.sha256"
];
const schemaFiles = run("git", ["ls-files", "src/schemas/*.ts"])
  .split("\n")
  .filter(Boolean)
  .sort();

if (packageLockVersion !== packageJson.version) {
  problems.push("package-lock version does not match package.json version");
}
if (readmeReleaseUrls.some((tag) => tag !== "latest")) {
  problems.push("README install URLs must use releases/latest/download");
}
if (!releaseWorkflow.includes("artifacts/checksums.txt")) {
  problems.push("release workflow does not upload checksums.txt");
}
if (!ciWorkflow.includes("npm run eval:rag")) {
  problems.push("CI does not run npm run eval:rag");
}
const mcpExecuteWriteDisabled = /MCP execute-write is (?:disabled|intentionally unavailable)/.test(mcpCommand)
  && mcpCommand.includes("apexcn workflow");
if (!mcpExecuteWriteDisabled) {
  problems.push("MCP execute-write disabled message was not found");
}

const report = {
  kind: "apexcn-baseline-report",
  schemaVersion: 1,
  version: packageJson.version,
  packageVersion: packageJson.version,
  packageLockVersion,
  git: {
    branch: run("git", ["branch", "--show-current"]).trim(),
    sha: run("git", ["rev-parse", "HEAD"]).trim()
  },
  node: process.version,
  readmeReleaseUrls,
  releaseWorkflowUploadsChecksums: releaseWorkflow.includes("artifacts/checksums.txt"),
  ciRunsRagEval: ciWorkflow.includes("npm run eval:rag"),
  mcpExecuteWriteDisabled,
  issuesBacklogAccurate: Array.isArray(issues.issues),
  commands: {
    total: descriptors.length,
    readonly: descriptors.filter((item) => item.mcpExposure === "readonly").length,
    previewOnly: descriptors.filter((item) => item.mcpExposure === "preview-only").length,
    destructive: descriptors.filter((item) => item.apiEffect === "destructive" || item.riskLevel === "destructive").length
  },
  mcp: {
    readonlyTools: descriptors.filter((item) => item.mcpExposure === "readonly").length,
    previewTools: descriptors.filter((item) => item.mcpExposure === "preview-only").length,
    executeWriteSupported: false
  },
  schemas: schemaFiles,
  releaseAssets,
  problems
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) {
  const outputPath = isAbsolute(args.output) ? args.output : join(repoRoot, args.output);
  mkdirSync(pathDirname(outputPath), { recursive: true });
  writeFileSync(outputPath, json);
}
console.log(json);
process.exitCode = problems.length === 0 ? 0 : 1;

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--output") {
      parsed.output = values[index + 1];
      index += 1;
      continue;
    }
    console.error("Usage: node scripts/baseline-report.mjs [--output <path>]");
    process.exit(2);
  }
  return parsed;
}

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
}
