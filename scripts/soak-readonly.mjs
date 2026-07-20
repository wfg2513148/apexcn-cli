#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const DEFAULT_COMMANDS = [
  { id: "me", args: ["me", "--json"] },
  { id: "categories", args: ["category", "list", "--json"] },
  { id: "search", args: ["search", "APEX", "--page-size", "1", "--json"] },
  { id: "recent", args: ["topic", "recent", "--since-hours", "48", "--page-size", "1", "--json"] }
];

export function summarizeSoak(records, minimumDays = 7, minimumSuccessRate = 99.5) {
  const valid = records.filter((record) => record && typeof record.startedAt === "string" && typeof record.ok === "boolean");
  const timestamps = valid.map((record) => Date.parse(record.startedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const elapsedDays = timestamps.length < 2 ? 0 : (timestamps.at(-1) - timestamps[0]) / 86_400_000;
  const successes = valid.filter((record) => record.ok).length;
  const failures = valid.filter((record) => !record.ok);
  const successRate = valid.length === 0 ? 0 : (successes / valid.length) * 100;
  const failuresWithActionableDiagnostics = failures.filter((record) =>
    typeof record.diagnostic === "string" && record.diagnostic.trim().length > 0
  ).length;
  const ok = elapsedDays >= minimumDays
    && successRate >= minimumSuccessRate
    && failuresWithActionableDiagnostics === failures.length;
  return {
    kind: "apexcn-readonly-soak",
    schemaVersion: 1,
    ok,
    minimumDays,
    minimumSuccessRate,
    startedAt: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null,
    endedAt: timestamps.length > 0 ? new Date(timestamps.at(-1)).toISOString() : null,
    elapsedDays,
    operations: valid.length,
    successes,
    failures: failures.length,
    successRate,
    failuresWithActionableDiagnostics
  };
}

async function sample(options) {
  await mkdir(options.outputDir, { recursive: true });
  const samplesPath = join(options.outputDir, "samples.jsonl");
  for (const command of DEFAULT_COMMANDS) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const result = await runCli(command.args, options.configPath);
    const parsed = parseJson(result.stdout) ?? parseJson(result.stderr);
    const diagnostic = result.code === 0 ? undefined : actionableDiagnostic(parsed);
    const record = {
      schemaVersion: 1,
      startedAt,
      commandId: command.id,
      ok: result.code === 0,
      exitCode: result.code,
      durationMs: Math.round(performance.now() - started),
      requestId: requestIdFrom(parsed),
      status: statusFrom(parsed),
      diagnostic,
      stdoutSha256: sha256(result.stdout),
      stderrSha256: sha256(result.stderr)
    };
    await appendFile(samplesPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return samplesPath;
}

async function finalize(options) {
  const samplesPath = join(options.outputDir, "samples.jsonl");
  const text = await readFile(samplesPath, "utf8");
  const records = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const report = summarizeSoak(records, options.minimumDays, options.minimumSuccessRate);
  const reportPath = join(options.outputDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

function runCli(args, configPath) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve(repoRoot, "dist/index.js"), ...(configPath ? ["--config", configPath] : []), ...args], {
      cwd: repoRoot,
      env: { ...process.env, APEXCN_ERROR_FORMAT: "json" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function actionableDiagnostic(parsed) {
  const error = parsed && typeof parsed === "object" && parsed.error && typeof parsed.error === "object" ? parsed.error : parsed;
  const remediation = error && typeof error === "object" ? error.remediation : undefined;
  if (remediation && typeof remediation === "object") {
    if (Array.isArray(remediation.actions) && remediation.actions.length > 0) return String(remediation.actions[0]);
    if (typeof remediation.message === "string") return remediation.message;
  }
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  return "Run apexcn doctor --json and apexcn doctor snapshot --json for actionable diagnostics.";
}

function requestIdFrom(value) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.requestId === "string") return value.requestId;
  if (value.error && typeof value.error === "object" && typeof value.error.requestId === "string") return value.error.requestId;
  return undefined;
}

function statusFrom(value) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.status === "number") return value.status;
  if (value.error && typeof value.error === "object" && typeof value.error.status === "number") return value.error.status;
  return undefined;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseArgs(argv) {
  const options = {
    mode: "sample",
    outputDir: resolve(repoRoot, "reports/m080-soak"),
    configPath: undefined,
    minimumDays: 7,
    minimumSuccessRate: 99.5
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--finalize") options.mode = "finalize";
    else if (arg === "--output-dir") options.outputDir = resolve(argv[++index]);
    else if (arg === "--config") options.configPath = resolve(argv[++index]);
    else if (arg === "--minimum-days") options.minimumDays = Number(argv[++index]);
    else if (arg === "--minimum-success-rate") options.minimumSuccessRate = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "finalize") {
    await finalize(options);
    return;
  }
  const samplesPath = await sample(options);
  process.stdout.write(`${JSON.stringify({ kind: "apexcn-readonly-soak-sample", schemaVersion: 1, samplesPath, operationCount: DEFAULT_COMMANDS.length })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
