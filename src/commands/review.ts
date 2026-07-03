import { readFile } from "node:fs/promises";
import { stdin as processStdin } from "node:process";
import { Command, InvalidArgumentError, Option } from "commander";
import { blockText, fieldText, isRecord, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type ReviewCommandOptions = CommandIo & {
  readStdin?: () => Promise<string>;
};

type ReviewTopicOptions = FormatOption & {
  title?: string;
  contentFile?: string;
  draftFile?: string;
  categoryId?: number;
  tags?: string;
};

type ReviewMessage = {
  code: string;
  severity: "issue" | "warning";
  message: string;
};

type ReviewReport = {
  kind: "topic-review";
  schemaVersion: 1;
  ok: boolean;
  issues: ReviewMessage[];
  warnings: ReviewMessage[];
  metrics: {
    titleLength: number;
    contentLength: number;
    referenceCount: number;
    sectionCount: number;
  };
  requestPlan: {
    method: "POST";
    path: "/api/v1/topics";
    body: {
      categoryId?: number;
      title: string;
      content: string;
      tags?: string;
    };
  };
  suggestedCommand: {
    command: string;
    contentFileRequired: boolean;
  } | null;
};

type TopicInput = {
  title: string;
  content: string;
  contentFileForCommand?: string;
  source: "content-file" | "draft-file" | "stdin";
};

const REQUIRED_SECTIONS = ["问题", "环境", "已尝试", "期望结果", "实际结果"] as const;
const MIN_CONTENT_LENGTH = 80;

export function createReviewCommand(options: ReviewCommandOptions): Command {
  const review = new Command("review");

  review
    .command("topic")
    .option("--title <title>", "topic title when using --content-file")
    .addOption(new Option("--content-file <path>", "read Markdown content from a file or - for stdin").conflicts("draftFile"))
    .addOption(new Option("--draft-file <path>", "read a question-draft JSON file or - for stdin").conflicts(["title", "contentFile"]))
    .option("--category-id <id>", "category id for the local request plan", parsePositiveInteger)
    .option("--tags <csv>", "topic tags for the local request plan")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: ReviewTopicOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const input = await topicInput(commandOptions, options);
      if (!input) {
        return;
      }
      const report = reviewTopic(input, commandOptions);
      if (!report.ok) {
        process.exitCode = 1;
      }
      printData(options, report, outputFormat(commandOptions), formatReviewTopicText);
    });

  return review;
}

async function topicInput(commandOptions: ReviewTopicOptions, options: ReviewCommandOptions): Promise<TopicInput | undefined> {
  if (commandOptions.draftFile) {
    return topicInputFromDraft(commandOptions.draftFile, options);
  }
  if (!commandOptions.contentFile) {
    printError(options, { type: "validation", message: "Missing --content-file or --draft-file" });
    process.exitCode = 1;
    return undefined;
  }
  if (commandOptions.title === undefined) {
    printError(options, { type: "validation", message: "--title is required when using --content-file" });
    process.exitCode = 1;
    return undefined;
  }
  const title = blockText(commandOptions.title);
  const rawContent = await readReviewFile(commandOptions.contentFile, options, "Content");
  if (rawContent === undefined) {
    return undefined;
  }
  const content = blockText(rawContent);
  return {
    title,
    content,
    contentFileForCommand: commandOptions.contentFile === "-" ? undefined : commandOptions.contentFile,
    source: commandOptions.contentFile === "-" ? "stdin" : "content-file"
  };
}

async function topicInputFromDraft(path: string, options: ReviewCommandOptions): Promise<TopicInput | undefined> {
  const text = await readReviewFile(path, options, "Draft");
  if (text === undefined) {
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      printError(options, { type: "validation", message: `Invalid draft file: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
  if (!isQuestionDraft(data)) {
    printError(options, { type: "validation", message: `Invalid draft file: ${path} must contain a question-draft schema` });
    process.exitCode = 1;
    return undefined;
  }
  return {
    title: blockText(data.title),
    content: blockText(data.content),
    source: "draft-file"
  };
}

async function readReviewFile(path: string, options: ReviewCommandOptions, label: "Content" | "Draft"): Promise<string | undefined> {
  if (path === "-") {
    return readStdin(options);
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      printError(options, { type: "validation", message: `${label} file not found: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    if (isNodeError(error) && error.code === "EACCES") {
      printError(options, { type: "validation", message: `${label} file is not readable: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

function reviewTopic(input: TopicInput, options: ReviewTopicOptions): ReviewReport {
  const issues = hardIssues(input);
  const warnings = softWarnings(input, options);
  const safeContent = issues.some((issue) => issue.code === "possible-secret") ? redactSensitiveContent(input.content) : input.content;
  const requestPlan = {
    method: "POST" as const,
    path: "/api/v1/topics" as const,
    body: compactBody({
      categoryId: options.categoryId,
      title: input.title,
      content: safeContent,
      tags: fieldText(options.tags).trim() || undefined
    }) as ReviewReport["requestPlan"]["body"]
  };
  return {
    kind: "topic-review",
    schemaVersion: 1,
    ok: issues.length === 0,
    issues,
    warnings,
    metrics: {
      titleLength: input.title.length,
      contentLength: input.content.length,
      referenceCount: referenceCount(input.content),
      sectionCount: sectionCount(input.content)
    },
    requestPlan,
    suggestedCommand: suggestedTopicCreateCommand(input, options)
  };
}

function hardIssues(input: TopicInput): ReviewMessage[] {
  const issues: ReviewMessage[] = [];
  if (!input.title) {
    issues.push({ code: "blank-title", severity: "issue", message: "Title must not be blank" });
  }
  if (!input.content) {
    issues.push({ code: "blank-content", severity: "issue", message: "Content must not be blank" });
  }
  if (input.content && input.content.length < MIN_CONTENT_LENGTH) {
    issues.push({ code: "content-too-short", severity: "issue", message: `Content must be at least ${MIN_CONTENT_LENGTH} characters` });
  }
  if (input.content.includes("待补充")) {
    issues.push({ code: "placeholder-content", severity: "issue", message: "Content still contains 待补充 placeholders" });
  }
  if (secretPattern().test(input.content)) {
    issues.push({ code: "possible-secret", severity: "issue", message: "Content appears to contain a token, Authorization header, or password" });
  }
  return issues;
}

function softWarnings(input: TopicInput, options: ReviewTopicOptions): ReviewMessage[] {
  const warnings: ReviewMessage[] = [];
  if (options.categoryId === undefined) {
    warnings.push({ code: "missing-category-id", severity: "warning", message: "Add --category-id before API preview or publish" });
  }
  if (input.source !== "content-file") {
    warnings.push({ code: "unsaved-content-file", severity: "warning", message: "Save the reviewed Markdown to a file before running topic create --content-file" });
  }
  if (referenceCount(input.content) === 0) {
    warnings.push({ code: "missing-reference", severity: "warning", message: "Content does not include a visible http(s) reference link" });
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(input.content)) {
      warnings.push({ code: `missing-section-${section}`, severity: "warning", message: `Missing section: ${section}` });
    }
  }
  return warnings;
}

function suggestedTopicCreateCommand(input: TopicInput, options: ReviewTopicOptions): ReviewReport["suggestedCommand"] {
  if (!input.contentFileForCommand) {
    return null;
  }
  const contentFile = input.contentFileForCommand ?? "<content.md>";
  const args = [
    "apexcn",
    "topic",
    "create",
    options.categoryId === undefined ? undefined : "--category-id",
    options.categoryId === undefined ? undefined : String(options.categoryId),
    "--title",
    input.title,
    "--content-file",
    contentFile,
    options.tags ? "--tags" : undefined,
    options.tags,
    "--preview"
  ].filter((value): value is string => value !== undefined);
  return {
    command: args.map(shellArg).join(" "),
    contentFileRequired: false
  };
}

function formatReviewTopicText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const issues = Array.isArray(data.issues) ? data.issues.filter(isRecord) : [];
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter(isRecord) : [];
  const metrics = isRecord(data.metrics) ? data.metrics : {};
  const suggested = isRecord(data.suggestedCommand) ? data.suggestedCommand : {};
  return [
    `Status: ${data.ok === true ? "ok" : "needs changes"}`,
    `Title length: ${fieldText(metrics.titleLength)}`,
    `Content length: ${fieldText(metrics.contentLength)}`,
    `References: ${fieldText(metrics.referenceCount)}`,
    issues.length > 0 ? "Issues:" : undefined,
    ...issues.map((issue) => `- ${fieldText(issue.code)}: ${fieldText(issue.message)}`),
    warnings.length > 0 ? "Warnings:" : undefined,
    ...warnings.map((warning) => `- ${fieldText(warning.code)}: ${fieldText(warning.message)}`),
    suggested.command ? `Suggested preview: ${fieldText(suggested.command)}` : "Suggested preview: unavailable until content is saved as Markdown"
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function isQuestionDraft(value: unknown): value is { kind: "question-draft"; schemaVersion: 1; title: string; content: string } {
  return isRecord(value) &&
    !Array.isArray(value) &&
    value.kind === "question-draft" &&
    value.schemaVersion === 1 &&
    typeof value.title === "string" &&
    typeof value.content === "string";
}

function readStdin(options: ReviewCommandOptions): Promise<string> {
  if (options.readStdin) {
    return options.readStdin();
  }
  return new Promise((resolve, reject) => {
    let text = "";
    processStdin.setEncoding("utf8");
    processStdin.on("data", (chunk) => {
      text += chunk;
    });
    processStdin.on("end", () => resolve(text));
    processStdin.on("error", reject);
    processStdin.resume();
  });
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer: ${value}`);
  }
  return parsed;
}

function referenceCount(content: string): number {
  return (content.match(/https?:\/\/\S+/g) ?? []).length;
}

function sectionCount(content: string): number {
  return (content.match(/^##\s+.+$/gm) ?? []).length;
}

function secretPattern(): RegExp {
  return /\b(Authorization:\s*Bearer\s+\S+|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|APEXCN_API_KEY\s*=|password\s*=|token\s*=)\b/i;
}

function redactSensitiveContent(content: string): string {
  return content
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [redacted]")
    .replace(/APEXCN_API_KEY\s*=\s*\S+/gi, "APEXCN_API_KEY=[redacted]")
    .replace(/password\s*=\s*\S+/gi, "password=[redacted]")
    .replace(/token\s*=\s*\S+/gi, "token=[redacted]");
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function compactBody(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
