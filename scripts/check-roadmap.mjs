#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const roadmapPath = join(repoRoot, "roadmap.json");
const issuesPath = join(repoRoot, "issues.json");
const agentsPath = join(repoRoot, "AGENTS.md");

export function renderRoadmap(roadmap, issues) {
  const lines = [
    "# apexcn-cli Roadmap",
    "",
    "> `roadmap.json` 是机器可读的唯一真相源。本文件由 `npm run roadmap:render` 生成。",
    "",
    "## 产品定位",
    "",
    "`apexcn-cli` 是 APEX 中文社区的本地 AI Agent 操作层、社区知识 CLI 和可审计内容工作流引擎。CLI 是主产品，MCP 是本地 stdio 薄适配层，真实写操作由 CLI workflow approval 管控。",
    "",
    `主要用户：${roadmap.productStrategy.primaryPersona}。`,
    "",
    "核心任务：",
    ...roadmap.productStrategy.topJobs.map((job) => `- \`${job.id}\`: ${job.description}`),
    "",
    "## 执行规则",
    "",
    "- 每个主会话开始时必须读取 `roadmap.json` 与 `issues.json`。",
    "- 只为当前里程碑生成即时执行计划，不预制后续里程碑实施计划。",
    "- 每个里程碑必须启动一个独立 Codex 目标模式，直至全部验收、独立复验、问题清零和发版闭环完成。",
    "- 每轮验证必须在固定测试项目中新建独立且无实现先验的任务线程；主会话按当前里程碑和实际风险动态下发结构化测试范围。",
    "- 固定基线套件与动态里程碑/逆向探索套件分开执行和计分，旧线程只作为历史证据。",
    "- `issues.json` 只接收独立 validator 线程实际观察且证据完整的问题；规划缺口进入 `readinessRisks`。",
    "- 同一时间最多一个里程碑为 `in_progress`。",
    "- 修复后的问题从活动 `issues.json` 删除，首次失败证据保留在验证历史。",
    "- 完成里程碑后必须归纳增强能力、意外问题、根因、规避措施和下一阶段预期。",
    "- 发布验证和上下文压缩完成后，自动批准完成审查并激活下一个里程碑，无需再次等待用户确认。",
    "- 每次目标模式小版本完成后必须 bump patch、通过本地门禁、提交、推送、打 tag，并直接创建 GitHub Release。",
    "- 发版提交以 `[skip ci]` 结尾；不得触发 GitHub Actions，正常发版使用 `gh release create`。",
    "- 发布验证后必须生成不超过 12 KiB 的 `reports/iteration-context.json`，并结束当前目标。",
    "",
    "## 验证路由",
    "",
    "| Role | Project | Thread policy | Model | Reasoning |",
    "|---|---|---|---|---|",
    `| Validator | ${md(roadmap.testingBindings.validator.project)} | \`${roadmap.testingBindings.validator.threadStrategy}\` | \`${roadmap.testingBindings.validator.model}\` | \`${roadmap.testingBindings.validator.reasoningEffort}\` |`,
    `| ORDS API | ${md(roadmap.testingBindings.server.repository)} | \`${roadmap.testingBindings.server.threadId}\` | \`${roadmap.testingBindings.server.model}\` | \`${roadmap.testingBindings.server.reasoningEffort}\` |`,
    "",
    `真实 API 验证可在 \`${roadmap.testingBindings.server.apiKeyEnvironment}\` 创建最小权限专用 API key；不得写入仓库、日志、fixture 或证据包，也不得用于生产社区写操作。`,
    "",
    "所有 CLI 回写场景必须同时保留后端/API 证据和 Codex 侧边栏真实浏览器视觉证据。浏览器复核标题、正文、格式、可见状态、用户可访问性与截图；不得只验证数据库。复用既有专用测试账号，不得逐轮新建。",
    "",
    "## 里程碑总览",
    "",
    "| Stage | Release line | Theme | Status | Active issues | Activation | Completion review |",
    "|---|---|---|---|---:|---|---|"
  ];

  for (const milestone of roadmap.milestones) {
    const activeIssues = issues.issues.filter((issue) => issue.milestoneId === milestone.id).length;
    lines.push(`| \`${milestone.id}\` | \`${milestone.releaseLine}\` | ${md(milestone.title)} | \`${milestone.status}\` | ${activeIssues} | \`${milestone.activationGate.status}\` | \`${milestone.completionReview.status}\` |`);
  }

  for (const milestone of roadmap.milestones) {
    lines.push(
      "",
      `## ${milestone.id} / ${milestone.releaseLine}: ${milestone.title}`,
      "",
      milestone.objective,
      "",
      `**用户结果：** ${milestone.userOutcome}`,
      "",
      `**阶段非目标：** ${milestone.stageNonGoals.join("；")}`,
      "",
      "### 能力",
      "",
      "| ID | Capability | Status | User value |",
      "|---|---|---|---|"
    );
    for (const capability of milestone.capabilities) {
      lines.push(`| \`${capability.id}\` | ${md(capability.title)} | \`${capability.status}\` | ${md(capability.userValue)} |`);
    }

    lines.push(
      "",
      "### 核心验收",
      "",
      "| ID | Status | Metric | Target | Measurement |",
      "|---|---|---|---|---|"
    );
    for (const criterion of milestone.acceptanceCriteria) {
      lines.push(`| \`${criterion.id}\` | \`${criterion.status}\` | ${md(criterion.description)} | ${targetText(criterion)} | ${md(criterion.measurementMethod)} |`);
    }

    const milestoneIssues = issues.issues.filter((issue) => issue.milestoneId === milestone.id);
    lines.push("", "### 活动问题", "");
    if (milestoneIssues.length === 0) {
      lines.push("无。");
    } else {
      lines.push("| ID | Priority | Owner | Status | Title |", "|---|---|---|---|---|");
      for (const issue of milestoneIssues) {
        lines.push(`| \`${issue.id}\` | \`${issue.priority}\` | \`${issue.owner}\` | \`${issue.status}\` | ${md(issue.title)} |`);
      }
    }

    lines.push(
      "",
      "### 人工交接门禁",
      "",
      `- Activation: \`${milestone.activationGate.status}\``,
      `- Completion review: \`${milestone.completionReview.status}\``,
      "- 完成后必须总结：增强能力、未预估问题、根因、规避措施、下一阶段目标、量化预期和主要风险。",
      "- 发布验证和上下文压缩完成后，自动批准完成审查并启动下一里程碑。"
    );
  }

  lines.push(
    "",
    "## 全局完成门禁",
    ""
  );
  for (const gate of roadmap.globalCompletionGates) {
    lines.push(`- \`${gate.id}\` (${gate.type}/${gate.appliesTo}): ${gate.requirement}`);
  }

  lines.push(
    "",
    "## 依赖与就绪风险",
    "",
    `- 结构化依赖：${roadmap.dependencyRegistry.length} 项；未就绪：${roadmap.dependencyRegistry.filter((entry) => entry.status !== "ready").length} 项。`,
    `- 就绪风险：${roadmap.readinessRisks.length} 项；开放：${roadmap.readinessRisks.filter((entry) => entry.status === "open").length} 项。`,
    "",
    "## 非目标",
    "",
    "- 不自动升级到 `2.0.0`。",
    "- 不开放 MCP execute-write 或远端 HTTP MCP Server。",
    "- 不在自动化测试中执行生产社区写操作。",
    "- 不用 CLI 补丁掩盖 ORDS REST API 能力缺口。",
    "- 不把离线 RAG fixture 指标描述成真实在线答案质量。",
    ""
  );
  return lines.join("\n");
}

export function renderIssues(issues) {
  const lines = [
    "# Issues",
    "",
    "> `issues.json` 是活动问题的机器可读真相源。本文件由 `npm run roadmap:render` 生成。",
    "> 已修复问题必须从活动列表删除；首次失败与关闭证据保留在独立验证历史中。",
    "",
    "## Active Backlog",
    ""
  ];

  const priorities = ["P0", "P1", "P2", "P3"];
  for (const priority of priorities) {
    const matching = issues.issues.filter((issue) => issue.priority === priority);
    if (matching.length === 0) {
      continue;
    }
    lines.push(`### ${priority}`, "", "| ID | Milestone | Owner | Status | Title |", "|---|---|---|---|---|");
    for (const issue of matching) {
      lines.push(`| \`${issue.id}\` | \`${issue.milestoneId}\` | \`${issue.owner}\` | \`${issue.status}\` | ${md(issue.title)} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function validateRoadmap({ roadmap, issues, agentsText }) {
  const problems = [];
  const expectedStages = ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"];
  const expectedReleaseLines = expectedStages.map((stage) => `0.${stage.slice(2)}0.x`);
  const milestoneStatuses = new Set(["planned", "in_progress", "blocked", "completed"]);
  const capabilityStatuses = new Set(["not_started", "partial", "implemented", "validated"]);
  const acceptanceStatuses = new Set(["pending", "pass", "fail"]);
  const completionStatuses = new Set(["not_due", "pending", "approved", "changes_requested"]);
  const activationStatuses = new Set(["approved", "waiting"]);
  const issueStatuses = new Set(["open", "in_progress", "blocked"]);
  const issueOwners = new Set(["cli", "server", "cross_repo", "test_environment", "external"]);
  const issuePriorities = new Set(["P0", "P1", "P2", "P3"]);
  const comparators = new Set(["eq", "gte", "lte"]);
  const dependencyStatuses = new Set(["unverified", "ready", "blocked", "retired"]);
  const dependencyGates = new Set(["activation", "completion"]);
  const readinessRiskStatuses = new Set(["open", "mitigated", "accepted"]);
  const allIds = new Set();

  check(roadmap.schemaVersion === 2, "roadmap.schemaVersion must be 2", problems);
  check(roadmap.product === "apexcn-cli", "roadmap.product must be apexcn-cli", problems);
  check(issues.schemaVersion === 1, "issues.schemaVersion must be 1", problems);
  check(issues.product === "apexcn-cli", "issues.product must be apexcn-cli", problems);
  check(issues.activeOnly === true, "issues.json must contain active issues only", problems);
  check(roadmap.executionProtocol?.planningMode === "just_in_time", "planningMode must be just_in_time", problems);
  check(roadmap.executionProtocol?.preGeneratedImplementationPlans === false, "preGeneratedImplementationPlans must be false", problems);
  check(roadmap.executionProtocol?.nextMilestoneRequiresManualConfirmation === false, "milestones must continue automatically after release closure", problems);
  check(equalArrays(roadmap.executionProtocol?.planningInputs, ["roadmap.json", "issues.json"]), "planningInputs must be roadmap.json and issues.json", problems);
  check(nonEmpty(roadmap.productStrategy?.primaryPersona), "product strategy needs a primary persona", problems);
  check(Array.isArray(roadmap.productStrategy?.topJobs) && roadmap.productStrategy.topJobs.length >= 4, "product strategy needs differentiated top jobs", problems);
  check(Array.isArray(roadmap.productStrategy?.excludedPersonas) && roadmap.productStrategy.excludedPersonas.length > 0, "product strategy needs excluded personas", problems);
  check(roadmap.versionPolicy?.milestoneEntryVersionBump === "minor", "milestone entry must bump the minor release line", problems);
  check(roadmap.versionPolicy?.goalModeIterationVersionBump === "patch", "goal-mode iteration must bump patch", problems);
  check(roadmap.versionPolicy?.migrationNoteRequiredOnMinorCutover === true, "minor cutover needs a migration note", problems);
  check(roadmap.executionProtocol?.goalModeDefinition?.incompleteWhenReleaseFails === true, "goal mode must remain incomplete when release fails", problems);
  check(roadmap.executionProtocol?.goalModeDefinition?.requiredForEveryMilestone === true, "every roadmap milestone must run in goal mode", problems);
  check(roadmap.executionProtocol?.goalModeDefinition?.milestoneExecutionMode === "one-codex-goal-per-roadmap-milestone", "each milestone must use one dedicated Codex goal", problems);
  check(roadmap.executionProtocol?.goalModeDefinition?.mayEndBeforeMilestoneCompletion === false, "milestone goal mode must not end before completion", problems);
  const patchClosure = roadmap.executionProtocol?.patchIterationClosure;
  check(patchClosure?.requiredInGoalMode === true, "goal-mode patch closure must be required", problems);
  check(patchClosure?.versionBump === "patch", "goal-mode closure must bump patch version", problems);
  check(patchClosure?.commitRequired === true && patchClosure?.pushRequired === true, "goal-mode closure must commit and push", problems);
  check(patchClosure?.githubReleaseRequired === true, "goal-mode closure must publish a GitHub Release", problems);
  check(patchClosure?.githubActionsMode === "skip", "goal-mode closure must skip GitHub Actions", problems);
  check(patchClosure?.releaseMethod === "gh-release-create", "goal-mode closure must use gh release create", problems);
  check(patchClosure?.releaseCommitSuffix === "[skip ci]", "release commit must end with [skip ci]", problems);
  check(patchClosure?.contextCompaction?.required === true, "iteration context compaction must be required", problems);
  check(patchClosure?.contextCompaction?.strategy === "durable-handoff", "context compaction strategy must be durable-handoff", problems);
  check(patchClosure?.contextCompaction?.output === "reports/iteration-context.json", "context compaction output drifted", problems);
  check(patchClosure?.contextCompaction?.maxBytes === 12288, "iteration context maximum must be 12288 bytes", problems);
  check(patchClosure?.contextCompaction?.nextSessionMustRead === true, "next session must read compact context", problems);
  const validator = roadmap.testingBindings?.validator;
  check(validator?.project === "/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test", "validator project binding drifted", problems);
  check(validator?.threadVisibility === "user-visible-codex-desktop-task", "validator must be a user-visible Codex Desktop task", problems);
  check(validator?.sessionCwdMustEqualProject === true, "validator session cwd must equal the validator project", problems);
  check(validator?.hiddenSubagentAllowed === false, "hidden subagents cannot satisfy validator rounds", problems);
  check(roadmap.testingBindings?.validator?.model === "gpt-5.6-luna", "validator model must be gpt-5.6-luna", problems);
  check(roadmap.testingBindings?.validator?.reasoningEffort === "high", "validator reasoning must be high", problems);
  check(validator?.threadStrategy === "fresh-task-per-validation-round", "each validator round must use a fresh task thread", problems);
  check(validator?.dynamicScenarioAssignment === true, "validator scenarios must be assigned dynamically", problems);
  check(validator?.personaResetEachRound === "novice", "each validator round must reset to novice persona", problems);
  check(validator?.issuesMustOriginateFromValidator === true, "issues must originate from validator findings", problems);
  check(validator?.reusePreviousThread === false, "validator threads must not be reused", problems);
  check(!Object.hasOwn(validator ?? {}, "threadId"), "validator binding must not pin a reusable threadId", problems);
  const roundProtocol = validator?.roundProtocol;
  check(roundProtocol?.intakeGate?.required === true, "validator intake gate must be required", problems);
  check(roundProtocol?.scopeContractGate?.required === true, "validator scope contract gate must be required", problems);
  check(roundProtocol?.scopeContractGate?.assignedBy === "main-session", "main session must dynamically assign validator scope", problems);
  check(roundProtocol?.scopeContractGate?.baselineSuiteCoverageRequiredPercent === 100, "validator must run 100% of the applicable baseline suite", problems);
  check(roundProtocol?.scopeContractGate?.dynamicSuiteRequired === true, "validator dynamic suite must be required", problems);
  check(roundProtocol?.issueAdmissionGate?.issueSourceMustMatchRoundThread === true, "issue source must match its validator round thread", problems);
  check(roundProtocol?.longitudinalComparison?.baselineSuiteStableAcrossRounds === true, "validator baseline suite must remain stable across rounds", problems);
  check(roundProtocol?.longitudinalComparison?.dynamicSuiteReportedSeparately === true, "dynamic validator results must be reported separately", problems);
  const visualVerification = roadmap.testingBindings?.validator?.writeBackVisualVerification;
  check(visualVerification?.required === true, "write-back visual verification must be required", problems);
  check(visualVerification?.browser === "codex-in-app-browser", "write-back validation must use the Codex in-app browser", problems);
  check(visualVerification?.perspective === "end-user", "write-back validation must use the end-user perspective", problems);
  check(visualVerification?.requireVisualRecognition === true, "write-back validation must require visual recognition", problems);
  check(visualVerification?.backendEvidenceStillRequired === true, "write-back validation must retain backend evidence", problems);
  check(equalArrays(visualVerification?.requiredBrowserEvidence, [
    "rendered-content",
    "formatting",
    "visibility-and-status",
    "screenshot"
  ]), "write-back browser evidence requirements drifted", problems);
  check(visualVerification?.testAccountPolicy?.reuseExistingAccount === true, "write-back tests must reuse the existing account", problems);
  check(visualVerification?.testAccountPolicy?.createAccountPerRun === false, "write-back tests must not create an account per run", problems);
  check(visualVerification?.testAccountPolicy?.credentialsStoredInRepository === false, "test account credentials must stay outside the repository", problems);
  check(roadmap.testingBindings?.server?.threadId === "019f2888-ef40-7b20-9af7-e4495f3a1091", "server thread binding drifted", problems);
  check(nonEmpty(roadmap.testingBindings?.server?.replacementThreadId), "server replacement thread binding is missing", problems);
  check(roadmap.testingBindings?.server?.model === "gpt-5.6-terra", "server model must be gpt-5.6-terra", problems);
  check(roadmap.testingBindings?.server?.reasoningEffort === "high", "server reasoning must be high", problems);
  check(roadmap.testingBindings?.server?.apiKeyEnvironment === "dev@oci", "server API key environment must be dev@oci", problems);
  check(roadmap.testingBindings?.server?.apiKeyPolicy?.productionUseAllowed === false, "production API key use must be disabled", problems);
  check(Array.isArray(roadmap.milestones) && roadmap.milestones.length === 8, "roadmap must contain eight milestones", problems);

  const measurementProfileIds = new Set();
  for (const profile of roadmap.measurementProfiles ?? []) {
    unique(profile.id, "measurement profile", measurementProfileIds, problems);
    check(nonEmpty(profile.owner) && nonEmpty(profile.purpose), `measurement profile ${profile.id} is incomplete`, problems);
    check(Array.isArray(profile.integrityRules) && profile.integrityRules.length > 0, `measurement profile ${profile.id} needs integrity rules`, problems);
  }
  check(measurementProfileIds.has("PROFILE-INDEPENDENT-NATURAL-LANGUAGE"), "independent natural-language measurement profile is required", problems);
  check(measurementProfileIds.has("PROFILE-WRITE-BACK-DUAL-EVIDENCE"), "write-back dual-evidence measurement profile is required", problems);

  const globalGateIds = new Set();
  for (const gate of roadmap.globalCompletionGates ?? []) {
    unique(gate.id, "global completion gate", globalGateIds, problems);
    check(["automatic", "manual"].includes(gate.type), `invalid global gate type for ${gate.id}`, problems);
    check(nonEmpty(gate.appliesTo) && nonEmpty(gate.requirement), `global gate ${gate.id} is incomplete`, problems);
  }
  for (const requiredGate of ["GLOBAL-GATE-ISSUES", "GLOBAL-GATE-DEPENDENCIES", "GLOBAL-GATE-INDEPENDENT", "GLOBAL-GATE-RELEASE"]) {
    check(globalGateIds.has(requiredGate), `missing global completion gate ${requiredGate}`, problems);
  }

  const dependencyMap = new Map();
  for (const dependency of roadmap.dependencyRegistry ?? []) {
    unique(dependency.id, "dependency", allIds, problems);
    dependencyMap.set(dependency.id, dependency);
    check(issueOwners.has(dependency.owner), `invalid dependency owner for ${dependency.id}`, problems);
    check(dependencyStatuses.has(dependency.status), `invalid dependency status for ${dependency.id}`, problems);
    check(dependencyGates.has(dependency.requiredAt), `invalid dependency gate for ${dependency.id}`, problems);
    check(Array.isArray(dependency.milestoneIds) && dependency.milestoneIds.length > 0, `dependency ${dependency.id} needs milestoneIds`, problems);
    check(dependency.readinessEvidence && typeof dependency.readinessEvidence === "object", `dependency ${dependency.id} needs readiness evidence`, problems);
    if (dependency.owner === "server") {
      const allowedServerThreadIds = new Set([
        roadmap.testingBindings.server.threadId,
        roadmap.testingBindings.server.replacementThreadId
      ]);
      check(allowedServerThreadIds.has(dependency.resolutionThreadId), `server dependency ${dependency.id} must route to a registered server thread`, problems);
    }
    if (dependency.status === "ready") {
      const evidenceValues = Object.values(dependency.readinessEvidence ?? {});
      check(evidenceValues.length > 0 && evidenceValues.every(nonEmpty), `ready dependency ${dependency.id} has incomplete evidence`, problems);
    }
  }

  const readinessRiskMap = new Map();
  for (const risk of roadmap.readinessRisks ?? []) {
    unique(risk.id, "readiness risk", allIds, problems);
    readinessRiskMap.set(risk.id, risk);
    check(readinessRiskStatuses.has(risk.status), `invalid readiness risk status for ${risk.id}`, problems);
    check(dependencyGates.has(risk.blockingAt), `invalid readiness risk gate for ${risk.id}`, problems);
    check(nonEmpty(risk.milestoneId) && nonEmpty(risk.description), `readiness risk ${risk.id} is incomplete`, problems);
    check(Array.isArray(risk.capabilityIds) && risk.capabilityIds.length > 0, `readiness risk ${risk.id} needs capabilityIds`, problems);
    if (risk.status === "mitigated") {
      check(Array.isArray(risk.resolutionEvidenceIds) && risk.resolutionEvidenceIds.length > 0, `mitigated risk ${risk.id} needs evidence`, problems);
    }
  }

  const milestoneMap = new Map();
  const capabilityIds = new Set();
  let inProgressCount = 0;
  for (let index = 0; index < roadmap.milestones.length; index += 1) {
    const milestone = roadmap.milestones[index];
    const expectedStage = expectedStages[index];
    const expectedReleaseLine = expectedReleaseLines[index];
    unique(milestone.id, "milestone", allIds, problems);
    milestoneMap.set(milestone.id, milestone);
    check(milestone.id === expectedStage, `milestone ${index} must be ${expectedStage}`, problems);
    check(milestone.releaseLine === expectedReleaseLine, `milestone ${milestone.id} must use ${expectedReleaseLine}`, problems);
    check(roadmap.versionPolicy?.productStageToReleaseLine?.[milestone.id] === milestone.releaseLine, `version mapping missing for ${milestone.id}`, problems);
    check(milestoneStatuses.has(milestone.status), `invalid milestone status for ${milestone.id}`, problems);
    check(nonEmpty(milestone.title) && nonEmpty(milestone.objective), `milestone ${milestone.id} needs title and objective`, problems);
    check(nonEmpty(milestone.userOutcome), `milestone ${milestone.id} needs a user outcome`, problems);
    check(Array.isArray(milestone.stageNonGoals) && milestone.stageNonGoals.length > 0, `milestone ${milestone.id} needs stage non-goals`, problems);
    check(Array.isArray(milestone.outcomeMetricIds) && milestone.outcomeMetricIds.length > 0, `milestone ${milestone.id} needs outcome metrics`, problems);
    check(Array.isArray(milestone.capabilities) && milestone.capabilities.length > 0, `milestone ${milestone.id} needs capabilities`, problems);
    check(Array.isArray(milestone.acceptanceCriteria) && milestone.acceptanceCriteria.length > 0, `milestone ${milestone.id} needs acceptance criteria`, problems);
    check(Array.isArray(milestone.validatorScenarios) && milestone.validatorScenarios.length > 0, `milestone ${milestone.id} needs validator scenarios`, problems);
    check(activationStatuses.has(milestone.activationGate?.status), `invalid activation gate for ${milestone.id}`, problems);
    check(completionStatuses.has(milestone.completionReview?.status), `invalid completion review for ${milestone.id}`, problems);
    if (milestone.status === "in_progress") {
      inProgressCount += 1;
    }
    for (const dependencyId of milestone.dependencies ?? []) {
      check(dependencyMap.has(dependencyId), `milestone ${milestone.id} references unknown dependency ${dependencyId}`, problems);
    }
    if (["in_progress", "completed"].includes(milestone.status)) {
      for (const dependencyId of milestone.dependencies ?? []) {
        const dependency = dependencyMap.get(dependencyId);
        if (dependency?.requiredAt === "activation") {
          check(dependency.status === "ready", `milestone ${milestone.id} cannot activate before dependency ${dependencyId} is ready`, problems);
        }
      }
      for (const risk of roadmap.readinessRisks ?? []) {
        if (risk.milestoneId === milestone.id && risk.blockingAt === "activation") {
          check(risk.status !== "open", `milestone ${milestone.id} cannot activate with open readiness risk ${risk.id}`, problems);
        }
      }
    }

    const previous = index === 0 ? null : roadmap.milestones[index - 1];
    const expectedPreviousId = previous?.id ?? null;
    check(milestone.activationGate?.previousMilestoneId === expectedPreviousId, `activation predecessor mismatch for ${milestone.id}`, problems);
    if (previous && ["in_progress", "completed"].includes(milestone.status)) {
      check(previous.completionReview?.status === "approved", `${milestone.id} cannot start before ${previous.id} completion approval`, problems);
      check(milestone.activationGate?.status === "approved", `${milestone.id} activation must be approved`, problems);
    }

    const evidenceIds = new Set();
    for (const evidence of milestone.evidence ?? []) {
      unique(evidence.id, "evidence", allIds, problems);
      evidenceIds.add(evidence.id);
      check(nonEmpty(evidence.kind) && nonEmpty(evidence.description), `evidence ${evidence.id} needs kind and description`, problems);
    }

    const criterionIds = new Set();
    for (const criterion of milestone.acceptanceCriteria) {
      unique(criterion.id, "acceptance criterion", allIds, problems);
      criterionIds.add(criterion.id);
      check(criterion.gate === "core" || criterion.gate === "supporting", `invalid gate for ${criterion.id}`, problems);
      check(acceptanceStatuses.has(criterion.status), `invalid acceptance status for ${criterion.id}`, problems);
      check(nonEmpty(criterion.metric) && nonEmpty(criterion.unit) && nonEmpty(criterion.measurementMethod), `criterion ${criterion.id} is not measurable`, problems);
      check(comparators.has(criterion.comparator), `invalid comparator for ${criterion.id}`, problems);
      check(criterion.target !== null && criterion.target !== undefined, `criterion ${criterion.id} needs a target`, problems);
      check(measurementProfileIds.has(criterion.measurementProfileId), `criterion ${criterion.id} references unknown measurement profile ${criterion.measurementProfileId}`, problems);
      for (const evidenceId of criterion.evidenceIds ?? []) {
        check(evidenceIds.has(evidenceId), `criterion ${criterion.id} references unknown evidence ${evidenceId}`, problems);
      }
      if (criterion.status === "pass") {
        check((criterion.evidenceIds ?? []).length > 0, `passing criterion ${criterion.id} needs evidence`, problems);
      }
    }

    const scenarioIds = new Set();
    for (const scenario of milestone.validatorScenarios) {
      unique(scenario.id, "validator scenario", allIds, problems);
      scenarioIds.add(scenario.id);
      check(nonEmpty(scenario.description) && nonEmpty(scenario.mode), `scenario ${scenario.id} is incomplete`, problems);
    }

    for (const capability of milestone.capabilities) {
      unique(capability.id, "capability", allIds, problems);
      capabilityIds.add(capability.id);
      check(capabilityStatuses.has(capability.status), `invalid capability status for ${capability.id}`, problems);
      check(nonEmpty(capability.title) && nonEmpty(capability.userValue), `capability ${capability.id} needs title and user value`, problems);
      check(Array.isArray(capability.scope) && capability.scope.length > 0, `capability ${capability.id} needs scope`, problems);
      check(Array.isArray(capability.nonGoals) && capability.nonGoals.length > 0, `capability ${capability.id} needs nonGoals`, problems);
      for (const dependencyId of capability.dependencies ?? []) {
        check(dependencyMap.has(dependencyId), `capability ${capability.id} references unknown dependency ${dependencyId}`, problems);
      }
      for (const criterionId of capability.acceptanceCriterionIds ?? []) {
        check(criterionIds.has(criterionId), `capability ${capability.id} references unknown criterion ${criterionId}`, problems);
      }
      for (const scenarioId of capability.validatorScenarioIds ?? []) {
        check(scenarioIds.has(scenarioId), `capability ${capability.id} references unknown scenario ${scenarioId}`, problems);
      }
      for (const evidenceId of capability.evidenceIds ?? []) {
        check(evidenceIds.has(evidenceId), `capability ${capability.id} references unknown evidence ${evidenceId}`, problems);
      }
      if (capability.status === "validated") {
        const hasValidatorEvidence = (capability.evidenceIds ?? []).some((id) =>
          milestone.evidence.some((entry) => entry.id === id && entry.kind === "independent_validator")
        );
        check(hasValidatorEvidence, `validated capability ${capability.id} needs independent validator evidence`, problems);
      }
    }

    if (milestone.status === "completed") {
      check(milestone.capabilities.every((capability) => capability.status === "validated"), `completed milestone ${milestone.id} has unvalidated capabilities`, problems);
      check(milestone.acceptanceCriteria.filter((criterion) => criterion.gate === "core").every((criterion) => criterion.status === "pass"), `completed milestone ${milestone.id} has incomplete core gates`, problems);
      check(milestone.completionReview?.status === "approved", `completed milestone ${milestone.id} must have an approved completion review`, problems);
      for (const dependency of roadmap.dependencyRegistry ?? []) {
        if ((dependency.milestoneIds ?? []).includes(milestone.id) && dependency.requiredAt === "completion") {
          check(dependency.status === "ready", `completed milestone ${milestone.id} has unready dependency ${dependency.id}`, problems);
        }
      }
      for (const risk of roadmap.readinessRisks ?? []) {
        if (risk.milestoneId === milestone.id) {
          check(risk.status !== "open", `completed milestone ${milestone.id} has open readiness risk ${risk.id}`, problems);
        }
      }
    }
    for (const outcomeMetricId of milestone.outcomeMetricIds ?? []) {
      check(criterionIds.has(outcomeMetricId), `milestone ${milestone.id} references unknown outcome metric ${outcomeMetricId}`, problems);
    }
  }
  check(inProgressCount <= 1, "only one milestone may be in_progress", problems);
  for (const dependency of roadmap.dependencyRegistry ?? []) {
    for (const milestoneId of dependency.milestoneIds ?? []) {
      check(milestoneMap.has(milestoneId), `dependency ${dependency.id} references unknown milestone ${milestoneId}`, problems);
    }
  }
  for (const risk of roadmap.readinessRisks ?? []) {
    check(milestoneMap.has(risk.milestoneId), `readiness risk ${risk.id} references unknown milestone ${risk.milestoneId}`, problems);
    for (const capabilityId of risk.capabilityIds ?? []) {
      check(capabilityIds.has(capabilityId), `readiness risk ${risk.id} references unknown capability ${capabilityId}`, problems);
    }
  }

  const sourcePolicy = issues.sourcePolicy;
  check(sourcePolicy?.allowedSource === "independent-validator-thread", "issues must only come from independent validator threads", problems);
  check(sourcePolicy?.validatorProject === validator?.project, "issue source validator project drifted", problems);
  check(sourcePolicy?.threadStrategy === "fresh-task-per-validation-round", "issue validation rounds must use fresh task threads", problems);
  check(sourcePolicy?.dynamicAssignmentRequired === true, "issue validation scope must be assigned dynamically", problems);
  check(sourcePolicy?.novicePersonaRequired === true, "issue validation must use a novice persona", problems);
  check(sourcePolicy?.newActiveIssueRequiresFreshRound === true, "new active issues must require a fresh validator round", problems);
  check(sourcePolicy?.implementationPlanningItemsBelongIn === "roadmap.readinessRisks", "planning items must stay out of issues.json", problems);

  const activeIssueIds = new Set();
  for (const issue of issues.issues ?? []) {
    unique(issue.id, "issue", activeIssueIds, problems);
    check(issueStatuses.has(issue.status), `issues.json contains non-active status for ${issue.id}`, problems);
    check(issueOwners.has(issue.owner), `invalid owner for ${issue.id}`, problems);
    check(issuePriorities.has(issue.priority), `invalid priority for ${issue.id}`, problems);
    check(milestoneMap.has(issue.milestoneId), `unknown milestone for ${issue.id}`, problems);
    check(nonEmpty(issue.title) && nonEmpty(issue.description), `issue ${issue.id} needs title and description`, problems);
    for (const dependencyId of issue.dependencies ?? []) {
      check(dependencyMap.has(dependencyId), `issue ${issue.id} references unknown dependency ${dependencyId}`, problems);
    }
    const source = issue.source;
    check(source?.type === "independent-validator-thread", `issue ${issue.id} must originate from an independent validator thread`, problems);
    check(nonEmpty(source?.threadId), `issue ${issue.id} needs validator thread provenance`, problems);
    check(nonEmpty(source?.assignmentRef), `issue ${issue.id} needs validator assignment provenance`, problems);
    check(nonEmpty(source?.report), `issue ${issue.id} needs validator report provenance`, problems);
    check(Array.isArray(source?.findingRefs) && source.findingRefs.length > 0, `issue ${issue.id} needs validator finding references`, problems);
    check(Array.isArray(source?.scenarioOrExplorationRef) && source.scenarioOrExplorationRef.length > 0, `issue ${issue.id} needs scenario or exploration provenance`, problems);
    check(nonEmpty(source?.observedCliVersion), `issue ${issue.id} needs observed CLI version`, problems);
    check(source?.persona === "novice", `issue ${issue.id} must be observed with novice persona`, problems);
    check(source?.firstAttemptEvidencePreserved === true, `issue ${issue.id} must preserve first-attempt evidence`, problems);
    check(nonEmpty(source?.actualOutputSummary), `issue ${issue.id} needs actual output summary`, problems);
    check(nonEmpty(source?.expectedUserOutcome), `issue ${issue.id} needs expected user outcome`, problems);
    check(issueOwners.has(source?.responsibilityAssessment), `issue ${issue.id} needs a valid responsibility assessment`, problems);
    check(issue.validatorRound === source?.assignmentRef, `issue ${issue.id} validator round must match its assignment`, problems);
    const milestone = milestoneMap.get(issue.milestoneId);
    const milestoneCriterionIds = new Set((milestone?.acceptanceCriteria ?? []).map((criterion) => criterion.id));
    for (const criterionId of issue.acceptanceCriterionIds ?? []) {
      check(milestoneCriterionIds.has(criterionId), `issue ${issue.id} references unknown criterion ${criterionId}`, problems);
    }
    if (issue.owner === "server" || issue.owner === "cross_repo") {
      const allowedServerThreadIds = new Set([
        roadmap.testingBindings.server.threadId,
        roadmap.testingBindings.server.replacementThreadId
      ]);
      check(allowedServerThreadIds.has(issue.serverThreadId), `server routing drift for ${issue.id}`, problems);
    }
  }

  for (const milestone of roadmap.milestones) {
    if (milestone.status !== "completed") {
      continue;
    }
    const blockers = issues.issues.filter((issue) =>
      ["P0", "P1"].includes(issue.priority) && (issue.blockingMilestones ?? []).includes(milestone.id)
    );
    check(blockers.length === 0, `completed milestone ${milestone.id} still has blocking P0/P1 issues`, problems);
  }

  check(agentsText.includes("roadmap.json") && agentsText.includes("issues.json"), "AGENTS.md must require roadmap.json and issues.json", problems);
  check(agentsText.includes("automatically mark") && agentsText.includes("Do not wait for additional user confirmation"), "AGENTS.md must require automatic milestone continuation", problems);
  check(agentsText.includes("[skip ci]") && agentsText.includes("gh release create"), "AGENTS.md must define direct release closure", problems);
  check(agentsText.includes("context:compact") && agentsText.includes("reports/iteration-context.json"), "AGENTS.md must define context compaction", problems);
  check(agentsText.includes("one dedicated Codex goal") && agentsText.includes("100%"), "AGENTS.md must require one goal mode per milestone through release", problems);
  check(agentsText.includes("fresh independent novice task thread") && agentsText.includes("dynamically assigns"), "AGENTS.md must require fresh dynamically scoped validator threads", problems);
  check(agentsText.includes("user-visible Codex Desktop task") && agentsText.includes("Hidden subagents do not satisfy"), "AGENTS.md must require a visible validator task in the validator project", problems);
  check(agentsText.includes("issues.json") && agentsText.includes("actual validator findings only"), "AGENTS.md must restrict issues.json to validator findings", problems);
  check(agentsText.includes("Codex in-app browser") && agentsText.includes("database-only"), "AGENTS.md must require visual write-back validation", problems);
  check(agentsText.includes("existing dedicated test account"), "AGENTS.md must require test account reuse", problems);
  return problems;
}

function targetText(criterion) {
  const symbols = { eq: "=", gte: ">=", lte: "<=" };
  return `\`${symbols[criterion.comparator]} ${criterion.target} ${criterion.unit}\``;
}

function md(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function check(condition, message, problems) {
  if (!condition) {
    problems.push(message);
  }
}

function unique(id, kind, seen, problems) {
  if (!nonEmpty(id)) {
    problems.push(`${kind} id is missing`);
    return;
  }
  if (seen.has(id)) {
    problems.push(`duplicate ${kind} id: ${id}`);
    return;
  }
  seen.add(id);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function equalArrays(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const roadmap = readJson(roadmapPath);
  const issues = readJson(issuesPath);
  const problems = validateRoadmap({
    roadmap,
    issues,
    agentsText: readFileSync(agentsPath, "utf8")
  });
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exit(1);
  }
  console.log(`Roadmap check passed for ${roadmap.milestones.length} milestones and ${issues.issues.length} active issues`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
