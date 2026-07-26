#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
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
  validateCandidateArgs(state, task, candidateArgs, task.expectedPublicCommandIds);
  validateBoundPaths(state, candidateArgs);
  appendEvent(state, {
    event: "started",
    taskId: task.taskId,
    action: "candidate-process",
    attemptedAt: new Date().toISOString(),
    commandOrAction: publicCommandLabel(candidateArgs)
  });

  const childArgs = ["--config", runtime.configPath, ...candidateArgs];
  const child = spawnSync(state.candidate, childArgs, {
    cwd: runtime.taskRoot,
    encoding: "utf8",
    shell: false,
    env: runtime.env,
    maxBuffer: 16 * 1024 * 1024
  });
  const exitCode = child.status ?? 1;
  const redactedStdout = redact(child.stdout ?? "", runtime.secretValues);
  const redactedStderr = redact(child.stderr ?? "", runtime.secretValues);
  const stdoutPath = writeOutput(state, task.taskId, "stdout", redactedStdout);
  const stderrPath = writeOutput(state, task.taskId, "stderr", redactedStderr);
  const attempt = {
    taskId: task.taskId,
    attemptedAt: new Date().toISOString(),
    commandOrAction: publicCommandLabel(candidateArgs),
    exitCode,
    signal: child.signal ?? null,
    stdoutSha256: sha256(redactedStdout),
    stderrSha256: sha256(redactedStderr),
    evidenceRefs: [relativeEvidence(state, stdoutPath), relativeEvidence(state, stderrPath)],
    outputRedacted: true,
    credentialMode: task.action.credentialMode,
    candidateSha256: state.candidateSha256
  };
  appendJsonLine(ledger(state, "attempts.jsonl"), attempt);
  print({ kind: "apexcn-ga-qualification-attempt", schemaVersion: 1, ...attempt });
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
  validateCandidateArgs(state, task, candidateArgs, [fixture.commandId], false);
  validateBoundPaths(state, candidateArgs);
  const child = spawnSync(state.candidate, ["--config", runtime.configPath, ...candidateArgs], {
    cwd: runtime.taskRoot,
    encoding: "utf8",
    shell: false,
    env: runtime.env,
    maxBuffer: 16 * 1024 * 1024
  });
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
  const task = taskFor(options["task-id"]);
  const attempt = attemptFor(state, task.taskId);
  if (!attempt) throw new Error(`${task.taskId} has no completed first attempt`);
  if (assessmentFor(state, task.taskId)) throw new Error(`${task.taskId} already has an assessment`);
  const statusValue = required(options, "status");
  if (!["pass", "fail", "blocked"].includes(statusValue)) throw new Error("status must be pass, fail, or blocked");
  const assessment = {
    taskId: task.taskId,
    firstAttempt: {
      status: statusValue,
      evidenceRefs: [...attempt.evidenceRefs, ...listOption(options, "evidence-ref")],
      assertions: {
        publicOutcome: booleanOption(options, "public-outcome"),
        safety: booleanOption(options, "safety"),
        evidence: booleanOption(options, "evidence")
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
}

function validateBoundPaths(state, values) {
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
  for (let index = 0; index < values.length - 1; index += 1) {
    if (!pathFlags.has(values[index]) || !isAbsolute(values[index + 1])) continue;
    const path = resolve(values[index + 1]);
    if (path !== state.runRoot && !path.startsWith(`${state.runRoot}/`)) {
      throw new Error(`Path argument for ${values[index]} escapes the isolated run root`);
    }
  }
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
    "updated-post.md": "# Updated qualification post\n\nThis is isolated updated content.\n"
  };
  for (const name of names) {
    const path = join(taskRoot, name);
    if (!existsSync(path)) writeFileSync(path, fixtures[name], { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
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
  let result = value;
  for (const secret of secretValues) {
    if (typeof secret === "string" && secret.length >= 4) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/("(?:token|apiKey|api_key|cookie|authorization)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .replace(/((?:token|api[_-]?key|cookie|authorization)\s*[=:]\s*)[^\s"',}]+/gi, "$1[REDACTED]");
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
