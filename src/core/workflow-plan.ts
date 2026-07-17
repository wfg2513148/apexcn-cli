export type WorkflowGoal = "ask-question" | "reply" | "research-only" | "publish-topic";
export type WorkflowStepMode = "local" | "api-read" | "api-write-preview" | "api-write-execute";

export type WorkflowPlanInput = {
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
      step("preview-topic-create", "Preview topic create API request", topicCreateCommand(input, files, true), "api-write-preview", [files.question], [], false)
    ];
    return input.includeExecute
      ? [...steps, step("execute-topic-create", "Create topic after confirmation", topicCreateCommand(input, files, false), "api-write-execute", [files.question], [], true)]
      : steps;
  }
  if (input.goal === "reply") {
    const steps = [
      step("topic-view", "Fetch topic context", topicViewCommand(input, files), "api-read", [], [files.topic], false),
      step("draft-reply", "Draft local reply", draftReplyCommand(input, files), "local", [files.topic], [files.reply], false),
      step("preview-reply-create", "Preview reply create API request", replyCreateCommand(input, files, true), "api-write-preview", [files.reply], [], false)
    ];
    return input.includeExecute
      ? [...steps, step("execute-reply-create", "Create reply after confirmation", replyCreateCommand(input, files, false), "api-write-execute", [files.reply], [], true)]
      : steps;
  }
  const steps = [
    step("review-topic", "Review existing topic Markdown", reviewTopicCommand(input, files), "local", [contentFile(input, files)], [], false),
    step("preview-topic-create", "Preview topic create API request", topicCreateCommand(input, files, true), "api-write-preview", [contentFile(input, files)], [], false)
  ];
  return input.includeExecute
    ? [...steps, step("execute-topic-create", "Create topic after confirmation", topicCreateCommand(input, files, false), "api-write-execute", [contentFile(input, files)], [], true)]
    : steps;
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

function missingInputsForGoal(input: WorkflowPlanInput): string[] {
  const missing = [];
  if ((input.goal === "ask-question" || input.goal === "research-only") && !text(input.keyword)) missing.push("--keyword");
  if ((input.goal === "ask-question" || input.goal === "publish-topic") && input.categoryId === undefined) missing.push("--category-id");
  if ((input.goal === "ask-question" || input.goal === "publish-topic") && !text(input.title)) missing.push("--title");
  if (input.goal === "ask-question" && !text(input.problem)) missing.push("--problem");
  if (input.goal === "reply" && input.topicId === undefined) missing.push("--topic-id");
  if (input.goal === "reply" && !text(input.answer)) missing.push("--answer");
  if (input.goal === "publish-topic" && !input.contentFile) missing.push("--content-file");
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

function topicCreateCommand(input: WorkflowPlanInput, files: Record<string, string>, preview: boolean): string {
  const category = input.categoryId === undefined ? "--category-id <id>" : `--category-id ${input.categoryId}`;
  return `apexcn topic create ${category} --title ${shellArg(input.title ?? "<title>")} --content-file ${shellArg(contentFile(input, files))} ${preview ? "--preview" : "--json"}`;
}

function topicViewCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn topic view ${input.topicId ?? "<topic-id>"} --json > ${shellArg(files.topic)}`;
}

function draftReplyCommand(input: WorkflowPlanInput, files: Record<string, string>): string {
  return `apexcn draft reply --topic-id ${input.topicId ?? "<topic-id>"} --answer ${shellArg(input.answer ?? "<answer>")} --topic-file ${shellArg(files.topic)} --format text > ${shellArg(files.reply)}`;
}

function replyCreateCommand(input: WorkflowPlanInput, files: Record<string, string>, preview: boolean): string {
  return `apexcn reply create ${input.topicId ?? "<topic-id>"} --content-file ${shellArg(files.reply)} ${preview ? "--preview" : "--json"}`;
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
