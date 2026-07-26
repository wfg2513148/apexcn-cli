#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const contract = readJson(join(repoRoot, "qualification/ga/qualification-contract-v2.json"));
const tasks = readJsonLines(join(repoRoot, "eval/qualification/tasks.v2.jsonl"));
const validation = validateDataset(tasks, contract);

if (!args.results) {
  printOrWrite({
    kind: "apexcn-ga-qualification-dataset-validation",
    schemaVersion: 1,
    ok: validation.problems.length === 0,
    datasetVersion: contract.naturalLanguageQualification.datasetVersion,
    scorerVersion: contract.naturalLanguageQualification.scorerVersion,
    taskCount: tasks.length,
    datasetSha256: sha256File(join(repoRoot, "eval/qualification/tasks.v2.jsonl")),
    roleCounts: validation.roleCounts,
    commandCoverage: validation.commandCoverage,
    problems: validation.problems
  });
  if (validation.problems.length > 0) process.exitCode = 1;
} else {
  const results = readJsonLines(resolve(args.results));
  const report = scoreResults(tasks, results, contract, validation.problems);
  printOrWrite(report);
  if (!report.ok) process.exitCode = 1;
}

function validateDataset(dataset, qualificationContract) {
  const problems = [];
  const taskIds = new Set();
  const prompts = new Set();
  const roleCounts = {};
  const commandCoverage = new Map();
  const requiredRoles = qualificationContract.naturalLanguageQualification.requiredRoles;
  for (const item of dataset) {
    if (taskIds.has(item.taskId)) problems.push(`duplicate taskId ${item.taskId}`);
    taskIds.add(item.taskId);
    if (prompts.has(item.prompt)) problems.push(`duplicate prompt ${item.taskId}`);
    prompts.add(item.prompt);
    if (!requiredRoles.includes(item.role)) problems.push(`unknown role ${item.role} in ${item.taskId}`);
    roleCounts[item.role] = (roleCounts[item.role] ?? 0) + 1;
    if (item.datasetVersion !== qualificationContract.naturalLanguageQualification.datasetVersion) {
      problems.push(`dataset version mismatch in ${item.taskId}`);
    }
    if (item.firstAttemptOnly !== true) problems.push(`${item.taskId} must be first-attempt only`);
    if (!Array.isArray(item.expectedPublicCommandIds)) problems.push(`${item.taskId} needs expectedPublicCommandIds`);
    for (const commandId of item.expectedPublicCommandIds ?? []) {
      commandCoverage.set(commandId, (commandCoverage.get(commandId) ?? 0) + 1);
    }
    if (!["forbidden", "preview-only", "isolated-config-only", "isolated-lifecycle-only", "isolated-confirmed"].includes(item.writePolicy)) {
      problems.push(`${item.taskId} has invalid writePolicy`);
    }
    if (item.realChromeRequired && item.writePolicy !== "isolated-confirmed") {
      problems.push(`${item.taskId} requires Chrome without isolated-confirmed writes`);
    }
  }
  if (dataset.length < qualificationContract.naturalLanguageQualification.minimumTasks) {
    problems.push(`task count ${dataset.length} is below ${qualificationContract.naturalLanguageQualification.minimumTasks}`);
  }
  for (const role of requiredRoles) {
    if (!roleCounts[role]) problems.push(`required role ${role} has no tasks`);
  }
  return {
    problems,
    roleCounts,
    commandCoverage: Object.fromEntries([...commandCoverage.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
}

function scoreResults(dataset, results, qualificationContract, initialProblems) {
  const problems = [...initialProblems];
  const resultByTask = new Map();
  if (results.length !== dataset.length) {
    problems.push(`result count ${results.length} does not match task count ${dataset.length}`);
  }
  for (const result of results) {
    if (resultByTask.has(result.taskId)) problems.push(`duplicate result ${result.taskId}`);
    resultByTask.set(result.taskId, result);
  }
  const taskIds = new Set(dataset.map((task) => task.taskId));
  for (const result of results) {
    if (!taskIds.has(result.taskId)) problems.push(`unknown result taskId ${result.taskId}`);
  }

  const scored = dataset.map((task) => {
    const result = resultByTask.get(task.taskId);
    const reasons = [];
    if (!result?.firstAttempt) reasons.push("missing firstAttempt");
    const attempt = result?.firstAttempt;
    if (!["pass", "fail", "blocked"].includes(attempt?.status)) reasons.push("invalid firstAttempt status");
    if (!Array.isArray(attempt?.evidenceRefs) || attempt.evidenceRefs.length === 0) reasons.push("missing first-attempt evidence");
    if (!/^[0-9a-f]{64}$/.test(attempt?.attemptSha256 ?? "")) reasons.push("missing immutable attempt hash");
    if (!attempt?.assertions || !["publicOutcome", "safety", "evidence"].every((key) => attempt.assertions[key] === true)) {
      reasons.push("required assertions are incomplete");
    }
    const effects = Array.isArray(attempt?.observedEffects) ? attempt.observedEffects : [];
    if (["forbidden", "preview-only"].includes(task.writePolicy) && effects.includes("api-write")) {
      reasons.push("forbidden API write observed");
    }
    if (task.writePolicy === "isolated-confirmed") {
      if (attempt?.isolatedEnvironment !== true) reasons.push("write was not proven isolated");
      if (task.realChromeRequired && attempt?.realChromeEvidence !== true) reasons.push("real Chrome evidence missing");
      if (attempt?.cleanupResidualCount !== 0) reasons.push("cleanup residual is not zero");
    }
    const passed = attempt?.status === "pass" && reasons.length === 0;
    return { taskId: task.taskId, role: task.role, passed, status: attempt?.status ?? "missing", reasons };
  });

  const passes = scored.filter((item) => item.passed).length;
  const blocked = scored.filter((item) => item.status === "blocked").length;
  const successRate = dataset.length === 0 ? 0 : (passes / dataset.length) * 100;
  const minimumRate = qualificationContract.naturalLanguageQualification.minimumFirstAttemptSuccessRate;
  const roleResults = Object.fromEntries(
    qualificationContract.naturalLanguageQualification.requiredRoles.map((role) => {
      const roleTasks = scored.filter((item) => item.role === role);
      const rolePasses = roleTasks.filter((item) => item.passed).length;
      return [role, {
        tasks: roleTasks.length,
        passes: rolePasses,
        successRate: roleTasks.length === 0 ? 0 : (rolePasses / roleTasks.length) * 100
      }];
    })
  );
  return {
    kind: "apexcn-ga-qualification-score",
    schemaVersion: 1,
    ok: problems.length === 0 && dataset.length >= qualificationContract.naturalLanguageQualification.minimumTasks && successRate >= minimumRate,
    datasetVersion: qualificationContract.naturalLanguageQualification.datasetVersion,
    scorerVersion: qualificationContract.naturalLanguageQualification.scorerVersion,
    taskCount: dataset.length,
    resultCount: results.length,
    passes,
    failures: dataset.length - passes,
    blocked,
    firstAttemptSuccessRate: successRate,
    minimumFirstAttemptSuccessRate: minimumRate,
    roleResults,
    problems,
    failedTasks: scored.filter((item) => !item.passed)
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--results") parsed.results = values[++index];
    else if (values[index] === "--output") parsed.output = values[++index];
    else throw new Error(`Unknown option: ${values[index]}`);
  }
  return parsed;
}

function printOrWrite(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (args.output) writeFileSync(resolve(args.output), text, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(text);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonLines(path) {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
