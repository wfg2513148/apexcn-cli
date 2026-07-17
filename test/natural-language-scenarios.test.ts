import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

type ManifestCommand = {
  path: string;
  aliases: string[];
  options: string[];
  safety: {
    effects: string[];
    preview: "required" | "available" | "none";
    confirmation: string[];
  };
  examples: Array<{ command: string; mode: "read" | "preview" | "execute" }>;
};

type Scenario = {
  name: string;
  userSays: string;
  commandPath: string;
  mode: "read" | "preview" | "execute";
  expectedEffects: string[];
  expectedPreview: "required" | "available" | "none";
  requiredOptions?: string[];
  requiredConfirmations?: string[];
};

type CliFeedback = {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  fetch: ReturnType<typeof vi.fn>;
  tmpDir: string;
  configPath: string;
};

type ExecutableNaturalLanguageScenario = {
  name: string;
  userSays: string;
  commandPath: string;
  argv: string[] | ((context: ScenarioRuntime) => string[] | Promise<string[]>);
  configureAuth?: boolean;
  prepare?: (context: ScenarioRuntime) => Promise<void>;
  responseForUrl?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  assertFeedback: (feedback: CliFeedback) => void | Promise<void>;
};

type ScenarioRuntime = {
  tmpDir: string;
  configPath: string;
  program: ReturnType<typeof createProgram>;
  stdout: string[];
  stderr: string[];
  fetch: ReturnType<typeof vi.fn>;
  readStdin?: () => Promise<string>;
};

const GOOD_TOPIC_CONTENT = [
  "# APEX REST API returns 403",
  "",
  "## 问题",
  "",
  "页面进程调用 REST API 时返回 403，需要确认认证配置。",
  "",
  "## 环境",
  "",
  "APEX 24.1 / ORDS 24 / Autonomous Database。",
  "",
  "## 已尝试",
  "",
  "确认 URL 能访问，也检查过 Web Credential 名称。",
  "",
  "## 期望结果",
  "",
  "页面进程能返回 JSON 数据。",
  "",
  "## 实际结果",
  "",
  "调用时返回 403。"
].join("\n");

const GOOD_REPLY_CONTENT = [
  "## 简短回应",
  "",
  "这个 403 更像是认证或 Web Credential 配置问题，可以先确认 ORDS URL 和凭据映射。",
  "",
  "## 建议步骤",
  "",
  "1. 在 APEX 中确认 Web Credential 名称。",
  "2. 用同一个 URL 单独测试接口权限。"
].join("\n");

const commonReadScenarios: Scenario[] = [
  scenario("check current account", "检查 apexcn-cli 当前登录的是谁，不要输出 API key", "me", "read", ["read"], "none", ["--json"]),
  scenario("show active auth profile", "看看当前认证 profile 和 base url，token 只显示脱敏结果", "auth show", "read", ["config-read"], "none", ["--json"]),
  scenario("audit auth configuration", "帮我检查本地 apexcn-cli 认证配置有没有问题", "auth audit", "read", ["config-read"], "none", ["--json"]),
  scenario("list auth profiles", "列出本机配置过的 apexcn-cli profiles", "auth list", "read", ["config-read"], "none", ["--json"]),
  scenario("doctor full check", "检查 apexcn-cli 安装、认证和社区 API 是否正常", "doctor", "read", ["diagnostic"], "none", ["--json"]),
  scenario("doctor with ask check", "诊断 apexcn-cli，并顺便检查 RAG 问答接口能不能回答 REST API 问题", "doctor", "read", ["diagnostic"], "none", ["--check-ask <question>", "--json"]),
  scenario("doctor snapshot for support", "生成一份可发给支持人员的诊断快照，不要泄露 token", "doctor snapshot", "read", ["diagnostic", "config-read"], "none", ["--json"]),
  scenario("list categories", "列出 APEX 中文社区所有板块", "category list", "read", ["read"], "none", ["--json"]),
  scenario("category stats", "统计 APEX 中文社区各板块的话题数和回复数", "stats category", "read", ["read"], "none", ["--json"]),
  scenario("topic stats", "查看社区全局话题统计和标签分布", "stats topic", "read", ["read"], "none", ["--json"]),
  scenario("topic stats by tag", "统计 ORDS 这个标签下有多少话题", "stats topic", "read", ["read"], "none", ["--tag <tag>", "--json"]),
  scenario("tag stats", "列出社区标签使用次数", "stats tag", "read", ["read"], "none", ["--json"]),
  scenario("admin list", "查看 APEX 中文社区管理员公开列表", "admin list", "read", ["read"], "none", ["--json"]),
  scenario("my stats", "统计我在社区发了多少帖子、回复、收藏和订阅", "me stats", "read", ["read"], "none", ["--json"]),
  scenario("my topics", "列出我发布过的社区帖子", "me topics", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("my replies", "列出我最近的社区回复", "me replies", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("my favorites", "查看我收藏过的话题", "me favorites", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("my subscriptions", "查看我订阅的话题列表", "me subscriptions", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("search rest api", "在 APEX 中文社区搜索 REST API 相关帖子", "search", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("search ords auth", "查找 ORDS 认证失败相关讨论", "search", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("search json table", "搜一下 JSON_TABLE 的新手示例", "search", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("search apexlang", "apexlang 有哪些新文章", "search", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("search by category", "只在进阶技巧板块里搜索性能优化", "search", "read", ["read"], "none", ["--category-id <id>", "--json"]),
  scenario("search by date window", "搜索 2026-06-01 到 2026-06-30 之间更新的 AI 相关文章", "search", "read", ["read"], "none", ["--from-date <date>", "--to-date <date>", "--json"]),
  scenario("search by v040 filters", "搜索 ORDS 标签下来自外部来源且有有用回复的帖子", "search", "read", ["read"], "none", ["--tag <tag>", "--source-type <type>", "--has-useful-reply", "--json"]),
  scenario("search smaller page", "先搜前 3 条 APEX 安全相关帖子", "search", "read", ["read"], "none", ["--page-size <n>", "--json"]),
  scenario("search text output", "把搜索 APEX 的结果用纯文本列出来", "search", "read", ["read"], "none", ["--format <format>"]),
  scenario("search beginner category", "在新手入门板块查安装环境搭建问题", "search", "read", ["read"], "none", ["--category-id <id>", "--json"]),
  scenario("search feedback category", "在建议反馈板块查有没有 API key 相关建议", "search", "read", ["read"], "none", ["--category-id <id>", "--json"]),
  scenario("search plugin keyword", "找一下社区里关于插件开发的帖子", "search", "read", ["read"], "none", ["--json"]),
  scenario("search security keyword", "查一下 APEX 安全配置的社区讨论", "search", "read", ["read"], "none", ["--json"]),
  scenario("ask rest api", "Oracle APEX 如何调用 REST API？请基于社区内容回答", "ask", "read", ["read"], "none", ["--top-k <n>", "--json"]),
  scenario("ask ords 401", "ORDS 返回 401 通常怎么排查？", "ask", "read", ["read"], "none", ["--top-k <n>", "--json"]),
  scenario("ask apexlang single page", "APEXLang 支持单页面导入吗？", "ask", "read", ["read"], "none", ["--top-k <n>", "--json"]),
  scenario("ask interactive report", "APEX 26.1 交互式报表有哪些新 JavaScript API？", "ask", "read", ["read"], "none", ["--top-k <n>", "--json"]),
  scenario("ask blueprint", "APEX 蓝图脚手架适合什么场景？", "ask", "read", ["read"], "none", ["--top-k <n>", "--json"]),
  scenario("ask filtered ords", "只基于 7 月 ORDS 标签内容回答最近 API 更新", "ask", "read", ["read"], "none", ["--tag <tag>", "--from <date>", "--to <date>", "--json"]),
  scenario("ask short answer", "用社区资料简短回答 APEX 如何做邮件发送", "ask", "read", ["read"], "none", ["--format <format>"]),
  scenario("topic view by id", "打开社区帖子 30549 并总结内容", "topic view", "read", ["read"], "none", ["--json"]),
  scenario("thread view alias intent", "查看 thread 30549 的详情", "topic view", "read", ["read"], "none", ["--json"]),
  scenario("topic view apexlang article", "查看 ApexLang 文件结构解析那篇帖子", "topic view", "read", ["read"], "none", ["--json"]),
  scenario("topic view replies", "查看某个帖子以及下面的回复", "topic view", "read", ["read"], "none", ["--json"]),
  scenario("topic list unanswered", "列出社区里还没有回复的最新话题", "topic list", "read", ["read"], "none", ["--view <view>", "--page-size <n>", "--json"]),
  scenario("topic recent 48 hours", "总结最近 48 小时更新的社区帖子", "topic recent", "read", ["read"], "none", ["--since-hours <n>", "--page-size <n>", "--cursor <cursor>", "--json"]),
  scenario("research rest api", "帮我研究 REST API 相关帖子并整理参考链接", "research", "read", ["read"], "none", ["--limit <n>", "--json"]),
  scenario("research apexlang", "整理 ApexLang 最新文章都更新了什么", "research", "read", ["read"], "none", ["--limit <n>", "--json"]),
  scenario("research ords", "研究 ORDS 部署问题，最多取 5 篇帖子", "research", "read", ["read"], "none", ["--limit <n>", "--json"]),
  scenario("research by category", "只研究进阶技巧板块里的性能优化资料", "research", "read", ["read"], "none", ["--category-id <id>", "--json"]),
  scenario("research by date", "研究 6 月份发布或更新的 APEXLang 内容", "research", "read", ["read"], "none", ["--from-date <date>", "--to-date <date>", "--json"]),
  scenario("research text output", "把 REST API 研究结果输出成文本", "research", "read", ["read"], "none", ["--format <format>"]),
  scenario("commands manifest", "告诉我 apexcn-cli 当前支持哪些命令和安全分类", "commands", "read", ["manifest"], "none", ["--json"]),
  scenario("collection build from query", "把 REST API 搜索结果做成本地知识合集", "collection build", "read", ["read"], "none", ["--query <keyword>", "--output-dir <dir>", "--json"]),
  scenario("collection build multiple topics", "把帖子 30549 和 30752 做成离线知识合集", "collection build", "read", ["read"], "none", ["--topic-id <id>", "--output-dir <dir>", "--json"]),
  scenario("collection build query and category", "按 ORDS 关键词和新手入门板块构建知识合集", "collection build", "read", ["read"], "none", ["--query <keyword>", "--category-id <id>", "--json"]),
  scenario("collection build date range", "构建 6 月份 APEXLang 相关文章合集", "collection build", "read", ["read"], "none", ["--from-date <date>", "--to-date <date>", "--json"]),
  scenario("collection index", "给这个本地知识合集建立离线检索索引", "collection index", "read", ["read"], "none", ["--dir <dir>", "--json"]),
  scenario("collection query", "在本地知识合集里搜索 ORDS 401", "collection query", "read", ["read"], "none", ["--dir <dir>", "--top-k <n>", "--explain", "--json"]),
  scenario("collection stats", "查看本地知识合集索引统计信息", "collection stats", "read", ["read"], "none", ["--dir <dir>", "--json"]),
  scenario("collection verify", "验证这个本地知识合集是否完整可用", "collection verify", "read", ["read"], "none", ["--dir <dir>", "--json"]),
  scenario("mcp tools", "列出 apexcn-cli 暴露给 AI Agent 的 MCP 工具", "mcp tools", "read", ["manifest"], "none", ["--json"]),
  scenario("mcp inspect", "检查 apexcn-cli MCP 默认是否只读", "mcp inspect", "read", ["manifest"], "none", ["--json"]),
  scenario("mcp serve", "以只读模式启动 apexcn-cli 本地 MCP 服务", "mcp serve", "read", ["manifest"], "none", ["--readonly"]),
  scenario("me verbose", "显示当前社区账号的详细信息", "me", "read", ["read"], "none", ["--verbose", "--json"])
];

const draftAndReviewScenarios: Scenario[] = [
  scenario("draft question rest 401", "我遇到 APEX 调 REST API 返回 401，先帮我起草提问，不要发布", "draft question", "read", ["read"], "none", ["--title <title>", "--problem <text>", "--format <format>"]),
  scenario("draft question with environment", "根据我的环境信息起草一个 APEX 安装失败问题", "draft question", "read", ["read"], "none", ["--environment <text>", "--problem <text>", "--format <format>"]),
  scenario("draft question with tried", "把我已经尝试过的排查步骤写进提问草稿", "draft question", "read", ["read"], "none", ["--tried <text>", "--format <format>"]),
  scenario("draft question with expected actual", "起草问题时写清楚期望结果和实际结果", "draft question", "read", ["read"], "none", ["--expected <text>", "--actual <text>", "--format <format>"]),
  scenario("draft question from research", "根据 research.json 里的资料起草提问帖", "draft question", "read", ["read"], "none", ["--research-file <path>", "--format <format>"]),
  scenario("draft question json", "用 JSON 输出提问草稿，方便后续 workflow 使用", "draft question", "read", ["read"], "none", ["--json"]),
  scenario("draft reply simple", "帮我给帖子 30549 起草一条友好回复，先不要发布", "draft reply", "read", ["read"], "none", ["--topic-id <id>", "--answer <text>", "--format <format>"]),
  scenario("draft reply with parent", "针对某个楼层回复起草内容", "draft reply", "read", ["read"], "none", ["--parent-post-id <id>", "--answer <text>"]),
  scenario("draft reply with topic file", "基于 topic.json 的上下文起草回复", "draft reply", "read", ["read"], "none", ["--topic-file <path>", "--answer <text>"]),
  scenario("draft reply with research file", "结合研究资料给帖子起草回复", "draft reply", "read", ["read"], "none", ["--research-file <path>", "--answer <text>"]),
  scenario("draft reply tone", "用更温和的语气起草回复", "draft reply", "read", ["read"], "none", ["--tone <tone>", "--format <format>"]),
  scenario("review topic markdown", "发布前检查这篇 Markdown 提问帖有没有占位符或敏感信息", "review topic", "read", ["read"], "none", ["--content-file <path>", "--json"]),
  scenario("review topic with category", "检查提问帖并确认板块 id 合理", "review topic", "read", ["read"], "none", ["--category-id <id>", "--json"]),
  scenario("review topic with tags", "发布前检查标题、正文和标签", "review topic", "read", ["read"], "none", ["--title <title>", "--tags <csv>", "--json"]),
  scenario("review topic from draft", "检查 draft question 输出的 JSON 草稿", "review topic", "read", ["read"], "none", ["--draft-file <path>", "--json"]),
  scenario("review reply markdown", "发布回复前检查内容是否太空泛", "review reply", "read", ["read"], "none", ["--topic-id <id>", "--content-file <path>", "--json"]),
  scenario("review reply with parent", "检查针对某层回复的草稿是否目标正确", "review reply", "read", ["read"], "none", ["--parent-post-id <id>", "--json"]),
  scenario("review reply from draft", "检查 draft reply 生成的 JSON 草稿", "review reply", "read", ["read"], "none", ["--draft-file <path>", "--json"]),
  scenario("review reply text output", "用文本方式显示回复审查结果", "review reply", "read", ["read"], "none", ["--format <format>"]),
  scenario("review topic text output", "用文本方式显示发帖审查结果", "review topic", "read", ["read"], "none", ["--format <format>"])
];

const workflowScenarios: Scenario[] = [
  scenario("workflow plan ask question", "规划一次先搜索再起草提问的流程，不要执行发布", "workflow plan", "read", ["read"], "none", ["--goal <goal>", "--keyword <keyword>", "--json"]),
  scenario("workflow plan reply", "规划一次回帖流程，只生成步骤", "workflow plan", "read", ["read"], "none", ["--goal <goal>", "--topic-id <id>", "--answer <text>"]),
  scenario("workflow plan research only", "只规划研究资料的流程", "workflow plan", "read", ["read"], "none", ["--goal <goal>", "--keyword <keyword>"]),
  scenario("workflow plan publish topic", "规划发布已有 Markdown 的帖子流程", "workflow plan", "read", ["read"], "none", ["--content-file <path>", "--category-id <id>", "--title <title>"]),
  scenario("workflow plan include execute", "规划流程时也把最终执行步骤列出来但不执行", "workflow plan", "read", ["read"], "none", ["--include-execute"]),
  scenario("workflow run ask preview", "运行一个可恢复的提问 workflow，只生成预览和本地 artifacts", "workflow run", "preview", ["read", "api-write"], "required", ["--goal <goal>", "--output-dir <path>", "--json"]),
  scenario("workflow run reply preview", "运行一个回帖 workflow，只到 preview，不发布", "workflow run", "preview", ["read", "api-write"], "required", ["--goal <goal>", "--topic-id <id>", "--answer <text>"]),
  scenario("workflow approve", "我已看过 workflow preview，记录批准 artifact", "workflow approve", "read", ["read"], "none", ["--run-dir <run-dir>", "--json"]),
  scenario("workflow approve with note", "批准 workflow preview 并写一条审核备注", "workflow approve", "read", ["read"], "none", ["--approved-by <name>", "--note <text>"]),
  scenario("workflow policy init", "生成一份 workflow policy 模板", "workflow policy init", "read", ["read"], "none", ["--output <file>", "--json"]),
  scenario("workflow verify", "验证 workflow run 目录里的证据和 approval hash", "workflow verify", "read", ["read"], "none", ["--run-dir <run-dir>", "--json"]),
  scenario("workflow verify with policy", "按 workflow policy 验证 run 目录", "workflow verify", "read", ["read"], "none", ["--policy <file>", "--json"]),
  scenario("workflow verify write report", "验证 workflow 并写出 verification.json", "workflow verify", "read", ["read"], "none", ["--write-report", "--json"]),
  scenario("workflow diff", "对比 workflow preview 和 approval 绑定请求", "workflow diff", "read", ["read"], "none", ["--run-dir <run-dir>", "--json"]),
  scenario("workflow audit log", "导出 workflow 审计日志 NDJSON", "workflow audit-log", "read", ["read"], "none", ["--run-dir <run-dir>", "--format <format>"]),
  scenario("workflow export", "把 workflow 证据导出成单文件归档", "workflow export", "read", ["read"], "none", ["--run-dir <run-dir>", "--output <file>", "--json"]),
  scenario("workflow export allow invalid", "即使 workflow 校验不完整也导出证据包", "workflow export", "read", ["read"], "none", ["--allow-invalid", "--json"]),
  scenario("workflow verify bundle", "验证别人发来的 workflow bundle", "workflow verify-bundle", "read", ["read"], "none", ["--bundle <file>", "--json"]),
  scenario("workflow execute approved", "执行已经批准过的 workflow 最终发布步骤", "workflow run", "execute", ["read", "api-write"], "required", ["--resume <run-dir>", "--execute", "--yes", "--json"], ["--execute", "--yes"])
];

const writePreviewScenarios: Scenario[] = [
  scenario("preview topic create", "把确认前的发帖请求预览出来，不要发布", "topic create", "preview", ["api-write"], "available", ["--category-id <id>", "--title <title>", "--content-file <path>", "--preview"]),
  scenario("preview topic create stdin", "通过 stdin 传正文预览发帖请求", "topic create", "preview", ["api-write"], "available", ["--content-file <path>", "--preview"]),
  scenario("preview topic create tags", "预览带标签的新帖请求", "topic create", "preview", ["api-write"], "available", ["--tags <csv>", "--preview"]),
  scenario("preview topic update content", "预览编辑帖子正文，不要提交", "topic update", "preview", ["api-write"], "available", ["--content-file <path>", "--preview"]),
  scenario("preview topic edit alias", "预览修改帖子标题和板块", "topic update", "preview", ["api-write"], "available", ["--title <title>", "--category-id <id>", "--preview"]),
  scenario("preview thread update alias intent", "用户说编辑 thread 时应走 topic update 能力", "topic update", "preview", ["api-write"], "available", ["--preview"]),
  scenario("preview reply create", "预览给帖子 30549 的回复，不要发布", "reply create", "preview", ["api-write"], "available", ["--content <text>", "--preview"]),
  scenario("preview reply create file", "预览用 Markdown 文件创建回复", "reply create", "preview", ["api-write"], "available", ["--content-file <path>", "--preview"]),
  scenario("preview child reply", "预览针对某层楼的回复", "reply create", "preview", ["api-write"], "available", ["--parent-post-id <id>", "--preview"]),
  scenario("preview reply update", "预览更新已有回复", "reply update", "preview", ["api-write"], "available", ["--content-file <path>", "--preview"]),
  scenario("preview post update alias intent", "用户说编辑 post 时应走 reply update 能力", "reply update", "preview", ["api-write"], "available", ["--preview"]),
  scenario("preview favorite add", "预览收藏帖子请求", "favorite add", "preview", ["api-write"], "available", ["--preview"]),
  scenario("preview favorite remove", "预览取消收藏帖子请求", "favorite remove", "preview", ["api-write"], "available", ["--preview"]),
  scenario("preview subscription add", "预览订阅帖子请求", "subscription add", "preview", ["api-write"], "available", ["--preview"]),
  scenario("preview subscription remove", "预览取消订阅帖子请求", "subscription remove", "preview", ["api-write"], "available", ["--preview"]),
  scenario("preview topic delete", "删除帖子前先预览请求并确认精确标题", "topic delete", "preview", ["api-write", "destructive"], "required", ["--yes", "--force", "--confirm-title <title>", "--preview"], ["--yes", "--force", "--confirm-title"]),
  scenario("preview thread delete alias intent", "删除 thread 前需要强确认", "topic delete", "preview", ["api-write", "destructive"], "required", ["--yes", "--force", "--confirm-title <title>"], ["--yes", "--force", "--confirm-title"]),
  scenario("preview reply delete", "删除回复前先预览请求", "reply delete", "preview", ["api-write", "destructive"], "required", ["--yes", "--force", "--preview"], ["--yes", "--force"]),
  scenario("preview post delete alias intent", "删除 post 前需要 yes 和 force", "reply delete", "preview", ["api-write", "destructive"], "required", ["--yes", "--force"], ["--yes", "--force"]),
  scenario("dry run topic create", "用 dry-run 检查创建帖子请求体", "topic create", "preview", ["api-write"], "available", ["--dry-run"]),
  scenario("dry run reply create", "用 dry-run 检查回复请求体", "reply create", "preview", ["api-write"], "available", ["--dry-run"])
];

const writeExecuteScenarios: Scenario[] = [
  scenario("execute topic create after approval", "我确认了，发布这个新帖子", "topic create", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute topic update after approval", "我确认了，提交帖子编辑", "topic update", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute reply create after approval", "我确认了，发布这条回复", "reply create", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute reply update after approval", "我确认了，更新这条回复", "reply update", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute favorite add", "帮我收藏帖子 30549", "favorite add", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute favorite remove", "帮我取消收藏帖子 30549", "favorite remove", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute subscription add", "帮我订阅帖子 30549", "subscription add", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute subscription remove", "帮我取消订阅帖子 30549", "subscription remove", "execute", ["api-write"], "available", ["--json"]),
  scenario("execute topic delete confirmed", "确认删除这个帖子，标题完全匹配", "topic delete", "execute", ["api-write", "destructive"], "required", ["--yes", "--force", "--confirm-title <title>", "--json"], ["--yes", "--force", "--confirm-title"]),
  scenario("execute reply delete confirmed", "确认删除这条回复", "reply delete", "execute", ["api-write", "destructive"], "required", ["--yes", "--force", "--json"], ["--yes", "--force"])
];

const authWriteScenarios: Scenario[] = [
  scenario("set token first install", "配置我的 APEX 中文社区 API key", "auth set-token", "execute", ["config-write", "auth", "secret"], "none", ["--token <token>", "--base-url <url>", "--profile <profile>"]),
  scenario("set token no switch", "新增一个备用 profile 但不要切换当前 profile", "auth set-token", "execute", ["config-write", "auth", "secret"], "none", ["--no-switch"]),
  scenario("switch profile", "切换到 agent-prod profile", "auth use", "execute", ["config-write", "auth"], "none"),
  scenario("remove old profile", "删除一个旧的 apexcn-cli profile", "auth remove", "execute", ["config-write", "auth"], "none"),
  scenario("logout current profile", "退出当前 apexcn-cli 登录状态", "auth logout", "execute", ["config-write", "auth"], "none")
];

const COMMON_NATURAL_LANGUAGE_SCENARIOS = [
  ...commonReadScenarios,
  ...draftAndReviewScenarios,
  ...workflowScenarios,
  ...writePreviewScenarios,
  ...writeExecuteScenarios,
  ...authWriteScenarios
];

const EXECUTABLE_NATURAL_LANGUAGE_SCENARIOS: ExecutableNaturalLanguageScenario[] = [
  {
    name: "search ApexLang with spaced product name",
    userSays: "APEX Lang 有哪些文章？",
    commandPath: "search",
    argv: ["node", "apexcn", "search", "APEX Lang", "--json"],
    responseForUrl: (url) => {
      expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/search?keyword=ApexLang");
      return Response.json({ items: [{ id: 42, title: "ApexLang topic" }], requestId: "req-search" });
    },
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).query).toEqual({ keyword: "APEX Lang", normalizedKeyword: "ApexLang" });
    }
  },
  {
    name: "pagination request fetches next page",
    userSays: "继续看下一页 ApexLang 搜索结果。",
    commandPath: "search",
    argv: ["node", "apexcn", "search", "ApexLang", "--page-size", "5", "--cursor", "cursor-2", "--json"],
    responseForUrl: (url) => {
      expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/search?keyword=ApexLang&pageSize=5&cursor=cursor-2");
      return Response.json({ items: [{ id: 43, title: "ApexLang page 2", createdDate: "2026-07-01", updatedDate: "2026-07-02" }], page: { hasMore: false }, requestId: "req-search" });
    },
    assertFeedback: ({ stdout, stderr, exitCode, fetch }) => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ id: 43, createdDate: "2026-07-01", updatedDate: "2026-07-02" }));
      expect(exitCode).toBeUndefined();
    }
  },
  {
    name: "write preview preserves preview mode",
    userSays: "先预览收藏帖子，不要真的收藏。",
    commandPath: "favorite add",
    argv: ["node", "apexcn", "favorite", "add", "30752", "--preview", "--json"],
    responseForUrl: () => Response.json({ ok: true }),
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).not.toHaveBeenCalled();
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expect.objectContaining({
        dryRun: true,
        preview: true,
        mode: "preview",
        path: "/api/v1/topics/30752/favorite"
      }));
    }
  },
  {
    name: "ask returns clickable source URL",
    userSays: "APEXLang 支持单页面导入吗？请给可点击来源。",
    commandPath: "ask",
    argv: ["node", "apexcn", "ask", "APEXLang 支持单页面导入吗？", "--top-k", "1", "--json"],
    responseForUrl: (url, init) => {
      expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/ask");
      expect(init?.body).toBe(JSON.stringify({ question: "APEXLang 支持单页面导入吗？", topK: 1 }));
      return Response.json({
        answer: "支持。",
        sources: [{ card_link: "f?p=100:14:::::P14_THREAD_ID:29667" }],
        requestId: "req-ask"
      });
    },
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).sources[0]).toEqual(expect.objectContaining({
        url: "https://oracleapex.cn/t/29667",
        threadUrl: "https://oracleapex.cn/t/29667"
      }));
    }
  },
  {
    name: "filtered ask sends scoped retrieval filters",
    userSays: "只基于 7 月 ORDS 标签内容回答最近 API 更新。",
    commandPath: "ask",
    argv: ["node", "apexcn", "ask", "最近 ORDS API 有哪些更新?", "--tag", "ORDS", "--from", "2026-07-01", "--to", "2026-07-05", "--top-k", "5", "--json"],
    responseForUrl: (url, init) => {
      expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/ask");
      expect(init?.body).toBe(JSON.stringify({
        question: "最近 ORDS API 有哪些更新?",
        topK: 5,
        fromDate: "2026-07-01",
        toDate: "2026-07-05",
        tag: "ORDS"
      }));
      return Response.json({
        answer: "有 scoped references。",
        filters: { fromDate: "2026-07-01", toDate: "2026-07-05", tag: "ORDS" },
        confidence: "medium",
        limitations: ["filtered retrieval"],
        references: [{ topicId: 42 }],
        requestId: "req-filtered-ask"
      });
    },
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expect.objectContaining({
        confidence: "medium",
        filters: { fromDate: "2026-07-01", toDate: "2026-07-05", tag: "ORDS" }
      }));
    }
  },
  {
    name: "research deduplicates links and keeps dates",
    userSays: "整理 APEX Lang 文章，不要重复来源。",
    commandPath: "research",
    argv: ["node", "apexcn", "research", "APEX Lang", "--limit", "1", "--json"],
    responseForUrl: (url) => {
      if (url.includes("/api/v1/search")) {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/search?keyword=ApexLang&pageSize=1");
        return Response.json({
          items: [{ id: 42, title: "ApexLang", url: "https://oracleapex.cn/t/42", updatedDate: "2026-06-02" }],
          requestId: "req-search"
        });
      }
      expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/topics/42");
      return Response.json({
        topic: {
          id: 42,
          title: "ApexLang",
          url: "https://oracleapex.cn/t/42",
          originalUrl: "https://oracleapex.cn/original/42",
          createdDate: "2026-06-01",
          content: "ApexLang content."
        },
        requestId: "req-topic"
      });
    },
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(stderr).toBe("");
      const data = JSON.parse(stdout);
      expect(data.query).toEqual({ keyword: "APEX Lang", normalizedKeyword: "ApexLang", limit: 1 });
      expect(data.links).toEqual([
        expect.objectContaining({
          id: 42,
          url: "https://oracleapex.cn/t/42",
          originalUrl: "https://oracleapex.cn/original/42",
          createdDate: "2026-06-01",
          updatedDate: "2026-06-02"
        })
      ]);
    }
  },
  {
    name: "topic recent summarizes last 48 hours",
    userSays: "总结最近 48 小时的帖子。",
    commandPath: "topic recent",
    prepare: () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-04T08:27:20Z"));
    },
    argv: ["node", "apexcn", "topic", "recent", "--since-hours", "48", "--page-size", "5", "--json"],
    responseForUrl: (url) => {
      if (url.includes("/api/v1/topics")) {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/topics?pageSize=5&fromDate=2026-07-02");
        return Response.json({
          items: [{
            id: 42,
            title: "ORDS MCP",
            createdDate: "2026-07-02T16:39:24",
            updatedDate: "2026-07-04T06:00:00",
            originalUrl: "https://example.com/ords-mcp",
            url: "https://oracleapex.cn/t/42"
          }],
          page: { limit: 5, count: 1, hasMore: false },
          requestId: "req-topics"
        });
      }
      return Response.json({ error: { message: `unexpected url ${url}` } }, { status: 500 });
    },
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(stderr).toBe("");
      const data = JSON.parse(stdout);
      expect(data.kind).toBe("topic-recent");
      expect(data.items).toEqual([
        expect.objectContaining({
          id: 42,
          title: "ORDS MCP",
          createdDate: "2026-07-02T16:39:24",
          updatedDate: "2026-07-04T06:00:00",
          originalUrl: "https://example.com/ords-mcp"
        })
      ]);
    }
  },
  ...executableCommandCoverageScenarios()
];

function executableCommandCoverageScenarios(): ExecutableNaturalLanguageScenario[] {
  return [
    {
      name: "auth set-token stores a profile",
      userSays: "配置我的 APEX 中文社区 API key。",
      commandPath: "auth set-token",
      configureAuth: false,
      argv: ["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "agent-prod"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(stdout).toBe("Saved profile agent-prod\n");
      }
    },
    {
      name: "auth list prints configured profiles",
      userSays: "列出本机配置过的 apexcn-cli profiles。",
      commandPath: "auth list",
      argv: ["node", "apexcn", "auth", "list", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ current: "test@oci" }));
      }
    },
    {
      name: "auth audit checks local config",
      userSays: "帮我检查本地 apexcn-cli 认证配置有没有问题。",
      commandPath: "auth audit",
      argv: ["node", "apexcn", "auth", "audit", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "auth-audit", ok: true }));
      }
    },
    {
      name: "auth show redacts token",
      userSays: "看看当前认证 profile 和 base url，token 只显示脱敏结果。",
      commandPath: "auth show",
      argv: ["node", "apexcn", "auth", "show", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ profile: "test@oci", token: "abcd...wxyz" }));
      }
    },
    {
      name: "auth use switches profile",
      userSays: "切换到 test@oci profile。",
      commandPath: "auth use",
      argv: ["node", "apexcn", "auth", "use", "test@oci"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(stdout).toBe("Using profile test@oci\n");
      }
    },
    {
      name: "auth remove deletes profile",
      userSays: "删除一个旧的 apexcn-cli profile。",
      commandPath: "auth remove",
      argv: ["node", "apexcn", "auth", "remove", "test@oci"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(stdout).toBe("Removed profile test@oci\n");
      }
    },
    {
      name: "auth logout clears current profile",
      userSays: "退出当前 apexcn-cli 登录状态。",
      commandPath: "auth logout",
      argv: ["node", "apexcn", "auth", "logout"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(stdout).toBe("Logged out\n");
      }
    },
    {
      name: "commands manifest is parseable",
      userSays: "告诉我 apexcn-cli 当前支持哪些命令和安全分类。",
      commandPath: "commands",
      configureAuth: false,
      argv: ["node", "apexcn", "commands", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).commands.length).toBeGreaterThanOrEqual(38);
      }
    },
    {
      name: "doctor runs authenticated checks",
      userSays: "检查 apexcn-cli 安装、认证和社区 API 是否正常。",
      commandPath: "doctor",
      argv: ["node", "apexcn", "doctor", "--json"],
      responseForUrl: doctorFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ ok: true }));
      }
    },
    {
      name: "doctor snapshot is local",
      userSays: "生成一份可发给支持人员的诊断快照，不要泄露 token。",
      commandPath: "doctor snapshot",
      argv: ["node", "apexcn", "doctor", "snapshot", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "doctor-snapshot" }));
      }
    },
    {
      name: "me reads current account",
      userSays: "检查当前 apexcn-cli 当前登录的是谁，不要输出 API key。",
      commandPath: "me",
      argv: ["node", "apexcn", "me", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/me");
        return Response.json({ user: { id: 1, nickname: "Tester" }, requestId: "req-me" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).user.nickname).toBe("Tester");
      }
    },
    {
      name: "category list reads categories",
      userSays: "列出 APEX 中文社区所有板块。",
      commandPath: "category list",
      argv: ["node", "apexcn", "category", "list", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/categories");
        return Response.json({ items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0].id).toBe(4);
      }
    },
    {
      name: "stats category reads aggregate category counts",
      userSays: "统计 APEX 中文社区各板块的话题数和回复数。",
      commandPath: "stats category",
      argv: ["node", "apexcn", "stats", "category", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/category-stats");
        return Response.json({ kind: "category-stats", items: [{ id: 4, name: "APEX 进阶技巧", topicCount: 12, replyCount: 34 }], requestId: "req-category-stats" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "category-stats" }));
      }
    },
    {
      name: "stats topic reads global topic counts",
      userSays: "查看社区全局话题统计和标签分布。",
      commandPath: "stats topic",
      argv: ["node", "apexcn", "stats", "topic", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/topic-stats");
        return Response.json({ kind: "topic-stats", topicCount: 1479, replyCount: 3200, tagCounts: [{ tag: "ORDS", topicCount: 9 }], requestId: "req-topic-stats" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "topic-stats", topicCount: 1479 }));
      }
    },
    {
      name: "stats tag reads tag distribution",
      userSays: "列出社区标签使用次数。",
      commandPath: "stats tag",
      argv: ["node", "apexcn", "stats", "tag", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/tag-stats");
        return Response.json({ kind: "tag-stats", items: [{ tag: "ORDS", topicCount: 9, matchMode: "exact" }], requestId: "req-tag-stats" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ tag: "ORDS", topicCount: 9 }));
      }
    },
    {
      name: "admin list reads public admin directory",
      userSays: "查看 APEX 中文社区管理员公开列表。",
      commandPath: "admin list",
      argv: ["node", "apexcn", "admin", "list", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/admin-list");
        return Response.json({ kind: "admin-list", items: [{ id: 1, nickname: "Admin", roleName: "管理员", roleLevel: 10, publicContacts: ["apex@example.com"] }], requestId: "req-admin-list" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ nickname: "Admin", roleName: "管理员" }));
      }
    },
    {
      name: "me stats reads personal aggregate counts",
      userSays: "统计我在社区发了多少帖子、回复、收藏和订阅。",
      commandPath: "me stats",
      argv: ["node", "apexcn", "me", "stats", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/me/stats");
        return Response.json({ kind: "me-stats", topicCount: 3, replyCount: 8, favoriteCount: 2, subscriptionCount: 4, requestId: "req-me-stats" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "me-stats", topicCount: 3 }));
      }
    },
    {
      name: "me topics reads personal topic history",
      userSays: "列出我发布过的社区帖子。",
      commandPath: "me topics",
      argv: ["node", "apexcn", "me", "topics", "--page-size", "2", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/me/topics?pageSize=2");
        return Response.json({ kind: "me-topics", items: [{ id: 42, title: "My topic" }], page: { limit: 2, count: 1 }, requestId: "req-me-topics" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ id: 42, title: "My topic" }));
      }
    },
    {
      name: "me replies reads personal replies",
      userSays: "列出我最近的社区回复。",
      commandPath: "me replies",
      argv: ["node", "apexcn", "me", "replies", "--page-size", "2", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/me/replies?pageSize=2");
        return Response.json({ kind: "my-replies", items: [{ id: 201, topicId: 42, content: "Reply" }], page: { limit: 2, count: 1 }, requestId: "req-me-replies" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ id: 201, topicId: 42 }));
      }
    },
    {
      name: "me favorites reads personal favorite topics",
      userSays: "查看我收藏过的话题。",
      commandPath: "me favorites",
      argv: ["node", "apexcn", "me", "favorites", "--page-size", "2", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/me/favorites?pageSize=2");
        return Response.json({ kind: "my-favorites", items: [{ topicId: 42, title: "Favorite topic" }], page: { limit: 2, count: 1 }, requestId: "req-me-favorites" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ topicId: 42, title: "Favorite topic" }));
      }
    },
    {
      name: "me subscriptions reads personal subscribed topics",
      userSays: "查看我订阅的话题列表。",
      commandPath: "me subscriptions",
      argv: ["node", "apexcn", "me", "subscriptions", "--page-size", "2", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/me/subscriptions?pageSize=2");
        return Response.json({ kind: "my-subscriptions", items: [{ topicId: 42, title: "Subscribed topic" }], page: { limit: 2, count: 1 }, requestId: "req-me-subscriptions" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ topicId: 42, title: "Subscribed topic" }));
      }
    },
    {
      name: "topic view reads a thread",
      userSays: "打开社区帖子 30549 并总结内容。",
      commandPath: "topic view",
      argv: ["node", "apexcn", "topic", "view", "30549", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/topics/30549");
        return Response.json({ topic: { id: 30549, title: "REST API" }, requestId: "req-topic" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).topic.id).toBe(30549);
      }
    },
    {
      name: "topic list reads filtered topic rows",
      userSays: "列出社区里还没有回复的最新话题。",
      commandPath: "topic list",
      argv: ["node", "apexcn", "topic", "list", "--view", "unanswered", "--page-size", "20", "--json"],
      responseForUrl: (url) => {
        expect(url).toBe("https://oracleapex.cn/ords/test/api/v1/topics?pageSize=20&view=unanswered");
        return Response.json({ items: [{ id: 51, title: "Unanswered" }], page: { hasMore: false }, requestId: "req-topics" });
      },
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).items[0]).toEqual(expect.objectContaining({ id: 51, title: "Unanswered" }));
      }
    },
    {
      name: "collection build writes local artifacts",
      userSays: "把 REST API 搜索结果做成本地知识合集。",
      commandPath: "collection build",
      argv: (context) => ["node", "apexcn", "collection", "build", "--query", "REST", "--limit", "1", "--output-dir", join(context.tmpDir, "collection"), "--json"],
      responseForUrl: collectionFetch,
      assertFeedback: async ({ stdout, stderr, fetch, tmpDir }) => {
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "collection-build", topicCount: 1 }));
        expect(JSON.parse(await readFile(join(tmpDir, "collection", "collection.json"), "utf8"))).toEqual(expect.objectContaining({ kind: "collection" }));
      }
    },
    {
      name: "collection verify checks local artifacts",
      userSays: "验证这个本地知识合集是否完整可用。",
      commandPath: "collection verify",
      prepare: (context) => prepareCollection(context, join(context.tmpDir, "collection")),
      argv: (context) => ["node", "apexcn", "collection", "verify", "--dir", join(context.tmpDir, "collection"), "--json"],
      responseForUrl: collectionFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "collection-verification", ok: true }));
      }
    },
    {
      name: "collection index builds local search index",
      userSays: "给这个本地知识合集建立离线检索索引。",
      commandPath: "collection index",
      prepare: (context) => prepareCollection(context, join(context.tmpDir, "collection")),
      argv: (context) => ["node", "apexcn", "collection", "index", "--dir", join(context.tmpDir, "collection"), "--json"],
      responseForUrl: collectionFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "collection-index", topicCount: 1 }));
      }
    },
    {
      name: "collection query searches local index",
      userSays: "在本地知识合集里搜索 ORDS 401。",
      commandPath: "collection query",
      prepare: async (context) => {
        const dir = join(context.tmpDir, "collection");
        await prepareCollection(context, dir);
        await context.program.parseAsync(["node", "apexcn", "collection", "index", "--dir", dir, "--json"]);
        context.stdout.length = 0;
      },
      argv: (context) => ["node", "apexcn", "collection", "query", "REST", "--dir", join(context.tmpDir, "collection"), "--json"],
      responseForUrl: collectionFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "collection-query-result", resultCount: 1, engine: "bm25" }));
      }
    },
    {
      name: "collection stats summarizes local index",
      userSays: "查看本地知识合集索引统计信息。",
      commandPath: "collection stats",
      prepare: async (context) => {
        const dir = join(context.tmpDir, "collection");
        await prepareCollection(context, dir);
        await context.program.parseAsync(["node", "apexcn", "collection", "index", "--dir", dir, "--json"]);
        context.stdout.length = 0;
      },
      argv: (context) => ["node", "apexcn", "collection", "stats", "--dir", join(context.tmpDir, "collection"), "--json"],
      responseForUrl: collectionFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "collection-index-stats", engine: "bm25", documentCount: 1 }));
      }
    },
    {
      name: "mcp tools prints readonly manifest",
      userSays: "列出 apexcn-cli 暴露给 AI Agent 的 MCP 工具。",
      commandPath: "mcp tools",
      configureAuth: false,
      argv: ["node", "apexcn", "mcp", "tools", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "mcp-tools" }));
      }
    },
    {
      name: "mcp inspect prints policy",
      userSays: "检查 apexcn-cli MCP 默认是否只读。",
      commandPath: "mcp inspect",
      configureAuth: false,
      argv: ["node", "apexcn", "mcp", "inspect", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "mcp-inspect", policy: expect.objectContaining({ allowExecuteWrite: false }) }));
      }
    },
    {
      name: "mcp serve rejects execute-write",
      userSays: "以只读模式启动 apexcn-cli 本地 MCP 服务，不允许真实写入。",
      commandPath: "mcp serve",
      configureAuth: false,
      argv: ["node", "apexcn", "mcp", "serve", "--allow-execute-write"],
      assertFeedback: ({ stdout, stderr, fetch, exitCode }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stdout).toBe("");
        expect(stderr).toContain("MCP execute-write is intentionally unavailable");
        expect(stderr).toContain("apexcn workflow");
        expect(exitCode).toBe(1);
      }
    },
    {
      name: "draft question creates local draft",
      userSays: "我遇到 APEX 调 REST API 返回 401，先帮我起草提问，不要发布。",
      commandPath: "draft question",
      configureAuth: false,
      argv: ["node", "apexcn", "draft", "question", "--title", "APEX REST 调用失败", "--problem", "页面进程调用 REST API 报错。", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "question-draft" }));
      }
    },
    {
      name: "draft reply creates local reply draft",
      userSays: "帮我给帖子 30549 起草一条友好回复，先不要发布。",
      commandPath: "draft reply",
      configureAuth: false,
      argv: ["node", "apexcn", "draft", "reply", "--topic-id", "30549", "--answer", "建议先检查 Web Credential。", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "reply-draft", topicId: 30549 }));
      }
    },
    {
      name: "review topic checks local Markdown",
      userSays: "发布前检查这篇 Markdown 提问帖有没有占位符或敏感信息。",
      commandPath: "review topic",
      configureAuth: false,
      prepare: async (context) => {
        await writeFile(join(context.tmpDir, "question.md"), GOOD_TOPIC_CONTENT, "utf8");
      },
      argv: (context) => ["node", "apexcn", "review", "topic", "--title", "APEX REST API returns 403", "--content-file", join(context.tmpDir, "question.md"), "--category-id", "4", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "topic-review", ok: true }));
      }
    },
    {
      name: "review reply checks local Markdown",
      userSays: "发布回复前检查内容是否太空泛。",
      commandPath: "review reply",
      configureAuth: false,
      prepare: async (context) => {
        await writeFile(join(context.tmpDir, "reply.md"), GOOD_REPLY_CONTENT, "utf8");
      },
      argv: (context) => ["node", "apexcn", "review", "reply", "--topic-id", "30549", "--content-file", join(context.tmpDir, "reply.md"), "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "reply-review", ok: true }));
      }
    },
    ...apiWritePreviewScenarios(),
    ...workflowExecutableScenarios()
  ];
}

function apiWritePreviewScenarios(): ExecutableNaturalLanguageScenario[] {
  return [
    writePreview("topic create", "预览发帖请求，不要发布。", ["node", "apexcn", "topic", "create", "--category-id", "4", "--title", "CLI title", "--content", "CLI body", "--preview", "--json"], "/api/v1/topics"),
    writePreview("topic update", "预览编辑帖子标题和正文。", ["node", "apexcn", "topic", "update", "30549", "--title", "Updated title", "--content", "Updated body", "--preview", "--json"], "/api/v1/topics/30549"),
    writePreview("topic delete", "删除帖子前先预览请求并确认精确标题。", ["node", "apexcn", "topic", "delete", "30549", "--yes", "--force", "--confirm-title", "CLI title", "--preview", "--json"], "/api/v1/topics/30549"),
    writePreview("reply create", "预览给帖子 30549 的回复，不要发布。", ["node", "apexcn", "reply", "create", "30549", "--content", "Reply body", "--preview", "--json"], "/api/v1/topics/30549/replies"),
    writePreview("reply update", "预览更新已有回复。", ["node", "apexcn", "reply", "update", "201480", "--content", "Reply updated", "--preview", "--json"], "/api/v1/replies/201480"),
    writePreview("reply delete", "删除回复前先预览请求。", ["node", "apexcn", "reply", "delete", "201480", "--yes", "--force", "--preview", "--json"], "/api/v1/replies/201480"),
    writePreview("favorite remove", "预览取消收藏帖子请求。", ["node", "apexcn", "favorite", "remove", "30549", "--preview", "--json"], "/api/v1/topics/30549/favorite"),
    writePreview("subscription add", "预览订阅帖子请求。", ["node", "apexcn", "subscription", "add", "30549", "--preview", "--json"], "/api/v1/topics/30549/subscription"),
    writePreview("subscription remove", "预览取消订阅帖子请求。", ["node", "apexcn", "subscription", "remove", "30549", "--preview", "--json"], "/api/v1/topics/30549/subscription")
  ];
}

function workflowExecutableScenarios(): ExecutableNaturalLanguageScenario[] {
  return [
    {
      name: "workflow plan creates local plan",
      userSays: "规划一次先搜索再起草提问的流程，不要执行发布。",
      commandPath: "workflow plan",
      configureAuth: false,
      argv: ["node", "apexcn", "workflow", "plan", "--goal", "ask-question", "--keyword", "REST API", "--title", "APEX REST API returns 403", "--problem", "Page process gets 403.", "--category-id", "4", "--json"],
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-plan", goal: "ask-question" }));
      }
    },
    {
      name: "workflow run creates preview artifacts",
      userSays: "运行一个可恢复的提问 workflow，只生成预览和本地 artifacts。",
      commandPath: "workflow run",
      argv: (context) => workflowRunArgv(join(context.tmpDir, "run")),
      responseForUrl: workflowFetch,
      assertFeedback: async ({ stdout, stderr, fetch, tmpDir }) => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-run", status: "preview-ready" }));
        expect(JSON.parse(await readFile(join(tmpDir, "run", "preview.json"), "utf8"))).toEqual(expect.objectContaining({ kind: "workflow-preview" }));
      }
    },
    {
      name: "workflow approve records approval",
      userSays: "我已看过 workflow preview，记录批准 artifact。",
      commandPath: "workflow approve",
      prepare: (context) => prepareWorkflowPreview(context, join(context.tmpDir, "run")),
      argv: (context) => ["node", "apexcn", "workflow", "approve", "--run-dir", join(context.tmpDir, "run"), "--approved-by", "tester", "--json"],
      responseForUrl: workflowFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-approval", approvedBy: "tester" }));
      }
    },
    {
      name: "workflow policy init writes template",
      userSays: "生成一份 workflow policy 模板。",
      commandPath: "workflow policy init",
      configureAuth: false,
      argv: (context) => ["node", "apexcn", "workflow", "policy", "init", "--output", join(context.tmpDir, "apexcn-policy.json"), "--json"],
      assertFeedback: async ({ stdout, stderr, fetch, tmpDir }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-policy-init" }));
        expect(JSON.parse(await readFile(join(tmpDir, "apexcn-policy.json"), "utf8"))).toEqual(expect.objectContaining({ schemaVersion: 1, mcp: { allowExecute: false } }));
      }
    },
    {
      name: "workflow verify checks evidence",
      userSays: "验证 workflow run 目录里的证据和 approval hash。",
      commandPath: "workflow verify",
      prepare: (context) => prepareWorkflowPreview(context, join(context.tmpDir, "run")),
      argv: (context) => ["node", "apexcn", "workflow", "verify", "--run-dir", join(context.tmpDir, "run"), "--json"],
      responseForUrl: workflowFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-verification", ok: true }));
      }
    },
    {
      name: "workflow diff compares preview and approval",
      userSays: "对比 workflow preview 和 approval 绑定请求。",
      commandPath: "workflow diff",
      prepare: (context) => prepareApprovedWorkflow(context, join(context.tmpDir, "run")),
      argv: (context) => ["node", "apexcn", "workflow", "diff", "--run-dir", join(context.tmpDir, "run"), "--json"],
      responseForUrl: workflowFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-diff", executionAllowed: true }));
      }
    },
    {
      name: "workflow audit-log prints ndjson",
      userSays: "导出 workflow 审计日志 NDJSON。",
      commandPath: "workflow audit-log",
      prepare: (context) => prepareApprovedWorkflow(context, join(context.tmpDir, "run")),
      argv: (context) => ["node", "apexcn", "workflow", "audit-log", "--run-dir", join(context.tmpDir, "run"), "--format", "ndjson"],
      responseForUrl: workflowFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(stdout.trim().split("\n").map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([expect.objectContaining({ event: "verify" })]));
      }
    },
    {
      name: "workflow export writes bundle",
      userSays: "把 workflow 证据导出成单文件归档。",
      commandPath: "workflow export",
      prepare: (context) => prepareApprovedWorkflow(context, join(context.tmpDir, "run")),
      argv: (context) => ["node", "apexcn", "workflow", "export", "--run-dir", join(context.tmpDir, "run"), "--output", join(context.tmpDir, "bundle.json"), "--json"],
      responseForUrl: workflowFetch,
      assertFeedback: async ({ stdout, stderr, fetch, tmpDir }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-export", ok: true }));
        expect(JSON.parse(await readFile(join(tmpDir, "bundle.json"), "utf8"))).toEqual(expect.objectContaining({ kind: "workflow-bundle" }));
      }
    },
    {
      name: "workflow verify-bundle checks portable bundle",
      userSays: "验证别人发来的 workflow bundle。",
      commandPath: "workflow verify-bundle",
      prepare: (context) => prepareWorkflowBundle(context, join(context.tmpDir, "run"), join(context.tmpDir, "bundle.json")),
      argv: (context) => ["node", "apexcn", "workflow", "verify-bundle", "--bundle", join(context.tmpDir, "bundle.json"), "--json"],
      responseForUrl: workflowFetch,
      assertFeedback: ({ stdout, stderr, fetch }) => {
        expect(fetch).not.toHaveBeenCalled();
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ kind: "workflow-bundle-verification", ok: true }));
      }
    }
  ];
}

describe("common natural-language agent scenarios", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.exitCode = undefined;
  });

  test("covers at least 100 daily user scenarios with unique descriptions", () => {
    expect(COMMON_NATURAL_LANGUAGE_SCENARIOS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(COMMON_NATURAL_LANGUAGE_SCENARIOS.map((item) => item.name)).size).toBe(COMMON_NATURAL_LANGUAGE_SCENARIOS.length);
    expect(new Set(COMMON_NATURAL_LANGUAGE_SCENARIOS.map((item) => item.userSays)).size).toBe(COMMON_NATURAL_LANGUAGE_SCENARIOS.length);
  });

  test("covers every command in the public manifest at least once", async () => {
    const manifest = await commandManifest();
    const covered = new Set(COMMON_NATURAL_LANGUAGE_SCENARIOS.map((item) => item.commandPath));

    expect(manifest.commands.map((command) => command.path).filter((path) => !covered.has(path))).toEqual([]);
  });

  test("runs at least one real natural-language CLI scenario for every manifest command", async () => {
    const manifest = await commandManifest();
    const commandPaths = new Set(manifest.commands.map((command) => command.path));
    const executablePaths = new Set(EXECUTABLE_NATURAL_LANGUAGE_SCENARIOS.map((item) => item.commandPath));

    expect(EXECUTABLE_NATURAL_LANGUAGE_SCENARIOS.filter((item) => !commandPaths.has(item.commandPath))).toEqual([]);
    expect(manifest.commands.map((command) => command.path).filter((path) => !executablePaths.has(path))).toEqual([]);
  });

  test.each(COMMON_NATURAL_LANGUAGE_SCENARIOS)("$name maps a user request to safe manifest guidance", async (item) => {
    const manifest = await commandManifest();
    const command = manifest.commands.find((entry) => entry.path === item.commandPath);

    expect(command, item.userSays).toBeDefined();
    expect(command?.safety.preview).toBe(item.expectedPreview);
    expect(command?.safety.effects).toEqual(expect.arrayContaining(item.expectedEffects));
    expect(command?.examples.length).toBeGreaterThan(0);

    if (item.requiredOptions) {
      expect(command?.options).toEqual(expect.arrayContaining(item.requiredOptions));
    }
    if (item.requiredConfirmations) {
      expect(command?.safety.confirmation).toEqual(expect.arrayContaining(item.requiredConfirmations));
    }
    if (item.mode === "preview") {
      expect(command?.safety.preview).not.toBe("none");
    }
    if (item.expectedEffects.includes("destructive")) {
      expect(command?.safety.preview).toBe("required");
      expect(command?.safety.confirmation.length).toBeGreaterThan(0);
    }
    if (item.expectedEffects.includes("secret")) {
      expect(command?.safety.effects).toContain("auth");
    }
  });

  test.each(EXECUTABLE_NATURAL_LANGUAGE_SCENARIOS)("$name runs the real CLI from natural language feedback", async (item) => {
    const feedback = await runNaturalLanguageScenario(item);

    item.assertFeedback(feedback);
  });
});

function scenario(
  name: string,
  userSays: string,
  commandPath: string,
  mode: Scenario["mode"],
  expectedEffects: string[],
  expectedPreview: Scenario["expectedPreview"],
  requiredOptions?: string[],
  requiredConfirmations?: string[]
): Scenario {
  return { name, userSays, commandPath, mode, expectedEffects, expectedPreview, requiredOptions, requiredConfirmations };
}

async function commandManifest(): Promise<{ commands: ManifestCommand[] }> {
  const stdout: string[] = [];
  const program = createProgram({
    stdout: (text) => stdout.push(text),
    stderr: () => undefined
  });

  await program.parseAsync(["node", "apexcn", "commands", "--json"]);

  return JSON.parse(stdout.join("")) as { commands: ManifestCommand[] };
}

function writePreview(commandPath: string, userSays: string, argv: string[], expectedPath: string): ExecutableNaturalLanguageScenario {
  return {
    name: `${commandPath} preview does not call API`,
    userSays,
    commandPath,
    argv,
    assertFeedback: ({ stdout, stderr, fetch }) => {
      expect(fetch).not.toHaveBeenCalled();
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(expect.objectContaining({
        dryRun: true,
        preview: true,
        mode: "preview",
        path: expectedPath
      }));
    }
  };
}

function doctorFetch(url: string): Response {
  if (url.endsWith("/api/v1/me")) {
    return Response.json({ user: { id: 1, nickname: "Tester" }, requestId: "req-me" });
  }
  if (url.endsWith("/api/v1/categories")) {
    return Response.json({ items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" });
  }
  if (url.includes("/api/v1/search")) {
    return Response.json({ items: [], requestId: "req-search" });
  }
  return Response.json({ error: { message: `unexpected url ${url}` } }, { status: 500 });
}

function collectionFetch(url: string): Response {
  if (url.includes("/api/v1/search")) {
    return Response.json({ requestId: "req-search", items: [{ id: 1, title: "REST API" }] });
  }
  if (url.endsWith("/api/v1/topics/1")) {
    return Response.json({
      requestId: "req-topic-1",
      topic: { id: 1, title: "REST API", url: "https://oracleapex.cn/t/1", content: "REST API content" }
    });
  }
  return Response.json({ error: { message: `unexpected url ${url}` } }, { status: 500 });
}

function workflowFetch(url: string): Response {
  if (url.includes("/api/v1/search")) {
    return Response.json({ requestId: "req-search", items: [] });
  }
  return Response.json({ error: { message: `unexpected url ${url}` } }, { status: 500 });
}

function workflowRunArgv(runDir: string): string[] {
  return [
    "node",
    "apexcn",
    "workflow",
    "run",
    "--goal",
    "ask-question",
    "--keyword",
    "REST API",
    "--title",
    "APEX REST API returns 403",
    "--problem",
    "Page process gets 403.",
    "--category-id",
    "4",
    "--output-dir",
    runDir,
    "--json"
  ];
}

async function prepareCollection(context: ScenarioRuntime, outputDir: string): Promise<void> {
  await context.program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--limit", "1", "--output-dir", outputDir, "--json"]);
}

async function prepareWorkflowPreview(context: ScenarioRuntime, runDir: string): Promise<void> {
  await context.program.parseAsync(workflowRunArgv(runDir));
}

async function prepareApprovedWorkflow(context: ScenarioRuntime, runDir: string): Promise<void> {
  await prepareWorkflowPreview(context, runDir);
  await context.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--approved-by", "tester", "--json"]);
}

async function prepareWorkflowBundle(context: ScenarioRuntime, runDir: string, bundlePath: string): Promise<void> {
  await prepareApprovedWorkflow(context, runDir);
  await context.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", bundlePath, "--json"]);
}

async function runNaturalLanguageScenario(item: ExecutableNaturalLanguageScenario): Promise<CliFeedback> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const tmpDir = await mkdtemp(join(tmpdir(), "apexcn-natural-language-"));
  const configPath = join(tmpDir, ".apexcn", "config.json");
  const context = {} as ScenarioRuntime;
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    if (!item.responseForUrl) {
      throw new Error(`Unexpected fetch for ${item.name}: ${String(url)}`);
    }
    return item.responseForUrl(String(url), init);
  });
  vi.stubGlobal("fetch", fetchMock);
  const program = createProgram({
    configPath,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readStdin: async () => context.readStdin ? context.readStdin() : ""
  });
  Object.assign(context, { tmpDir, configPath, program, stdout, stderr, fetch: fetchMock });
  if (item.configureAuth !== false) {
    await program.parseAsync([
      "node",
      "apexcn",
      "auth",
      "set-token",
      "--token",
      "abcdefghijklmnopqrstuvwxyz",
      "--base-url",
      "https://oracleapex.cn/ords/test",
      "--profile",
      "test@oci"
    ]);
  }
  stdout.length = 0;
  stderr.length = 0;
  fetchMock.mockClear();
  process.exitCode = undefined;

  if (item.prepare) {
    await item.prepare(context);
    stdout.length = 0;
    stderr.length = 0;
    fetchMock.mockClear();
    process.exitCode = undefined;
  }

  const argv = typeof item.argv === "function" ? await item.argv(context) : item.argv;
  await program.parseAsync(argv);

  return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode, fetch: fetchMock, tmpDir, configPath };
}
