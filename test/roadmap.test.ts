import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { renderIssues, renderRoadmap, validateRoadmap } from "../scripts/check-roadmap.mjs";

const repoRoot = join(__dirname, "..");

function loadJson(relativePath: string) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

function validationInput(roadmap = loadJson("roadmap.json"), issues = loadJson("issues.json")) {
  return {
    roadmap,
    issues,
    roadmapMarkdown: renderRoadmap(roadmap, issues),
    issuesMarkdown: renderIssues(issues),
    agentsText: readFileSync(join(repoRoot, "AGENTS.md"), "utf8")
  };
}

describe("roadmap contract", () => {
  test("passes the repository roadmap quality gate", () => {
    const output = execFileSync("node", ["scripts/check-roadmap.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain("Roadmap check passed for 8 milestones and 12 active issues");
  });

  test("defines differentiated measurable stages from 0.2 through 0.9", () => {
    const roadmap = loadJson("roadmap.json");

    expect(roadmap.milestones.map((milestone: { id: string }) => milestone.id)).toEqual([
      "0.2",
      "0.3",
      "0.4",
      "0.5",
      "0.6",
      "0.7",
      "0.8",
      "0.9"
    ]);
    expect(roadmap.milestones.map((milestone: { releaseLine: string }) => milestone.releaseLine)).toEqual([
      "0.20.x",
      "0.30.x",
      "0.40.x",
      "0.50.x",
      "0.60.x",
      "0.70.x",
      "0.80.x",
      "0.90.x"
    ]);
    for (const milestone of roadmap.milestones) {
      expect(milestone.capabilities.length).toBeGreaterThan(0);
      expect(milestone.acceptanceCriteria.length).toBeGreaterThan(0);
      for (const criterion of milestone.acceptanceCriteria) {
        expect(criterion.gate).toBe("core");
        expect(criterion.metric).toEqual(expect.any(String));
        expect(["eq", "gte", "lte"]).toContain(criterion.comparator);
        expect(criterion.target).not.toBeNull();
        expect(criterion.unit).toEqual(expect.any(String));
        expect(criterion.measurementMethod).toEqual(expect.any(String));
      }
    }
  });

  test("locks just-in-time planning and fixed model routing", () => {
    const roadmap = loadJson("roadmap.json");

    expect(roadmap.executionProtocol).toEqual(expect.objectContaining({
      planningMode: "just_in_time",
      planningInputs: ["roadmap.json", "issues.json"],
      preGeneratedImplementationPlans: false,
      activeMilestoneLimit: 1,
      nextMilestoneRequiresManualConfirmation: true
    }));
    expect(roadmap.testingBindings.validator).toEqual(expect.objectContaining({
      threadId: "019f6ed4-f811-7fd0-8111-241bb262c3ba",
      model: "gpt-5.6-luna",
      reasoningEffort: "high"
    }));
    expect(roadmap.testingBindings.server).toEqual(expect.objectContaining({
      threadId: "019f2888-ef40-7b20-9af7-e4495f3a1091",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      apiKeyEnvironment: "dev@oci"
    }));
    expect(roadmap.testingBindings.server.apiKeyPolicy).toEqual(expect.objectContaining({
      minimumPrivilege: true,
      productionUseAllowed: false,
      persistInRepository: false,
      includeInEvidence: false
    }));
  });

  test("blocks a next milestone before manual approval", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.milestones[1].status = "in_progress";
    roadmap.milestones[1].activationGate.status = "approved";

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain("0.3 cannot start before 0.2 manual approval");
  });

  test("rejects validated capabilities without independent evidence", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.milestones[0].capabilities[0].status = "validated";

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain("validated capability M020-CAP-INSTALL needs independent validator evidence");
  });

  test("keeps issues.json active-only and server gaps on the fixed server thread", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    expect(issues.issues.every((issue: { status: string }) => ["open", "in_progress", "blocked"].includes(issue.status))).toBe(true);
    expect(issues.issues.filter((issue: { owner: string }) => ["server", "cross_repo"].includes(issue.owner))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverThreadId: roadmap.testingBindings.server.threadId
        })
      ])
    );

    issues.issues[0].status = "resolved";
    const problems = validateRoadmap(validationInput(roadmap, issues));
    expect(problems).toContain(`issues.json contains non-active status for ${issues.issues[0].id}`);
  });
});
