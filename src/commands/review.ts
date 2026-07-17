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
  content?: string;
  contentFile?: string;
  draftFile?: string;
  categoryId?: number;
  tags?: string;
};

type ReviewReplyOptions = FormatOption & {
  topicId?: string;
  parentPostId?: string;
  contentFile?: string;
  draftFile?: string;
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

type ReplyInput = {
  topicId?: number;
  parentPostId?: number;
  content: string;
  contentFileForCommand?: string;
  source?: "content-file" | "draft-file" | "stdin";
};

type ReplyReviewReport = {
  kind: "reply-review";
  schemaVersion: 1;
  ok: boolean;
  issues: ReviewMessage[];
  warnings: ReviewMessage[];
  metrics: {
    contentLength: number;
    referenceCount: number;
    lineCount: number;
    duplicateLineCount: number;
  };
  requestPlan: {
    method: "POST";
    path: string;
    body: {
      content: string;
      parentPostId?: number;
    };
  } | null;
  suggestedCommand: {
    command: string;
    contentFileRequired: boolean;
  } | null;
};

const REQUIRED_SECTIONS = ["问题", "环境", "已尝试", "期望结果", "实际结果"] as const;
const MIN_CONTENT_LENGTH = 80;
const MIN_REPLY_CONTENT_LENGTH = 20;
const MAX_REPLY_CONTENT_LENGTH = 4000;

export function createReviewCommand(options: ReviewCommandOptions): Command {
  const review = new Command("review");

  review
    .command("topic")
    .option("--title <title>", "topic title when using --content or --content-file")
    .addOption(new Option("--content <markdown>", "review inline Markdown content").conflicts(["contentFile", "draftFile"]))
    .addOption(new Option("--content-file <path>", "read Markdown content from a file or - for stdin").conflicts(["content", "draftFile"]))
    .addOption(new Option("--draft-file <path>", "read a question-draft JSON file or - for stdin").conflicts(["title", "content", "contentFile"]))
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

  review
    .command("reply")
    .option("--topic-id <id>", "topic id")
    .option("--parent-post-id <id>", "parent reply id")
    .option("--content-file <path>", "read Markdown reply content from a file or - for stdin")
    .option("--draft-file <path>", "read a reply-draft JSON file or - for stdin")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: ReviewReplyOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const report = await reviewReply(commandOptions, options);
      if (!report.ok) {
        process.exitCode = 1;
      }
      printData(options, report, outputFormat(commandOptions), formatReviewReplyText);
    });

  return review;
}

async function topicInput(commandOptions: ReviewTopicOptions, options: ReviewCommandOptions): Promise<TopicInput | undefined> {
  if (commandOptions.draftFile) {
    return topicInputFromDraft(commandOptions.draftFile, options);
  }
  if (!commandOptions.contentFile && commandOptions.content === undefined) {
    printError(options, { type: "validation", message: "Missing --content, --content-file, or --draft-file" });
    process.exitCode = 1;
    return undefined;
  }
  if (commandOptions.title === undefined) {
    printError(options, { type: "validation", message: "--title is required when using --content or --content-file" });
    process.exitCode = 1;
    return undefined;
  }
  const title = blockText(commandOptions.title);
  const rawContent = commandOptions.content === undefined
    ? await readReviewFile(commandOptions.contentFile as string, options, "Content")
    : commandOptions.content;
  if (rawContent === undefined) {
    return undefined;
  }
  const content = blockText(rawContent);
  return {
    title,
    content,
    contentFileForCommand: commandOptions.contentFile === "-" || commandOptions.content !== undefined ? undefined : commandOptions.contentFile,
    source: commandOptions.content === undefined ? (commandOptions.contentFile === "-" ? "stdin" : "content-file") : "stdin"
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

async function reviewReply(commandOptions: ReviewReplyOptions, options: ReviewCommandOptions): Promise<ReplyReviewReport> {
  const issues: ReviewMessage[] = [];
  const warnings: ReviewMessage[] = [];
  const explicitTopicId = positiveIntegerOption(commandOptions.topicId, "topic-id", issues);
  const explicitParentPostId = positiveIntegerOption(commandOptions.parentPostId, "parent-post-id", issues);
  let input: ReplyInput = { content: "" };

  if (commandOptions.contentFile && commandOptions.draftFile) {
    issues.push({ code: "input-conflict", severity: "issue", message: "Use either --content-file or --draft-file, not both" });
  } else if (!commandOptions.contentFile && !commandOptions.draftFile) {
    issues.push({ code: "missing-input", severity: "issue", message: "Missing --content-file or --draft-file" });
  } else if (commandOptions.contentFile) {
    const text = await readReviewFileForReport(commandOptions.contentFile, options, "Content", issues);
    input = {
      topicId: explicitTopicId,
      parentPostId: explicitParentPostId,
      content: blockText(text ?? ""),
      contentFileForCommand: commandOptions.contentFile === "-" ? undefined : commandOptions.contentFile,
      source: commandOptions.contentFile === "-" ? "stdin" : "content-file"
    };
  } else if (commandOptions.draftFile) {
    input = await replyInputFromDraft(commandOptions.draftFile, options, explicitTopicId, explicitParentPostId, issues);
  }

  if (commandOptions.topicId !== undefined && explicitTopicId === undefined) {
    input.topicId = undefined;
    input.contentFileForCommand = undefined;
  }
  if (commandOptions.parentPostId !== undefined && explicitParentPostId === undefined) {
    input.parentPostId = undefined;
  }
  if (!input.topicId && !issues.some((issue) => issue.code === "invalid-topic-id")) {
    issues.push({ code: "missing-topic-id", severity: "issue", message: "Missing a valid topic id" });
  }
  if (input.topicId && input.parentPostId === input.topicId) {
    warnings.push({ code: "parent-matches-topic", severity: "warning", message: "Parent post id matches the topic id; confirm this is a reply id" });
  }

  issues.push(...replyHardIssues(input));
  warnings.push(...replySoftWarnings(input));

  const safeContent = issues.some((issue) => issue.code === "possible-secret") ? redactSensitiveContent(input.content) : input.content;
  const requestPlan = input.topicId && safeContent ? {
    method: "POST" as const,
    path: `/api/v1/topics/${input.topicId}/replies`,
    body: compactBody({
      content: safeContent,
      parentPostId: input.parentPostId
    }) as ReplyReviewReport["requestPlan"] extends infer Plan ? Plan extends { body: infer Body } ? Body : never : never
  } : null;

  return {
    kind: "reply-review",
    schemaVersion: 1,
    ok: issues.length === 0,
    issues,
    warnings,
    metrics: {
      contentLength: input.content.length,
      referenceCount: referenceCount(input.content),
      lineCount: nonEmptyLines(input.content).length,
      duplicateLineCount: duplicateLineCount(input.content)
    },
    requestPlan,
    suggestedCommand: suggestedReplyCreateCommand(input)
  };
}

async function replyInputFromDraft(
  path: string,
  options: ReviewCommandOptions,
  explicitTopicId: number | undefined,
  explicitParentPostId: number | undefined,
  issues: ReviewMessage[]
): Promise<ReplyInput> {
  const text = await readReviewFileForReport(path, options, "Draft", issues);
  if (text === undefined) {
    return { topicId: explicitTopicId, parentPostId: explicitParentPostId, content: "", source: "draft-file" };
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      issues.push({ code: "invalid-draft-json", severity: "issue", message: `Invalid draft file: ${path}` });
      return { topicId: explicitTopicId, parentPostId: explicitParentPostId, content: "", source: "draft-file" };
    }
    throw error;
  }
  if (!isReplyDraft(data)) {
    issues.push({ code: "invalid-draft-schema", severity: "issue", message: `Invalid draft file: ${path} must contain a reply-draft schema` });
    return { topicId: explicitTopicId, parentPostId: explicitParentPostId, content: "", source: "draft-file" };
  }
  if (explicitTopicId !== undefined && explicitTopicId !== data.topicId) {
    issues.push({ code: "topic-id-mismatch", severity: "issue", message: "Draft topicId does not match --topic-id" });
  }
  const draftParentPostId = data.parentPostId ?? undefined;
  if (explicitParentPostId !== undefined && draftParentPostId !== undefined && explicitParentPostId !== draftParentPostId) {
    issues.push({ code: "parent-post-id-mismatch", severity: "issue", message: "Draft parentPostId does not match --parent-post-id" });
  }
  return {
    topicId: explicitTopicId ?? data.topicId,
    parentPostId: explicitParentPostId ?? draftParentPostId,
    content: blockText(data.content),
    source: "draft-file"
  };
}

async function readReviewFileForReport(
  path: string,
  options: ReviewCommandOptions,
  label: "Content" | "Draft",
  issues: ReviewMessage[]
): Promise<string | undefined> {
  if (path === "-") {
    return readStdin(options);
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      issues.push({ code: "input-read-failed", severity: "issue", message: `${label} file not found: ${path}` });
      return undefined;
    }
    if (isNodeError(error) && error.code === "EACCES") {
      issues.push({ code: "input-read-failed", severity: "issue", message: `${label} file is not readable: ${path}` });
      return undefined;
    }
    throw error;
  }
}

function replyHardIssues(input: ReplyInput): ReviewMessage[] {
  const issues: ReviewMessage[] = [];
  if (!input.content) {
    issues.push({ code: "blank-content", severity: "issue", message: "Reply content must not be blank" });
  }
  if (input.content && input.content.length < MIN_REPLY_CONTENT_LENGTH) {
    issues.push({ code: "content-too-short", severity: "issue", message: `Reply content must be at least ${MIN_REPLY_CONTENT_LENGTH} characters` });
  }
  if (input.content.includes("待补充")) {
    issues.push({ code: "placeholder-content", severity: "issue", message: "Reply content still contains 待补充 placeholders" });
  }
  if (secretPattern().test(input.content)) {
    issues.push({ code: "possible-secret", severity: "issue", message: "Reply appears to contain a token, Authorization header, or password" });
  }
  return issues;
}

function replySoftWarnings(input: ReplyInput): ReviewMessage[] {
  const warnings: ReviewMessage[] = [];
  if (input.source !== "content-file") {
    warnings.push({ code: "unsaved-content-file", severity: "warning", message: "Save the reviewed Markdown to a file before running reply create --content-file" });
  }
  if (input.content && referenceCount(input.content) === 0) {
    warnings.push({ code: "missing-reference", severity: "warning", message: "Reply does not include a visible http(s) reference link" });
  }
  if (input.content.length > MAX_REPLY_CONTENT_LENGTH) {
    warnings.push({ code: "reply-too-long", severity: "warning", message: `Reply content is longer than ${MAX_REPLY_CONTENT_LENGTH} characters` });
  }
  if (duplicateLineCount(input.content) > 0) {
    warnings.push({ code: "duplicate-lines", severity: "warning", message: "Reply contains repeated non-empty lines" });
  }
  return warnings;
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

function suggestedReplyCreateCommand(input: ReplyInput): ReplyReviewReport["suggestedCommand"] {
  if (!input.topicId || !input.contentFileForCommand) {
    return null;
  }
  const args = [
    "apexcn",
    "reply",
    "create",
    String(input.topicId),
    input.parentPostId === undefined ? undefined : "--parent-post-id",
    input.parentPostId === undefined ? undefined : String(input.parentPostId),
    "--content-file",
    input.contentFileForCommand,
    "--dry-run",
    "--json"
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

function formatReviewReplyText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const issues = Array.isArray(data.issues) ? data.issues.filter(isRecord) : [];
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter(isRecord) : [];
  const metrics = isRecord(data.metrics) ? data.metrics : {};
  const suggested = isRecord(data.suggestedCommand) ? data.suggestedCommand : {};
  return [
    `Status: ${data.ok === true ? "ok" : "needs changes"}`,
    `Content length: ${fieldText(metrics.contentLength)}`,
    `References: ${fieldText(metrics.referenceCount)}`,
    `Lines: ${fieldText(metrics.lineCount)}`,
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

function isReplyDraft(value: unknown): value is { kind: "reply-draft"; schemaVersion: 1; topicId: number; parentPostId: number | null; content: string } {
  return isRecord(value) &&
    value.kind === "reply-draft" &&
    value.schemaVersion === 1 &&
    typeof value.topicId === "number" &&
    Number.isInteger(value.topicId) &&
    value.topicId > 0 &&
    (value.parentPostId === null || (typeof value.parentPostId === "number" && Number.isInteger(value.parentPostId) && value.parentPostId > 0)) &&
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

function positiveIntegerOption(value: string | undefined, name: string, issues: ReviewMessage[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push({ code: `invalid-${name}`, severity: "issue", message: `Expected a positive integer for --${name}: ${value}` });
    return undefined;
  }
  return parsed;
}

function referenceCount(content: string): number {
  return (content.match(/https?:\/\/\S+/g) ?? []).length;
}

function sectionCount(content: string): number {
  return (content.match(/^##\s+.+$/gm) ?? []).length;
}

function nonEmptyLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function duplicateLineCount(content: string): number {
  const counts = new Map<string, number>();
  for (const line of nonEmptyLines(content)) {
    if (line.length < 8) {
      continue;
    }
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
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
