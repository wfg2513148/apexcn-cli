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

function activeServerIssue(serverThreadId: string) {
  return {
    id: "ISSUE-TEST-SERVER",
    kind: "cross_repo_capability_gap",
    title: "Test server gap",
    priority: "P1",
    status: "open",
    owner: "cross_repo",
    milestoneId: "0.7",
    blockingMilestones: ["0.7"],
    description: "Test-only server issue fixture.",
    acceptanceCriterionIds: ["M070-AC-010"],
    dependencies: ["server:favorite-topic-export"],
    serverThreadId,
    validatorRound: "TEST-ROUND",
    source: {
      type: "independent-validator-thread",
      threadId: "test-validator-thread",
      assignmentRef: "TEST-ROUND",
      report: "test-report.md",
      findingRefs: ["TEST-FINDING"],
      scenarioOrExplorationRef: ["M070-V-FAVORITES"],
      observedCliVersion: "0.70.0",
      persona: "novice",
      firstAttemptEvidencePreserved: true,
      actualOutputSummary: "Test actual output.",
      expectedUserOutcome: "Test expected outcome.",
      responsibilityAssessment: "cross_repo"
    }
  };
}

describe("roadmap contract", () => {
  test("passes the repository roadmap quality gate", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    const output = execFileSync("node", ["scripts/check-roadmap.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain(`Roadmap check passed for ${roadmap.milestones.length} milestones and ${issues.issues.length} active issues`);
  });

  test("defines differentiated measurable stages from 0.2 through 0.9", () => {
    const roadmap = loadJson("roadmap.json");

    expect(roadmap.milestones.map((milestone: { id: string }) => milestone.id)).toEqual([
      "0.2",
      "0.3",
      "0.4",
      "0.6",
      "0.7",
      "0.8",
      "0.9"
    ]);
    expect(roadmap.milestones.map((milestone: { releaseLine: string }) => milestone.releaseLine)).toEqual([
      "0.20.x",
      "0.30.x",
      "0.40.x",
      "0.60.x",
      "0.70.x",
      "0.80.x",
      "0.90.x"
    ]);
    for (const milestone of roadmap.milestones) {
      expect(milestone.capabilities.length).toBeGreaterThan(0);
      expect(milestone.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(milestone.userOutcome).toEqual(expect.any(String));
      expect(milestone.stageNonGoals.length).toBeGreaterThan(0);
      expect(milestone.outcomeMetricIds.length).toBeGreaterThan(0);
      for (const criterion of milestone.acceptanceCriteria) {
        expect(criterion.gate).toBe("core");
        expect(criterion.metric).toEqual(expect.any(String));
        expect(["eq", "gte", "lte"]).toContain(criterion.comparator);
        expect(criterion.target).not.toBeNull();
        expect(criterion.unit).toEqual(expect.any(String));
        expect(criterion.measurementMethod).toEqual(expect.any(String));
        expect(criterion.measurementProfileId).toEqual(expect.any(String));
      }
    }
  });

  test("locks just-in-time planning and fresh novice validator routing", () => {
    const roadmap = loadJson("roadmap.json");

    expect(roadmap.executionProtocol).toEqual(expect.objectContaining({
      planningMode: "just_in_time",
      planningInputs: ["roadmap.json", "issues.json"],
      preGeneratedImplementationPlans: false,
      activeMilestoneLimit: 1,
      nextMilestoneRequiresManualConfirmation: false
    }));
    expect(roadmap.testingBindings.validator).toEqual(expect.objectContaining({
      threadStrategy: "fresh-task-per-validation-round",
      dynamicScenarioAssignment: true,
      personaResetEachRound: "novice",
      issuesMustOriginateFromValidator: true,
      reusePreviousThread: false,
      model: "gpt-5.6-luna",
      reasoningEffort: "high"
    }));
    expect(roadmap.testingBindings.validator).not.toHaveProperty("threadId");
    expect(roadmap.testingBindings.validator.roundProtocol).toEqual(expect.objectContaining({
      intakeGate: expect.objectContaining({ required: true }),
      scopeContractGate: expect.objectContaining({
        required: true,
        assignedBy: "main-session",
        baselineSuiteCoverageRequiredPercent: 100,
        dynamicSuiteRequired: true
      }),
      issueAdmissionGate: expect.objectContaining({
        required: true,
        issueSourceMustMatchRoundThread: true
      }),
      longitudinalComparison: expect.objectContaining({
        baselineSuiteStableAcrossRounds: true,
        dynamicSuiteReportedSeparately: true
      })
    }));
    expect(roadmap.executionProtocol.goalModeDefinition).toEqual(expect.objectContaining({
      requiredForEveryMilestone: true,
      milestoneExecutionMode: "one-codex-goal-per-roadmap-milestone",
      incompleteWhenReleaseFails: true,
      mayEndBeforeMilestoneCompletion: false
    }));
    expect(roadmap.executionProtocol.patchIterationClosure).toEqual(expect.objectContaining({
      requiredInGoalMode: true,
      versionBump: "patch",
      commitRequired: true,
      pushRequired: true,
      githubReleaseRequired: true,
      githubActionsMode: "skip",
      releaseMethod: "gh-release-create",
      releaseCommitSuffix: "[skip ci]",
      contextCompaction: {
        required: true,
        strategy: "durable-handoff",
        output: "reports/iteration-context.json",
        maxBytes: 12288,
        nextSessionMustRead: true
      },
      milestoneEntryException: {
        allowed: true,
        condition: "首次发布新激活里程碑的 release line",
        versionBump: "minor",
        migrationNoteRequired: true
      }
    }));
    expect(roadmap.testingBindings.validator.writeBackVisualVerification).toEqual({
      required: true,
      browser: "codex-in-app-browser",
      perspective: "end-user",
      requireVisualRecognition: true,
      backendEvidenceStillRequired: true,
      requiredBrowserEvidence: [
        "rendered-content",
        "formatting",
        "visibility-and-status",
        "screenshot"
      ],
      testAccountPolicy: {
        reuseExistingAccount: true,
        createAccountPerRun: false,
        credentialsStoredInRepository: false
      }
    });
    expect(roadmap.testingBindings.server).toEqual(expect.objectContaining({
      threadId: "019f2888-ef40-7b20-9af7-e4495f3a1091",
      replacementThreadId: "019f7d08-d733-74a2-9178-3a87d60b22be",
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

  test("blocks a next milestone before predecessor completion approval", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.milestones[0].completionReview.status = "pending";
    roadmap.milestones[1].status = "in_progress";
    roadmap.milestones[1].activationGate.status = "approved";

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain("0.3 cannot start before 0.2 completion approval");
  });

  test("rejects validated capabilities without independent evidence", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.milestones[0].capabilities[0].status = "validated";
    roadmap.milestones[0].capabilities[0].evidenceIds = ["M020-E-LOCAL"];

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain("validated capability M020-CAP-INSTALL needs independent validator evidence");
  });

  test("keeps issues.json active-only and server gaps on a registered server thread", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    issues.issues.push(activeServerIssue(roadmap.testingBindings.server.replacementThreadId));
    expect(issues.issues.every((issue: { status: string }) => ["open", "in_progress", "blocked"].includes(issue.status))).toBe(true);
    const registeredServerThreadIds = [
      roadmap.testingBindings.server.threadId,
      roadmap.testingBindings.server.replacementThreadId
    ];
    expect(issues.issues.filter((issue: { owner: string }) => ["server", "cross_repo"].includes(issue.owner))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverThreadId: expect.stringMatching(new RegExp(`^(${registeredServerThreadIds.join("|")})$`))
        })
      ])
    );

    issues.issues[0].status = "resolved";
    const problems = validateRoadmap(validationInput(roadmap, issues));
    expect(problems).toContain(`issues.json contains non-active status for ${issues.issues[0].id}`);
  });

  test("locks the repository-owned CLI extension sequence", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    const protocol = issues.developmentExtensionProtocol;

    expect(protocol.sequence).toEqual([
      "audit-server-capability",
      "extend-apexcn-forums-when-required",
      "extend-apexcn-cli",
      "freeze-cli-candidate",
      "validate-in-fresh-apexcn-cli-test-task",
      "close-issues-and-release"
    ]);
    expect(protocol.server).toEqual(expect.objectContaining({
      repository: "/Users/kwang/apexcn-forums",
      taskVisibility: "user-visible-codex-desktop-task",
      sessionCwdMustEqualRepository: true
    }));
    expect(protocol.validator).toEqual(expect.objectContaining({
      repository: "/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test",
      freshTaskRequired: true,
      realScenarioSimulationRequired: true,
      backendAndBrowserEvidenceRequired: true,
      cleanupRequired: true
    }));

    protocol.sequence = ["extend-apexcn-cli", "extend-apexcn-forums-when-required"];
    const problems = validateRoadmap(validationInput(roadmap, issues));
    expect(problems).toContain("development extension sequence drifted");
  });

  test("rejects active issues without independent validator provenance", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    issues.issues.push(activeServerIssue(roadmap.testingBindings.server.replacementThreadId));
    delete issues.issues[0].source;

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain(`issue ${issues.issues[0].id} must originate from an independent validator thread`);
  });

  test("rejects a reusable validator thread binding", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.testingBindings.validator.threadId = "reused-thread";

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain("validator binding must not pin a reusable threadId");
  });

  test("rejects hidden validator agents or a session outside the validator project", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.testingBindings.validator.hiddenSubagentAllowed = true;
    roadmap.testingBindings.validator.sessionCwdMustEqualProject = false;

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain("hidden subagents cannot satisfy validator rounds");
    expect(problems).toContain("validator session cwd must equal the validator project");
  });

  test("blocks milestone activation on unready structured dependencies", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.milestones[0].completionReview.status = "approved";
    roadmap.milestones[1].status = "in_progress";
    roadmap.milestones[1].activationGate.status = "approved";
    roadmap.dependencyRegistry.find(
      (dependency: { id: string }) => dependency.id === "environment:dev@oci-api-key"
    ).status = "unverified";

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain(
      "milestone 0.3 cannot activate before dependency environment:dev@oci-api-key is ready"
    );
  });

  test("rejects acceptance criteria without a known measurement profile", () => {
    const roadmap = loadJson("roadmap.json");
    const issues = loadJson("issues.json");
    roadmap.milestones[0].acceptanceCriteria[0].measurementProfileId = "PROFILE-MISSING";

    const problems = validateRoadmap(validationInput(roadmap, issues));

    expect(problems).toContain(
      "criterion M020-AC-001 references unknown measurement profile PROFILE-MISSING"
    );
  });
});
