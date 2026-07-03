import { readFile } from "node:fs/promises";
import { stdin as processStdin } from "node:process";
import { Command, InvalidArgumentError, Option } from "commander";
import { blockText, fieldText, isRecord, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type DraftCommandOptions = CommandIo & {
  readStdin?: () => Promise<string>;
};

type DraftQuestionOptions = FormatOption & {
  title: string;
  problem: string;
  environment?: string;
  tried?: string;
  expected?: string;
  actual?: string;
  researchFile?: string;
};

type DraftReplyOptions = FormatOption & {
  topicId: number;
  parentPostId?: number;
  answer: string;
  tone?: DraftReplyTone;
  topicFile?: string;
  researchFile?: string;
};

type DraftReplyTone = "concise" | "friendly" | "technical";

type DraftReference = {
  id?: string;
  title?: string;
  url?: string;
  originalUrl?: string;
};

type DraftQuestion = {
  kind: "question-draft";
  schemaVersion: 1;
  title: string;
  content: string;
  sections: {
    problem: string;
    environment: string;
    tried: string;
    expected: string;
    actual: string;
  };
  references: DraftReference[];
};

type DraftReply = {
  kind: "reply-draft";
  schemaVersion: 1;
  topicId: number;
  parentPostId: number | null;
  content: string;
  references: DraftReference[];
  metadata: {
    tone: DraftReplyTone;
    topicTitle?: string;
    topicUrl?: string;
    originalUrl?: string;
  };
};

export function createDraftCommand(options: DraftCommandOptions): Command {
  const draft = new Command("draft");

  draft
    .command("question")
    .requiredOption("--title <title>", "question title")
    .requiredOption("--problem <text>", "problem description")
    .option("--environment <text>", "runtime, version, or environment details")
    .option("--tried <text>", "steps already tried")
    .option("--expected <text>", "expected result")
    .option("--actual <text>", "actual result")
    .option("--research-file <path>", "read a research JSON bundle from a file or - for stdin")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: DraftQuestionOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const title = blockText(commandOptions.title);
      const problem = blockText(commandOptions.problem);
      if (!title) {
        printError(options, { type: "validation", message: "--title must not be blank" });
        process.exitCode = 1;
        return;
      }
      if (!problem) {
        printError(options, { type: "validation", message: "--problem must not be blank" });
        process.exitCode = 1;
        return;
      }
      const research = commandOptions.researchFile ? await readResearchJson(commandOptions.researchFile, options) : undefined;
      if (commandOptions.researchFile && research === undefined) {
        return;
      }
      const draftQuestion = buildDraftQuestion({
        title,
        problem,
        environment: blockText(commandOptions.environment),
        tried: blockText(commandOptions.tried),
        expected: blockText(commandOptions.expected),
        actual: blockText(commandOptions.actual),
        references: research ? referencesFromResearch(research) : []
      });
      printData(options, draftQuestion, outputFormat(commandOptions), (data) => isRecord(data) && typeof data.content === "string" ? data.content : "");
    });

  draft
    .command("reply")
    .requiredOption("--topic-id <id>", "topic id", parsePositiveInteger)
    .option("--parent-post-id <id>", "parent reply id", parsePositiveInteger)
    .requiredOption("--answer <text>", "reply answer, suggestion, or position")
    .addOption(new Option("--tone <tone>", "reply tone: concise, friendly, technical").argParser(parseDraftReplyTone))
    .option("--topic-file <path>", "read topic view JSON from a file or - for stdin")
    .option("--research-file <path>", "read research JSON from a file or - for stdin")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: DraftReplyOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const answer = blockText(commandOptions.answer);
      if (!answer) {
        printError(options, { type: "validation", message: "--answer must not be blank" });
        process.exitCode = 1;
        return;
      }
      if (commandOptions.topicFile === "-" && commandOptions.researchFile === "-") {
        printError(options, { type: "validation", message: "Only one draft reply input can read from stdin" });
        process.exitCode = 1;
        return;
      }
      const topic = commandOptions.topicFile ? await readJsonObject(commandOptions.topicFile, "topic", options) : undefined;
      if (commandOptions.topicFile && topic === undefined) {
        return;
      }
      if (topic && !validateTopicIdMatch(commandOptions.topicId, topic, options)) {
        return;
      }
      const research = commandOptions.researchFile ? await readJsonObject(commandOptions.researchFile, "research", options) : undefined;
      if (commandOptions.researchFile && research === undefined) {
        return;
      }
      const draftReply = buildDraftReply({
        topicId: commandOptions.topicId,
        parentPostId: commandOptions.parentPostId,
        answer,
        tone: commandOptions.tone ?? "friendly",
        topic,
        research
      });
      printData(options, draftReply, outputFormat(commandOptions), (data) => isRecord(data) && typeof data.content === "string" ? data.content : "");
    });

  return draft;
}

function buildDraftQuestion(input: {
  title: string;
  problem: string;
  environment: string;
  tried: string;
  expected: string;
  actual: string;
  references: DraftReference[];
}): DraftQuestion {
  const sections = {
    problem: input.problem,
    environment: input.environment,
    tried: input.tried,
    expected: input.expected,
    actual: input.actual
  };
  const content = markdownDraft(input.title, sections, input.references);
  return {
    kind: "question-draft",
    schemaVersion: 1,
    title: input.title,
    content,
    sections,
    references: input.references
  };
}

function buildDraftReply(input: {
  topicId: number;
  parentPostId?: number;
  answer: string;
  tone: DraftReplyTone;
  topic?: Record<string, unknown>;
  research?: Record<string, unknown>;
}): DraftReply {
  const topic = input.topic ? topicFromData(input.topic) : undefined;
  const references = dedupeReferences([
    ...(topic ? referencesFromTopic(topic) : []),
    ...(input.research ? referencesFromResearch(input.research) : [])
  ]);
  const metadata = compactMetadata({
    tone: input.tone,
    topicTitle: fieldText(topic?.title ?? topic?.topicTitle).trim() || undefined,
    topicUrl: fieldText(topic?.url ?? topic?.threadUrl).trim() || undefined,
    originalUrl: fieldText(topic?.originalUrl).trim() || undefined
  });
  const content = markdownReply(input.answer, input.tone, references);
  return compactReply({
    kind: "reply-draft",
    schemaVersion: 1,
    topicId: input.topicId,
    parentPostId: input.parentPostId ?? null,
    content,
    references,
    metadata
  });
}

async function readResearchJson(path: string, options: DraftCommandOptions): Promise<Record<string, unknown> | undefined> {
  return readJsonObject(path, "research", options);
}

async function readJsonObject(path: string, label: "research" | "topic", options: DraftCommandOptions): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = path === "-" ? await readStdin(options) : await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      printError(options, { type: "validation", message: `${capitalized(label)} file not found: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    if (isNodeError(error) && error.code === "EACCES") {
      printError(options, { type: "validation", message: `${capitalized(label)} file is not readable: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isResearchObject(parsed)) {
      printError(options, { type: "validation", message: `Invalid ${label} file: ${path} must contain a JSON object` });
      process.exitCode = 1;
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      printError(options, { type: "validation", message: `Invalid ${label} file: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

function readStdin(options: DraftCommandOptions): Promise<string> {
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

function referencesFromResearch(data: Record<string, unknown>): DraftReference[] {
  const records = [
    ...arrayRecords(data.links),
    ...arrayRecords(data.items),
    ...arrayRecords(data.topics)
  ];
  const seen = new Set<string>();
  const references = records.map((record) => compactReference({
    id: record.id ?? record.topicId ?? record.threadId,
    title: record.title ?? record.topicTitle,
    url: record.url ?? record.threadUrl,
    originalUrl: record.originalUrl
  })).filter((reference) => Object.keys(reference).length > 0);
  return references.filter((reference) => {
    const key = reference.url ?? reference.originalUrl ?? reference.id ?? JSON.stringify(reference);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function referencesFromTopic(topic: Record<string, unknown>): DraftReference[] {
  const reference = compactReference({
    id: topic.id ?? topic.topicId ?? topic.threadId,
    title: topic.title ?? topic.topicTitle,
    url: topic.url ?? topic.threadUrl,
    originalUrl: topic.originalUrl
  });
  return Object.keys(reference).length > 0 ? [reference] : [];
}

function topicFromData(data: Record<string, unknown>): Record<string, unknown> {
  return isRecord(data.topic) && !Array.isArray(data.topic) ? data.topic : data;
}

function dedupeReferences(references: DraftReference[]): DraftReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = reference.url ?? reference.originalUrl ?? reference.id ?? JSON.stringify(reference);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function compactReference(input: Record<string, unknown>): DraftReference {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, fieldText(value).trim()] as const)
      .filter(([, value]) => value.length > 0)
  ) as DraftReference;
}

function markdownDraft(title: string, sections: DraftQuestion["sections"], references: DraftReference[]): string {
  return [
    `# ${title}`,
    section("问题", sections.problem),
    section("环境", sections.environment),
    section("已尝试", sections.tried),
    section("期望结果", sections.expected),
    section("实际结果", sections.actual),
    referenceSection(references)
  ].join("\n\n");
}

function markdownReply(answer: string, tone: DraftReplyTone, references: DraftReference[]): string {
  return [
    "## 简短回应",
    "",
    replyOpening(tone),
    answer,
    "",
    "## 建议步骤",
    "",
    ...answerSteps(answer),
    "",
    "## 参考链接",
    "",
    ...replyReferenceLines(references)
  ].join("\n");
}

function replyOpening(tone: DraftReplyTone): string {
  if (tone === "concise") {
    return "可以按下面思路处理。";
  }
  if (tone === "technical") {
    return "从现象看，建议先把问题拆成可验证的配置、认证和调用链路。";
  }
  return "我建议先按下面步骤排查，这样比较容易定位问题。";
}

function answerSteps(answer: string): string[] {
  const parts = answer.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  return parts.length > 0 ? parts.map((item) => `- ${item.replace(/^[-*]\s+/, "")}`) : ["- 先确认问题现象，再逐项验证配置和日志。"];
}

function replyReferenceLines(references: DraftReference[]): string[] {
  if (references.length === 0) {
    return ["无参考链接。"];
  }
  return references.map((reference, index) => {
    const label = reference.title ?? reference.id ?? reference.url ?? reference.originalUrl ?? `reference ${index + 1}`;
    const details = [
      reference.url,
      reference.originalUrl && reference.originalUrl !== reference.url ? `original: ${reference.originalUrl}` : undefined
    ].filter(Boolean).join(" | ");
    return details ? `${index + 1}. ${label} - ${details}` : `${index + 1}. ${label}`;
  });
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content || "待补充"}`;
}

function referenceSection(references: DraftReference[]): string {
  const lines = references.map((reference, index) => {
    const label = reference.title ?? reference.id ?? reference.url ?? reference.originalUrl ?? `reference ${index + 1}`;
    const details = [
      reference.url,
      reference.originalUrl && reference.originalUrl !== reference.url ? `original: ${reference.originalUrl}` : undefined
    ].filter(Boolean).join(" | ");
    return details ? `${index + 1}. ${label} - ${details}` : `${index + 1}. ${label}`;
  });
  return `## 参考链接\n\n${lines.length > 0 ? lines.join("\n") : "待补充"}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isResearchObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer: ${value}`);
  }
  return parsed;
}

function parseDraftReplyTone(value: string): DraftReplyTone {
  if (value === "concise" || value === "friendly" || value === "technical") {
    return value;
  }
  throw new InvalidArgumentError(`Expected tone concise, friendly, or technical: ${value}`);
}

function compactReply(input: {
  kind: "reply-draft";
  schemaVersion: 1;
  topicId: number;
  parentPostId: number | null;
  content: string;
  references: DraftReference[];
  metadata: DraftReply["metadata"];
}): DraftReply {
  return input;
}

function compactMetadata(input: DraftReply["metadata"]): DraftReply["metadata"] {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as DraftReply["metadata"];
}

function capitalized(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function validateTopicIdMatch(topicId: number, data: Record<string, unknown>, options: DraftCommandOptions): boolean {
  const topic = topicFromData(data);
  const value = topic.id ?? topic.topicId ?? topic.threadId;
  const parsed = typeof value === "number" && Number.isInteger(value) ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
  if (parsed !== undefined && parsed !== topicId) {
    printError(options, { type: "validation", message: `--topic-id ${topicId} does not match topic file id ${parsed}` });
    process.exitCode = 1;
    return false;
  }
  return true;
}
