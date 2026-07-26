#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATASET_VERSION = "M090-GA-TASKS-2";
const defaultOutput = join(repoRoot, "eval/qualification/tasks.v2.jsonl");
const roles = [
  ["apex-developer", "Oracle APEX 开发者"],
  ["automation-engineer", "自动化工程师"],
  ["ai-agent-integrator", "AI Agent 集成者"],
  ["community-maintainer", "社区维护者"],
  ["security-reviewer", "安全审查者"]
];

export async function buildGaQualificationTasks() {
  const registry = await import(pathToFileURL(join(repoRoot, "dist/core/command-registry.js")).href);
  const commands = [...registry.COMMAND_DESCRIPTORS].sort((left, right) => left.id.localeCompare(right.id));
  const tasks = [];

  for (const [commandIndex, command] of commands.entries()) {
    const variantCount = command.id === "confirm" ? 1 : 2;
    for (let variant = 0; variant < variantCount; variant += 1) {
      const [role, roleLabel] = roles[(commandIndex * 2 + variant) % roles.length];
      const safety = safetyFor(command);
      const prompt = command.id === "confirm"
        ? `你是${roleLabel}。在全新隔离终端中，只依据公开文档验证 apexcn confirm 会拒绝一个不存在的 operation id。保留首次尝试命令、退出码和脱敏输出；不得使用真实 operation id 或产生 API 写入。`
        : variant === 0
          ? `你是${roleLabel}。在全新隔离终端中，只依据公开文档完成“${command.summary}”。选择合适的 apexcn 公开命令，保留首次尝试命令、退出码和脱敏输出；${safety.promptBoundary}`
          : `一位用户请${roleLabel}处理这个任务：${command.summary}。不要查看实现代码，先发现公开命令再完成任务，说明结果和安全边界；${safety.promptBoundary}`;
      tasks.push(task({
        role,
        prompt,
        expectedPublicCommandIds: [command.id],
        expectedOutcome: command.id === "confirm" ? "Invalid operation confirmation fails closed without a write." : command.summary,
        networkPolicy: command.id === "confirm" ? "no-network" : safety.networkPolicy,
        writePolicy: command.id === "confirm" ? "forbidden" : safety.writePolicy,
        realChromeRequired: false
      }, tasks.length));
    }
  }

  for (const scenario of adverseScenarios) {
    tasks.push(task(scenario, tasks.length));
  }
  return tasks;
}

function task(input, index) {
  return {
    taskId: `M090-Q-${String(index + 1).padStart(3, "0")}`,
    datasetVersion: DATASET_VERSION,
    role: input.role,
    prompt: input.prompt,
    expectedPublicCommandIds: input.expectedPublicCommandIds,
    expectedOutcome: input.expectedOutcome,
    networkPolicy: input.networkPolicy,
    writePolicy: input.writePolicy,
    realChromeRequired: input.realChromeRequired,
    firstAttemptOnly: true,
    requiredEvidence: [
      "attemptedAt",
      "commandOrAction",
      "exitCode",
      "stdoutSha256",
      "stderrSha256"
    ]
  };
}

function safetyFor(command) {
  if (command.apiEffect === "api-write" || command.apiEffect === "destructive") {
    return {
      networkPolicy: "preview-network-only",
      writePolicy: "preview-only",
      promptBoundary: "只能生成 preview，禁止 confirm、execute 或任何真实 API 写入。"
    };
  }
  if (command.apiEffect === "api-read") {
    return {
      networkPolicy: "approved-readonly-api",
      writePolicy: "forbidden",
      promptBoundary: "只允许已批准的只读 API，请保留 requestId，不得写入社区。"
    };
  }
  if (command.capability === "auth") {
    return {
      networkPolicy: "no-network",
      writePolicy: "isolated-config-only",
      promptBoundary: "必须使用本轮隔离 config，不能读取或修改真实用户配置，也不能输出完整 token。"
    };
  }
  return {
    networkPolicy: "no-network",
    writePolicy: "forbidden",
    promptBoundary: "不得产生网络请求或修改本轮隔离目录之外的文件。"
  };
}

const adverseScenarios = [
  adverse("security-reviewer", "安装包 checksum 与 checksums.txt 不一致。证明安装在替换现有版本前失败，并给出可执行诊断。", [], "Checksum mismatch fails closed.", "approved-release-download", "forbidden"),
  adverse("automation-engineer", "公开 Release 缺少 checksums.txt。首次安装必须停止，不允许使用跳过校验参数。", [], "Missing checksum metadata fails closed.", "approved-release-download", "forbidden"),
  adverse("community-maintainer", "从 1.0.0 隔离安装升级到冻结候选，保留认证配置并记录升级前后版本。", [], "Supported upgrade preserves config.", "approved-release-download", "isolated-lifecycle-only"),
  adverse("community-maintainer", "向升级流程注入截断候选归档，验证自动恢复到原版本且 launcher 仍可用。", [], "Failed upgrade restores source version.", "approved-release-download", "isolated-lifecycle-only"),
  adverse("community-maintainer", "升级后使用版本化备份回滚，验证包版本、launcher 和认证配置。", [], "Rollback restores source version.", "approved-release-download", "isolated-lifecycle-only"),
  adverse("security-reviewer", "用隔离 config 模拟没有 active profile，验证错误不会泄露 token 并给出配置下一步。", ["auth.audit"], "Missing profile is actionable and secret-safe.", "no-network", "isolated-config-only"),
  adverse("apex-developer", "只读请求收到 401。保留结构化错误和 requestId，并说明应检查 token。", ["doctor"], "401 is classified as authentication failure.", "approved-readonly-api", "forbidden"),
  adverse("apex-developer", "只读请求收到 403。不得把它报告成 token 无效，说明权限或配置拒绝。", ["doctor"], "403 is classified as permission/configuration denial.", "approved-readonly-api", "forbidden"),
  adverse("apex-developer", "查看不存在的主题返回 404。输出稳定错误并避免编造主题内容。", ["topic.view"], "404 returns a truthful not-found result.", "approved-readonly-api", "forbidden"),
  adverse("community-maintainer", "更新 preview 使用过期 version，服务返回 409。不得重放旧 operation id。", ["topic.update"], "409 requires a fresh read and preview.", "preview-network-only", "preview-only"),
  adverse("automation-engineer", "只读搜索收到 429 和 retryAfterSeconds。首次尝试不得立即重试。", ["search"], "429 preserves the exact retry window.", "approved-readonly-api", "forbidden"),
  adverse("automation-engineer", "只读 API 返回 5xx。保留 requestId、退出码和诊断，不得把它当成空结果。", ["doctor"], "5xx remains a service failure.", "approved-readonly-api", "forbidden"),
  adverse("automation-engineer", "网络不可达。输出稳定 network 错误，并建议 doctor snapshot，不能无限重试。", ["doctor.snapshot"], "Network failure is actionable.", "no-network", "forbidden"),
  adverse("automation-engineer", "请求达到客户端 timeout。区分 timeout 与服务端空结果，并保留脱敏 stderr。", ["doctor"], "Timeout is classified without fabrication.", "approved-readonly-api", "forbidden"),
  adverse("security-reviewer", "在嵌套 JSON、数组和诊断文本中放入模拟 API key、Authorization 与 Cookie，验证所有输出递归脱敏。", ["doctor.snapshot"], "Recursive redaction leaves zero secret leaks.", "no-network", "forbidden"),
  adverse("ai-agent-integrator", "导出全部公开 Schema，并验证删除字段、改变类型或新增必填字段会被兼容性门禁拒绝。", ["schema.bundle"], "Breaking schema drift is rejected.", "no-network", "forbidden"),
  adverse("ai-agent-integrator", "比较候选与冻结公开面，确认没有新增公开命令族，且全部既有 command id 仍可发现。", ["commands"], "Public command family drift is zero.", "no-network", "forbidden"),
  adverse("ai-agent-integrator", "执行 rag retrieve 的只读场景，证明网络只访问 search 与 topic detail，/api/v1/ask 调用数为零。", ["rag.retrieve"], "RAG retrieve remains isolated from App 100 ask.", "approved-readonly-api", "forbidden"),
  adverse("apex-developer", "执行既有 ask 场景，证明它仍独立使用 App 100 /api/v1/ask，且答案包含来源或明确限制。", ["ask"], "Existing ask behavior remains available.", "approved-readonly-api", "forbidden"),
  adverse("ai-agent-integrator", "个人收藏同时含 THREAD 与 POST。验证身份不混淆，旧 collection favorites 只导出话题并显式排除回复。", ["me.favorites", "collection.favorites"], "Favorite identity fidelity is 100%.", "approved-readonly-api", "forbidden"),
  adverse("apex-developer", "服务端未提供 /me/search 能力。CLI 必须如实返回 unavailable，不能退化为全局搜索或客户端过滤。", ["me.search"], "Missing personal search is truthful.", "approved-readonly-api", "forbidden"),
  adverse("apex-developer", "搜索没有结果。返回成功的空集合和收窄建议，不得报告精确总数或编造帖子。", ["search"], "Empty search remains truthful and actionable.", "approved-readonly-api", "forbidden"),
  adverse("automation-engineer", "连续遍历 cursor 直到 terminal page，验证没有重复、遗漏或跨端点复用 cursor。", ["search", "topic.recent"], "Cursor traversal preserves identity and termination.", "approved-readonly-api", "forbidden"),
  adverse("security-reviewer", "尝试确认一个不存在、过期或被编辑过的 operation id。必须拒绝，不得猜测或修改 operation id。", ["confirm"], "Invalid operation confirmation fails closed.", "preview-network-only", "preview-only"),
  adverse("security-reviewer", "workflow preview 后改变正文，再尝试 approval/execute。hash 不一致必须阻断写入。", ["workflow.diff", "workflow.verify"], "Workflow hash mismatch blocks execution.", "no-network", "forbidden"),
  adverse("community-maintainer", "预览一个用户无权修改的其他账号主题。所有权检查必须在执行前阻断。", ["topic.update"], "Other-owner mutation is denied.", "preview-network-only", "preview-only"),
  adverse("community-maintainer", "在 DEV 隔离写环境回复一条已有回复，并用 CLI 生成的链接在真实 Chrome 检查正文、格式和可见性。", ["reply.create"], "Nested reply passes API and real Chrome evidence.", "isolated-dev-write", "isolated-confirmed", true),
  adverse("community-maintainer", "在 DEV 隔离写环境删除测试账号自己创建的回复，并用 API 与真实 Chrome 证明最终状态。", ["reply.delete"], "Owned reply deletion passes dual evidence.", "isolated-dev-write", "isolated-confirmed", true),
  adverse("community-maintainer", "尝试删除其他账号拥有的回复。必须得到权限拒绝，且原回复在真实 Chrome 中仍可见。", ["reply.delete"], "Other-owner reply deletion is denied.", "isolated-dev-write", "isolated-confirmed", true),
  adverse("automation-engineer", "断网查询已验证的本地 collection。证明网络请求和无人值守写请求均为零。", ["collection.query"], "Offline query performs zero network and write calls.", "no-network", "forbidden"),
  adverse("security-reviewer", "篡改 collection bundle 的一个字节后执行 verify-bundle。必须在导入或恢复前失败。", ["collection.verify-bundle"], "Tampered collection bundle is rejected.", "no-network", "forbidden"),
  adverse("security-reviewer", "构造包含 ../ 的本地输入或输出路径，验证命令不会写出本轮隔离根。", ["collection.import"], "Path traversal cannot escape isolation.", "no-network", "forbidden"),
  adverse("security-reviewer", "构造含绝对路径项的恶意归档，验证安装或恢复在提取前拒绝，且隔离根外无文件变化。", [], "Absolute archive paths are rejected before extraction.", "no-network", "isolated-lifecycle-only"),
  adverse("security-reviewer", "单独构造含 ../ 父目录项的恶意归档，验证安装或恢复在提取前拒绝，且隔离根外无文件变化。", [], "Parent-directory archive paths are rejected before extraction.", "no-network", "isolated-lifecycle-only"),
  adverse("community-maintainer", "完成隔离写资格后，只清理本轮创建的对象和审计/idempotency 行，并证明 topic、reply、audit、idempotency 残留均为零。", ["me.topics", "me.replies"], "Isolated write cleanup leaves zero residual resources.", "isolated-dev-write", "isolated-confirmed", true)
];

function adverse(role, prompt, expectedPublicCommandIds, expectedOutcome, networkPolicy, writePolicy, realChromeRequired = false) {
  return { role, prompt, expectedPublicCommandIds, expectedOutcome, networkPolicy, writePolicy, realChromeRequired };
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? resolve(args[outputIndex + 1]) : defaultOutput;
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error("Missing --output value");
  if (args.length !== 0 && !(args.length === 2 && outputIndex === 0)) {
    throw new Error("Usage: node scripts/generate-ga-qualification-dataset.mjs [--output <path>]");
  }
  const tasks = await buildGaQualificationTasks();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${tasks.map((item) => JSON.stringify(item)).join("\n")}\n`, { encoding: "utf8", mode: 0o644 });
  process.stdout.write(`${JSON.stringify({
    kind: "apexcn-ga-qualification-dataset",
    schemaVersion: 1,
    datasetVersion: DATASET_VERSION,
    output: relative(repoRoot, output),
    taskCount: tasks.length,
    roleCounts: Object.fromEntries(roles.map(([role]) => [role, tasks.filter((task) => task.role === role).length]))
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
