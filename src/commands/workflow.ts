import { Command, InvalidArgumentError, Option } from "commander";
import { fieldText, isRecord, outputFormat, parseOutputFormat, printData, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type WorkflowGoal = "ask-question" | "reply" | "research-only" | "publish-topic";
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

export function createWorkflowCommand(options: CommandIo): Command {
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

  return workflow;
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
