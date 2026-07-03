import { readFile } from "node:fs/promises";
import { stdin as processStdin } from "node:process";
import { Command, Option } from "commander";
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

async function readResearchJson(path: string, options: DraftCommandOptions): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = path === "-" ? await readStdin(options) : await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      printError(options, { type: "validation", message: `Research file not found: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    if (isNodeError(error) && error.code === "EACCES") {
      printError(options, { type: "validation", message: `Research file is not readable: ${path}` });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isResearchObject(parsed)) {
      printError(options, { type: "validation", message: `Invalid research file: ${path} must contain a JSON object` });
      process.exitCode = 1;
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      printError(options, { type: "validation", message: `Invalid research file: ${path}` });
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
