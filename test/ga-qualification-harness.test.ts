import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const recorder = join(repoRoot, "scripts", "ga-qualification-recorder.mjs");

function readJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function readJsonLines(path: string) {
  return readFileSync(join(repoRoot, path), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function runRecorder(args: string[]) {
  return spawnSync(process.execPath, [recorder, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
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

  test("records redacted first attempts and refuses retries after a started event", () => {
    const root = mkdtempSync(join(tmpdir(), "apexcn-ga-recorder-"));
    const evidenceDir = join(root, "evidence");
    const candidate = join(root, "apexcn");
    writeFileSync(candidate, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.0.10\\n");
} else {
  process.stdout.write(JSON.stringify({ ok: true, authorization: "Bearer fake-secret" }) + "\\n");
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
      expect(persisted).toContain("[REDACTED]");
      expect(persisted).not.toContain("fake-secret");

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
});
