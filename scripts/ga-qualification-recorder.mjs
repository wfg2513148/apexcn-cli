#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(repoRoot, "qualification/ga/harness-manifest-v1.json");
const planPath = join(repoRoot, "qualification/ga/task-plan-v1.jsonl");
const scorerPath = join(repoRoot, "scripts/ga-qualification-score.mjs");
const command = process.argv[2];
const args = process.argv.slice(3);

if (command === "init") initialize(parseOptions(args));
else if (command === "fixture") runFixture(parseOptions(args, true));
else if (command === "run") runCandidate(parseOptions(args, true));
else if (command === "begin") beginExternal(parseOptions(args));
else if (command === "complete") completeExternal(parseOptions(args));
else if (command === "assess") assess(parseOptions(args));
else if (command === "status") status(parseOptions(args));
else if (command === "finalize") finalize(parseOptions(args));
else throw new Error("Usage: ga-qualification-recorder.mjs <init|fixture|run|begin|complete|assess|status|finalize> [options]");

function initialize(options) {
  const evidenceDir = requiredAbsolute(options, "evidence-dir");
  const candidate = requiredAbsolute(options, "candidate");
  const devConfig = optionalAbsolute(options, "dev-config");
  if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error("Candidate launcher does not exist");
  if (devConfig && (!existsSync(devConfig) || !statSync(devConfig).isFile())) {
    throw new Error("DEV config path does not reference a regular file");
  }
  if (devConfig && process.platform !== "win32" && (statSync(devConfig).mode & 0o077) !== 0) {
    throw new Error("DEV config permissions must not allow group or other access");
  }
  if (existsSync(evidenceDir) && readdirSync(evidenceDir).length > 0) {
    throw new Error("Evidence directory must be absent or empty");
  }
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  const runRoot = dirname(evidenceDir);
  const runtimeDir = join(runRoot, ".qualification-runtime");
  const syntheticConfig = join(runtimeDir, "config", "synthetic.json");
  const secretPath = join(runtimeDir, "secret.json");
  mkdirSync(dirname(syntheticConfig), { recursive: true, mode: 0o700 });
  const syntheticToken = `qualification-${randomBytes(32).toString("hex")}`;
  writePrivateJson(syntheticConfig, {
    current: "qualifier-synthetic",
    profiles: {
      "qualifier-synthetic": {
        baseUrl: "https://qualification.invalid/ords/api",
        token: syntheticToken,
        tokenEnv: "APEXCN_QUALIFICATION_SYNTHETIC_TOKEN"
      }
    }
  });
  writePrivateJson(secretPath, { APEXCN_QUALIFICATION_SYNTHETIC_TOKEN: syntheticToken });

  const manifest = readJson(manifestPath);
  const versionProbe = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    shell: false,
    env: safeEnvironment(runRoot, {})
  });
  if (versionProbe.status !== 0 || versionProbe.stderr !== "") throw new Error("Candidate version probe failed");
  const candidateVersion = versionProbe.stdout.trim();
  if (candidateVersion !== manifest.targetVersion) {
    throw new Error(`Candidate version ${candidateVersion} does not match ${manifest.targetVersion}`);
  }
  const state = {
    kind: "apexcn-ga-qualification-recorder-state",
    schemaVersion: 1,
    harnessVersion: manifest.harnessVersion,
    targetVersion: manifest.targetVersion,
    initializedAt: new Date().toISOString(),
    evidenceDir,
    runRoot,
    candidate,
    candidateSha256: sha256File(candidate),
    candidateVersion,
    manifestSha256: sha256File(manifestPath),
    taskPlanSha256: sha256File(planPath),
    syntheticConfig,
    secretPath,
    devConfig: devConfig ?? null
  };
  writePrivateJson(join(evidenceDir, "state.json"), state);
  for (const file of ["fixtures.jsonl", "events.jsonl", "attempts.jsonl", "results.jsonl"]) {
    writeFileSync(join(evidenceDir, file), "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  print({
    kind: state.kind,
    schemaVersion: state.schemaVersion,
    ok: true,
    harnessVersion: state.harnessVersion,
    targetVersion: state.targetVersion,
    candidateSha256: state.candidateSha256,
    manifestSha256: state.manifestSha256,
    taskPlanSha256: state.taskPlanSha256,
    devConfigBound: Boolean(devConfig),
    secretValuesExposed: false
  });
}

function runCandidate(options) {
  const state = loadState(options);
  const task = taskFor(options["task-id"]);
  ensureTaskMayStart(state, task);
  if (task.action.kind !== "public-cli") {
    throw new Error(`${task.taskId} requires begin/complete external evidence`);
  }
  const candidateArgs = options._afterDoubleDash;
  if (candidateArgs.length === 0) throw new Error("run requires candidate argv after --");
  const runtime = runtimeFor(state, task, task.action.credentialMode);
  ensureNetworkIsolationAvailable(task);
  const selectedCommand = validateCandidateArgs(state, task, candidateArgs, task.expectedPublicCommandIds);
  validateBoundPaths(state, runtime.taskRoot, candidateArgs);
  const fixtureMutations = applyFixtureMutations(runtime.taskRoot, task.action.fixtureMutations ?? []);
  const invocations = taskInvocations(state, task, runtime, selectedCommand, candidateArgs);
  const automaticContext = automaticAssertionContext(task, runtime);
  appendEvent(state, {
    event: "started",
    taskId: task.taskId,
    action: "candidate-process",
    attemptedAt: new Date().toISOString(),
    commandOrAction: invocations.map((invocation) => publicCommandLabel(invocation.args)).join(" && "),
    fixtureMutations
  });

  const commandResults = invocations.map((invocation, index) => {
    const execution = spawnCandidate(state, task, runtime, invocation.args);
    const exitCode = execution.child.status ?? 1;
    const rawStdout = execution.child.stdout ?? "";
    const rawStderr = execution.child.stderr ?? "";
    const redactedStdout = redact(rawStdout, runtime.secretValues);
    const redactedStderr = redact(rawStderr, runtime.secretValues);
    const label = invocations.length === 1 ? task.taskId : `${task.taskId}.${invocation.commandId}`;
    const stdoutPath = writeOutput(state, label, "stdout", redactedStdout);
    const stderrPath = writeOutput(state, label, "stderr", redactedStderr);
    return {
      commandId: invocation.commandId,
      order: index + 1,
      commandOrAction: publicCommandLabel(invocation.args),
      exitCode,
      signal: execution.child.signal ?? null,
      stdoutSha256: sha256(redactedStdout),
      stderrSha256: sha256(redactedStderr),
      evidenceRefs: [relativeEvidence(state, stdoutPath), relativeEvidence(state, stderrPath)],
      networkIsolation: execution.networkIsolation,
      automaticAssertions: automaticCommandAssertions(invocation, exitCode, rawStdout, rawStderr, automaticContext)
    };
  });
  const automaticAssertions = {
    required: commandResults.some((result) => result.automaticAssertions.required),
    pass: commandResults.every((result) => result.automaticAssertions.pass),
    commands: commandResults.map((result) => ({ commandId: result.commandId, ...result.automaticAssertions }))
  };
  const aggregateStdout = commandResults.map((result) => result.stdoutSha256).join("\n");
  const aggregateStderr = commandResults.map((result) => result.stderrSha256).join("\n");
  const attempt = {
    taskId: task.taskId,
    attemptedAt: new Date().toISOString(),
    commandOrAction: invocations.map((invocation) => publicCommandLabel(invocation.args)).join(" && "),
    exitCode: commandResults.length === 1 ? commandResults[0].exitCode : Math.max(...commandResults.map((result) => result.exitCode)),
    signal: commandResults.find((result) => result.signal)?.signal ?? null,
    stdoutSha256: sha256(aggregateStdout),
    stderrSha256: sha256(aggregateStderr),
    evidenceRefs: commandResults.flatMap((result) => result.evidenceRefs),
    outputRedacted: true,
    credentialMode: task.action.credentialMode,
    fixtureMutations,
    automaticAssertions,
    commandResults,
    candidateSha256: state.candidateSha256
  };
  appendJsonLine(ledger(state, "attempts.jsonl"), attempt);
  print({ kind: "apexcn-ga-qualification-attempt", schemaVersion: 1, ...attempt });
  if (automaticAssertions.required && !automaticAssertions.pass) process.exitCode = 1;
}

function runFixture(options) {
  const state = loadState(options);
  const task = taskFor(options["task-id"]);
  if (startedEvent(state, task.taskId)) throw new Error(`${task.taskId} already started; fixture setup is closed`);
  const fixtureId = required(options, "fixture-id");
  const fixture = task.action.setup.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error(`${task.taskId} has no fixture ${fixtureId}`);
  if (fixtureFor(state, task.taskId, fixtureId)) throw new Error(`${task.taskId} fixture ${fixtureId} already ran`);
  const fixtureIndex = task.action.setup.indexOf(fixture);
  for (const prerequisite of task.action.setup.slice(0, fixtureIndex)) {
    if (!fixtureFor(state, task.taskId, prerequisite.id)) {
      throw new Error(`${task.taskId} fixture ${fixtureId} requires ${prerequisite.id}`);
    }
  }
  const candidateArgs = options._afterDoubleDash;
  if (candidateArgs.length === 0) throw new Error("fixture requires candidate argv after --");
  const runtime = runtimeFor(state, task, fixture.credentialMode);
  ensureNetworkIsolationAvailable(task);
  validateFrozenTemplateArgs(state, task, runtime, fixture.commandTemplate, candidateArgs, fixture.id);
  validateCandidateArgs(state, task, candidateArgs, [fixture.commandId], false);
  validateBoundPaths(state, runtime.taskRoot, candidateArgs);
  const execution = spawnCandidate(state, task, runtime, candidateArgs);
  const child = execution.child;
  const exitCode = child.status ?? 1;
  const redactedStdout = redact(child.stdout ?? "", runtime.secretValues);
  const redactedStderr = redact(child.stderr ?? "", runtime.secretValues);
  const stdoutPath = writeFixtureOutput(state, task.taskId, fixtureId, "stdout", redactedStdout);
  const stderrPath = writeFixtureOutput(state, task.taskId, fixtureId, "stderr", redactedStderr);
  const record = {
    taskId: task.taskId,
    fixtureId,
    attemptedAt: new Date().toISOString(),
    commandOrAction: publicCommandLabel(candidateArgs),
    exitCode,
    stdoutSha256: sha256(redactedStdout),
    stderrSha256: sha256(redactedStderr),
    evidenceRefs: [relativeEvidence(state, stdoutPath), relativeEvidence(state, stderrPath)],
    capture: fixture.capture ?? {},
    outputRedacted: true,
    networkIsolation: execution.networkIsolation,
    candidateSha256: state.candidateSha256
  };
  appendJsonLine(ledger(state, "fixtures.jsonl"), record);
  print({ kind: "apexcn-ga-qualification-fixture", schemaVersion: 1, ...record });
}

function beginExternal(options) {
  const state = loadState(options);
  const task = taskFor(options["task-id"]);
  ensureTaskMayStart(state, task);
  if (task.action.kind === "public-cli") throw new Error(`${task.taskId} must use recorder run`);
  appendEvent(state, {
    event: "started",
    taskId: task.taskId,
    action: required(options, "action"),
    attemptedAt: new Date().toISOString(),
    commandOrAction: required(options, "action")
  });
  print({
    kind: "apexcn-ga-qualification-external-start",
    schemaVersion: 1,
    ok: true,
    taskId: task.taskId,
    retryAllowed: false
  });
}

function completeExternal(options) {
  const state = loadState(options);
  const task = taskFor(options["task-id"]);
  const start = startedEvent(state, task.taskId);
  if (!start) throw new Error(`${task.taskId} has no started event`);
  if (attemptFor(state, task.taskId)) throw new Error(`${task.taskId} already has an attempt`);
  const stdoutSource = optionalAbsolute(options, "stdout-file");
  const stderrSource = optionalAbsolute(options, "stderr-file");
  const redactedStdout = redact(stdoutSource ? readFileSync(stdoutSource, "utf8") : "", []);
  const redactedStderr = redact(stderrSource ? readFileSync(stderrSource, "utf8") : "", []);
  const stdoutPath = writeOutput(state, task.taskId, "stdout", redactedStdout);
  const stderrPath = writeOutput(state, task.taskId, "stderr", redactedStderr);
  const evidenceRefs = [
    relativeEvidence(state, stdoutPath),
    relativeEvidence(state, stderrPath),
    ...listOption(options, "evidence-ref")
  ];
  const attempt = {
    taskId: task.taskId,
    attemptedAt: start.attemptedAt,
    completedAt: new Date().toISOString(),
    commandOrAction: start.commandOrAction,
    exitCode: integerOption(options, "exit-code"),
    signal: null,
    stdoutSha256: sha256(redactedStdout),
    stderrSha256: sha256(redactedStderr),
    evidenceRefs,
    outputRedacted: true,
    credentialMode: task.action.credentialMode,
    candidateSha256: state.candidateSha256
  };
  appendJsonLine(ledger(state, "attempts.jsonl"), attempt);
  print({ kind: "apexcn-ga-qualification-attempt", schemaVersion: 1, ...attempt });
}

function assess(options) {
  const state = loadState(options);
  ensureFrozenInputs(state);
  const task = taskFor(options["task-id"]);
  const attempt = attemptFor(state, task.taskId);
  if (!attempt) throw new Error(`${task.taskId} has no completed first attempt`);
  if (assessmentFor(state, task.taskId)) throw new Error(`${task.taskId} already has an assessment`);
  const statusValue = required(options, "status");
  if (!["pass", "fail", "blocked"].includes(statusValue)) throw new Error("status must be pass, fail, or blocked");
  const publicOutcome = booleanOption(options, "public-outcome");
  const safety = booleanOption(options, "safety");
  const evidence = booleanOption(options, "evidence");
  const requiresAutomaticAssertions = (task.action.commandTemplates ?? [])
    .some((template) => template.mode === "expected-business-denial");
  if (requiresAutomaticAssertions
    && attempt.automaticAssertions?.pass !== true
    && (statusValue === "pass" || publicOutcome)) {
    throw new Error(`${task.taskId} automatic business-denial assertions did not pass`);
  }
  const assessment = {
    taskId: task.taskId,
    firstAttempt: {
      status: statusValue,
      evidenceRefs: [...attempt.evidenceRefs, ...listOption(options, "evidence-ref")],
      assertions: {
        publicOutcome,
        safety,
        evidence
      },
      observedEffects: listOption(options, "observed-effect"),
      isolatedEnvironment: task.writePolicy === "isolated-confirmed"
        ? booleanOption(options, "isolated-environment")
        : undefined,
      realChromeEvidence: task.realChromeRequired
        ? booleanOption(options, "real-chrome-evidence")
        : undefined,
      cleanupResidualCount: task.writePolicy === "isolated-confirmed"
        ? integerOption(options, "cleanup-residual-count")
        : undefined,
      attemptSha256: sha256(`${JSON.stringify(attempt)}\n`)
    }
  };
  appendJsonLine(ledger(state, "results.jsonl"), assessment);
  print({ kind: "apexcn-ga-qualification-assessment", schemaVersion: 1, ok: true, taskId: task.taskId });
}

function status(options) {
  const state = loadState(options);
  const tasks = readJsonLines(planPath);
  const events = readJsonLines(ledger(state, "events.jsonl"), true);
  const attempts = readJsonLines(ledger(state, "attempts.jsonl"), true);
  const results = readJsonLines(ledger(state, "results.jsonl"), true);
  const fixtures = readJsonLines(ledger(state, "fixtures.jsonl"), true);
  const started = new Set(events.filter((event) => event.event === "started").map((event) => event.taskId));
  const completed = new Set(attempts.map((attempt) => attempt.taskId));
  const assessed = new Set(results.map((result) => result.taskId));
  print({
    kind: "apexcn-ga-qualification-recorder-status",
    schemaVersion: 1,
    ok: started.size === tasks.length && started.size === completed.size && completed.size === assessed.size,
    targetVersion: state.targetVersion,
    denominator: tasks.length,
    started: started.size,
    completed: completed.size,
    assessed: assessed.size,
    fixtureAttempts: fixtures.length,
    startedWithoutCompletedEvidence: [...started].filter((taskId) => !completed.has(taskId)).sort(),
    completedWithoutAssessment: [...completed].filter((taskId) => !assessed.has(taskId)).sort(),
    remaining: tasks.map((task) => task.taskId).filter((taskId) => !started.has(taskId))
  });
}

function finalize(options) {
  const state = loadState(options);
  const tasks = readJsonLines(planPath);
  const events = readJsonLines(ledger(state, "events.jsonl"), true);
  const attempts = readJsonLines(ledger(state, "attempts.jsonl"), true);
  const results = readJsonLines(ledger(state, "results.jsonl"), true);
  if (events.length !== tasks.length || attempts.length !== tasks.length || results.length !== tasks.length) {
    throw new Error(`Cannot finalize: expected ${tasks.length}/${tasks.length}/${tasks.length} events, attempts, and results`);
  }
  const order = new Map(tasks.map((task, index) => [task.taskId, index]));
  const ordered = [...results].sort((left, right) => order.get(left.taskId) - order.get(right.taskId));
  const resultPath = join(state.evidenceDir, "results.final.jsonl");
  writeFileSync(resultPath, `${ordered.map((value) => JSON.stringify(value)).join("\n")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const scorePath = join(state.evidenceDir, "score.json");
  const score = spawnSync(process.execPath, [scorerPath, "--results", resultPath, "--output", scorePath], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false
  });
  if (score.error) throw score.error;
  const report = readJson(scorePath);
  print({
    kind: "apexcn-ga-qualification-finalization",
    schemaVersion: 1,
    ok: score.status === 0 && report.ok === true,
    taskCount: tasks.length,
    resultsSha256: sha256File(resultPath),
    scoreSha256: sha256File(scorePath),
    score: report
  });
  if (score.status !== 0 || report.ok !== true) process.exitCode = 1;
}

function ensureTaskMayStart(state, task) {
  if (startedEvent(state, task.taskId)) throw new Error(`${task.taskId} already started; retry is forbidden`);
  for (const fixture of task.action.setup ?? []) {
    const record = fixtureFor(state, task.taskId, fixture.id);
    if (!record || record.exitCode !== 0) {
      throw new Error(`${task.taskId} requires successful fixture ${fixture.id}`);
    }
  }
  ensureFrozenInputs(state);
}

function ensureFrozenInputs(state) {
  if (sha256File(manifestPath) !== state.manifestSha256 || sha256File(planPath) !== state.taskPlanSha256) {
    throw new Error("Frozen harness inputs drifted after initialization");
  }
  if (sha256File(state.candidate) !== state.candidateSha256) throw new Error("Candidate launcher drifted after initialization");
}

function validateCandidateArgs(state, task, values, allowedCommandIds, enforceTaskPolicy = true) {
  if (values.some((value) => value.includes("${"))) {
    throw new Error("All qualification bindings must be resolved before candidate execution");
  }
  if (values.some((value) => /^(--token|--api-key|--authorization|--cookie)(?:=|$)/i.test(value))) {
    throw new Error("Secret-bearing argv is forbidden; use the bound synthetic or DEV config");
  }
  const surface = readJson(join(repoRoot, "qualification/ga/public-surface-v2.json"));
  const matched = surface.commandManifest.commands.find((descriptor) => {
    const path = descriptor.path.split(" ");
    return path.every((part, index) => values[index] === part);
  });
  if (!matched || !allowedCommandIds.includes(matched.id)) {
    throw new Error(`${task.taskId} argv does not select an allowed public command`);
  }
  if (enforceTaskPolicy && task.writePolicy === "preview-only" && matched.id !== "confirm" && !values.includes("--preview")) {
    throw new Error(`${task.taskId} requires --preview`);
  }
  if (matched.id === "confirm" && values[1] !== "qualification-invalid-operation") {
    throw new Error("confirm qualification may use only the frozen invalid operation id");
  }
  return matched;
}

function taskInvocations(state, task, runtime, selectedCommand, candidateArgs) {
  const templates = task.action.commandTemplates ?? [];
  const denialTemplates = templates.filter((template) => template.mode === "expected-business-denial");
  if (denialTemplates.length === 0) {
    return [{ commandId: selectedCommand.id, mode: "operator-assessed", args: candidateArgs }];
  }
  if (denialTemplates.length !== templates.length) {
    throw new Error(`${task.taskId} mixes automatic and operator-assessed command templates`);
  }
  const expectedIds = [...new Set(task.expectedPublicCommandIds)];
  const templateIds = denialTemplates.map((template) => template.commandId);
  if (new Set(templateIds).size !== templateIds.length
    || templateIds.length !== expectedIds.length
    || expectedIds.some((commandId) => !templateIds.includes(commandId))) {
    throw new Error(`${task.taskId} automatic command templates do not cover the frozen command ids exactly`);
  }
  const bindings = frozenTemplateBindings(state, runtime);
  const invocations = denialTemplates.map((template) => {
    const resolved = resolveCommandTemplate(template.commandTemplate, bindings);
    if (resolved[0] !== state.candidate) {
      throw new Error(`${task.taskId} automatic command template must execute the bound candidate`);
    }
    const invocationArgs = resolved.slice(1);
    validateCandidateArgs(state, task, invocationArgs, [template.commandId], false);
    validateBoundPaths(state, runtime.taskRoot, invocationArgs);
    return { commandId: template.commandId, mode: template.mode, args: invocationArgs };
  });
  if (!invocations.some((invocation) => arraysEqual(invocation.args, candidateArgs))) {
    throw new Error(`${task.taskId} argv does not match a frozen automatic command template`);
  }
  return invocations;
}

function frozenTemplateBindings(state, runtime) {
  return {
    APEXCN_BIN: state.candidate,
    RUN_ROOT: state.runRoot,
    TASK_ROOT: runtime.taskRoot
  };
}

function validateFrozenTemplateArgs(state, task, runtime, template, candidateArgs, label) {
  const resolved = resolveCommandTemplate(template, frozenTemplateBindings(state, runtime));
  if (resolved[0] !== state.candidate || !arraysEqual(resolved.slice(1), candidateArgs)) {
    throw new Error(`${task.taskId} ${label} argv does not match its frozen command template`);
  }
}

function resolveCommandTemplate(template, bindings) {
  const words = shellWords(template).map((word) => {
    let resolved = word;
    for (const [name, value] of Object.entries(bindings)) {
      resolved = resolved.replaceAll(`\${${name}}`, value);
    }
    return resolved;
  });
  const unresolved = words.flatMap((word) => word.match(/\$\{[A-Z0-9_]+\}/g) ?? []);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved command bindings: ${[...new Set(unresolved)].join(",")}`);
  }
  return words;
}

function shellWords(value) {
  const words = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else current += character;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current) words.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quote) throw new Error("Unterminated quote in command template");
  if (escaped) current += "\\";
  if (current) words.push(current);
  return words;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function spawnCandidate(state, task, runtime, candidateArgs) {
  const childArgs = ["--config", runtime.configPath, ...candidateArgs];
  let file = state.candidate;
  let args = childArgs;
  let networkIsolation = "not-required";
  if (task.networkPolicy === "no-network") {
    ensureNetworkIsolationAvailable(task);
    file = "/usr/bin/sandbox-exec";
    args = ["-p", "(version 1)\n(allow default)\n(deny network*)", state.candidate, ...childArgs];
    networkIsolation = "macos-sandbox-exec";
  }
  const child = spawnSync(file, args, {
    cwd: runtime.taskRoot,
    encoding: "utf8",
    shell: false,
    env: runtime.env,
    maxBuffer: 16 * 1024 * 1024
  });
  if (child.error) throw child.error;
  return { child, networkIsolation };
}

function ensureNetworkIsolationAvailable(task) {
  if (task.networkPolicy === "no-network"
    && (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))) {
    throw new Error("No-network qualification requires macOS sandbox-exec");
  }
}

function automaticAssertionContext(task, runtime) {
  const automaticTemplates = (task.action.commandTemplates ?? [])
    .filter((template) => template.mode === "expected-business-denial");
  if (automaticTemplates.length === 0) return undefined;
  const commandIds = automaticTemplates.map((template) => template.commandId).sort();
  if (canonicalJson(commandIds) !== canonicalJson(["workflow.diff", "workflow.verify"])) {
    throw new Error(`${task.taskId} has no independent automatic assertion context`);
  }
  return workflowHashMismatchContext(task, runtime.taskRoot);
}

function workflowHashMismatchContext(task, taskRoot) {
  const mutations = task.action.fixtureMutations ?? [];
  if (mutations.length !== 1
    || mutations[0].kind !== "json-set"
    || mutations[0].file !== "run/preview.json"
    || canonicalJson(mutations[0].path) !== canonicalJson(["request", "body", "title"])) {
    throw new Error(`${task.taskId} does not declare the frozen workflow title mutation`);
  }
  const runDir = join(taskRoot, "run");
  const run = readWorkflowArtifact(join(runDir, "run.json"), "run");
  const preview = readWorkflowArtifact(join(runDir, "preview.json"), "preview");
  const approval = readWorkflowArtifact(join(runDir, "approval.json"), "approval");
  if (run.kind !== "workflow-run" || run.schemaVersion !== 1
    || typeof run.runId !== "string" || !run.runId || run.status !== "preview-ready") {
    throw new Error(`${task.taskId} workflow run witness is invalid`);
  }
  if (preview.kind !== "workflow-preview" || preview.schemaVersion !== 1) {
    throw new Error(`${task.taskId} workflow preview witness is invalid`);
  }
  if (approval.kind !== "workflow-approval" || approval.schemaVersion !== 1 || approval.runId !== run.runId) {
    throw new Error(`${task.taskId} workflow approval witness is invalid`);
  }
  const previewTarget = workflowTargetFromArtifact(preview);
  const approvalTarget = workflowTargetFromArtifact(approval.target);
  const previewRequest = workflowRequestFromArtifact(preview.request);
  const approvalRequest = workflowRequestFromArtifact(approval.request);
  if (!previewTarget || !approvalTarget || !previewRequest || !approvalRequest
    || canonicalJson(previewTarget) !== canonicalJson(approvalTarget)) {
    throw new Error(`${task.taskId} workflow target or request witness is invalid`);
  }
  if (typeof approval.previewHash !== "string" || !/^[a-f0-9]{64}$/u.test(approval.previewHash)) {
    throw new Error(`${task.taskId} workflow approval hash witness is invalid`);
  }
  const approvalHash = workflowPreviewHash(approvalTarget, approvalRequest);
  const previewHash = workflowPreviewHash(previewTarget, previewRequest);
  if (approvalHash !== approval.previewHash || previewHash === approvalHash) {
    throw new Error(`${task.taskId} workflow hash mismatch witness is invalid`);
  }
  const currentMutationValue = jsonPathValue(preview, mutations[0].path);
  const approvedMutationValue = jsonPathValue(approval, mutations[0].path);
  if (canonicalJson(currentMutationValue) !== canonicalJson(mutations[0].value)
    || canonicalJson(currentMutationValue) === canonicalJson(approvedMutationValue)) {
    throw new Error(`${task.taskId} workflow mutation witness is invalid`);
  }
  const expectedPreviewEnvelope = { request: structuredClone(approvalRequest) };
  setExistingJsonPath(expectedPreviewEnvelope, mutations[0].path, mutations[0].value);
  if (canonicalJson(previewRequest) !== canonicalJson(expectedPreviewEnvelope.request)) {
    throw new Error(`${task.taskId} workflow preview contains changes beyond the frozen title mutation`);
  }
  const differences = workflowRequestDifferences(previewRequest, approvalRequest);
  if (differences.length !== 1 || differences[0].path !== "body") {
    throw new Error(`${task.taskId} workflow witness contains differences beyond the frozen body mutation`);
  }
  return {
    kind: "workflow-hash-mismatch",
    runId: run.runId,
    status: run.status,
    runDir,
    previewHash,
    approvalHash,
    previewTarget,
    approvalTarget,
    previewRequest,
    approvalRequest,
    differences,
    verificationReportPath: join(runDir, "verification.json")
  };
}

function readWorkflowArtifact(path, label) {
  let value;
  try {
    value = readJson(path);
  } catch (error) {
    throw new Error(`Invalid workflow ${label} witness: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error(`Invalid workflow ${label} witness`);
  return value;
}

function workflowTargetFromArtifact(value) {
  if (!isRecord(value) || typeof value.profile !== "string" || typeof value.baseUrl !== "string") return undefined;
  if (value.configScope !== undefined && typeof value.configScope !== "string") return undefined;
  if (value.credentialFingerprint !== undefined && typeof value.credentialFingerprint !== "string") return undefined;
  return Object.fromEntries(Object.entries({
    profile: value.profile,
    baseUrl: value.baseUrl,
    configScope: value.configScope,
    credentialFingerprint: value.credentialFingerprint
  }).filter(([, child]) => child !== undefined));
}

function workflowRequestFromArtifact(value) {
  if (!isRecord(value)
    || (value.method !== "POST" && value.method !== "DELETE")
    || typeof value.path !== "string"
    || !isRecord(value.body)) return undefined;
  return { method: value.method, path: value.path, body: value.body };
}

function workflowPreviewHash(target, request) {
  return sha256(canonicalJson({ target, request }));
}

function workflowRequestDifferences(left, right) {
  const differences = [];
  if (left.method !== right.method) differences.push({ path: "method", left: left.method, right: right.method });
  if (left.path !== right.path) differences.push({ path: "path", left: left.path, right: right.path });
  if (canonicalJson(left.body) !== canonicalJson(right.body)) {
    differences.push({
      path: "body",
      leftHash: sha256(canonicalJson(left.body)),
      rightHash: sha256(canonicalJson(right.body))
    });
  }
  return differences;
}

function jsonPathValue(value, path) {
  let current = value;
  for (const part of path) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function automaticCommandAssertions(invocation, exitCode, stdout, stderr, context) {
  if (invocation.mode !== "expected-business-denial") return { required: false, pass: true };
  let output;
  try {
    output = JSON.parse(stdout);
  } catch {
    output = undefined;
  }
  const common = {
    exitCodeIsOne: exitCode === 1,
    stderrIsEmpty: stderr === "",
    stdoutIsJsonObject: Boolean(output && typeof output === "object" && !Array.isArray(output)),
    schemaVersionIsOne: output?.schemaVersion === 1,
    okIsFalse: output?.ok === false,
    independentWitnessPresent: context?.kind === "workflow-hash-mismatch"
  };
  let contract;
  if (invocation.commandId === "workflow.diff") {
    contract = {
      kindMatches: output?.kind === "workflow-diff",
      runIdMatches: output?.runId === context?.runId,
      hashMatchesIsFalse: output?.hashMatches === false,
      executionAllowedIsFalse: output?.executionAllowed === false,
      previewHashMatchesWitness: output?.previewHash === context?.previewHash,
      approvalHashMatchesWitness: output?.approvalHash === context?.approvalHash,
      approvedRequestHashMatchesWitness: output?.approvedRequestHash === context?.approvalHash,
      approvalBoundRequestHashMatchesWitness: output?.approvalBoundRequestHash === context?.approvalHash,
      currentRequestHashMatchesWitness: output?.currentRequestHash === context?.previewHash,
      previewRequestMatchesWitness: canonicalJson(output?.previewRequest) === canonicalJson(context?.previewRequest),
      approvalRequestMatchesWitness: canonicalJson(output?.approvalRequest) === canonicalJson(context?.approvalRequest),
      differencesMatchWitness: canonicalJson(output?.differences) === canonicalJson(context?.differences),
      changesMatchWitness: canonicalJson(output?.changes) === canonicalJson(context?.differences)
    };
  } else if (invocation.commandId === "workflow.verify") {
    const issues = Array.isArray(output?.issues) ? output.issues : [];
    contract = {
      kindMatches: output?.kind === "workflow-verification",
      runIdMatches: output?.runId === context?.runId,
      statusMatches: output?.status === context?.status,
      previewHashMatchesWitness: output?.previewHash === context?.previewHash,
      approvalRunIdMatchesWitness: output?.approval?.runId === context?.runId,
      approvalHashMatchesWitness: output?.approval?.previewHash === context?.approvalHash,
      approvalTargetMatchesWitness: canonicalJson(output?.approval?.target) === canonicalJson(context?.approvalTarget),
      approvalRequestMatchesWitness: canonicalJson(output?.approval?.request) === canonicalJson(context?.approvalRequest),
      approvalHashMismatchIsOnlyIssue: issues.length === 1 && issues[0]?.code === "approval-hash-mismatch",
      reportPathMatchesWitness: output?.reportPath === context?.verificationReportPath
    };
  } else {
    contract = { recognizedContract: false };
  }
  const assertions = { ...common, ...contract };
  return {
    required: true,
    pass: Object.values(assertions).every(Boolean),
    ...assertions
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateBoundPaths(state, taskRoot, values) {
  const pathFlags = new Set([
    "--bundle",
    "--content-file",
    "--dir",
    "--draft-file",
    "--input",
    "--output",
    "--output-dir",
    "--plan",
    "--policy",
    "--research-file",
    "--run-dir",
    "--topic-file"
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (pathFlags.has(value)) {
      const pathValue = values[index + 1];
      if (pathValue === undefined) throw new Error(`Missing path argument for ${value}`);
      validateBoundPath(state, taskRoot, value, pathValue);
      index += 1;
      continue;
    }
    const inlineFlag = [...pathFlags].find((flag) => value.startsWith(`${flag}=`));
    if (!inlineFlag) continue;
    validateBoundPath(state, taskRoot, inlineFlag, value.slice(inlineFlag.length + 1));
  }
}

function validateBoundPath(state, taskRoot, flag, value) {
  if (!value) throw new Error(`Missing path argument for ${flag}`);
  const runRoot = resolve(state.runRoot);
  const path = isAbsolute(value) ? resolve(value) : resolve(taskRoot, value);
  if (!pathInside(runRoot, path)) {
    throw new Error(`Path argument for ${flag} escapes the isolated run root`);
  }
  let existing = path;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (!pathInside(realpathSync(runRoot), realpathSync(existing))) {
    throw new Error(`Path argument for ${flag} escapes the isolated run root through a symbolic link`);
  }
}

function pathInside(root, path) {
  const nested = relative(root, path);
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
}

function runtimeFor(state, task, credentialMode) {
  const secrets = readJson(state.secretPath);
  const taskRoot = join(state.runRoot, "tasks", task.taskId);
  mkdirSync(taskRoot, { recursive: true, mode: 0o700 });
  materializeStaticFixtures(taskRoot, task.action.staticFixtures ?? []);
  if (credentialMode === "approved-dev") {
    if (!state.devConfig) throw new Error(`${task.taskId} requires --dev-config binding`);
    return {
      configPath: state.devConfig,
      env: safeEnvironment(state.runRoot, {}),
      secretValues: [],
      taskRoot
    };
  }
  const taskConfig = join(state.runRoot, ".qualification-runtime", "task-configs", `${task.taskId}.json`);
  if (!existsSync(taskConfig)) {
    mkdirSync(dirname(taskConfig), { recursive: true, mode: 0o700 });
    writeFileSync(taskConfig, readFileSync(state.syntheticConfig), { mode: 0o600, flag: "wx" });
    chmodSync(taskConfig, 0o600);
  }
  return {
    configPath: taskConfig,
    env: safeEnvironment(state.runRoot, secrets),
    secretValues: Object.values(secrets),
    taskRoot
  };
}

function materializeStaticFixtures(taskRoot, names) {
  const fixtures = {
    "research.json": `${JSON.stringify({ links: [] }, null, 2)}\n`,
    "reply.md": "## Qualification reply\n\nThis is an isolated qualification reply.\n",
    "updated-reply.md": "## Updated qualification reply\n\nThis is an isolated updated reply.\n",
    "question.md": "# Qualification question\n\nThis is isolated qualification content.\n",
    "post.md": "# Qualification post\n\nThis is isolated qualification content.\n",
    "updated-post.md": "# Updated qualification post\n\nThis is isolated updated content.\n",
    "bundle.json": qualificationCollectionBundleText()
  };
  for (const name of names) {
    const path = join(taskRoot, name);
    if (!existsSync(path)) writeFileSync(path, fixtures[name], { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
}

function qualificationCollectionBundleText() {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const sources = [{ type: "explicit" }];
  const topicData = {
    id: 1,
    title: "ORDS authentication qualification fixture",
    url: "https://qualification.invalid/t/1",
    content: "REST API ORDS authentication privilege mapping qualification content.",
    tags: ["ORDS", "REST"]
  };
  const topicArtifact = {
    kind: "collection-topic",
    schemaVersion: 1,
    id: 1,
    sources,
    request: { method: "GET", path: "/api/v1/topics/1" },
    requestId: "qualification-topic-1",
    result: { requestId: "qualification-topic-1", topic: topicData }
  };
  const topicCanonicalHash = prefixedSha256(canonicalJson({ id: 1, sources, topic: topicData }));
  const topicText = prettyJson(topicArtifact);
  const indexText = "# Qualification collection\n\n- [ORDS authentication qualification fixture](topics/1.json)\n";
  const topicEvidence = fileEvidence("topics/1.json", topicText);
  const indexEvidence = fileEvidence("index.md", indexText);
  const contentHash = prefixedSha256(canonicalJson([{ id: 1, canonicalHash: topicCanonicalHash }]));
  const collection = {
    kind: "collection",
    schemaVersion: 2,
    createdAt,
    contentHash,
    source: {
      profile: "qualifier-synthetic",
      baseUrl: "https://qualification.invalid/ords/api",
      queries: [],
      topicIds: [1],
      limit: 1
    },
    topicCount: 1,
    topics: [{
      id: 1,
      title: topicData.title,
      url: topicData.url,
      sources,
      file: topicEvidence.path,
      canonicalHash: topicCanonicalHash
    }],
    errors: [],
    files: {
      index: indexEvidence,
      topics: [{ id: 1, canonicalHash: topicCanonicalHash, ...topicEvidence }]
    }
  };
  const collectionText = prettyJson(collection);
  const indexRecord = {
    kind: "collection-index-record",
    schemaVersion: 1,
    engine: "bm25",
    topicId: 1,
    title: topicData.title,
    url: topicData.url,
    sourcePath: topicEvidence.path,
    sourceHash: topicCanonicalHash,
    terms: { ords: 2, authentication: 2, rest: 1, api: 1 },
    documentLength: 6,
    excerpt: `${topicData.title} ${topicData.content}`
  };
  const indexJsonl = `${JSON.stringify(indexRecord)}\n`;
  const indexJsonlEvidence = fileEvidence("index.jsonl", indexJsonl);
  const indexMetaText = prettyJson({
    kind: "collection-index-meta",
    schemaVersion: 3,
    engine: "bm25",
    createdAt,
    documentCount: 1,
    tokenCount: 6,
    averageDocumentLength: 6,
    fieldWeights: { title: 3, tags: 2, content: 1 },
    sourceCollectionHash: prefixedSha256(collectionText),
    sourceDocuments: [{ topicId: 1, canonicalHash: topicCanonicalHash }],
    fields: ["title", "content", "tags", "category"],
    files: { index: indexJsonlEvidence }
  });
  const contents = {
    "collection.json": collectionText,
    "index.jsonl": indexJsonl,
    "index.md": indexText,
    "index.meta.json": indexMetaText,
    "topics/1.json": topicText
  };
  const files = Object.entries(contents).map(([path, content]) => ({ ...fileEvidence(path, content), content }));
  const payload = {
    kind: "collection-bundle",
    schemaVersion: 1,
    collectionContentHash: contentHash,
    documentCount: 1,
    files
  };
  return prettyJson({ ...payload, bundleHash: prefixedSha256(canonicalJson(payload)) });
}

function applyFixtureMutations(taskRoot, mutations) {
  return mutations.map((mutation) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(mutation.id ?? "")) {
      throw new Error("Fixture mutation id is unsafe");
    }
    if (mutation.kind !== "json-set" || typeof mutation.file !== "string" || isAbsolute(mutation.file)) {
      throw new Error(`Unsupported fixture mutation ${mutation.id}`);
    }
    const file = resolve(taskRoot, mutation.file);
    const relativePath = relative(resolve(taskRoot), file);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Fixture mutation path escapes task root: ${mutation.file}`);
    }
    const metadata = lstatSync(file);
    const canonicalRelative = relative(realpathSync(taskRoot), realpathSync(file));
    if (!metadata.isFile() || metadata.isSymbolicLink()
      || !canonicalRelative || canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
      throw new Error(`Fixture mutation path is unsafe: ${mutation.file}`);
    }
    const beforeText = readFileSync(file, "utf8");
    const value = JSON.parse(beforeText);
    setExistingJsonPath(value, mutation.path, mutation.value);
    const afterText = prettyJson(value);
    writeFileSync(file, afterText, { encoding: "utf8", mode: 0o600 });
    return {
      id: mutation.id,
      kind: mutation.kind,
      file: relativePath,
      path: mutation.path.join("."),
      beforeSha256: sha256(beforeText),
      afterSha256: sha256(afterText)
    };
  });
}

function setExistingJsonPath(value, path, replacement) {
  if (!Array.isArray(path) || path.length === 0 || path.some((part) => (
    typeof part !== "string"
    || !/^[A-Za-z0-9_-]+$/.test(part)
    || ["__proto__", "prototype", "constructor"].includes(part)
  ))) {
    throw new Error("Fixture mutation requires a safe non-empty JSON path");
  }
  let parent = value;
  for (const part of path.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part)) {
      throw new Error(`Fixture mutation JSON path is missing: ${path.join(".")}`);
    }
    parent = parent[part];
  }
  const leaf = path.at(-1);
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, leaf)) {
    throw new Error(`Fixture mutation JSON path is missing: ${path.join(".")}`);
  }
  parent[leaf] = replacement;
}

function fileEvidence(path, content) {
  return { path, size: Buffer.byteLength(content), sha256: sha256(content) };
}

function prefixedSha256(value) {
  return `sha256:${sha256(value)}`;
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
}

function safeEnvironment(runRoot, additions) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(TOKEN|SECRET|PASSWORD|API_?KEY|COOKIE|AUTHORIZATION)/i.test(name)
  ));
  return {
    ...env,
    HOME: join(runRoot, "home"),
    APEXCN_CLI_INSTALL_ROOT: join(runRoot, "install"),
    APEXCN_CLI_BIN_DIR: join(runRoot, "bin"),
    APEXCN_CLI_BACKUP_ROOT: join(runRoot, "backups"),
    ...additions
  };
}

function redact(value, secretValues) {
  const sensitiveValues = secretValues.filter((secret) => typeof secret === "string" && secret.length >= 4);
  const structured = sanitizeStructuredText(value, sensitiveValues);
  if (structured !== null) return structured;
  return replaceSensitiveValues(value, sensitiveValues)
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/("(?:(?:access[_-]?)?token|(?:x[_-]?)?api[_-]?key|cookie|authorization|password|secret)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .replace(/((?:(?:access[_-]?)?token|(?:x[_-]?)?api[_-]?key|cookie|authorization|password|secret)\s*[=:]\s*)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/((?:body|requestBody|content|question)\s*[=:]\s*)[^\r\n]+/gi, "$1[REDACTED_BODY]");
}

function sanitizeStructuredText(value, sensitiveValues) {
  const trailingNewline = value.endsWith("\n");
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    const sanitized = JSON.stringify(redactStructuredValue(JSON.parse(trimmed), sensitiveValues));
    return trailingNewline ? `${sanitized}\n` : sanitized;
  } catch {
    const lines = value.split("\n");
    if (lines.filter((line) => line.trim()).length < 2) return null;
    try {
      return lines.map((line) => line.trim()
        ? JSON.stringify(redactStructuredValue(JSON.parse(line), sensitiveValues))
        : line).join("\n");
    } catch {
      return null;
    }
  }
}

function redactStructuredValue(value, sensitiveValues) {
  if (typeof value === "string") return replaceSensitiveValues(value, sensitiveValues);
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, sensitiveValues));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (["body", "requestbody", "content", "question"].includes(normalizedKey)) return [key, "[REDACTED_BODY]"];
    if (sensitiveStructuredKey(normalizedKey)) return [key, "[REDACTED]"];
    return [key, redactStructuredValue(child, sensitiveValues)];
  }));
}

function sensitiveStructuredKey(normalizedKey) {
  return normalizedKey.endsWith("token")
    || normalizedKey.endsWith("apikey")
    || normalizedKey.endsWith("secret")
    || normalizedKey.endsWith("password")
    || normalizedKey.endsWith("authorization")
    || normalizedKey.endsWith("cookie");
}

function replaceSensitiveValues(value, sensitiveValues) {
  let result = value;
  for (const sensitiveValue of sensitiveValues) result = result.replaceAll(sensitiveValue, "[REDACTED]");
  return result;
}

function writeOutput(state, taskId, stream, value) {
  const dir = join(state.evidenceDir, "output");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${taskId}.${stream}.txt`);
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return path;
}

function writeFixtureOutput(state, taskId, fixtureId, stream, value) {
  const dir = join(state.evidenceDir, "fixtures");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${taskId}.${fixtureId}.${stream}.txt`);
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return path;
}

function appendEvent(state, event) {
  appendJsonLine(ledger(state, "events.jsonl"), event);
}

function appendJsonLine(path, value) {
  appendFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function loadState(options) {
  const evidenceDir = requiredAbsolute(options, "evidence-dir");
  const state = readJson(join(evidenceDir, "state.json"));
  if (state.evidenceDir !== evidenceDir) throw new Error("Evidence directory does not match recorder state");
  return state;
}

function taskFor(taskId) {
  if (!taskId) throw new Error("Missing --task-id");
  const task = readJsonLines(planPath).find((item) => item.taskId === taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  return task;
}

function startedEvent(state, taskId) {
  return readJsonLines(ledger(state, "events.jsonl"), true).find((event) => event.taskId === taskId && event.event === "started");
}

function attemptFor(state, taskId) {
  return readJsonLines(ledger(state, "attempts.jsonl"), true).find((attempt) => attempt.taskId === taskId);
}

function assessmentFor(state, taskId) {
  return readJsonLines(ledger(state, "results.jsonl"), true).find((result) => result.taskId === taskId);
}

function fixtureFor(state, taskId, fixtureId) {
  return readJsonLines(ledger(state, "fixtures.jsonl"), true)
    .find((fixture) => fixture.taskId === taskId && fixture.fixtureId === fixtureId);
}

function ledger(state, name) {
  return join(state.evidenceDir, name);
}

function relativeEvidence(state, path) {
  return `evidence/${path.slice(state.evidenceDir.length + 1)}`;
}

function publicCommandLabel(values) {
  return `apexcn ${values.map((value) => value.includes(" ") ? JSON.stringify(value) : value).join(" ")}`;
}

function writePrivateJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonLines(path, allowEmpty = false) {
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return allowEmpty ? [] : [];
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredAbsolute(options, name) {
  const value = required(options, name);
  if (!isAbsolute(value)) throw new Error(`--${name} must be absolute`);
  return resolve(value);
}

function optionalAbsolute(options, name) {
  const value = options[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) throw new Error(`--${name} may be supplied once`);
  if (!isAbsolute(value)) throw new Error(`--${name} must be absolute`);
  return resolve(value);
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${name}`);
  return value;
}

function listOption(options, name) {
  const value = options[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function booleanOption(options, name) {
  const value = required(options, name);
  if (value !== "true" && value !== "false") throw new Error(`--${name} must be true or false`);
  return value === "true";
}

function integerOption(options, name) {
  const value = Number(required(options, name));
  if (!Number.isSafeInteger(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function parseOptions(values, allowDoubleDash = false) {
  const options = { _afterDoubleDash: [] };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--" && allowDoubleDash) {
      options._afterDoubleDash = values.slice(index + 1);
      return options;
    }
    const flag = values[index];
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument ${flag}`);
    const name = flag.slice(2);
    const value = values[++index];
    if (value === undefined || value === "--") throw new Error(`Missing value for ${flag}`);
    if (options[name] === undefined) options[name] = value;
    else if (Array.isArray(options[name])) options[name].push(value);
    else options[name] = [options[name], value];
  }
  return options;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
