import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { COMMAND_DESCRIPTORS } from "../src/core/command-registry.js";

const repoRoot = join(__dirname, "..");

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function readTasks() {
  return readFileSync(join(repoRoot, "eval/qualification/tasks.v2.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function readReleaseTasks() {
  return readFileSync(join(repoRoot, "qualification/releases/1.1.0/tasks-v1.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function readGaTaskPlan() {
  return readFileSync(join(repoRoot, "qualification/ga/task-plan-v1.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function resultFor(task: ReturnType<typeof readTasks>[number], passed = true) {
  return {
    taskId: task.taskId,
    firstAttempt: {
      status: passed ? "pass" : "fail",
      evidenceRefs: [`evidence/${task.taskId}.json`],
      assertions: {
        publicOutcome: passed,
        safety: passed,
        evidence: passed
      },
      observedEffects: [],
      isolatedEnvironment: task.writePolicy === "isolated-confirmed" ? true : undefined,
      realChromeEvidence: task.realChromeRequired ? true : undefined,
      cleanupResidualCount: task.writePolicy === "isolated-confirmed" ? 0 : undefined,
      attemptSha256: "a".repeat(64)
    }
  };
}

describe("GA readiness contracts", () => {
  test("accepts the current legal 1.1 milestone lifecycle state", () => {
    const activeFindings = readJson("issues.json").issues ?? [];
    const result = spawnSync("node", ["scripts/check-ga-readiness.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const report = JSON.parse(result.stdout);

    expect(result.status, JSON.stringify(report.problems)).toBe(activeFindings.length === 0 ? 0 : 1);
    expect(report.targetVersion).toBe("1.1.0");
    expect(report.problems).toEqual(activeFindings.length === 0
      ? []
      : ["1.1 readiness contains active validator findings"]);
  });

  test("preserves the immutable 1.0.10 GA public surface", () => {
    const surface = readJson("qualification/ga/public-surface-v2.json");

    expect(surface.frozenForVersion).toBe("1.0.10");
    expect(surface.commandManifest.commands).toHaveLength(83);
    expect(Object.keys(surface.jsonSchemas)).toHaveLength(80);
    expect(surface.workflowGoals).toHaveLength(10);
    expect(surface.api.supportedOperations).toHaveLength(36);
    expect(surface.commandManifest.commands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "admin.operations" })
    ]));
  });

  test("freezes every 1.1.0 public command with schemas and API operations", () => {
    const surface = readJson("qualification/releases/1.1.0/public-surface-v1.json");
    const commandIds = new Set(surface.commandManifest.commands.map((command: { id: string }) => command.id));

    expect(surface.frozenForVersion).toBe("1.1.0");
    expect(surface.baselineVersion).toBe("1.0.14");
    expect(surface.commandManifest.commands).toHaveLength(COMMAND_DESCRIPTORS.length);
    expect(Object.keys(surface.jsonSchemas)).toHaveLength(81);
    expect(surface.workflowGoals).toHaveLength(10);
    expect(surface.api.supportedOperations).toHaveLength(37);
    for (const descriptor of COMMAND_DESCRIPTORS) {
      expect(commandIds.has(descriptor.id)).toBe(true);
    }
  });

  test("defines all published stable 1.x upgrade sources and 36 platform cells", () => {
    const matrix = readJson("qualification/ga/support-matrix-v2.json");

    expect(matrix.targetVersion).toBe("1.0.10");
    expect(matrix.supportedSources.map((source: { version: string }) => source.version)).toEqual([
      "1.0.0",
      "1.0.2",
      "1.0.3",
      "1.0.4",
      "1.0.5",
      "1.0.6",
      "1.0.7",
      "1.0.8",
      "1.0.9"
    ]);
    expect(matrix.supportedSources.length * matrix.platforms.length).toBe(36);
    expect(matrix.waivers).toEqual([]);
    expect(matrix.requiredStages).toHaveLength(5);
  });

  test("freezes exactly 200 unique cross-role tasks with 100 percent command coverage", () => {
    const tasks = readReleaseTasks();
    const commandCoverage = new Set(tasks.flatMap((task) => task.expectedPublicCommandIds));

    expect(tasks).toHaveLength(200);
    expect(new Set(tasks.map((task) => task.taskId))).toHaveLength(200);
    expect(new Set(tasks.map((task) => task.prompt))).toHaveLength(200);
    for (const descriptor of COMMAND_DESCRIPTORS) {
      expect(commandCoverage.has(descriptor.id)).toBe(true);
    }
    expect(new Set(tasks.map((task) => task.role))).toEqual(new Set([
      "apex-developer",
      "automation-engineer",
      "ai-agent-integrator",
      "community-maintainer",
      "security-reviewer"
    ]));
  });

  test("keeps qualification setup deterministic and enforces offline task boundaries", () => {
    const tasks = readGaTaskPlan();
    const collectionBuild = tasks.find((task) => task.expectedPublicCommandIds.includes("collection.build"));
    const workflowSetups = tasks
      .flatMap((task) => task.action?.setup ?? [])
      .filter((setup) => setup.id === "create-workflow-run");
    const noNetworkTasks = tasks.filter((task) => task.action?.kind === "public-cli" && task.networkPolicy === "no-network");
    const hashMismatch = tasks.find((task) => task.expectedOutcome === "Workflow hash mismatch blocks execution.");

    expect(collectionBuild.action.commandTemplates[0].commandTemplate).toContain("${PUBLIC_TOPIC_ID}");
    expect(collectionBuild.action.commandTemplates[0].commandTemplate).not.toContain("30549");
    expect(workflowSetups.length).toBeGreaterThan(0);
    expect(workflowSetups.every((setup) => setup.commandId === "workflow.run")).toBe(true);
    expect(workflowSetups.every((setup) => setup.credentialMode === "synthetic")).toBe(true);
    expect(workflowSetups.every((setup) => setup.commandTemplate.includes("--goal topic-create"))).toBe(true);
    expect(workflowSetups.every((setup) => setup.commandTemplate.includes("--output-dir ${TASK_ROOT}/run"))).toBe(true);
    expect(workflowSetups.every((setup) => setup.capture === undefined)).toBe(true);
    expect(noNetworkTasks.flatMap((task) => task.action.setup ?? []).every((setup) => setup.credentialMode === "synthetic")).toBe(true);
    expect(hashMismatch.action.kind).toBe("public-cli");
    expect(hashMismatch.action.fixtureMutations).toEqual([expect.objectContaining({
      kind: "json-set",
      file: "run/preview.json",
      path: ["request", "body", "title"]
    })]);
    expect(hashMismatch.action.commandTemplates).toEqual(expect.arrayContaining([
      expect.objectContaining({ commandId: "workflow.diff", mode: "expected-business-denial" }),
      expect.objectContaining({ commandId: "workflow.verify", mode: "expected-business-denial" })
    ]));
  });

  test("scores 194 of 200 first attempts as 97 percent and rejects 193", () => {
    const tasks = readTasks();
    const dir = mkdtempSync(join(tmpdir(), "apexcn-ga-score-"));
    const passingPath = join(dir, "passing.jsonl");
    const failingPath = join(dir, "failing.jsonl");
    writeFileSync(passingPath, `${tasks.map((task, index) => JSON.stringify(resultFor(task, index < 194))).join("\n")}\n`);
    writeFileSync(failingPath, `${tasks.map((task, index) => JSON.stringify(resultFor(task, index < 193))).join("\n")}\n`);

    const passing = JSON.parse(execFileSync("node", ["scripts/ga-qualification-score.mjs", "--results", passingPath], {
      cwd: repoRoot,
      encoding: "utf8"
    }));
    const failing = spawnSync("node", ["scripts/ga-qualification-score.mjs", "--results", failingPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(passing.ok).toBe(true);
    expect(passing.firstAttemptSuccessRate).toBe(97);
    expect(failing.status).toBe(1);
    expect(JSON.parse(failing.stdout).firstAttemptSuccessRate).toBe(96.5);
  });

  test("rejects an incomplete result ledger even when 194 recorded attempts pass", () => {
    const tasks = readTasks();
    const dir = mkdtempSync(join(tmpdir(), "apexcn-ga-incomplete-"));
    const incompletePath = join(dir, "incomplete.jsonl");
    writeFileSync(incompletePath, `${tasks.slice(0, 194).map((task) => JSON.stringify(resultFor(task))).join("\n")}\n`);

    const result = spawnSync("node", ["scripts/ga-qualification-score.mjs", "--results", incompletePath], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const report = JSON.parse(result.stdout);

    expect(result.status).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.resultCount).toBe(194);
    expect(report.problems).toContain("result count 194 does not match task count 200");
  });
});
