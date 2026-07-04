import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { blockText, fieldText, isRecord, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type WorkflowCommandOptions = CommandIo & {
  configPath?: string;
};

type WorkflowGoal = "ask-question" | "reply" | "research-only" | "publish-topic";
type WorkflowRunGoal = "ask-question" | "reply";
type WorkflowStepMode = "local" | "api-read" | "api-write-preview" | "api-write-execute";

type WorkflowPlanOptions = FormatOption & {
  goal: WorkflowGoal;
  keyword?: string;
  topicId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  contentFile?: string;
  outputDir?: string;
  includeExecute?: boolean;
};

type WorkflowRunOptions = FormatOption & {
  goal?: WorkflowRunGoal;
  resume?: string;
  keyword?: string;
  topicId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  outputDir?: string;
  execute?: boolean;
  yes?: boolean;
};

type WorkflowStep = {
  id: string;
  label: string;
  command: string;
  mode: WorkflowStepMode;
  inputFiles: string[];
  outputFiles: string[];
  requiresConfirmation: boolean;
};

type WorkflowPlan = {
  kind: "workflow-plan";
  schemaVersion: 1;
  goal: WorkflowGoal;
  steps: WorkflowStep[];
  checkpoints: {
    missingInputs: string[];
    confirmations: string[];
  };
  files: Record<string, string>;
  safetySummary: {
    localSteps: number;
    apiReadSteps: number;
    apiWritePreviewSteps: number;
    apiWriteExecuteSteps: number;
    requiresConfirmation: boolean;
  };
};

type Session = {
  profile: string;
  baseUrl: string;
  token: string;
};

type WorkflowRunStatus = "running" | "preview-ready" | "completed" | "failed";
type WorkflowRunStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

type WorkflowRunStep = {
  id: string;
  status: WorkflowRunStepStatus;
  startedAt?: string;
  endedAt?: string;
  requestId?: string;
  error?: string;
};

type WorkflowRunInputs = {
  keyword?: string;
  topicId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
};

type WorkflowRunState = {
  kind: "workflow-run";
  schemaVersion: 1;
  runId: string;
  goal: WorkflowRunGoal;
  inputs: WorkflowRunInputs;
  status: WorkflowRunStatus;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowRunStep[];
  artifacts: Record<string, string>;
  nextAction: string;
};

export function createWorkflowCommand(options: WorkflowCommandOptions): Command {
  const workflow = new Command("workflow");

  workflow
    .command("plan")
    .requiredOption("--goal <goal>", "workflow goal: ask-question, reply, research-only, publish-topic", parseWorkflowGoal)
    .option("--keyword <keyword>", "search or research keyword")
    .option("--topic-id <id>", "topic id", parsePositiveInteger)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--title <title>", "topic title")
    .option("--problem <text>", "question problem text for ask-question")
    .option("--answer <text>", "reply answer text for reply")
    .option("--content-file <path>", "existing Markdown content file for publish-topic")
    .option("--output-dir <path>", "directory for planned local files")
    .option("--include-execute", "include final API execute steps after preview")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action((commandOptions: WorkflowPlanOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const plan = workflowPlan(commandOptions);
      printData(options, plan, outputFormat(commandOptions), formatWorkflowPlanText);
    });

  workflow
    .command("run")
    .option("--goal <goal>", "workflow goal: ask-question, reply", parseWorkflowRunGoal)
    .option("--resume <run-dir>", "resume an existing workflow run directory")
    .option("--keyword <keyword>", "search or research keyword for ask-question")
    .option("--topic-id <id>", "topic id for reply", parsePositiveInteger)
    .option("--category-id <id>", "category id for topic create preview", parsePositiveInteger)
    .option("--title <title>", "topic title for ask-question")
    .option("--problem <text>", "question problem text for ask-question")
    .option("--answer <text>", "reply answer text for reply")
    .option("--output-dir <path>", "directory for run artifacts")
    .option("--execute", "execute the final API write after preview")
    .option("--yes", "confirm --execute")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowRunOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runWorkflow(options, commandOptions);
    });

  return workflow;
}

async function runWorkflow(io: WorkflowCommandOptions, options: WorkflowRunOptions): Promise<void> {
  if (options.resume && options.outputDir) {
    printError(io, { type: "validation", message: "--resume cannot be combined with --output-dir" });
    process.exitCode = 1;
    return;
  }
  if (options.execute && !options.resume) {
    printError(io, { type: "validation", message: "Use --resume <run-dir> --execute --yes to publish a reviewed workflow." });
    process.exitCode = 1;
    return;
  }
  if (options.execute && !options.yes) {
    printError(io, { type: "safety", message: "Refusing to execute workflow without --yes" });
    process.exitCode = 1;
    return;
  }
  const loaded = options.resume ? await loadWorkflowRun(options.resume) : undefined;
  if (options.resume && !loaded) {
    printError(io, { type: "validation", message: `Workflow run not found: ${options.resume}` });
    process.exitCode = 1;
    return;
  }
  const goal = loaded?.state.goal ?? options.goal;
  if (!goal) {
    printError(io, { type: "validation", message: "Missing --goal for workflow run" });
    process.exitCode = 1;
    return;
  }
  const missing = loaded ? [] : missingInputsForRun(options, goal);
  if (missing.length > 0) {
    printError(io, { type: "validation", message: `Missing required workflow run inputs: ${missing.join(", ")}` });
    process.exitCode = 1;
    return;
  }
  const session = await loadSession(io);
  if (!session) {
    return;
  }
  const runDir = loaded?.runDir ?? (options.outputDir ?? `apexcn-run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(runDir, { recursive: true });
  const state = loaded?.state ?? initialRunState(goal, runDir, options);
  state.status = "running";
  state.nextAction = "Workflow run is in progress.";
  await writeRunState(runDir, state);
  try {
    await executeRunSteps(state, runDir, session, options);
  } catch (error) {
    state.status = "failed";
    state.nextAction = "Fix the failed step and rerun with --resume.";
    await writeRunState(runDir, state);
    handleRunError(io, error, session);
    return;
  }
  state.status = options.execute ? "completed" : "preview-ready";
  state.nextAction = options.execute ? "Workflow completed." : `Review ${state.artifacts.preview} and rerun with --resume ${shellArg(runDir)} --execute --yes to publish.`;
  await writeRunState(runDir, state);
  printData(io, state, outputFormat(options), formatWorkflowRunText);
}

function workflowPlan(options: WorkflowPlanOptions): WorkflowPlan {
  const files = workflowFiles(options.outputDir);
  const missingInputs = missingInputsForGoal(options);
  const steps = stepsForGoal(options, files);
  const confirmations = steps.filter((step) => step.requiresConfirmation).map((step) => step.id);
  return {
    kind: "workflow-plan",
    schemaVersion: 1,
    goal: options.goal,
    steps,
    checkpoints: {
      missingInputs,
      confirmations
    },
    files,
    safetySummary: safetySummary(steps)
  };
}

async function executeRunSteps(state: WorkflowRunState, runDir: string, session: Session, options: WorkflowRunOptions): Promise<void> {
  if (state.goal === "ask-question") {
    await runStep(state, runDir, "research", state.artifacts.research, async () => {
      const research = await runResearch(session, state, options);
      await writeJson(state.artifacts.research, research);
      return requestIdFrom(research);
    });
    await runStep(state, runDir, "draft-question", state.artifacts.question, async () => {
      const research = await readJson(state.artifacts.research);
      await writeFile(state.artifacts.question, questionMarkdown(state, options, research), "utf8");
    });
    await runStep(state, runDir, "review-topic", state.artifacts.review, async () => {
      const content = await readFile(state.artifacts.question, "utf8");
      await writeJson(state.artifacts.review, reviewArtifact(state, options, state.artifacts.question, content));
    });
    await runStep(state, runDir, "preview-topic-create", state.artifacts.preview, async () => {
      const content = await readFile(state.artifacts.question, "utf8");
      const body = {
        categoryId: effectiveCategoryId(state, options),
        title: effectiveTitle(state, options),
        content
      };
      await writeJson(state.artifacts.preview, {
        kind: "workflow-preview",
        schemaVersion: 1,
        profile: session.profile,
        baseUrl: session.baseUrl,
        request: { method: "POST", path: "/api/v1/topics", body },
        result: null
      });
    });
    if (options.execute) {
      await runStep(state, runDir, "execute-topic-create", state.artifacts.execute, async () => {
        const request = await previewRequest(state.artifacts.preview, "/api/v1/topics");
        const response = await requestJson(session.baseUrl, request.path, {
          token: session.token,
          method: "POST",
          body: request.body
        });
        const artifact = {
          kind: "workflow-execute",
          schemaVersion: 1,
          requestId: requestIdFrom(response),
          request: { method: "POST", path: request.path, body: request.body },
          result: response
        };
        await writeJson(state.artifacts.execute, artifact);
        return requestIdFrom(response);
      });
    }
    return;
  }

  await runStep(state, runDir, "topic-view", state.artifacts.topic, async () => {
    const topicId = effectiveTopicId(state, options);
    const path = `/api/v1/topics/${topicId}`;
    const topic = await requestJson(session.baseUrl, path, { token: session.token });
    const artifact = {
      kind: "workflow-topic",
      schemaVersion: 1,
      requestId: requestIdFrom(topic),
      request: { method: "GET", path },
      result: topic
    };
    await writeJson(state.artifacts.topic, artifact);
    return requestIdFrom(topic);
  });
  await runStep(state, runDir, "draft-reply", state.artifacts.reply, async () => {
    const topic = await readJson(state.artifacts.topic);
    await writeFile(state.artifacts.reply, replyMarkdown(state, options, topic), "utf8");
  });
  await runStep(state, runDir, "preview-reply-create", state.artifacts.preview, async () => {
    const content = await readFile(state.artifacts.reply, "utf8");
    const topicId = effectiveTopicId(state, options);
    const path = `/api/v1/topics/${topicId}/replies`;
    await writeJson(state.artifacts.preview, {
      kind: "workflow-preview",
      schemaVersion: 1,
      profile: session.profile,
      baseUrl: session.baseUrl,
      request: { method: "POST", path, body: { content } },
      result: null
    });
  });
  if (options.execute) {
    await runStep(state, runDir, "execute-reply-create", state.artifacts.execute, async () => {
      const topicId = effectiveTopicId(state, options);
      const path = `/api/v1/topics/${topicId}/replies`;
      const request = await previewRequest(state.artifacts.preview, path);
      const response = await requestJson(session.baseUrl, request.path, {
        token: session.token,
        method: "POST",
        body: request.body
      });
      const artifact = {
        kind: "workflow-execute",
        schemaVersion: 1,
        requestId: requestIdFrom(response),
        request: { method: "POST", path: request.path, body: request.body },
        result: response
      };
      await writeJson(state.artifacts.execute, artifact);
      return requestIdFrom(response);
    });
  }
}

async function runResearch(session: Session, state: WorkflowRunState, options: WorkflowRunOptions): Promise<Record<string, unknown>> {
  const keyword = effectiveKeyword(state, options);
  const search = await requestJson(session.baseUrl, "/api/v1/search", {
    token: session.token,
    query: { keyword, pageSize: 3 }
  });
  const items = itemsFromData(search).slice(0, 3);
  const topics = [];
  const requestIds = [];
  for (const [sourceItemIndex, item] of items.entries()) {
    const id = topicIdFromItem(item);
    if (id !== undefined) {
      const topic = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
      const normalized = topicFromApiData(topic);
      topics.push(compactObject({
        sourceItemIndex,
        id: normalized.id ?? id,
        title: normalized.title,
        url: normalized.url ?? normalized.threadUrl,
        originalUrl: normalized.originalUrl,
        content: normalized.content ?? normalized.body,
        requestId: requestIdFrom(topic)
      }));
      const requestId = requestIdFrom(topic);
      if (requestId) {
        requestIds.push(requestId);
      }
    }
  }
  return {
    kind: "workflow-research",
    schemaVersion: 1,
    requestId: requestIdFrom(search),
    request: {
      method: "GET",
      path: "/api/v1/search",
      query: { keyword, pageSize: 3 }
    },
    result: {
      query: { keyword, limit: 3 },
      items,
      topics,
      links: researchLinks(items, topics),
      requestIds: {
        search: requestIdFrom(search),
        topics: requestIds
      },
      errors: []
    }
  };
}

async function runStep(state: WorkflowRunState, runDir: string, id: string, artifact: string | undefined, action: () => Promise<string | undefined | void>): Promise<void> {
  const current = stepState(state, id);
  if ((current.status === "completed" || current.status === "skipped") && artifact && await fileExists(artifact)) {
    current.status = "skipped";
    current.endedAt = now();
    await writeRunState(runDir, state);
    return;
  }
  current.status = "running";
  current.startedAt = now();
  current.error = undefined;
  touchState(state);
  await writeRunState(runDir, state);
  try {
    const requestId = await action();
    current.status = "completed";
    current.endedAt = now();
    if (requestId) {
      current.requestId = requestId;
    }
    touchState(state);
    await writeRunState(runDir, state);
  } catch (error) {
    current.status = "failed";
    current.endedAt = now();
    current.error = errorMessage(error);
    touchState(state);
    await writeRunState(runDir, state);
    throw error;
  }
}

function stepsForGoal(options: WorkflowPlanOptions, files: Record<string, string>): WorkflowStep[] {
  if (options.goal === "research-only") {
    return [
      step("research", "Build research bundle", researchCommand(options, files), "api-read", [], [files.research], false)
    ];
  }
  if (options.goal === "ask-question") {
    const steps = [
      step("research", "Build research bundle", researchCommand(options, files), "api-read", [], [files.research], false),
      step("draft-question", "Draft local question", draftQuestionCommand(options, files), "local", [files.research], [files.question], false),
      step("review-topic", "Review local topic draft", reviewTopicCommand(options, files), "local", [files.question], [], false),
      step("preview-topic-create", "Preview topic create API request", topicCreateCommand(options, files, true), "api-write-preview", [files.question], [], false)
    ];
    return options.includeExecute ? [...steps, step("execute-topic-create", "Create topic after confirmation", topicCreateCommand(options, files, false), "api-write-execute", [files.question], [], true)] : steps;
  }
  if (options.goal === "reply") {
    const steps = [
      step("topic-view", "Fetch topic context", topicViewCommand(options, files), "api-read", [], [files.topic], false),
      step("draft-reply", "Draft local reply", draftReplyCommand(options, files), "local", [files.topic], [files.reply], false),
      step("preview-reply-create", "Preview reply create API request", replyCreateCommand(options, files, true), "api-write-preview", [files.reply], [], false)
    ];
    return options.includeExecute ? [...steps, step("execute-reply-create", "Create reply after confirmation", replyCreateCommand(options, files, false), "api-write-execute", [files.reply], [], true)] : steps;
  }
  const steps = [
    step("review-topic", "Review existing topic Markdown", reviewTopicCommand(options, files), "local", [contentFile(options, files)], [], false),
    step("preview-topic-create", "Preview topic create API request", topicCreateCommand(options, files, true), "api-write-preview", [contentFile(options, files)], [], false)
  ];
  return options.includeExecute ? [...steps, step("execute-topic-create", "Create topic after confirmation", topicCreateCommand(options, files, false), "api-write-execute", [contentFile(options, files)], [], true)] : steps;
}

function initialRunState(goal: WorkflowRunGoal, runDir: string, options: WorkflowRunOptions): WorkflowRunState {
  const createdAt = now();
  const artifacts = runArtifacts(goal, runDir);
  return {
    kind: "workflow-run",
    schemaVersion: 1,
    runId: `run-${createdAt.replace(/[:.]/g, "-")}`,
    goal,
    inputs: workflowRunInputs(options),
    status: "running",
    createdAt,
    updatedAt: createdAt,
    steps: runStepIds(goal, options.execute === true).map((id) => ({ id, status: "pending" })),
    artifacts,
    nextAction: "Workflow run is in progress."
  };
}

function workflowRunInputs(options: WorkflowRunOptions): WorkflowRunInputs {
  return compactObject({
    keyword: fieldText(options.keyword).trim() || undefined,
    topicId: options.topicId,
    categoryId: options.categoryId,
    title: fieldText(options.title).trim() || undefined,
    problem: fieldText(options.problem).trim() || undefined,
    answer: fieldText(options.answer).trim() || undefined
  }) as WorkflowRunInputs;
}

function runArtifacts(goal: WorkflowRunGoal, runDir: string): Record<string, string> {
  if (goal === "ask-question") {
    return {
      state: join(runDir, "run.json"),
      research: join(runDir, "research.json"),
      question: join(runDir, "question.md"),
      review: join(runDir, "review.json"),
      preview: join(runDir, "preview.json"),
      execute: join(runDir, "execute.json")
    };
  }
  return {
    state: join(runDir, "run.json"),
    topic: join(runDir, "topic.json"),
    reply: join(runDir, "reply.md"),
    preview: join(runDir, "preview.json"),
    execute: join(runDir, "execute.json")
  };
}

function runStepIds(goal: WorkflowRunGoal, execute: boolean): string[] {
  if (goal === "ask-question") {
    return execute
      ? ["research", "draft-question", "review-topic", "preview-topic-create", "execute-topic-create"]
      : ["research", "draft-question", "review-topic", "preview-topic-create"];
  }
  return execute
    ? ["topic-view", "draft-reply", "preview-reply-create", "execute-reply-create"]
    : ["topic-view", "draft-reply", "preview-reply-create"];
}

function missingInputsForRun(options: WorkflowRunOptions, goal: WorkflowRunGoal): string[] {
  const missing = [];
  if (goal === "ask-question") {
    if (!fieldText(options.keyword).trim()) {
      missing.push("--keyword");
    }
    if (!fieldText(options.title).trim()) {
      missing.push("--title");
    }
    if (!fieldText(options.problem).trim()) {
      missing.push("--problem");
    }
    if (options.categoryId === undefined) {
      missing.push("--category-id");
    }
  } else {
    if (options.topicId === undefined) {
      missing.push("--topic-id");
    }
    if (!fieldText(options.answer).trim()) {
      missing.push("--answer");
    }
  }
  return missing;
}

async function loadWorkflowRun(runDir: string): Promise<{ runDir: string; state: WorkflowRunState } | undefined> {
  try {
    const data = await readJson(join(runDir, "run.json"));
    if (!isRecord(data) || data.kind !== "workflow-run" || !isWorkflowRunGoal(data.goal)) {
      return undefined;
    }
    const state = data as WorkflowRunState;
    state.inputs ??= {};
    return { runDir, state };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function loadSession(io: WorkflowCommandOptions): Promise<Session | undefined> {
  try {
    const config = await loadConfig(io.configPath);
    const profile = config.current;
    const current = profile ? config.profiles[profile] : undefined;
    if (!profile || !current) {
      printError(io, { type: "no-profile", message: "No active profile" });
      process.exitCode = 1;
      return undefined;
    }
    return { profile, ...current };
  } catch (error) {
    if (error instanceof ConfigFileError) {
      printError(io, { type: "config", message: error.message });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

function questionMarkdown(state: WorkflowRunState, options: WorkflowRunOptions, research: unknown): string {
  const source = isRecord(research) && isRecord(research.result) ? research.result : research;
  const links = isRecord(source) && Array.isArray(source.links) ? source.links.filter(isRecord) : [];
  return [
    `# ${effectiveTitle(state, options)}`,
    "",
    "## 问题",
    "",
    blockText(effectiveProblem(state, options)),
    "",
    "## 环境",
    "",
    "Oracle APEX / ORDS 环境，具体版本请在发布前确认。",
    "",
    "## 已尝试",
    "",
    "已检索社区相关话题并整理参考链接。",
    "",
    "## 期望结果",
    "",
    "希望获得可复现的排查步骤或配置建议。",
    "",
    "## 实际结果",
    "",
    blockText(effectiveProblem(state, options)),
    "",
    "## 参考链接",
    "",
    ...(links.length > 0 ? links.map((link, index) => `${index + 1}. ${fieldText(link.title ?? link.id ?? `reference ${index + 1}`)} - ${fieldText(link.url ?? link.originalUrl)}`) : ["本次搜索没有返回可引用链接。"])
  ].join("\n");
}

function replyMarkdown(state: WorkflowRunState, options: WorkflowRunOptions, topic: unknown): string {
  const source = isRecord(topic) && isRecord(topic.result) ? topic.result : topic;
  const normalized = isRecord(source) ? topicFromApiData(source) : {};
  const answer = effectiveAnswer(state, options);
  const reference = compactObject({
    id: normalized.id ?? effectiveTopicId(state, options),
    title: normalized.title,
    url: normalized.url ?? normalized.threadUrl,
    originalUrl: normalized.originalUrl
  });
  const referenceText = fieldText(reference.url ?? reference.originalUrl);
  return [
    "## 简短回应",
    "",
    "我建议先按下面步骤排查。",
    blockText(answer),
    "",
    "## 建议步骤",
    "",
    `- ${blockText(answer)}`,
    "",
    "## 参考链接",
    "",
    referenceText ? `1. ${fieldText(reference.title ?? reference.id ?? "topic")} - ${referenceText}` : "无参考链接。"
  ].join("\n");
}

function reviewArtifact(state: WorkflowRunState, options: WorkflowRunOptions, contentFile: string, content: string): Record<string, unknown> {
  const issues = [];
  if (content.includes("待补充")) {
    issues.push({ code: "placeholder-content", severity: "issue", message: "Content still contains 待补充 placeholders" });
  }
  return {
    kind: "workflow-review",
    schemaVersion: 1,
    request: {
      contentFile,
      title: effectiveTitle(state, options),
      categoryId: effectiveCategoryId(state, options)
    },
    result: {
      ok: issues.length === 0,
      issues,
      warnings: [],
      metrics: {
        titleLength: effectiveTitle(state, options).length,
        contentLength: content.length,
        referenceCount: (content.match(/https?:\/\/\S+/g) ?? []).length
      }
    }
  };
}

function parseWorkflowRunGoal(value: string): WorkflowRunGoal {
  if (value === "ask-question" || value === "reply") {
    return value;
  }
  throw new InvalidArgumentError(`Expected workflow run goal ask-question or reply: ${value}`);
}

function isWorkflowRunGoal(value: unknown): value is WorkflowRunGoal {
  return value === "ask-question" || value === "reply";
}

async function writeRunState(runDir: string, state: WorkflowRunState): Promise<void> {
  touchState(state);
  await writeJson(join(runDir, "run.json"), state);
}

function touchState(state: WorkflowRunState): void {
  state.updatedAt = now();
}

function stepState(state: WorkflowRunState, id: string): WorkflowRunStep {
  let item = state.steps.find((step) => step.id === id);
  if (!item) {
    item = { id, status: "pending" };
    state.steps.push(item);
  }
  return item;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function previewRequest(path: string, expectedPath: string): Promise<{ path: string; body: unknown }> {
  const preview = await readJson(path);
  if (!isRecord(preview) || preview.kind !== "workflow-preview" || !isRecord(preview.request)) {
    throw new Error(`Invalid workflow preview artifact: ${path}`);
  }
  const method = preview.request.method;
  const requestPath = preview.request.path;
  if (method !== "POST" || requestPath !== expectedPath) {
    throw new Error(`Workflow preview artifact does not match expected POST ${expectedPath}.`);
  }
  return { path: requestPath, body: preview.request.body };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function now(): string {
  return new Date().toISOString();
}

function requestIdFrom(data: unknown): string | undefined {
  if (isRecord(data) && typeof data.requestId === "string") {
    return data.requestId;
  }
  if (isRecord(data) && isRecord(data.result) && typeof data.result.requestId === "string") {
    return data.result.requestId;
  }
  return undefined;
}

function itemsFromData(data: unknown): Array<Record<string, unknown>> {
  if (!isRecord(data) || !Array.isArray(data.items)) {
    return [];
  }
  return data.items.filter(isRecord);
}

function topicIdFromItem(item: Record<string, unknown>): number | undefined {
  for (const key of ["id", "topicId", "threadId"]) {
    const value = item[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function topicFromApiData(data: unknown): Record<string, unknown> {
  if (isRecord(data) && isRecord(data.topic)) {
    return data.topic;
  }
  return isRecord(data) ? data : {};
}

function researchLinks(items: Array<Record<string, unknown>>, topics: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return [...items, ...topics].map((item) => compactObject({
    id: item.id ?? item.topicId ?? item.threadId,
    title: item.title ?? item.topicTitle,
    url: item.url ?? item.threadUrl,
    originalUrl: item.originalUrl
  })).filter((item) => Object.keys(item).length > 0).filter((item) => {
    const key = [item.id, item.url, item.originalUrl].map(fieldText).join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

function effectiveKeyword(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.keyword ?? state.inputs.keyword).trim();
  if (!value) {
    throw new Error("Workflow run is missing keyword input.");
  }
  return value;
}

function effectiveTitle(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.title ?? state.inputs.title).trim();
  if (!value) {
    throw new Error("Workflow run is missing title input.");
  }
  return value;
}

function effectiveProblem(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.problem ?? state.inputs.problem).trim();
  if (!value) {
    throw new Error("Workflow run is missing problem input.");
  }
  return value;
}

function effectiveAnswer(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.answer ?? state.inputs.answer).trim();
  if (!value) {
    throw new Error("Workflow run is missing answer input.");
  }
  return value;
}

function effectiveCategoryId(state: WorkflowRunState, options: WorkflowRunOptions): number {
  const value = options.categoryId ?? state.inputs.categoryId;
  if (value === undefined) {
    throw new Error("Workflow run is missing category id input.");
  }
  return value;
}

function effectiveTopicId(state: WorkflowRunState, options: WorkflowRunOptions): number {
  const value = options.topicId ?? state.inputs.topicId;
  if (value === undefined) {
    throw new Error("Workflow run is missing topic id input.");
  }
  return value;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/\b[A-Za-z0-9]{26,}\b/g, "[redacted]");
}

function handleRunError(io: CommandIo, error: unknown, session: Session): void {
  if (error instanceof HttpError) {
    const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
    printError(io, {
      type: "http",
      message: redactSecret(error.message, session.token),
      status: error.status,
      requestId: error.requestId
    }, `HTTP ${error.status}: ${redactSecret(error.message, session.token)}${requestId}\n`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    printError(io, { type: error instanceof TimeoutError ? "timeout" : "network", message: error.message });
    process.exitCode = 1;
    return;
  }
  throw error;
}

function formatWorkflowRunText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.steps)) {
    return "";
  }
  const steps = data.steps.filter(isRecord).map((step) => `${fieldText(step.id)}\t${fieldText(step.status)}`);
  return [
    `Run: ${fieldText(data.runId)}`,
    `Goal: ${fieldText(data.goal)}`,
    `Status: ${fieldText(data.status)}`,
    `Next: ${fieldText(data.nextAction)}`,
    "Steps:",
    ...steps
  ].join("\n");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function workflowFiles(outputDir = "."): Record<string, string> {
  const dir = outputDir.replace(/\/+$/, "") || ".";
  return {
    research: `${dir}/research.json`,
    topic: `${dir}/topic.json`,
    question: `${dir}/question.md`,
    reply: `${dir}/reply.md`
  };
}

function missingInputsForGoal(options: WorkflowPlanOptions): string[] {
  const missing = [];
  if ((options.goal === "ask-question" || options.goal === "research-only") && !fieldText(options.keyword).trim()) {
    missing.push("--keyword");
  }
  if ((options.goal === "ask-question" || options.goal === "publish-topic") && options.categoryId === undefined) {
    missing.push("--category-id");
  }
  if ((options.goal === "ask-question" || options.goal === "publish-topic") && !fieldText(options.title).trim()) {
    missing.push("--title");
  }
  if (options.goal === "ask-question" && !fieldText(options.problem).trim()) {
    missing.push("--problem");
  }
  if ((options.goal === "reply") && options.topicId === undefined) {
    missing.push("--topic-id");
  }
  if (options.goal === "reply" && !fieldText(options.answer).trim()) {
    missing.push("--answer");
  }
  if (options.goal === "publish-topic" && !options.contentFile) {
    missing.push("--content-file");
  }
  return missing;
}

function researchCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn research ${shellArg(options.keyword ?? "<keyword>")} --limit 3 --json > ${shellArg(files.research)}`;
}

function draftQuestionCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn draft question --title ${shellArg(options.title ?? "<title>")} --problem ${shellArg(options.problem ?? "<problem>")} --research-file ${shellArg(files.research)} --format text > ${shellArg(files.question)}`;
}

function reviewTopicCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn review topic --title ${shellArg(options.title ?? "<title>")} --content-file ${shellArg(contentFile(options, files))}${options.categoryId === undefined ? "" : ` --category-id ${options.categoryId}`} --json`;
}

function topicCreateCommand(options: WorkflowPlanOptions, files: Record<string, string>, preview: boolean): string {
  const category = options.categoryId === undefined ? "--category-id <id>" : `--category-id ${options.categoryId}`;
  return `apexcn topic create ${category} --title ${shellArg(options.title ?? "<title>")} --content-file ${shellArg(contentFile(options, files))} ${preview ? "--preview" : "--json"}`;
}

function topicViewCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn topic view ${options.topicId ?? "<topic-id>"} --json > ${shellArg(files.topic)}`;
}

function draftReplyCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn draft reply --topic-id ${options.topicId ?? "<topic-id>"} --answer ${shellArg(options.answer ?? "<answer>")} --topic-file ${shellArg(files.topic)} --format text > ${shellArg(files.reply)}`;
}

function replyCreateCommand(options: WorkflowPlanOptions, files: Record<string, string>, preview: boolean): string {
  return `apexcn reply create ${options.topicId ?? "<topic-id>"} --content-file ${shellArg(files.reply)} ${preview ? "--preview" : "--json"}`;
}

function contentFile(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return options.contentFile ?? files.question;
}

function step(id: string, label: string, command: string, mode: WorkflowStepMode, inputFiles: string[], outputFiles: string[], requiresConfirmation: boolean): WorkflowStep {
  return { id, label, command, mode, inputFiles, outputFiles, requiresConfirmation };
}

function safetySummary(steps: WorkflowStep[]): WorkflowPlan["safetySummary"] {
  return {
    localSteps: steps.filter((step) => step.mode === "local").length,
    apiReadSteps: steps.filter((step) => step.mode === "api-read").length,
    apiWritePreviewSteps: steps.filter((step) => step.mode === "api-write-preview").length,
    apiWriteExecuteSteps: steps.filter((step) => step.mode === "api-write-execute").length,
    requiresConfirmation: steps.some((step) => step.requiresConfirmation)
  };
}

function formatWorkflowPlanText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.steps)) {
    return "";
  }
  const missing = isRecord(data.checkpoints) && Array.isArray(data.checkpoints.missingInputs) ? data.checkpoints.missingInputs.map(fieldText) : [];
  const steps = data.steps.filter(isRecord);
  return [
    `Workflow: ${fieldText(data.goal)}`,
    missing.length > 0 ? `Missing inputs: ${missing.join(", ")}` : "Missing inputs: none",
    "Steps:",
    ...steps.map((item, index) => `${index + 1}. [${fieldText(item.mode)}] ${fieldText(item.command)}${item.requiresConfirmation === true ? " (requires confirmation)" : ""}`)
  ].join("\n");
}

function parseWorkflowGoal(value: string): WorkflowGoal {
  if (value === "ask-question" || value === "reply" || value === "research-only" || value === "publish-topic") {
    return value;
  }
  throw new InvalidArgumentError(`Expected goal ask-question, reply, research-only, or publish-topic: ${value}`);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer: ${value}`);
  }
  return parsed;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
