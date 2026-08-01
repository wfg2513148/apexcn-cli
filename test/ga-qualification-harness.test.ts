import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const recorder = join(repoRoot, "scripts", "ga-qualification-recorder.mjs");
const sandboxRecorderTest = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? test : test.skip;

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function readJsonLines(path: string) {
  return readFileSync(join(repoRoot, path), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function runRecorder(args: string[], nodeArgs: string[] = []) {
  return spawnSync(process.execPath, [...nodeArgs, recorder, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function runWorkflowHashSetup(evidenceDir: string, taskId: string, taskRoot: string) {
  const fixtures = [
    {
      id: "create-workflow-run",
      args: [
        "workflow", "run", "--goal", "topic-create", "--category-id", "4", "--title", "资格标题",
        "--content-file", join(taskRoot, "post.md"), "--output-dir", join(taskRoot, "run"), "--json"
      ]
    },
    {
      id: "approve-workflow-run",
      args: ["workflow", "approve", "--run-dir", join(taskRoot, "run"), "--approved-by", "qualification-reviewer", "--json"]
    }
  ];
  for (const fixture of fixtures) {
    const result = runRecorder([
      "fixture", "--evidence-dir", evidenceDir, "--task-id", taskId, "--fixture-id", fixture.id, "--", ...fixture.args
    ]);
    expect(result.status, result.stderr).toBe(0);
  }
}

function workflowRecorderCandidateSource(validDenials: boolean, probeNetwork: boolean) {
  return `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const args = process.argv.slice(2);
const validDenials = ${JSON.stringify(validDenials)};
const probeNetwork = ${JSON.stringify(probeNetwork)};
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}
function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function previewHash(target, request) {
  return sha256(canonicalJson({ target, request }));
}
function print(value, exitCode) {
  process.stdout.write(JSON.stringify(value) + "\\n");
  process.exitCode = exitCode;
}
function workflowCommand() {
  const index = args.indexOf("workflow");
  return index >= 0 ? args[index + 1] : undefined;
}
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function targetFrom(value) {
  return {
    profile: value.profile,
    baseUrl: value.baseUrl,
    configScope: value.configScope,
    credentialFingerprint: value.credentialFingerprint
  };
}
function prepare(command) {
  if (command === "run") {
    const runDir = option("--output-dir");
    const target = {
      profile: "qualifier-synthetic",
      baseUrl: "https://qualification.invalid/ords/api",
      configScope: "a".repeat(64),
      credentialFingerprint: "b".repeat(64)
    };
    const request = {
      method: "POST",
      path: "/api/v1/topics",
      body: { categoryId: 4, title: "资格标题", content: "Qualification body", tags: [] }
    };
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
      kind: "workflow-run",
      schemaVersion: 1,
      runId: "run-qualification",
      goal: "topic-create",
      status: "preview-ready"
    }) + "\\n");
    fs.writeFileSync(path.join(runDir, "preview.json"), JSON.stringify({
      kind: "workflow-preview",
      schemaVersion: 1,
      ...target,
      request,
      result: null
    }) + "\\n");
  }
  if (command === "approve") {
    const runDir = option("--run-dir");
    const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
    const preview = JSON.parse(fs.readFileSync(path.join(runDir, "preview.json"), "utf8"));
    const target = targetFrom(preview);
    fs.writeFileSync(path.join(runDir, "approval.json"), JSON.stringify({
      kind: "workflow-approval",
      schemaVersion: 1,
      runId: run.runId,
      approvedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      approvedBy: "qualification-reviewer",
      previewHash: previewHash(target, preview.request),
      target,
      request: preview.request
    }) + "\\n");
  }
}
function denialResponse(command) {
  if (command !== "diff" && command !== "verify") {
    return { value: { kind: "fixture", schemaVersion: 1, ok: true, networkDenied: true }, exitCode: 0 };
  }
  if (!validDenials) {
    return command === "diff"
      ? {
        value: {
          kind: "workflow-diff",
          schemaVersion: 1,
          ok: false,
          previewHash: "x",
          approvalHash: "y",
          hashMatches: false,
          executionAllowed: false,
          differences: [{ path: "unrelated.field" }]
        },
        exitCode: 1
      }
      : {
        value: {
          kind: "workflow-verification",
          schemaVersion: 1,
          ok: false,
          issues: [{ code: "approval-hash-mismatch" }]
        },
        exitCode: 1
      };
  }
  const runDir = option("--run-dir");
  const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  const preview = JSON.parse(fs.readFileSync(path.join(runDir, "preview.json"), "utf8"));
  const approval = JSON.parse(fs.readFileSync(path.join(runDir, "approval.json"), "utf8"));
  const currentTarget = targetFrom(preview);
  const currentHash = previewHash(currentTarget, preview.request);
  const differences = [{
    path: "body",
    leftHash: sha256(canonicalJson(preview.request.body)),
    rightHash: sha256(canonicalJson(approval.request.body))
  }];
  if (command === "diff") {
    return {
      value: {
        kind: "workflow-diff",
        schemaVersion: 1,
        runId: run.runId,
        runDir,
        ok: false,
        previewRequest: preview.request,
        approvalRequest: approval.request,
        previewHash: currentHash,
        approvalHash: approval.previewHash,
        approvedRequestHash: approval.previewHash,
        approvalBoundRequestHash: approval.previewHash,
        currentRequestHash: currentHash,
        hashMatches: false,
        executionAllowed: false,
        changes: differences,
        differences
      },
      exitCode: 1
    };
  }
  const report = {
    kind: "workflow-verification",
    schemaVersion: 1,
    runId: run.runId,
    status: run.status,
    ok: false,
    issues: [{ code: "approval-hash-mismatch", message: "Approval hash does not match current preview request." }],
    warnings: [{ code: "execute-missing", message: "Workflow has not executed yet." }],
    artifacts: {},
    previewHash: currentHash,
    approval: {
      runId: approval.runId,
      previewHash: approval.previewHash,
      target: approval.target,
      request: approval.request
    },
    reportPath: path.join(runDir, "verification.json")
  };
  fs.writeFileSync(path.join(runDir, "verification.json"), JSON.stringify(report) + "\\n");
  return { value: report, exitCode: 1 };
}
function execute(command) {
  prepare(command);
  if (!probeNetwork) {
    const response = denialResponse(command);
    print(response.value, response.exitCode);
    return;
  }
  const server = net.createServer();
  let finished = false;
  const complete = (value, exitCode) => {
    if (finished) return;
    finished = true;
    print(value, exitCode);
  };
  server.once("error", () => {
    const response = denialResponse(command);
    complete(response.value, response.exitCode);
  });
  try {
    server.listen(0, "127.0.0.1", () => {
      server.close(() => complete({ kind: "unexpected-network-access", schemaVersion: 1, ok: false }, 2));
    });
  } catch {
    server.emit("error");
  }
}
if (args.includes("--version")) process.stdout.write("1.0.10\\n");
else execute(workflowCommand());
`;
}

describe("public GA qualification harness", () => {
  test("freezes an exact 200-task plan, six phases, and 36 unwaived lifecycle cells", () => {
    const manifest = readJson("qualification/ga/harness-manifest-v1.json");
    const plan = readJsonLines("qualification/ga/task-plan-v1.jsonl");

    expect(plan).toHaveLength(200);
    expect(new Set(plan.map((task) => task.taskId))).toHaveLength(200);
    expect(plan[0].taskId).toBe("M090-Q-001");
    expect(plan[199].taskId).toBe("M090-Q-200");
    expect(manifest.phases.map((phase: { id: string }) => phase.id)).toEqual([
      "P00-bind",
      "P10-public-cli",
      "P20-adverse-and-lifecycle",
      "P30-dev-api-chrome",
      "P40-security-boundaries",
      "P50-cleanup-score"
    ]);
    expect(manifest.lifecyclePlan.cells).toHaveLength(36);
    expect(manifest.lifecyclePlan.applicableMacOsLinuxCells).toBe(18);
    expect(manifest.lifecyclePlan.windowsCellsRequired).toBe(18);
    expect(manifest.lifecyclePlan.waivers).toEqual([]);
    expect(plan[197].expectedOutcome).toBe("Absolute archive paths are rejected before extraction.");
    expect(plan[198].expectedOutcome).toBe("Parent-directory archive paths are rejected before extraction.");
    expect(plan[199].expectedOutcome).toBe("Isolated write cleanup leaves zero residual resources.");
  });

  test("detects generated harness drift", () => {
    const result = spawnSync(process.execPath, ["scripts/generate-ga-qualification-harness.mjs", "--check"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      taskCount: 200,
      lifecycleCells: 36
    });
  });

  sandboxRecorderTest("records redacted first attempts and refuses retries after a started event", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-recorder-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    writeFileSync(candidate, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.0.10\\n");
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    authorization: "Bearer fake-secret",
    "api-key": "fake-api-key",
    access_token: "fake-access-token",
    body: { question: "private-body" }
  }) + "\\n");
}
`);
    chmodSync(candidate, 0o755);
    const plan = readJsonLines("qualification/ga/task-plan-v1.jsonl");
    const commandsTask = plan.find((task) => task.expectedPublicCommandIds.length === 1
      && task.expectedPublicCommandIds[0] === "commands");
    const externalTask = plan.find((task) => task.action.kind === "isolated-lifecycle-scenario");

    try {
      const initialized = runRecorder([
        "init",
        "--evidence-dir", evidenceDir,
        "--candidate", candidate
      ]);
      expect(initialized.status, initialized.stderr).toBe(0);
      expect(JSON.parse(initialized.stdout)).toMatchObject({
        ok: true,
        targetVersion: "1.0.10",
        secretValuesExposed: false
      });

      const attempted = runRecorder([
        "run",
        "--evidence-dir", evidenceDir,
        "--task-id", commandsTask.taskId,
        "--",
        "commands",
        "--json"
      ]);
      expect(attempted.status, attempted.stderr).toBe(0);
      expect(JSON.parse(attempted.stdout)).toMatchObject({
        taskId: commandsTask.taskId,
        exitCode: 0,
        outputRedacted: true
      });
      const persisted = readFileSync(join(evidenceDir, "output", `${commandsTask.taskId}.stdout.txt`), "utf8");
      expect(() => JSON.parse(persisted)).not.toThrow();
      expect(persisted).toContain("[REDACTED]");
      expect(persisted).not.toContain("fake-secret");
      expect(persisted).not.toContain("fake-api-key");
      expect(persisted).not.toContain("fake-access-token");
      expect(persisted).not.toContain("private-body");

      const assessed = runRecorder([
        "assess",
        "--evidence-dir", evidenceDir,
        "--task-id", commandsTask.taskId,
        "--status", "pass",
        "--public-outcome", "true",
        "--safety", "true",
        "--evidence", "true"
      ]);
      expect(assessed.status, assessed.stderr).toBe(0);

      const started = runRecorder([
        "begin",
        "--evidence-dir", evidenceDir,
        "--task-id", externalTask.taskId,
        "--action", "isolated lifecycle canary"
      ]);
      expect(started.status, started.stderr).toBe(0);
      const retry = runRecorder([
        "begin",
        "--evidence-dir", evidenceDir,
        "--task-id", externalTask.taskId,
        "--action", "retry must fail"
      ]);
      expect(retry.status).not.toBe(0);
      expect(retry.stderr).toContain("already started; retry is forbidden");

      const recorderStatus = runRecorder(["status", "--evidence-dir", evidenceDir]);
      expect(recorderStatus.status, recorderStatus.stderr).toBe(0);
      expect(JSON.parse(recorderStatus.stdout)).toMatchObject({
        ok: false,
        denominator: 200,
        started: 2,
        completed: 1,
        assessed: 1,
        startedWithoutCompletedEvidence: [externalTask.taskId]
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  sandboxRecorderTest("enforces frozen fixture order and isolated path bindings before a task starts", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-fixtures-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    const devConfig = join(root, "dev-config.json");
    writeFileSync(candidate, `#!/usr/bin/env node
if (process.argv.includes("--version")) process.stdout.write("1.0.10\\n");
else process.stdout.write(JSON.stringify({ ok: true }) + "\\n");
`);
    chmodSync(candidate, 0o755);
    writeFileSync(devConfig, "{\"profiles\":{}}\n");
    chmodSync(devConfig, 0o600);
    const plan = readJsonLines("qualification/ga/task-plan-v1.jsonl");
    const automationTask = plan.find((task) => task.expectedPublicCommandIds[0] === "collection.automation.run");
    const schemaTask = plan.find((task) => task.expectedPublicCommandIds[0] === "schema.bundle");
    const taskRoot = join(root, "tasks", automationTask.taskId);

    try {
      expect(runRecorder([
        "init",
        "--evidence-dir", evidenceDir,
        "--candidate", candidate,
        "--dev-config", devConfig
      ]).status).toBe(0);

      const outOfOrder = runRecorder([
        "fixture",
        "--evidence-dir", evidenceDir,
        "--task-id", automationTask.taskId,
        "--fixture-id", "build-automation-plan",
        "--",
        "collection", "automation", "plan",
        "--dir", join(taskRoot, "collection"),
        "--query", "ORDS auth",
        "--output", join(taskRoot, "plan.json"),
        "--json"
      ]);
      expect(outOfOrder.status).not.toBe(0);
      expect(outOfOrder.stderr).toContain("requires import-collection-fixture");

      const substitutedFixture = runRecorder([
        "fixture",
        "--evidence-dir", evidenceDir,
        "--task-id", automationTask.taskId,
        "--fixture-id", "import-collection-fixture",
        "--",
        "collection", "import",
        "--bundle=/etc/hosts",
        "--output-dir", join(taskRoot, "collection"),
        "--json"
      ]);
      expect(substitutedFixture.status).not.toBe(0);
      expect(substitutedFixture.stderr).toContain("does not match its frozen command template");

      const built = runRecorder([
        "fixture",
        "--evidence-dir", evidenceDir,
        "--task-id", automationTask.taskId,
        "--fixture-id", "import-collection-fixture",
        "--",
        "collection", "import",
        "--bundle", join(taskRoot, "bundle.json"),
        "--output-dir", join(taskRoot, "collection"),
        "--json"
      ]);
      expect(built.status, built.stderr).toBe(0);
      const planned = runRecorder([
        "fixture",
        "--evidence-dir", evidenceDir,
        "--task-id", automationTask.taskId,
        "--fixture-id", "build-automation-plan",
        "--",
        "collection", "automation", "plan",
        "--dir", join(taskRoot, "collection"),
        "--query", "ORDS auth",
        "--output", join(taskRoot, "plan.json"),
        "--json"
      ]);
      expect(planned.status, planned.stderr).toBe(0);
      const attempted = runRecorder([
        "run",
        "--evidence-dir", evidenceDir,
        "--task-id", automationTask.taskId,
        "--",
        "collection", "automation", "run",
        "--plan", join(taskRoot, "plan.json"),
        "--output", join(taskRoot, "result.json"),
        "--json"
      ]);
      expect(attempted.status, attempted.stderr).toBe(0);
      expect(existsSync(join(root, ".qualification-runtime", "task-configs", `${automationTask.taskId}.json`))).toBe(true);

      const escaped = runRecorder([
        "run",
        "--evidence-dir", evidenceDir,
        "--task-id", schemaTask.taskId,
        "--",
        "schema", "bundle",
        "--output", "/tmp/apexcn-qualification-escape.json",
        "--json"
      ]);
      expect(escaped.status).not.toBe(0);
      expect(escaped.stderr).toContain("escapes the isolated run root");

      const inlineEscaped = runRecorder([
        "run",
        "--evidence-dir", evidenceDir,
        "--task-id", schemaTask.taskId,
        "--",
        "schema", "bundle",
        "--output=/tmp/apexcn-qualification-inline-escape.json",
        "--json"
      ]);
      expect(inlineEscaped.status).not.toBe(0);
      expect(inlineEscaped.stderr).toContain("escapes the isolated run root");

      const relativeEscaped = runRecorder([
        "run",
        "--evidence-dir", evidenceDir,
        "--task-id", schemaTask.taskId,
        "--",
        "schema", "bundle",
        "--output", "../../../apexcn-qualification-relative-escape.json",
        "--json"
      ]);
      expect(relativeEscaped.status).not.toBe(0);
      expect(relativeEscaped.stderr).toContain("escapes the isolated run root");

      const linkedOutside = join(root, "tasks", schemaTask.taskId, "outside-link");
      symlinkSync(tmpdir(), linkedOutside);
      const symlinkEscaped = runRecorder([
        "run",
        "--evidence-dir", evidenceDir,
        "--task-id", schemaTask.taskId,
        "--",
        "schema", "bundle",
        "--output", join(linkedOutside, "apexcn-qualification-symlink-escape.json"),
        "--json"
      ]);
      expect(symlinkEscaped.status).not.toBe(0);
      expect(symlinkEscaped.stderr).toContain("symbolic link");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed before starting a no-network task when the OS isolator is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-no-isolator-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    const preload = join(root, "simulate-non-darwin.cjs");
    writeFileSync(candidate, `#!/usr/bin/env node
if (process.argv.includes("--version")) process.stdout.write("1.0.10\\n");
else process.stdout.write(JSON.stringify({ ok: true }) + "\\n");
`);
    chmodSync(candidate, 0o755);
    writeFileSync(preload, `Object.defineProperty(process, "platform", { value: "linux" });\n`);
    const tasks = readJsonLines("qualification/ga/task-plan-v1.jsonl");
    const task = tasks.find((item) => item.expectedPublicCommandIds.length === 1 && item.expectedPublicCommandIds[0] === "commands");
    const fixtureTask = tasks.find((item) => item.expectedPublicCommandIds[0] === "collection.automation.run");
    const fixtureTaskRoot = join(root, "tasks", fixtureTask.taskId);

    try {
      expect(runRecorder(["init", "--evidence-dir", evidenceDir, "--candidate", candidate]).status).toBe(0);
      const attempted = runRecorder([
        "run", "--evidence-dir", evidenceDir, "--task-id", task.taskId, "--", "commands", "--json"
      ], ["--require", preload]);
      expect(attempted.status).not.toBe(0);
      expect(attempted.stderr).toContain("No-network qualification requires macOS sandbox-exec");
      const fixtureAttempt = runRecorder([
        "fixture", "--evidence-dir", evidenceDir, "--task-id", fixtureTask.taskId,
        "--fixture-id", "import-collection-fixture", "--",
        "collection", "import", "--bundle", join(fixtureTaskRoot, "bundle.json"),
        "--output-dir", join(fixtureTaskRoot, "collection"), "--json"
      ], ["--require", preload]);
      expect(fixtureAttempt.status).not.toBe(0);
      expect(fixtureAttempt.stderr).toContain("No-network qualification requires macOS sandbox-exec");
      expect(JSON.parse(runRecorder(["status", "--evidence-dir", evidenceDir]).stdout)).toMatchObject({
        started: 0,
        completed: 0,
        assessed: 0,
        fixtureAttempts: 0
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  sandboxRecorderTest("applies declared workflow tampering under enforced network isolation and records automatic denial evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-mutation-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    writeFileSync(candidate, workflowRecorderCandidateSource(true, true));
    chmodSync(candidate, 0o755);
    const task = readJsonLines("qualification/ga/task-plan-v1.jsonl")
      .find((item) => item.expectedOutcome === "Workflow hash mismatch blocks execution.");
    const taskRoot = join(root, "tasks", task.taskId);

    try {
      const unsandboxed = spawnSync(candidate, [
        "workflow", "run", "--output-dir", join(root, "unsandboxed", "run")
      ], { encoding: "utf8" });
      expect(unsandboxed.status).toBe(2);
      expect(JSON.parse(unsandboxed.stdout)).toMatchObject({ kind: "unexpected-network-access", ok: false });

      expect(runRecorder(["init", "--evidence-dir", evidenceDir, "--candidate", candidate]).status).toBe(0);
      const substitutedSetup = runRecorder([
        "fixture", "--evidence-dir", evidenceDir, "--task-id", task.taskId,
        "--fixture-id", "create-workflow-run", "--",
        "workflow", "run", "--goal", "topic-create", "--category-id", "4", "--title", "替换标题",
        "--content-file=/etc/hosts", "--output-dir", join(taskRoot, "run"), "--json"
      ]);
      expect(substitutedSetup.status).not.toBe(0);
      expect(substitutedSetup.stderr).toContain("does not match its frozen command template");
      runWorkflowHashSetup(evidenceDir, task.taskId, taskRoot);
      const fixtureRecords = readFileSync(join(evidenceDir, "fixtures.jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(fixtureRecords).toHaveLength(2);
      expect(fixtureRecords.every((record) => record.networkIsolation === "macos-sandbox-exec")).toBe(true);
      for (const fixture of task.action.setup) {
        const output = JSON.parse(readFileSync(
          join(evidenceDir, "fixtures", `${task.taskId}.${fixture.id}.stdout.txt`),
          "utf8"
        ));
        expect(output).toMatchObject({ networkDenied: true });
      }
      const attempted = runRecorder([
        "run", "--evidence-dir", evidenceDir, "--task-id", task.taskId, "--",
        "workflow", "diff", "--run-dir", join(taskRoot, "run"), "--json"
      ]);

      expect(attempted.status, attempted.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(taskRoot, "run", "preview.json"), "utf8")).request.body.title).toBe("Tampered after approval");
      const attempt = JSON.parse(attempted.stdout);
      expect(attempt.exitCode).toBe(1);
      expect(attempt.automaticAssertions).toMatchObject({ required: true, pass: true });
      expect(attempt.commandResults).toHaveLength(2);
      expect(attempt.commandResults.map((result: Record<string, unknown>) => result.commandId)).toEqual([
        "workflow.diff",
        "workflow.verify"
      ]);
      expect(attempt.commandResults.every((result: Record<string, unknown>) => result.exitCode === 1)).toBe(true);
      expect(attempt.commandResults.every((result: Record<string, unknown>) => result.networkIsolation === "macos-sandbox-exec")).toBe(true);
      expect(attempt.commandResults.every((result: { automaticAssertions: { pass: boolean } }) => result.automaticAssertions.pass)).toBe(true);
      expect(attempt.fixtureMutations).toEqual([expect.objectContaining({
        id: "tamper-approved-workflow-preview",
        beforeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        afterSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })]);
      expect(JSON.stringify(attempt.fixtureMutations)).not.toContain("Tampered after approval");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  sandboxRecorderTest("rejects workflow preview changes beyond the single frozen title mutation", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-extra-mutation-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    writeFileSync(candidate, workflowRecorderCandidateSource(true, false));
    chmodSync(candidate, 0o755);
    const task = readJsonLines("qualification/ga/task-plan-v1.jsonl")
      .find((item) => item.expectedOutcome === "Workflow hash mismatch blocks execution.");
    const taskRoot = join(root, "tasks", task.taskId);

    try {
      expect(runRecorder(["init", "--evidence-dir", evidenceDir, "--candidate", candidate]).status).toBe(0);
      runWorkflowHashSetup(evidenceDir, task.taskId, taskRoot);
      const previewPath = join(taskRoot, "run", "preview.json");
      const preview = JSON.parse(readFileSync(previewPath, "utf8"));
      preview.request.body.categoryId = 999;
      writeFileSync(previewPath, `${JSON.stringify(preview, null, 2)}\n`);

      const attempted = runRecorder([
        "run", "--evidence-dir", evidenceDir, "--task-id", task.taskId, "--",
        "workflow", "diff", "--run-dir", join(taskRoot, "run"), "--json"
      ]);
      expect(attempted.status).not.toBe(0);
      expect(attempted.stderr).toContain("changes beyond the frozen title mutation");
      expect(readFileSync(join(evidenceDir, "attempts.jsonl"), "utf8")).toBe("");
      expect(JSON.parse(runRecorder(["status", "--evidence-dir", evidenceDir]).stdout)).toMatchObject({
        started: 0,
        completed: 0,
        assessed: 0
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  sandboxRecorderTest("rejects a manual pass when automatic business-denial assertions fail", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-false-pass-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    writeFileSync(candidate, workflowRecorderCandidateSource(false, false));
    chmodSync(candidate, 0o755);
    const task = readJsonLines("qualification/ga/task-plan-v1.jsonl")
      .find((item) => item.expectedOutcome === "Workflow hash mismatch blocks execution.");
    const taskRoot = join(root, "tasks", task.taskId);

    try {
      expect(runRecorder(["init", "--evidence-dir", evidenceDir, "--candidate", candidate]).status).toBe(0);
      runWorkflowHashSetup(evidenceDir, task.taskId, taskRoot);
      const attempted = runRecorder([
        "run", "--evidence-dir", evidenceDir, "--task-id", task.taskId, "--",
        "workflow", "diff", "--run-dir", join(taskRoot, "run"), "--json"
      ]);
      expect(attempted.status).toBe(1);
      expect(JSON.parse(attempted.stdout).automaticAssertions).toMatchObject({ required: true, pass: false });

      const assessed = runRecorder([
        "assess", "--evidence-dir", evidenceDir, "--task-id", task.taskId,
        "--status", "pass", "--public-outcome", "true", "--safety", "true", "--evidence", "true"
      ]);
      expect(assessed.status).not.toBe(0);
      expect(assessed.stderr).toContain("automatic business-denial assertions did not pass");
      expect(readFileSync(join(evidenceDir, "results.jsonl"), "utf8")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
