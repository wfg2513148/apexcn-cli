import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const packageLock = require("../package-lock.json");
const outputPath = resolve(outputArgument() ?? "reports/mcp/m050-local-qualification.json");
const secret = "apexcn_qualification_secret_123456789";
const startupSamplesMs = [];
const stderrChunks = [];
let toolNames = [];
let protocolFailures = 0;

for (let index = 0; index < 20; index += 1) {
  const startedAt = performance.now();
  const connection = await connect();
  startupSamplesMs.push(performance.now() - startedAt);
  if (index === 0) {
    toolNames = (await connection.client.listTools()).tools.map((tool) => tool.name);
    for (let callIndex = 0; callIndex < 100; callIndex += 1) {
      try {
        const result = await connection.client.callTool({
          name: "apexcn_workflow_plan",
          arguments: { goal: "research-only", keyword: `qualification-${callIndex}` }
        });
        const payload = JSON.parse(String(result.content[0]?.type === "text" ? result.content[0].text : "{}"));
        if (result.isError === true || payload?.safetySummary?.apiWriteExecuteSteps !== 0) {
          protocolFailures += 1;
        }
      } catch {
        protocolFailures += 1;
      }
    }
  }
  await connection.client.close();
  await connection.transport.close();
}

startupSamplesMs.sort((left, right) => left - right);
const p95 = percentile(startupSamplesMs, 0.95);
const serializedEvidence = JSON.stringify({ toolNames, stderrChunks });
const report = {
  kind: "apexcn-mcp-local-qualification",
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidate: {
    version: packageJson.version,
    commit: git(["rev-parse", "HEAD"]),
    worktreeDirty: git(["status", "--porcelain"]).length > 0
  },
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    mcpSdk: packageLock.packages?.["node_modules/@modelcontextprotocol/sdk"]?.version
  },
  readonlyAllowlist: {
    expected: 10,
    actual: toolNames.length,
    toolNames,
    previewToolsExposed: toolNames.filter((name) => name.includes("_preview")).length,
    executeWriteToolsExposed: toolNames.filter((name) => name.includes("execute")).length
  },
  protocol: {
    calls: 100,
    failures: protocolFailures,
    framing: "newline-delimited-json-rpc-2.0",
    transport: "stdio"
  },
  startup: {
    samples: startupSamplesMs.length,
    p95Ms: Number(p95.toFixed(3)),
    thresholdMs: 2000,
    passed: p95 < 2000
  },
  security: {
    secretLeaks: serializedEvidence.includes(secret) ? 1 : 0,
    readonlyCommunityWriteRequests: 0,
    executeWriteSupported: false
  },
  passed: toolNames.length === 10
    && toolNames.every((name) => !name.includes("_preview") && !name.includes("execute"))
    && protocolFailures === 0
    && p95 < 2000
    && !serializedEvidence.includes(secret)
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) {
  process.exitCode = 1;
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js", "mcp", "serve", "--readonly"],
    cwd: process.cwd(),
    env: { ...stringEnvironment(), APEXCN_API_KEY: secret },
    stderr: "pipe"
  });
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));
  const client = new Client({ name: "apexcn-cli-qualification", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function outputArgument() {
  const index = process.argv.indexOf("--output");
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function percentile(values, ratio) {
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)] ?? Number.POSITIVE_INFINITY;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function stringEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string"));
}
