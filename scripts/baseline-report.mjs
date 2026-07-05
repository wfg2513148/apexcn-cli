#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const readme = readText("README.md");
const releaseWorkflow = readText(".github/workflows/release.yml");
const ciWorkflow = readText(".github/workflows/ci.yml");
const mcpCommand = readText("src/commands/mcp.ts");
const issues = readText("issues.md");
const problems = [];

const readmeReleaseUrls = [...new Set([...readme.matchAll(/releases\/download\/(v\d+\.\d+\.\d+)\//g)].map((match) => match[1]))];
const packageLockVersion = packageLock.packages?.[""]?.version ?? packageLock.version;

if (packageLockVersion !== packageJson.version) {
  problems.push("package-lock version does not match package.json version");
}
if (readmeReleaseUrls.some((tag) => tag !== `v${packageJson.version}`)) {
  problems.push("README release URL version does not match package.json version");
}
if (!releaseWorkflow.includes("artifacts/checksums.txt")) {
  problems.push("release workflow does not upload checksums.txt");
}
if (!ciWorkflow.includes("npm run eval:rag")) {
  problems.push("CI does not run npm run eval:rag");
}
if (!mcpCommand.includes("MCP execute-write is disabled")) {
  problems.push("MCP execute-write disabled message was not found");
}

const report = {
  kind: "apexcn-baseline-report",
  schemaVersion: 1,
  packageVersion: packageJson.version,
  packageLockVersion,
  readmeReleaseUrls,
  releaseWorkflowUploadsChecksums: releaseWorkflow.includes("artifacts/checksums.txt"),
  ciRunsRagEval: ciWorkflow.includes("npm run eval:rag"),
  mcpExecuteWriteDisabled: mcpCommand.includes("MCP execute-write is disabled"),
  issuesBacklogAccurate: !/No open CLI backlog items\./.test(issues),
  problems
};

console.log(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = problems.length === 0 ? 0 : 1;

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}
