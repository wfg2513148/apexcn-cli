#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedReferenceMatch, expectedTopicMatch, p95Seconds } from "./retrieval-eval-score.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const cliPath = resolvePath(args.cli ?? "dist/index.js");
const datasetPath = resolvePath(args.questions ?? "eval/retrieval/questions.zh.jsonl");
const configReference = args.config ?? process.env.APEXCN_LIVE_EVAL_CONFIG;
const configPath = configReference ? resolvePath(configReference) : undefined;
const environment = args.environment ?? process.env.APEXCN_LIVE_EVAL_ENVIRONMENT ?? "unconfigured";
const startedAt = new Date().toISOString();
const packageVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
const rateGateStartedAt = Date.now();
const rateGate = {
  ask: { minimumStartGapMs: 31_000, initialCooldownMs: 61_000, lastStartedAt: 0 },
  research: { minimumStartGapMs: 5_500, initialCooldownMs: 0, lastStartedAt: 0 }
};

const datasetText = await readFile(datasetPath, "utf8");
const questions = parseJsonl(datasetText, datasetPath);
const datasetProblems = validateDataset(questions);
const datasetSha256 = sha256(datasetText);

let report;
if (datasetProblems.length > 0) {
  report = unavailableReport(`invalid dataset: ${datasetProblems.join("; ")}`);
} else if (!configPath) {
  report = unavailableReport("APEXCN_LIVE_EVAL_CONFIG or --config is required");
} else if (environment !== "dev@oci") {
  report = unavailableReport("--environment dev@oci is required for live retrieval evaluation");
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
  const auth = await runCli(["auth", "audit", "--json"]);
  const profile = auth.value?.profiles?.find?.((item) => item?.current === true);
  if (!auth.ok || !profile?.token?.present) {
    return unavailableReport("configured profile is missing or auth audit failed", {
      auth: safeRunSummary(auth)
    });
  }
  if (!isDevBaseUrl(profile.baseUrl)) {
    return unavailableReport("configured profile must target the dev@oci ORDS base URL", {
      auth: {
        profile: profile.name,
        baseUrl: profile.baseUrl,
        tokenPresent: profile.token.present === true
      }
    });
  }

  const answerable = questions.filter((item) => item.answerability !== "unanswerable");
  const unanswerable = questions.filter((item) => item.answerability === "unanswerable");
  const retrievalRuns = [];
  const ragRuns = [];

  for (const question of answerable) {
    const search = await runCli(["search", question.searchQuery, "--page-size", "5", "--json"]);
    retrievalRuns.push(scoreRetrieval(question, search));
    if (question.ragMode === "ask") {
      ragRuns.push(scoreRag(question, "ask", await runRateLimitedCli("ask", ["ask", question.question, "--top-k", "5", "--json"])));
    } else if (question.ragMode === "research") {
      ragRuns.push(scoreRag(question, "research", await runRateLimitedCli("research", ["research", question.searchQuery, "--limit", "5", "--json"])));
    }
  }

  const unanswerableRuns = [];
  for (const question of unanswerable) {
    const run = await runRateLimitedCli("ask", ["ask", question.question, "--top-k", "5", "--json"]);
    unanswerableRuns.push(scoreUnanswerable(question, run));
  }

  const pagination = await evaluatePagination();
  const searchLatencies = retrievalRuns.map((item) => item.durationMs);
  const ragLatencies = [...ragRuns, ...unanswerableRuns].map((item) => item.durationMs);
  const askRuns = ragRuns.filter((item) => item.mode === "ask");
  const researchRuns = ragRuns.filter((item) => item.mode === "research");
  const askLatencies = [...askRuns, ...unanswerableRuns].map((item) => item.durationMs);
  const researchLatencies = researchRuns.map((item) => item.durationMs);
  const provenanceChecks = [
    ...retrievalRuns.map((item) => item.provenanceComplete),
    ...ragRuns.map((item) => item.provenanceComplete),
    ...unanswerableRuns.map((item) => item.provenanceComplete),
    ...pagination.pages.map((item) => item.provenanceComplete)
  ];

  const metrics = {
    retrievalQuestionCount: answerable.length,
    unanswerableQuestionCount: unanswerable.length,
    top5ExpectedReferenceHitRate: percent(retrievalRuns.filter((item) => item.expectedReferenceHit).length, retrievalRuns.length),
    citationCoverage: percent(ragRuns.filter((item) => item.citationCovered).length, ragRuns.length),
    askCitationCoverage: percent(askRuns.filter((item) => item.citationCovered).length, askRuns.length),
    researchCitationCoverage: percent(researchRuns.filter((item) => item.citationCovered).length, researchRuns.length),
    unanswerableCorrectBehaviorRate: percent(unanswerableRuns.filter((item) => item.correctBehavior).length, unanswerableRuns.length),
    cursorDuplicateOrMissingRecords: pagination.duplicateOrMissingRecords,
    searchP95Seconds: p95Seconds(searchLatencies),
    ragP95Seconds: p95Seconds(ragLatencies),
    askP95Seconds: p95Seconds(askLatencies),
    researchP95Seconds: p95Seconds(researchLatencies),
    resultProvenanceCoverage: percent(provenanceChecks.filter(Boolean).length, provenanceChecks.length)
  };
  const thresholds = {
    retrievalQuestionCount: 50,
    unanswerableQuestionCount: 10,
    top5ExpectedReferenceHitRate: 85,
    citationCoverage: 90,
    askCitationCoverage: 100,
    researchCitationCoverage: 90,
    unanswerableCorrectBehaviorRate: 100,
    cursorDuplicateOrMissingRecords: 0,
    searchP95Seconds: 5,
    ragP95Seconds: 15,
    askP95Seconds: 15,
    researchP95Seconds: 15,
    resultProvenanceCoverage: 100
  };
  const ok = metrics.retrievalQuestionCount >= thresholds.retrievalQuestionCount
    && metrics.unanswerableQuestionCount >= thresholds.unanswerableQuestionCount
    && metrics.top5ExpectedReferenceHitRate >= thresholds.top5ExpectedReferenceHitRate
    && metrics.citationCoverage >= thresholds.citationCoverage
    && metrics.askCitationCoverage === thresholds.askCitationCoverage
    && metrics.researchCitationCoverage >= thresholds.researchCitationCoverage
    && metrics.unanswerableCorrectBehaviorRate === thresholds.unanswerableCorrectBehaviorRate
    && metrics.cursorDuplicateOrMissingRecords === thresholds.cursorDuplicateOrMissingRecords
    && metrics.searchP95Seconds <= thresholds.searchP95Seconds
    && metrics.ragP95Seconds <= thresholds.ragP95Seconds
    && metrics.askP95Seconds <= thresholds.askP95Seconds
    && metrics.researchP95Seconds <= thresholds.researchP95Seconds
    && metrics.resultProvenanceCoverage === thresholds.resultProvenanceCoverage;

  return {
    kind: "live-retrieval-eval-report",
    schemaVersion: 1,
    mode: "live-readonly",
    doesNotCallWriteApi: true,
    environment,
    environmentHash: sha256(JSON.stringify({
      environment,
      baseUrl: profile.baseUrl,
      cliVersion: packageVersion,
      datasetSha256
    })),
    generatedAt: new Date().toISOString(),
    durationSeconds: seconds(Date.now() - Date.parse(startedAt)),
    cli: {
      path: relativeDisplay(cliPath),
      configReference: basename(configPath),
      version: packageVersion,
      profile: profile.name,
      baseUrl: profile.baseUrl,
      tokenPresent: true
    },
    dataset: {
      path: relativeDisplay(datasetPath),
      version: "M030-LIVE-ZH-2",
      sha256: datasetSha256,
      questionCount: questions.length,
      answerableCount: answerable.length,
      unanswerableCount: unanswerable.length
    },
    scorer: {
      version: "grounded-topic-and-reference-v2",
      note: "Top-5 hit requires a versioned expected topic id; citation coverage independently requires expected terms in user-visible source evidence."
    },
    ratePolicy: {
      askInitialCooldownMs: rateGate.ask.initialCooldownMs,
      askMinimumStartGapMs: rateGate.ask.minimumStartGapMs,
      researchMinimumStartGapMs: rateGate.research.minimumStartGapMs,
      waitTimeExcludedFromCommandLatency: true
    },
    thresholds,
    metrics,
    pagination,
    retrievalRuns,
    ragRuns,
    unanswerableRuns,
    ok
  };
}

async function evaluatePagination() {
  const pages = [];
  const seen = new Set();
  let cursor;
  let duplicateOrMissingRecords = 0;
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const command = ["search", "APEX", "--page-size", "5"];
    if (cursor) {
      command.push("--cursor", cursor);
    }
    command.push("--json");
    const run = await runCli(command);
    const items = Array.isArray(run.value?.items) ? run.value.items : [];
    const ids = items.map(topicId).filter((value) => value !== undefined);
    const duplicates = ids.filter((id) => seen.has(id));
    ids.forEach((id) => seen.add(id));
    const nextCursor = run.value?.page?.nextCursor;
    const hasMore = run.value?.page?.hasMore === true;
    if (!run.ok || duplicates.length > 0 || ids.length === 0 || (pageNumber < 5 && (!hasMore || typeof nextCursor !== "string"))) {
      duplicateOrMissingRecords += Math.max(1, duplicates.length);
    }
    pages.push({
      pageNumber,
      ok: run.ok,
      durationMs: run.durationMs,
      ids,
      duplicates,
      nextCursorPresent: typeof nextCursor === "string",
      provenanceComplete: provenanceComplete(run.value, items.length > 0)
    });
    if (typeof nextCursor !== "string") {
      break;
    }
    cursor = nextCursor;
  }
  if (pages.length < 5) {
    duplicateOrMissingRecords += 5 - pages.length;
  }
  return {
    requestedPages: 5,
    completedPages: pages.length,
    uniqueRecordCount: seen.size,
    duplicateOrMissingRecords,
    pages
  };
}

function scoreRetrieval(question, run) {
  const items = Array.isArray(run.value?.items) ? run.value.items.slice(0, 5) : [];
  const relevance = expectedReferenceMatch(items, question.expectedReferenceTerms, question.minimumMatchedTerms);
  const topicMatch = expectedTopicMatch(items, question.expectedTopicIds);
  const usesExpectedTopicIds = Array.isArray(question.expectedTopicIds) && question.expectedTopicIds.length > 0;
  return {
    id: question.id,
    searchQuery: question.searchQuery,
    ok: run.ok,
    durationMs: run.durationMs,
    resultCount: items.length,
    resultIds: items.map(topicId).filter((value) => value !== undefined),
    matchedTerms: relevance.matchedTerms,
    matchedTopicIds: topicMatch.matchedTopicIds,
    referenceBasis: usesExpectedTopicIds ? "topic-id" : "reference-terms",
    expectedReferenceHit: usesExpectedTopicIds ? topicMatch.hit : relevance.hit,
    provenanceComplete: provenanceComplete(run.value, items.length > 0),
    requestIds: requestIds(run.value)
  };
}

function scoreRag(question, mode, run) {
  const sources = provenanceSources(run.value);
  const evidenceSources = citationEvidenceSources(run.value);
  const answerAccepted = mode !== "ask" || run.value?.answerable === true;
  const citationPresent = run.ok
    && answerAccepted
    && sources.length > 0
    && sources.every((item) => validUrl(item.url));
  const relevance = expectedReferenceMatch(evidenceSources, question.expectedReferenceTerms, question.minimumMatchedTerms);
  return {
    id: question.id,
    mode,
    ok: run.ok,
    durationMs: run.durationMs,
    sourceCount: sources.length,
    sourceUrls: sources.map((item) => item.url).filter((value) => typeof value === "string"),
    citationPresent,
    matchedTerms: relevance.matchedTerms,
    citationCovered: citationPresent && relevance.hit,
    provenanceComplete: provenanceComplete(run.value, true),
    requestIds: requestIds(run.value)
  };
}

function scoreUnanswerable(question, run) {
  const reason = run.value?.fallback?.reason;
  const correctBehavior = run.ok
    && run.value?.answerable === false
    && ["no-trusted-references", "low-confidence", "needs-context"].includes(reason);
  return {
    id: question.id,
    ok: run.ok,
    durationMs: run.durationMs,
    reason,
    correctBehavior,
    provenanceComplete: requestIds(run.value).length > 0,
    requestIds: requestIds(run.value)
  };
}

async function runCli(commandArgs) {
  const started = performance.now();
  const result = await new Promise((resolveRun) => {
    const childEnv = {
      ...process.env,
      APEXCN_ERROR_FORMAT: "json",
      APEXCN_HTTP_TIMEOUT_MS: process.env.APEXCN_HTTP_TIMEOUT_MS ?? "20000"
    };
    delete childEnv.APEXCN_API_KEY;
    const child = spawn(process.execPath, [cliPath, "--config", configPath, ...commandArgs], {
      cwd: repoRoot,
      env: childEnv
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => resolveRun({ exitCode: exitCode ?? 1, stdout, stderr }));
    child.on("error", (error) => resolveRun({ exitCode: 1, stdout, stderr: String(error) }));
  });
  const value = parseJson(result.stdout) ?? parseJson(result.stderr);
  return {
    ok: result.exitCode === 0 && value !== undefined,
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    value,
    error: result.exitCode === 0 ? undefined : safeError(value, result.stderr)
  };
}

async function runRateLimitedCli(kind, commandArgs) {
  const gate = rateGate[kind];
  const initialRemainingMs = gate.lastStartedAt === 0
    ? gate.initialCooldownMs - (Date.now() - rateGateStartedAt)
    : 0;
  const gapRemainingMs = gate.lastStartedAt === 0
    ? 0
    : gate.minimumStartGapMs - (Date.now() - gate.lastStartedAt);
  const remainingMs = Math.max(initialRemainingMs, gapRemainingMs);
  if (remainingMs > 0) {
    await new Promise((resolveWait) => setTimeout(resolveWait, remainingMs));
  }
  gate.lastStartedAt = Date.now();
  return runCli(commandArgs);
}

function unavailableReport(reason, extra = {}) {
  return {
    kind: "live-retrieval-eval-report",
    schemaVersion: 1,
    mode: "live-readonly-unavailable",
    doesNotCallWriteApi: true,
    environment,
    generatedAt: new Date().toISOString(),
    dataset: {
      path: relativeDisplay(datasetPath),
      version: "M030-LIVE-ZH-2",
      sha256: datasetSha256,
      questionCount: questions.length
    },
    reason,
    datasetProblems,
    ...extra,
    ok: false
  };
}

function validateDataset(items) {
  const problems = [];
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      problems.push(`line ${index + 1} must be an object`);
      continue;
    }
    if (typeof item.id !== "string" || ids.has(item.id)) {
      problems.push(`line ${index + 1} has missing or duplicate id`);
    }
    ids.add(item.id);
    if (typeof item.question !== "string" || typeof item.searchQuery !== "string") {
      problems.push(`${item.id ?? index + 1} needs question and searchQuery`);
    }
    if (item.answerability !== "unanswerable") {
      if (!Array.isArray(item.expectedReferenceTerms) || item.expectedReferenceTerms.length === 0) {
        problems.push(`${item.id ?? index + 1} needs expectedReferenceTerms`);
      }
      if (!Array.isArray(item.expectedTopicIds) || item.expectedTopicIds.length === 0) {
        problems.push(`${item.id ?? index + 1} needs expectedTopicIds`);
      }
      if (!Number.isInteger(item.minimumMatchedTerms) || item.minimumMatchedTerms < 1) {
        problems.push(`${item.id ?? index + 1} needs minimumMatchedTerms`);
      }
      if (!["ask", "research"].includes(item.ragMode)) {
        problems.push(`${item.id ?? index + 1} needs ragMode ask or research`);
      }
    }
  }
  const answerableCount = items.filter((item) => item?.answerability !== "unanswerable").length;
  const unanswerableCount = items.filter((item) => item?.answerability === "unanswerable").length;
  if (answerableCount < 50) {
    problems.push(`dataset needs at least 50 answerable questions; found ${answerableCount}`);
  }
  if (unanswerableCount < 10) {
    problems.push(`dataset needs at least 10 unanswerable questions; found ${unanswerableCount}`);
  }
  return problems;
}

function parseArgs(values) {
  const parsed = {
    strict: false,
    report: false,
    output: undefined,
    questions: undefined,
    config: undefined,
    environment: undefined,
    cli: undefined
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--strict" || value === "--report") {
      parsed[value.slice(2)] = true;
      continue;
    }
    if (["--output", "--questions", "--config", "--environment", "--cli"].includes(value)) {
      parsed[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = values[index + 1];
      index += 1;
      continue;
    }
    console.error("Usage: node scripts/eval-retrieval.mjs [--report] [--strict] [--output <path>] [--questions <path>] [--config <path>] [--environment <name>] [--cli <path>]");
    process.exit(2);
  }
  return parsed;
}

function parseJsonl(text, path) {
  return text.split(/\n+/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`);
    }
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function provenanceSources(value) {
  return Array.isArray(value?.provenance?.sources) ? value.provenance.sources : [];
}

function citationEvidenceSources(value) {
  return [
    ...provenanceSources(value),
    ...arrayValue(value?.sources),
    ...arrayValue(value?.references),
    ...arrayValue(value?.citations),
    ...arrayValue(value?.items),
    ...arrayValue(value?.topics)
  ];
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function requestIds(value) {
  return Array.isArray(value?.provenance?.requestIds)
    ? value.provenance.requestIds.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

function provenanceComplete(value, sourcesRequired) {
  const sources = provenanceSources(value);
  return requestIds(value).length > 0
    && (!sourcesRequired || (sources.length > 0 && sources.every((item) => validUrl(item?.url))));
}

function safeRunSummary(run) {
  return {
    ok: run.ok,
    exitCode: run.exitCode,
    error: run.error
  };
}

function safeError(value, stderr) {
  if (value?.error && typeof value.error === "object") {
    return {
      type: value.error.type,
      code: value.error.code,
      status: value.error.status,
      requestId: value.error.requestId
    };
  }
  return stderr ? "CLI command failed; stderr omitted from report" : "CLI command failed";
}

function topicId(item) {
  const value = item?.id ?? item?.topicId ?? item?.threadId;
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function percent(numerator, denominator) {
  return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));
}

function seconds(milliseconds) {
  return Number((milliseconds / 1000).toFixed(3));
}

function validUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isDevBaseUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "oracleapex.cn"
      && url.pathname.replace(/\/+$/, "") === "/ords/dev";
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function resolvePath(path) {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function relativeDisplay(path) {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : basename(path);
}
