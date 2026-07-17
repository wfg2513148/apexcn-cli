#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const roadmapPath = join(repoRoot, "roadmap.json");
const issuesPath = join(repoRoot, "issues.json");
const roadmapMarkdownPath = join(repoRoot, "docs/roadmap.md");
const issuesMarkdownPath = join(repoRoot, "issues.md");
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
    "## 执行规则",
    "",
    "- 每个主会话开始时必须读取 `roadmap.json` 与 `issues.json`。",
    "- 只为当前里程碑生成即时执行计划，不预制后续里程碑实施计划。",
    "- 同一时间最多一个里程碑为 `in_progress`。",
    "- 修复后的问题从活动 `issues.json` 删除，首次失败证据保留在验证历史。",
    "- 完成里程碑后必须停下，归纳增强能力、意外问题、根因、规避措施和下一阶段预期。",
    "- 只有用户手工确认后，下一里程碑才可进入 `in_progress`。",
    "",
    "## 固定验证路由",
    "",
    "| Role | Project | Thread | Model | Reasoning |",
    "|---|---|---|---|---|",
    `| Validator | ${md(roadmap.testingBindings.validator.project)} | \`${roadmap.testingBindings.validator.threadId}\` | \`${roadmap.testingBindings.validator.model}\` | \`${roadmap.testingBindings.validator.reasoningEffort}\` |`,
    `| ORDS API | ${md(roadmap.testingBindings.server.repository)} | \`${roadmap.testingBindings.server.threadId}\` | \`${roadmap.testingBindings.server.model}\` | \`${roadmap.testingBindings.server.reasoningEffort}\` |`,
    "",
    `真实 API 验证可在 \`${roadmap.testingBindings.server.apiKeyEnvironment}\` 创建最小权限专用 API key；不得写入仓库、日志、fixture 或证据包，也不得用于生产社区写操作。`,
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
      "- 未获得用户明确确认，不得启动下一里程碑。"
    );
  }

  lines.push(
    "",
    "## 非目标",
    "",
    "- 不自动升级到 `1.0.0`。",
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

export function validateRoadmap({ roadmap, issues, roadmapMarkdown, issuesMarkdown, agentsText }) {
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
  const allIds = new Set();

  check(roadmap.schemaVersion === 1, "roadmap.schemaVersion must be 1", problems);
  check(roadmap.product === "apexcn-cli", "roadmap.product must be apexcn-cli", problems);
  check(issues.schemaVersion === 1, "issues.schemaVersion must be 1", problems);
  check(issues.product === "apexcn-cli", "issues.product must be apexcn-cli", problems);
  check(issues.activeOnly === true, "issues.json must contain active issues only", problems);
  check(roadmap.executionProtocol?.planningMode === "just_in_time", "planningMode must be just_in_time", problems);
  check(roadmap.executionProtocol?.preGeneratedImplementationPlans === false, "preGeneratedImplementationPlans must be false", problems);
  check(roadmap.executionProtocol?.nextMilestoneRequiresManualConfirmation === true, "manual milestone confirmation must be required", problems);
  check(equalArrays(roadmap.executionProtocol?.planningInputs, ["roadmap.json", "issues.json"]), "planningInputs must be roadmap.json and issues.json", problems);
  check(roadmap.testingBindings?.validator?.threadId === "019f6ed4-f811-7fd0-8111-241bb262c3ba", "validator thread binding drifted", problems);
  check(roadmap.testingBindings?.validator?.model === "gpt-5.6-luna", "validator model must be gpt-5.6-luna", problems);
  check(roadmap.testingBindings?.validator?.reasoningEffort === "high", "validator reasoning must be high", problems);
  check(roadmap.testingBindings?.server?.threadId === "019f2888-ef40-7b20-9af7-e4495f3a1091", "server thread binding drifted", problems);
  check(roadmap.testingBindings?.server?.model === "gpt-5.6-terra", "server model must be gpt-5.6-terra", problems);
  check(roadmap.testingBindings?.server?.reasoningEffort === "high", "server reasoning must be high", problems);
  check(roadmap.testingBindings?.server?.apiKeyEnvironment === "dev@oci", "server API key environment must be dev@oci", problems);
  check(roadmap.testingBindings?.server?.apiKeyPolicy?.productionUseAllowed === false, "production API key use must be disabled", problems);
  check(Array.isArray(roadmap.milestones) && roadmap.milestones.length === 8, "roadmap must contain eight milestones", problems);

  const milestoneMap = new Map();
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
    check(Array.isArray(milestone.capabilities) && milestone.capabilities.length > 0, `milestone ${milestone.id} needs capabilities`, problems);
    check(Array.isArray(milestone.acceptanceCriteria) && milestone.acceptanceCriteria.length > 0, `milestone ${milestone.id} needs acceptance criteria`, problems);
    check(Array.isArray(milestone.validatorScenarios) && milestone.validatorScenarios.length > 0, `milestone ${milestone.id} needs validator scenarios`, problems);
    check(activationStatuses.has(milestone.activationGate?.status), `invalid activation gate for ${milestone.id}`, problems);
    check(completionStatuses.has(milestone.completionReview?.status), `invalid completion review for ${milestone.id}`, problems);
    if (milestone.status === "in_progress") {
      inProgressCount += 1;
    }

    const previous = index === 0 ? null : roadmap.milestones[index - 1];
    const expectedPreviousId = previous?.id ?? null;
    check(milestone.activationGate?.previousMilestoneId === expectedPreviousId, `activation predecessor mismatch for ${milestone.id}`, problems);
    if (previous && ["in_progress", "completed"].includes(milestone.status)) {
      check(previous.completionReview?.status === "approved", `${milestone.id} cannot start before ${previous.id} manual approval`, problems);
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
      check(capabilityStatuses.has(capability.status), `invalid capability status for ${capability.id}`, problems);
      check(nonEmpty(capability.title) && nonEmpty(capability.userValue), `capability ${capability.id} needs title and user value`, problems);
      check(Array.isArray(capability.scope) && capability.scope.length > 0, `capability ${capability.id} needs scope`, problems);
      check(Array.isArray(capability.nonGoals) && capability.nonGoals.length > 0, `capability ${capability.id} needs nonGoals`, problems);
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
      check(["pending", "approved"].includes(milestone.completionReview?.status), `completed milestone ${milestone.id} must await or have manual review`, problems);
    }
  }
  check(inProgressCount <= 1, "only one milestone may be in_progress", problems);

  const activeIssueIds = new Set();
  for (const issue of issues.issues ?? []) {
    unique(issue.id, "issue", activeIssueIds, problems);
    check(issueStatuses.has(issue.status), `issues.json contains non-active status for ${issue.id}`, problems);
    check(issueOwners.has(issue.owner), `invalid owner for ${issue.id}`, problems);
    check(issuePriorities.has(issue.priority), `invalid priority for ${issue.id}`, problems);
    check(milestoneMap.has(issue.milestoneId), `unknown milestone for ${issue.id}`, problems);
    check(nonEmpty(issue.title) && nonEmpty(issue.description), `issue ${issue.id} needs title and description`, problems);
    const milestone = milestoneMap.get(issue.milestoneId);
    const milestoneCriterionIds = new Set((milestone?.acceptanceCriteria ?? []).map((criterion) => criterion.id));
    for (const criterionId of issue.acceptanceCriterionIds ?? []) {
      check(milestoneCriterionIds.has(criterionId), `issue ${issue.id} references unknown criterion ${criterionId}`, problems);
    }
    if (issue.owner === "server" || issue.owner === "cross_repo") {
      check(issue.serverThreadId === roadmap.testingBindings.server.threadId, `server routing drift for ${issue.id}`, problems);
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

  check(roadmapMarkdown === renderRoadmap(roadmap, issues), "docs/roadmap.md is not synchronized with roadmap.json", problems);
  check(issuesMarkdown === renderIssues(issues), "issues.md is not synchronized with issues.json", problems);
  check(agentsText.includes("roadmap.json") && agentsText.includes("issues.json"), "AGENTS.md must require roadmap.json and issues.json", problems);
  check(agentsText.includes("手工确认"), "AGENTS.md must require manual milestone confirmation", problems);
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
  const writeDocs = process.argv.slice(2).includes("--write-docs");
  if (writeDocs) {
    writeFileSync(roadmapMarkdownPath, renderRoadmap(roadmap, issues));
    writeFileSync(issuesMarkdownPath, renderIssues(issues));
  }

  const problems = validateRoadmap({
    roadmap,
    issues,
    roadmapMarkdown: readFileSync(roadmapMarkdownPath, "utf8"),
    issuesMarkdown: readFileSync(issuesMarkdownPath, "utf8"),
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
