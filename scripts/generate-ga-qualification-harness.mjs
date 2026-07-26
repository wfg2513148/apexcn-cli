#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const taskPlanPath = join(repoRoot, "qualification/ga/task-plan-v1.jsonl");
const manifestPath = join(repoRoot, "qualification/ga/harness-manifest-v1.json");
const inputPaths = {
  publicSurface: "qualification/ga/public-surface-v2.json",
  supportMatrix: "qualification/ga/support-matrix-v2.json",
  qualificationContract: "qualification/ga/qualification-contract-v2.json",
  qualificationDataset: "eval/qualification/tasks.v2.jsonl",
  fixtures: "qualification/ga/fixtures-v1.json",
  recorder: "scripts/ga-qualification-recorder.mjs",
  scorer: "scripts/ga-qualification-score.mjs",
  lifecycleBash: "scripts/lifecycle-agent.sh",
  lifecyclePowerShell: "scripts/lifecycle-agent.ps1"
};

export function buildGaQualificationHarness() {
  const surface = readJson(inputPaths.publicSurface);
  const matrix = readJson(inputPaths.supportMatrix);
  const contract = readJson(inputPaths.qualificationContract);
  const fixtures = readJson(inputPaths.fixtures);
  const tasks = readJsonLines(inputPaths.qualificationDataset);
  const commands = new Map(surface.commandManifest.commands.map((command) => [command.id, command]));
  const publicTaskCount = surface.commandManifest.commands.reduce(
    (count, command) => count + (command.id === "confirm" ? 1 : 2),
    0
  );
  const taskPlan = tasks.map((task, index) => taskBinding(task, index, publicTaskCount, commands));
  const taskPlanText = jsonLines(taskPlan);
  const phases = phaseDefinitions.map((phase) => ({
    ...phase,
    taskIds: taskPlan.filter((task) => task.phase === phase.id).map((task) => task.taskId),
    taskCount: taskPlan.filter((task) => task.phase === phase.id).length
  }));
  const lifecycleCells = matrix.supportedSources.flatMap((source) => matrix.platforms.map((platform) => ({
    cellId: `${source.version}-${platform.id}`,
    sourceVersion: source.version,
    sourceTag: source.tag,
    sourcePackageSha256: source.packageSha256,
    platformId: platform.id,
    shells: platform.shells,
    stages: matrix.requiredStages,
    statusRequirement: platform.id.startsWith("windows-") ? "required-not-waived" : "required"
  })));
  const assetDigests = Object.fromEntries(
    Object.entries(inputPaths).map(([name, path]) => [name, {
      path,
      sha256: sha256(readFileSync(join(repoRoot, path)))
    }])
  );
  const manifest = {
    kind: "apexcn-ga-qualification-harness",
    schemaVersion: 1,
    harnessVersion: contract.publicHarness.harnessVersion,
    targetVersion: contract.targetVersion,
    datasetVersion: contract.naturalLanguageQualification.datasetVersion,
    scorerVersion: contract.naturalLanguageQualification.scorerVersion,
    fixtureVersion: fixtures.fixtureVersion,
    taskPlan: {
      path: relative(repoRoot, taskPlanPath),
      sha256: sha256(taskPlanText),
      taskCount: taskPlan.length,
      firstTaskId: taskPlan.at(0)?.taskId,
      lastTaskId: taskPlan.at(-1)?.taskId,
      duplicateAttemptsAllowed: false,
      startedWithoutCompletedEvidenceMayBeRetried: false
    },
    phases,
    lifecyclePlan: {
      matrixVersion: matrix.matrixVersion,
      expectedCells: matrix.expectedMatrixCells,
      applicableMacOsLinuxCells: matrix.applicableLocalAndLinuxCells,
      windowsCellsRequired: matrix.windowsCellsRequired,
      waivers: matrix.waivers,
      cells: lifecycleCells
    },
    execution: {
      candidateInterface: "installed public apexcn launcher",
      recorder: inputPaths.recorder,
      scorer: inputPaths.scorer,
      shellExecutionAllowed: false,
      candidateProcessUsesArgvArray: true,
      candidateMustBeAbsolute: true,
      candidateVersionMustEqualTarget: true,
      realUserHomeMutationAllowed: false,
      productionWriteAllowed: false,
      inAppBrowserAllowed: false,
      realChromeRequiredForBoundTasks: true
    },
    evidence: {
      appendOnlyStartLedger: "events.jsonl",
      appendOnlyAttemptLedger: "attempts.jsonl",
      appendOnlyAssessmentLedger: "results.jsonl",
      rawSecretBearingOutputMayBePersisted: false,
      persistedOutputMustBeRedacted: true,
      stdoutStderrExitCodeAndHashesRequired: true,
      finalTaskDenominator: contract.naturalLanguageQualification.exactTaskCount
    },
    assetDigests
  };
  return { manifest, taskPlan, taskPlanText };
}

function taskBinding(task, index, publicTaskCount, commands) {
  const isPublicTask = index < publicTaskCount;
  const phase = phaseFor(task, isPublicTask);
  const descriptors = task.expectedPublicCommandIds.map((id) => {
    const descriptor = commands.get(id);
    if (!descriptor) throw new Error(`Unknown public command ${id} in ${task.taskId}`);
    return descriptor;
  });
  const templates = descriptors.flatMap((descriptor) => safeTemplates(descriptor, task));
  const credentialMode = credentialModeFor(task, descriptors);
  const requiredBindings = new Set(templates.flatMap((template) => bindingsIn(template.commandTemplate)));
  if (credentialMode === "approved-dev") requiredBindings.add("DEV_CONFIG_PATH");
  if (credentialMode === "synthetic") requiredBindings.add("RUN_ROOT");
  if (task.realChromeRequired) {
    requiredBindings.add("OWNED_TOPIC_ID");
    requiredBindings.add("OWNED_REPLY_ID");
    requiredBindings.add("OTHER_OWNER_REPLY_ID");
  }
  return {
    taskId: task.taskId,
    datasetVersion: task.datasetVersion,
    phase,
    role: task.role,
    promptSha256: sha256(`${task.prompt}\n`),
    expectedPublicCommandIds: task.expectedPublicCommandIds,
    expectedOutcome: task.expectedOutcome,
    networkPolicy: task.networkPolicy,
    writePolicy: task.writePolicy,
    realChromeRequired: task.realChromeRequired,
    action: {
      kind: actionKind(task, isPublicTask),
      credentialMode,
      commandTemplates: templates,
      requiredBindings: [...requiredBindings].sort(),
      executor: executorFor(task, isPublicTask)
    },
    firstAttempt: {
      only: true,
      beginBeforeExternalAction: true,
      retryAfterStartedEventAllowed: false,
      requiredEvidence: task.requiredEvidence
    }
  };
}

function phaseFor(task, isPublicTask) {
  if (isPublicTask) return "P10-public-cli";
  if (task.expectedOutcome === "Isolated write cleanup leaves zero residual resources.") {
    return "P50-cleanup-score";
  }
  if (task.realChromeRequired) return "P30-dev-api-chrome";
  if (task.role === "security-reviewer"
    || task.expectedOutcome.includes("archive paths")
    || task.expectedOutcome.includes("Path traversal")) {
    return "P40-security-boundaries";
  }
  return "P20-adverse-and-lifecycle";
}

function actionKind(task, isPublicTask) {
  if (isPublicTask) return "public-cli";
  if (task.realChromeRequired) return "dev-api-real-chrome-scenario";
  if (task.writePolicy === "isolated-lifecycle-only") return "isolated-lifecycle-scenario";
  return "public-adverse-scenario";
}

function executorFor(task, isPublicTask) {
  if (isPublicTask) return "recorder-run";
  if (task.realChromeRequired) return "recorder-begin-complete-plus-real-chrome";
  if (task.writePolicy === "isolated-lifecycle-only") return "packaged-lifecycle-agent-plus-recorder";
  return "recorder-begin-complete";
}

function credentialModeFor(task, descriptors) {
  if (descriptors.some((command) => command.capability === "auth")) return "synthetic";
  if (task.networkPolicy === "approved-readonly-api"
    || task.networkPolicy === "preview-network-only"
    || task.networkPolicy === "isolated-dev-write") {
    return "approved-dev";
  }
  return "synthetic";
}

function safeTemplates(descriptor, task) {
  if (descriptor.id === "confirm") {
    return [{
      commandId: descriptor.id,
      mode: "expected-denial",
      commandTemplate: "${APEXCN_BIN} confirm qualification-invalid-operation --yes --json"
    }];
  }
  let examples = descriptor.examples;
  if (task.writePolicy === "preview-only") {
    const previews = examples.filter((example) => example.mode === "preview");
    if (previews.length > 0) examples = previews;
  } else {
    examples = examples.slice(0, 1);
  }
  return examples.map((example) => ({
    commandId: descriptor.id,
    mode: example.mode,
    commandTemplate: sanitizeExample(example.command)
  }));
}

function sanitizeExample(command) {
  return command
    .replace(/^apexcn\b/, "${APEXCN_BIN}")
    .replaceAll("agent-prod", "qualifier-synthetic")
    .replaceAll("APEXCN_API_KEY", "APEXCN_QUALIFICATION_SYNTHETIC_TOKEN")
    .replaceAll("<operation-id>", "qualification-invalid-operation")
    .replaceAll("<draft-id>", "qualification-missing-draft")
    .replaceAll("./", "${RUN_ROOT}/");
}

function bindingsIn(value) {
  return [...value.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]);
}

const phaseDefinitions = [
  {
    id: "P00-bind",
    title: "Bind candidate, manifest, public inputs, environment, and recorder before product use.",
    stopPoint: "No candidate task may start until all declared digests and the isolated candidate version match."
  },
  {
    id: "P10-public-cli",
    title: "Execute the frozen natural-language public CLI surface tasks.",
    stopPoint: "Any started attempt without a completed evidence row invalidates the 200-task success-rate claim."
  },
  {
    id: "P20-adverse-and-lifecycle",
    title: "Execute bounded adverse behavior and the supported-source lifecycle plan.",
    stopPoint: "Unexecuted platform cells remain not passed and cannot be converted into waivers."
  },
  {
    id: "P30-dev-api-chrome",
    title: "Execute approved DEV writes, permission denials, API proof, and real Chrome checks.",
    stopPoint: "Stop before cleanup if created object identity or ownership is ambiguous."
  },
  {
    id: "P40-security-boundaries",
    title: "Execute the frozen independent security boundary scenarios.",
    stopPoint: "Any critical or high product finding blocks qualification acceptance."
  },
  {
    id: "P50-cleanup-score",
    title: "Clean only run-created state, prove zero residuals, and score the complete denominator.",
    stopPoint: "No acceptance claim is allowed unless all 200 attempts and assessments are present."
  }
];

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function readJsonLines(path) {
  return readFileSync(join(repoRoot, path), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function jsonLines(values) {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(values) {
  if (values.length === 0) return { check: false };
  if (values.length === 1 && values[0] === "--check") return { check: true };
  throw new Error(`Usage: node ${basename(process.argv[1])} [--check]`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const built = buildGaQualificationHarness();
  const manifestText = `${JSON.stringify(built.manifest, null, 2)}\n`;
  if (args.check) {
    const failures = [];
    if (readFileSync(taskPlanPath, "utf8") !== built.taskPlanText) failures.push("task plan drifted");
    if (readFileSync(manifestPath, "utf8") !== manifestText) failures.push("harness manifest drifted");
    process.stdout.write(`${JSON.stringify({
      kind: "apexcn-ga-qualification-harness-check",
      schemaVersion: 1,
      ok: failures.length === 0,
      harnessVersion: built.manifest.harnessVersion,
      taskCount: built.taskPlan.length,
      lifecycleCells: built.manifest.lifecyclePlan.cells.length,
      failures
    }, null, 2)}\n`);
    if (failures.length > 0) process.exitCode = 1;
    return;
  }
  writeFileSync(taskPlanPath, built.taskPlanText, { encoding: "utf8", mode: 0o644 });
  writeFileSync(manifestPath, manifestText, { encoding: "utf8", mode: 0o644 });
  process.stdout.write(`${JSON.stringify({
    kind: built.manifest.kind,
    schemaVersion: built.manifest.schemaVersion,
    harnessVersion: built.manifest.harnessVersion,
    taskPlan: relative(repoRoot, taskPlanPath),
    manifest: relative(repoRoot, manifestPath),
    taskCount: built.taskPlan.length,
    lifecycleCells: built.manifest.lifecyclePlan.cells.length
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
