import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

type QualificationTask = {
  taskId: string;
  datasetVersion: string;
  prompt: string;
  expectedPublicCommandIds: string[];
  networkPolicy: string;
  writePolicy: string;
};

function generatedTasksWithV2(): { baseline: QualificationTask[]; extended: QualificationTask[] } {
  const script = `
    import { COMMAND_DESCRIPTORS } from './dist/core/command-registry.js';
    import { buildGaQualificationTasks } from './scripts/generate-ga-qualification-dataset.mjs';
    const existingIndex = COMMAND_DESCRIPTORS.findIndex((command) => command.id === 'admin.operations-v2');
    const existing = existingIndex < 0 ? undefined : COMMAND_DESCRIPTORS.splice(existingIndex, 1)[0];
    const baseline = await buildGaQualificationTasks();
    COMMAND_DESCRIPTORS.push(existing ?? {
      id: 'admin.operations-v2',
      summary: 'Show administrator operations v2 aggregates',
      apiEffect: 'api-read',
      capability: 'read'
    });
    const extended = await buildGaQualificationTasks();
    process.stdout.write(JSON.stringify({ baseline, extended }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8"
  }));
}

function frozenTasks(): QualificationTask[] {
  return readFileSync(join(repoRoot, "qualification/releases/1.2.2/tasks-v1.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("qualification dataset stability", () => {
  test("adding operations v2 preserves every existing scenario identity", () => {
    const frozen = frozenTasks();
    const { baseline, extended } = generatedTasksWithV2();
    expect(baseline).toEqual(frozen);
    expect(frozen).toHaveLength(202);
    expect(extended).toHaveLength(204);

    for (const original of frozen) {
      const current = extended.find((item) => item.taskId === original.taskId);
      expect(current, original.taskId).toBeDefined();
      if (original.prompt.includes("只有 admin operations 和 update 两个批准新增命令")) {
        expect(current).toEqual({
          ...original,
          datasetVersion: "M130-QUALIFICATION-TASKS-1",
          prompt: expect.stringContaining("admin operations-v2"),
          expectedPublicCommandIds: [...original.expectedPublicCommandIds, "admin.operations-v2"],
          expectedOutcome: "The approved additions preserve every existing command."
        });
      } else {
        expect(current, original.taskId).toEqual({ ...original, datasetVersion: "M130-QUALIFICATION-TASKS-1" });
      }
    }
  });

  test("appends two v2 read scenarios and updates the approved-additions comparison", () => {
    const { extended } = generatedTasksWithV2();
    const appended = extended.slice(202);
    expect(appended.map((item) => item.taskId)).toEqual(["M110-Q-203", "M110-Q-204"]);
    for (const item of appended) {
      expect(item.datasetVersion).toBe("M130-QUALIFICATION-TASKS-1");
      expect(item.expectedPublicCommandIds).toEqual(["admin.operations-v2"]);
      expect(item.networkPolicy).toBe("approved-readonly-api");
      expect(item.writePolicy).toBe("forbidden");
    }

    const comparison = extended.find((item) => item.expectedPublicCommandIds.includes("commands")
      && item.expectedPublicCommandIds.includes("admin.operations")
      && item.expectedPublicCommandIds.includes("update"));
    expect(comparison?.prompt).not.toContain("两个批准新增命令");
    expect(comparison?.prompt).toContain("批准的新增命令恰为");
    expect(comparison?.prompt).toContain("admin operations-v2");
  });
});
