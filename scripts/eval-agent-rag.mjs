#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAgentRagCase, summarizeAgentRagRuns } from "./agent-rag-eval-score.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const cliPath = resolvePath(args.cli ?? "dist/index.js");
const datasetPath = resolvePath(args.questions ?? "eval/agent-rag/questions.zh.jsonl");
const configPath = args.config ? resolvePath(args.config) : undefined;
const environment = args.environment ?? "unconfigured";
const datasetText = await readFile(datasetPath, "utf8");
const cases = parseJsonl(datasetText);
const datasetProblems = validateDataset(cases);
const startedAt = Date.now();
const minimumStartGapMs = 3_000;

let report;
if (datasetProblems.length > 0) {
  report = unavailable(`invalid dataset: ${datasetProblems.join("; ")}`);
} else if (!configPath) {
  report = unavailable("--config is required");
} else if (environment !== "oracleapex.cn-readonly") {
  report = unavailable("--environment oracleapex.cn-readonly is required");
} else {
  report = await evaluate();
}

if (args.output) {
  const outputPath = resolvePath(args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = args.strict && !report.ok ? 1 : 0;

async function evaluate() {
  const audit = await runCli(["auth", "audit", "--json"]);
  const profile = audit.value?.profiles?.find?.((item) => item?.current === true);
  if (!audit.ok || !profile?.token?.present) {
    return unavailable("configured profile is missing or auth audit failed");
  }
  if (profile.baseUrl !== "https://oracleapex.cn/ords/api") {
    return unavailable("configured profile must target https://oracleapex.cn/ords/api");
  }

  const runs = [];
  let lastStartedAt = 0;
  for (const testCase of cases) {
    const remainingMs = minimumStartGapMs - (Date.now() - lastStartedAt);
    if (remainingMs > 0) {
      await new Promise((resolveWait) => setTimeout(resolveWait, remainingMs));
    }
    lastStartedAt = Date.now();
    const command = ["rag", "retrieve", testCase.question];
    for (const query of testCase.queries) {
      command.push("--query", query);
    }
    command.push("--top-k", "5", "--json");
    runs.push(scoreAgentRagCase(testCase, await runCli(command)));
  }

  const metrics = summarizeAgentRagRuns(runs);
  const thresholds = {
    top5ExpectedTopicRecall: 90,
    correctAnswerEvidenceHitRate: 95,
    citationIntegrityRate: 100,
    unanswerableCorrectBehaviorRate: 100,
    forbiddenAppRagEndpointCalls: 0
  };
  const ok = metrics.top5ExpectedTopicRecall >= thresholds.top5ExpectedTopicRecall
    && metrics.correctAnswerEvidenceHitRate >= thresholds.correctAnswerEvidenceHitRate
    && metrics.citationIntegrityRate === thresholds.citationIntegrityRate
    && metrics.unanswerableCorrectBehaviorRate === thresholds.unanswerableCorrectBehaviorRate
    && metrics.forbiddenAppRagEndpointCalls === thresholds.forbiddenAppRagEndpointCalls;

  return {
    kind: "agent-rag-live-eval-report",
    schemaVersion: 1,
    mode: "live-readonly",
    doesNotCallWriteApi: true,
    app100AskEndpointAllowed: false,
    environment,
    environmentHash: sha256(JSON.stringify({
      environment,
      baseUrl: profile.baseUrl,
      cliVersion: audit.value?.cliVersion,
      datasetSha256: sha256(datasetText)
    })),
    generatedAt: new Date().toISOString(),
    durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    cli: {
      path: displayPath(cliPath),
      configReference: basename(configPath),
      profile: profile.name,
      baseUrl: profile.baseUrl,
      tokenPresent: true
    },
    dataset: {
      path: displayPath(datasetPath),
      version: "M080-AGENT-RAG-ZH-1",
      sha256: sha256(datasetText),
      caseCount: cases.length
    },
    scorer: {
      version: "agent-rag-evidence-v1",
      allowedEndpoints: ["/api/v1/search", "/api/v1/topics/{topicId}"]
    },
    ratePolicy: {
      minimumStartGapMs,
      waitTimeExcludedFromCommandLatency: true
    },
    thresholds,
    metrics,
    runs,
    ok
  };
}

async function runCli(commandArgs) {
  const started = performance.now();
  const result = await new Promise((resolveRun) => {
    const childEnv = { ...process.env, APEXCN_ERROR_FORMAT: "json" };
    delete childEnv.APEXCN_API_KEY;
    const child = spawn(process.execPath, [cliPath, "--config", configPath, ...commandArgs], {
      cwd: repoRoot,
      env: childEnv
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => resolveRun({ exitCode: exitCode ?? 1, stdout, stderr }));
    child.on("error", (error) => resolveRun({ exitCode: 1, stdout, stderr: String(error) }));
  });
  const value = parseJson(result.stdout) ?? parseJson(result.stderr);
  return {
    ok: result.exitCode === 0 && value !== undefined,
    durationMs: Math.round(performance.now() - started),
    value,
    error: result.exitCode === 0 ? undefined : value?.error?.code ?? result.stderr.trim()
  };
}

function validateDataset(items) {
  const problems = [];
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (typeof item?.id !== "string" || ids.has(item.id)) {
      problems.push(`line ${index + 1} has missing or duplicate id`);
    }
    ids.add(item?.id);
    if (typeof item?.question !== "string" || !Array.isArray(item?.queries) || item.queries.length === 0) {
      problems.push(`${item?.id ?? index + 1} needs question and queries`);
    }
    if (!Array.isArray(item?.expectedTopicIds)) {
      problems.push(`${item?.id ?? index + 1} needs expectedTopicIds`);
    }
  }
  if (items.filter((item) => item.expectedTopicIds?.length > 0).length < 20) {
    problems.push("dataset needs at least 20 retrieval cases");
  }
  if (items.filter((item) => item.expectedCorrectAnswerReplyIds?.length > 0).length < 5) {
    problems.push("dataset needs at least 5 correct-answer cases");
  }
  if (items.filter((item) => item.expectedAnswerability === "unanswerable").length < 3) {
    problems.push("dataset needs at least 3 unanswerable cases");
  }
  return problems;
}

function unavailable(reason) {
  return {
    kind: "agent-rag-live-eval-report",
    schemaVersion: 1,
    mode: "live-readonly-unavailable",
    doesNotCallWriteApi: true,
    app100AskEndpointAllowed: false,
    environment,
    generatedAt: new Date().toISOString(),
    dataset: {
      path: displayPath(datasetPath),
      version: "M080-AGENT-RAG-ZH-1",
      sha256: sha256(datasetText),
      caseCount: cases.length
    },
    datasetProblems,
    reason,
    ok: false
  };
}

function parseArgs(values) {
  const parsed = { strict: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--strict") {
      parsed.strict = true;
    } else if (["--output", "--questions", "--config", "--environment", "--cli"].includes(value)) {
      parsed[value.slice(2)] = values[index + 1];
      index += 1;
    } else {
      console.error("Usage: node scripts/eval-agent-rag.mjs [--strict] --config <path> --environment oracleapex.cn-readonly [--output <path>] [--questions <path>] [--cli <path>]");
      process.exit(2);
    }
  }
  return parsed;
}

function parseJsonl(text) {
  return text.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function resolvePath(path) {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function displayPath(path) {
  const value = relative(repoRoot, path);
  return value.startsWith("..") ? basename(path) : value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
