export type WorkflowGoal =
  | "ask-question"
  | "reply"
  | "research-only"
  | "publish-topic"
  | "topic-create"
  | "topic-update"
  | "topic-delete"
  | "reply-create"
  | "reply-update"
  | "reply-delete";
export type WorkflowStepMode = "local" | "api-read" | "api-write-preview" | "api-write-execute";

export type WorkflowPlanInput = {
  goal: WorkflowGoal;
  keyword?: string;
  topicId?: number;
  replyId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  contentFile?: string;
  ifVersion?: number;
  confirmTitle?: string;
  confirmId?: number;
  outputDir?: string;
  includeExecute?: boolean;
};

export type WorkflowStep = {
  id: string;
  label: string;
  command: string;
  mode: WorkflowStepMode;
  inputFiles: string[];
  outputFiles: string[];
  requiresConfirmation: boolean;
};

export type WorkflowPlan = {
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

export function createWorkflowPlan(input: WorkflowPlanInput): WorkflowPlan {
  const files = workflowFiles(input.outputDir);
  const missingInputs = missingInputsForGoal(input);
  const steps = stepsForGoal(input, files);
  const confirmations = steps.filter((item) => item.requiresConfirmation).map((item) => item.id);
  return {
    kind: "workflow-plan",
    schemaVersion: 1,
    goal: input.goal,
    steps,
    checkpoints: { missingInputs, confirmations },
    files,
    safetySummary: safetySummary(steps)
  };
}

function stepsForGoal(input: WorkflowPlanInput, files: Record<string, string>): WorkflowStep[] {
  if (input.goal === "research-only") {
    return [step("research", "Build research bundle", researchCommand(input, files), "api-read", [], [files.research], false)];
  }
  if (input.goal === "ask-question") {
    const steps = [
      step("research", "Build research bundle", researchCommand(input, files), "api-read", [], [files.research], false),
      step("draft-question", "Draft local question", draftQuestionCommand(input, files), "local", [files.research], [files.question], false),
      step("review-topic", "Review local topic draft", reviewTopicCommand(input, files), "local", [files.question], [], false),
      step("preview-topic-create", "Run auditable topic create preview", workflowRunPreviewCommand(input, files), "api-write-preview", [files.question], [files.preview], false)
    ];
    return input.includeExecute
      ? withApprovalAndExecute(steps, "topic-create", files)
      : steps;
  }
  if (input.goal === "reply") {
    const steps = [
      step("topic-view", "Fetch topic context", topicViewCommand(input, files), "api-read", [], [files.topic], false),
      step("draft-reply", "Draft local reply", draftReplyCommand(input, files), "local", [files.topic], [files.reply], false),
      step("review-reply", "Review local reply draft", `apexcn review reply --content-file ${shellArg(files.reply)} --json`, "local", [files.reply], [], false),
      step("preview-reply-create", "Run auditable reply create preview", workflowRunPreviewCommand(input, files), "api-write-preview", [files.reply], [files.preview], false)
    ];
    return input.includeExecute
      ? withApprovalAndExecute(steps, "reply-create", files)
      : steps;
  }
  if (isContentWorkflowGoal(input.goal)) {
    const content = input.goal.endsWith("-create") || input.goal.endsWith("-update");
    const steps = [
      ...(content ? [step("review-content", "Review content before preview", reviewContentCommand(input), "local", [contentFile(input, files)], [], false)] : []),
      step(`preview-${input.goal}`, `Run auditable ${input.goal} preview`, workflowRunPreviewCommand(input, files), "api-write-preview", content ? [contentFile(input, files)] : [], [files.preview], false)
    ];
    return input.includeExecute ? withApprovalAndExecute(steps, input.goal, files) : steps;
  }
  const steps = [
    step("review-topic", "Review existing topic Markdown", reviewTopicCommand(input, files), "local", [contentFile(input, files)], [], false),
    step("preview-topic-create", "Run auditable topic create preview", workflowRunPreviewCommand({ ...input, goal: "topic-create" }, files), "api-write-preview", [contentFile(input, files)], [files.preview], false)
  ];
  return input.includeExecute
    ? withApprovalAndExecute(steps, "topic-create", files)
    : steps;
}

function workflowFiles(outputDir = "."): Record<string, string> {
  const dir = outputDir.replace(/\/+$/, "") || ".";
  return {
    runDir: dir,
    research: `${dir}/research.json`,
    topic: `${dir}/topic.json`,
    question: `${dir}/question.md`,
    reply: `${dir}/reply.md`,
    preview: `${dir}/preview.json`,
    approval: `${dir}/approval.json`,
    execute: `${dir}/execute.json`
  };
}

function missingInputsForGoal(input: WorkflowPlanInput): string[] {
  const missing = [];
  if ((input.goal === "ask-question" || input.goal === "research-only") && !text(input.keyword)) missing.push("--keyword");
  if ((input.goal === "ask-question" || input.goal === "publish-topic") && input.categoryId === undefined) missing.push("--category-id");
  if ((input.goal === "ask-question" || input.goal === "publish-topic") && !text(input.title)) missing.push("--title");
  if (input.goal === "ask-question" && !text(input.problem)) missing.push("--problem");
  if (input.goal === "reply" && input.topicId === undefined) missing.push("--topic-id");
  if (input.goal === "reply" && !text(input.answer)) missing.push("--answer");
  if (input.goal === "publish-topic" && !input.contentFile) missing.push("--content-file");
  if (input.goal === "topic-create") {
    if (input.categoryId === undefined) missing.push("--category-id");
    if (!text(input.title)) missing.push("--title");
    if (!input.contentFile) missing.push("--content-file");
  }
  if (input.goal === "topic-update") {
    if (input.topicId === undefined) missing.push("--topic-id");
    if (input.ifVersion === undefined) missing.push("--if-version");
    if (!input.contentFile && !text(input.title) && input.categoryId === undefined) missing.push("--content-file|--title|--category-id");
  }
  if (input.goal === "topic-delete") {
    if (input.topicId === undefined) missing.push("--topic-id");
    if (input.ifVersion === undefined) missing.push("--if-version");
    if (!text(input.confirmTitle)) missing.push("--confirm-title");
  }
  if (input.goal === "reply-create") {
    if (input.topicId === undefined) missing.push("--topic-id");
    if (!input.contentFile) missing.push("--content-file");
  }
  if (input.goal === "reply-update") {
    if (input.replyId === undefined) missing.push("--reply-id");
    if (input.ifVersion === undefined) missing.push("--if-version");
    if (!input.contentFile) missing.push("--content-file");
  }
  if (input.goal === "reply-delete") {
    if (input.replyId === undefined) missing.push("--reply-id");
    if (input.ifVersion === undefined) missing.push("--if-version");
    if (input.confirmId === undefined) missing.push("--confirm-id");
    if (input.replyId !== undefined && input.confirmId !== undefined && input.replyId !== input.confirmId) {
      missing.push("--confirm-id must match --reply-id");
    }
  }
  return missing;
}

function researchCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn research ${shellArg(input.keyword ?? "<keyword>")} --limit 3 --json > ${shellArg(files.research)}`;
}

function draftQuestionCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn draft question --title ${shellArg(input.title ?? "<title>")} --problem ${shellArg(input.problem ?? "<problem>")} --research-file ${shellArg(files.research)} --format text > ${shellArg(files.question)}`;
}

function reviewTopicCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn review topic --title ${shellArg(input.title ?? "<title>")} --content-file ${shellArg(contentFile(input, files))}${input.categoryId === undefined ? "" : ` --category-id ${input.categoryId}`} --json`;
}

function topicViewCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn topic view ${input.topicId ?? "<topic-id>"} --json > ${shellArg(files.topic)}`;
}

function draftReplyCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn draft reply --topic-id ${input.topicId ?? "<topic-id>"} --answer ${shellArg(input.answer ?? "<answer>")} --topic-file ${shellArg(files.topic)} --format text > ${shellArg(files.reply)}`;
}

function withApprovalAndExecute(
  steps: WorkflowStep[],
  goal: string,
  files: Record<string, string>
): WorkflowStep[] {
  return [
    ...steps,
    step(`approve-${goal}`, "Approve the exact preview hash", `apexcn workflow approve --run-dir ${shellArg(files.runDir)} --json`, "local", [files.preview], [files.approval], true),
    step(`execute-${goal}`, "Execute the approved request", `apexcn workflow run --resume ${shellArg(files.runDir)} --execute --yes --json`, "api-write-execute", [files.preview, files.approval], [files.execute], true)
  ];
}

function workflowRunPreviewCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  const goal = input.goal === "publish-topic" ? "topic-create" : input.goal;
  const args = ["apexcn", "workflow", "run", "--goal", goal];
  if (input.keyword) args.push("--keyword", shellArg(input.keyword));
  if (input.topicId !== undefined) args.push("--topic-id", String(input.topicId));
  if (input.replyId !== undefined) args.push("--reply-id", String(input.replyId));
  if (input.categoryId !== undefined) args.push("--category-id", String(input.categoryId));
  if (input.title) args.push("--title", shellArg(input.title));
  if (input.problem) args.push("--problem", shellArg(input.problem));
  if (input.answer) args.push("--answer", shellArg(input.answer));
  if (input.contentFile) args.push("--content-file", shellArg(input.contentFile));
  if (input.ifVersion !== undefined) args.push("--if-version", String(input.ifVersion));
  if (input.confirmTitle) args.push("--confirm-title", shellArg(input.confirmTitle));
  if (input.confirmId !== undefined) args.push("--confirm-id", String(input.confirmId));
  args.push("--output-dir", shellArg(files.runDir), "--json");
  return args.join(" ");
}

function reviewContentCommand(input: WorkflowPlanInput): string {
  const kind = input.goal.startsWith("reply-") ? "reply" : "topic";
  return `apexcn review ${kind} --content-file ${shellArg(input.contentFile ?? "<content-file>")} --json`;
}

function isContentWorkflowGoal(goal: WorkflowGoal): boolean {
  return goal === "topic-create"
    || goal === "topic-update"
    || goal === "topic-delete"
    || goal === "reply-create"
    || goal === "reply-update"
    || goal === "reply-delete";
}

function contentFile(input: WorkflowPlanInput, files: Record<string, string>): string {
  return input.contentFile ?? files.question;
}

function step(id: string, label: string, command: string, mode: WorkflowStepMode, inputFiles: string[], outputFiles: string[], requiresConfirmation: boolean): WorkflowStep {
  return { id, label, command, mode, inputFiles, outputFiles, requiresConfirmation };
}

function safetySummary(steps: WorkflowStep[]): WorkflowPlan["safetySummary"] {
  return {
    localSteps: steps.filter((item) => item.mode === "local").length,
    apiReadSteps: steps.filter((item) => item.mode === "api-read").length,
    apiWritePreviewSteps: steps.filter((item) => item.mode === "api-write-preview").length,
    apiWriteExecuteSteps: steps.filter((item) => item.mode === "api-write-execute").length,
    requiresConfirmation: steps.some((item) => item.requiresConfirmation)
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
