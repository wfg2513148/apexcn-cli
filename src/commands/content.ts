import { readFile } from "node:fs/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, requestJson } from "../http.js";
import { blockText, fieldText, isRecord, itemsFromData, outputFormat, parseOutputFormat, printData, validateFormatOptions, type FormatOption, type JsonOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type ApiCommandOptions = CommandIo & {
  configPath?: string;
  readStdin?: () => Promise<string>;
  isStdinTTY?: () => boolean;
};

type Session = {
  profile: string;
  baseUrl: string;
  token: string;
};

type DryRunOption = {
  dryRun?: boolean;
};

type ApiRequestPlan = {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export function createCategoryCommand(options: ApiCommandOptions): Command {
  const category = new Command("category");
  category
    .command("list")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/categories", { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatCategoryListText);
      });
    });
  return category;
}

export function createSearchCommand(options: ApiCommandOptions): Command {
  return new Command("search")
    .argument("<keyword>")
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--page-size <n>", "page size, 1-50", parseSearchPageSize)
    .addOption(new Option("--offset <n>", "unsupported; current search API ignores offset").argParser(rejectUnsupportedOffset).hideHelp())
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD", parseSearchDate)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (keyword: string, commandOptions: FormatOption & { categoryId?: number; pageSize?: number; offset?: number; fromDate?: string; toDate?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateSearchDateRange(options, commandOptions.fromDate, commandOptions.toDate)) {
        return;
      }
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/search", {
          token: session.token,
          query: {
            keyword,
            categoryId: commandOptions.categoryId,
            pageSize: commandOptions.pageSize,
            offset: commandOptions.offset,
            fromDate: commandOptions.fromDate,
            toDate: commandOptions.toDate
          }
        });
        printData(options, data, outputFormat(commandOptions), formatSearchText);
      });
    });
}

export function createTopicCommand(options: ApiCommandOptions): Command {
  const topic = new Command("topic").alias("thread");

  topic
    .command("view")
    .argument("<id>", "topic id", parsePositiveInteger)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (id: number, commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatTopicText);
      });
    });

  topic
    .command("create")
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .requiredOption("--title <title>")
    .addOption(new Option("--content <text>", "inline content").conflicts("contentFile"))
    .addOption(new Option("--content-file <path>", "read content from file").conflicts("content"))
    .option("--tags <csv>")
    .option("--json", "pretty-print JSON")
    .option("--dry-run", "print the API request without sending it")
    .action(async (commandOptions: JsonOption & DryRunOption & TopicWriteOptions & { categoryId?: number }) => {
      await runApi(options, async (session) => {
        if (commandOptions.dryRun && commandOptions.categoryId === undefined) {
          options.stderr("Missing --category-id in dry-run mode\n");
          process.exitCode = 1;
          return;
        }
        const categoryId = commandOptions.categoryId ?? await promptCategoryId(options, session);
        if (categoryId === undefined) {
          return;
        }
        const request = {
          method: "POST",
          path: "/api/v1/topics",
          body: compactBody({
            categoryId,
            title: commandOptions.title,
            content: await contentFromOptions(commandOptions, options),
            tags: commandOptions.tags
          })
        };
        if (commandOptions.dryRun) {
          printDryRun(options, session, request, commandOptions.json);
          return;
        }
        const data = await requestJson(session.baseUrl, request.path, {
          token: session.token,
          method: request.method,
          body: request.body
        });
        printData(options, data, commandOptions.json);
      });
    });

  topic
    .command("update")
    .alias("edit")
    .argument("<id>", "topic id", parsePositiveInteger)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--title <title>")
    .addOption(new Option("--content <text>", "inline content").conflicts("contentFile"))
    .addOption(new Option("--content-file <path>", "read content from file").conflicts("content"))
    .option("--tags <csv>")
    .option("--json", "pretty-print JSON")
    .option("--dry-run", "print the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & TopicWriteOptions & { categoryId?: number }) => {
      await runApi(options, async (session) => {
        const request = {
          method: "POST",
          path: `/api/v1/topics/${id}`,
          body: compactBody({
            categoryId: commandOptions.categoryId,
            title: commandOptions.title,
            content: await optionalContentFromOptions(commandOptions, options),
            tags: commandOptions.tags
          })
        };
        if (commandOptions.dryRun) {
          printDryRun(options, session, request, commandOptions.json);
          return;
        }
        const data = await requestJson(session.baseUrl, request.path, {
          token: session.token,
          method: request.method,
          body: request.body
        });
        printData(options, data, commandOptions.json);
      });
    });

  topic
    .command("delete")
    .argument("<id>", "topic id", parsePositiveInteger)
    .option("--yes", "confirm delete")
    .option("--force", "required for non-interactive delete")
    .option("--confirm-title <title>", "required topic title confirmation")
    .option("--json", "pretty-print JSON")
    .option("--dry-run", "print the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & { yes?: boolean; force?: boolean; confirmTitle?: string }) => {
      if (!commandOptions.yes || !commandOptions.force || !commandOptions.confirmTitle) {
        if (commandOptions.dryRun) {
          options.stderr("Refusing to delete topic without --yes --force --confirm-title\n");
          process.exitCode = 1;
          return;
        }
        if (processStdin.isTTY === true && !commandOptions.yes && !commandOptions.force) {
          await runApi(options, async (session) => {
            const topic = await requestJson<{ topic?: { title?: string; createdByName?: string; categoryName?: string } }>(session.baseUrl, `/api/v1/topics/${id}`, {
              token: session.token
            });
            const title = topic.topic?.title;
            if (!title) {
              options.stderr("Unable to load topic for confirmation\n");
              process.exitCode = 1;
              return;
            }
            options.stdout(`Delete topic: ${title}\n`);
            if (topic.topic?.createdByName) {
              options.stdout(`Author: ${topic.topic.createdByName}\n`);
            }
            if (topic.topic?.categoryName) {
              options.stdout(`Category: ${topic.topic.categoryName}\n`);
            }
            const confirmed = await promptText(`Type the full topic title to delete: `);
            if (confirmed !== title) {
              options.stderr("Delete cancelled\n");
              process.exitCode = 1;
              return;
            }
            const data = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token, method: "DELETE" });
            printData(options, data, commandOptions.json);
          });
          return;
        }
        options.stderr("Refusing to delete topic without --yes --force --confirm-title\n");
        process.exitCode = 1;
        return;
      }
      await runApi(options, async (session) => {
        const request = { method: "DELETE", path: `/api/v1/topics/${id}` };
        if (commandOptions.dryRun) {
          printDryRun(options, session, request, commandOptions.json);
          return;
        }
        const topic = await requestJson<{ topic?: { title?: string } }>(session.baseUrl, `/api/v1/topics/${id}`, {
          token: session.token
        });
        if (topic.topic?.title !== commandOptions.confirmTitle) {
          options.stderr("Refusing to delete topic because --confirm-title does not match\n");
          process.exitCode = 1;
          return;
        }
        const data = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token, method: "DELETE" });
        printData(options, data, commandOptions.json);
      });
    });

  return topic;
}

export function createReplyCommand(options: ApiCommandOptions): Command {
  const reply = new Command("reply").alias("post");

  reply
    .command("create")
    .argument("<topic-id>", "topic id", parsePositiveInteger)
    .option("--parent-post-id <id>", "parent reply id", parsePositiveInteger)
    .addOption(new Option("--content <text>", "inline content").conflicts("contentFile"))
    .addOption(new Option("--content-file <path>", "read content from file").conflicts("content"))
    .option("--json", "pretty-print JSON")
    .option("--dry-run", "print the API request without sending it")
    .action(async (topicId: number, commandOptions: JsonOption & DryRunOption & ReplyWriteOptions) => {
      await runApi(options, async (session) => {
        const request = {
          method: "POST",
          path: `/api/v1/topics/${topicId}/replies`,
          body: compactBody({
            content: await contentFromOptions(commandOptions, options),
            parentPostId: commandOptions.parentPostId
          })
        };
        if (commandOptions.dryRun) {
          printDryRun(options, session, request, commandOptions.json);
          return;
        }
        const data = await requestJson(session.baseUrl, request.path, {
          token: session.token,
          method: request.method,
          body: request.body
        });
        printData(options, data, commandOptions.json);
      });
    });

  reply
    .command("update")
    .alias("edit")
    .argument("<id>", "reply id", parsePositiveInteger)
    .addOption(new Option("--content <text>", "inline content").conflicts("contentFile"))
    .addOption(new Option("--content-file <path>", "read content from file").conflicts("content"))
    .option("--json", "pretty-print JSON")
    .option("--dry-run", "print the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & ReplyWriteOptions) => {
      await runApi(options, async (session) => {
        const request = {
          method: "POST",
          path: `/api/v1/replies/${id}`,
          body: { content: await contentFromOptions(commandOptions, options) }
        };
        if (commandOptions.dryRun) {
          printDryRun(options, session, request, commandOptions.json);
          return;
        }
        const data = await requestJson(session.baseUrl, request.path, {
          token: session.token,
          method: request.method,
          body: request.body
        });
        printData(options, data, commandOptions.json);
      });
    });

  reply
    .command("delete")
    .argument("<id>", "reply id", parsePositiveInteger)
    .option("--yes", "confirm delete")
    .option("--force", "required for non-interactive delete")
    .option("--json", "pretty-print JSON")
    .option("--dry-run", "print the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & { yes?: boolean; force?: boolean }) => {
      if (!commandOptions.yes || !commandOptions.force) {
        if (commandOptions.dryRun) {
          options.stderr("Refusing to delete reply without --yes --force\n");
          process.exitCode = 1;
          return;
        }
        if (processStdin.isTTY === true && !commandOptions.yes && !commandOptions.force) {
          const confirmed = await promptText("Type delete to delete this reply: ");
          if (confirmed !== "delete") {
            options.stderr("Delete cancelled\n");
            process.exitCode = 1;
            return;
          }
          await runApi(options, async (session) => {
            const data = await requestJson(session.baseUrl, `/api/v1/replies/${id}`, { token: session.token, method: "DELETE" });
            printData(options, data, commandOptions.json);
          });
          return;
        }
        options.stderr("Refusing to delete reply without --yes --force\n");
        process.exitCode = 1;
        return;
      }
      await runApi(options, async (session) => {
        const request = { method: "DELETE", path: `/api/v1/replies/${id}` };
        if (commandOptions.dryRun) {
          printDryRun(options, session, request, commandOptions.json);
          return;
        }
        const data = await requestJson(session.baseUrl, request.path, { token: session.token, method: request.method });
        printData(options, data, commandOptions.json);
      });
    });

  return reply;
}

export function createRelationCommand(name: "favorite" | "subscription", options: ApiCommandOptions): Command {
  const command = new Command(name);
  for (const action of ["add", "remove"] as const) {
    command
      .command(action)
      .argument("<topic-id>", "topic id", parsePositiveInteger)
      .option("--json", "pretty-print JSON")
      .option("--dry-run", "print the API request without sending it")
      .action(async (topicId: number, commandOptions: JsonOption & DryRunOption) => {
        await runApi(options, async (session) => {
          const request = {
            path: `/api/v1/topics/${topicId}/${name}`,
            method: action === "add" ? "POST" : "DELETE"
          };
          if (commandOptions.dryRun) {
            printDryRun(options, session, request, commandOptions.json);
            return;
          }
          const data = await requestJson(session.baseUrl, request.path, {
            token: session.token,
            method: request.method
          });
          printData(options, data, commandOptions.json);
        });
      });
  }
  return command;
}

export function createAskCommand(options: ApiCommandOptions): Command {
  return new Command("ask")
    .argument("<question>")
    .option("--top-k <n>", "number of chunks", parsePositiveInteger)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (question: string, commandOptions: FormatOption & { topK?: number }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/ask", {
          token: session.token,
          method: "POST",
          body: compactBody({ question, topK: commandOptions.topK })
        });
        printData(options, data, outputFormat(commandOptions), formatAskText);
      });
    });
}

type TopicWriteOptions = {
  title?: string;
  content?: string;
  contentFile?: string;
  tags?: string;
};

type ReplyWriteOptions = {
  content?: string;
  contentFile?: string;
  parentPostId?: number;
};

class CliValidationError extends Error {
}

async function runApi(options: ApiCommandOptions, callback: (session: Session) => Promise<void>): Promise<void> {
  try {
    const session = await loadSession(options);
    if (!session) {
      return;
    }
    await callback(session);
  } catch (error) {
    if (error instanceof HttpError) {
      const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
      options.stderr(`HTTP ${error.status}: ${error.message}${requestId}\n`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof CliValidationError) {
      options.stderr(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof ConfigFileError) {
      options.stderr(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof NetworkError) {
      options.stderr(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function loadSession(options: ApiCommandOptions): Promise<Session | undefined> {
  const config = await loadConfig(options.configPath);
  const profile = config.current;
  const current = profile ? config.profiles[profile] : undefined;
  if (!profile || !current) {
    options.stderr("No active profile\n");
    process.exitCode = 1;
    return undefined;
  }
  return { profile, ...current };
}

function printDryRun(options: CommandIo, session: Session, request: ApiRequestPlan, json?: boolean): void {
  printData(options, compactBody({
    dryRun: true,
    profile: session.profile,
    baseUrl: session.baseUrl,
    method: request.method,
    path: request.path,
    query: request.query,
    body: request.body
  }), json);
}

async function contentFromOptions(options: { content?: string; contentFile?: string }, commandOptions: ApiCommandOptions): Promise<string> {
  const content = await optionalContentFromOptions(options, commandOptions);
  if (!content) {
    throw new CliValidationError("content is required");
  }
  return content;
}

async function optionalContentFromOptions(options: { content?: string; contentFile?: string }, commandOptions: ApiCommandOptions): Promise<string | undefined> {
  if (options.contentFile) {
    return readContentFile(options.contentFile, commandOptions);
  }
  if (options.content !== undefined) {
    return options.content;
  }
  if (isStdinTTY(commandOptions) !== true) {
    return readStdin(commandOptions);
  }
  return undefined;
}

async function readContentFile(path: string, options: ApiCommandOptions): Promise<string> {
  if (path === "-") {
    return readStdin(options);
  }
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new CliValidationError(`Content file not found: ${path}`);
    }
    if (isNodeError(error) && error.code === "EACCES") {
      throw new CliValidationError(`Content file is not readable: ${path}`);
    }
    throw error;
  }
}

function readStdin(options: ApiCommandOptions): Promise<string> {
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

function isStdinTTY(options: ApiCommandOptions): boolean {
  return options.isStdinTTY ? options.isStdinTTY() : processStdin.isTTY === true;
}

async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: processStdin, output: processStdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function compactBody(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function formatCategoryListText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => `${fieldText(item.id)}\t${fieldText(item.name)}`).join("\n");
}

function formatSearchText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => `${fieldText(item.id)}\t${fieldText(item.title)}\t${fieldText(item.url)}`).join("\n");
}

function formatTopicText(data: unknown): string {
  const topic = topicFromData(data);
  if (!topic) {
    return "";
  }
  return lines([
    line("Title", topic.title),
    line("Author", topic.createdByName ?? topic.authorName ?? topic.createdBy),
    line("Category", topic.categoryName),
    line("URL", topic.url ?? topic.threadUrl),
    line("Original URL", topic.originalUrl),
    blockLine("Content", topic.content ?? topic.body ?? topic.summary ?? topic.excerpt),
    line("requestId", isRecord(data) ? data.requestId : undefined)
  ]);
}

function formatAskText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const answer = blockText(data.answer);
  const sources = sourcesFromData(data);
  const sourceLines = sources.map((source, index) => {
    const title = fieldText(source.title ?? source.topicTitle ?? source.topicId ?? `source ${index + 1}`);
    const url = fieldText(source.url ?? source.threadUrl);
    const score = fieldText(source.score);
    const snippet = fieldText(source.snippet ?? source.content);
    const details = [url, score ? `score ${score}` : "", snippet].filter(Boolean).join(" | ");
    return details ? `${index + 1}. ${title} - ${details}` : `${index + 1}. ${title}`;
  });
  return lines([
    blockLine("Answer", answer),
    sourceLines.length > 0 ? "Sources:" : undefined,
    ...sourceLines,
    line("requestId", data.requestId)
  ]);
}

function topicFromData(data: unknown): Record<string, unknown> | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  if (isRecord(data.topic)) {
    return data.topic;
  }
  return data;
}

function sourcesFromData(data: Record<string, unknown>): Array<Record<string, unknown>> {
  for (const key of ["sources", "citations", "items"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function line(label: string, value: unknown): string | undefined {
  const text = fieldText(value);
  return text ? `${label}: ${text}` : undefined;
}

function blockLine(label: string, value: unknown): string | undefined {
  const text = blockText(value);
  return text ? `${label}:\n${text}` : undefined;
}

function lines(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join("\n");
}

async function promptCategoryId(options: CommandIo, session: Session): Promise<number | undefined> {
  if (processStdin.isTTY !== true) {
    options.stderr("Missing --category-id in non-interactive mode\n");
    process.exitCode = 1;
    return undefined;
  }

  const data = await requestJson<{ items?: Array<{ id: number; name: string; canCreateTopic?: boolean }> }>(session.baseUrl, "/api/v1/categories", {
    token: session.token
  });
  const categories = (data.items ?? []).filter((item) => item.canCreateTopic !== false);
  if (categories.length === 0) {
    options.stderr("No categories are available for topic creation\n");
    process.exitCode = 1;
    return undefined;
  }

  options.stdout("Select a category:\n");
  categories.forEach((category, index) => {
    options.stdout(`${index + 1}. ${category.name} (${category.id})\n`);
  });
  const answer = await promptText("Category number: ");
  const index = Number(answer);
  if (!Number.isInteger(index) || index < 1 || index > categories.length) {
    options.stderr("Invalid category selection\n");
    process.exitCode = 1;
    return undefined;
  }
  return categories[index - 1].id;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`Invalid number: ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = parseNumber(value);
  if (parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer: ${value}`);
  }
  return parsed;
}

function parseSearchPageSize(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 50) {
    throw new InvalidArgumentError("Expected --page-size to be between 1 and 50");
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = parseNumber(value);
  if (parsed < 0) {
    throw new InvalidArgumentError(`Expected a non-negative integer: ${value}`);
  }
  return parsed;
}

function rejectUnsupportedOffset(): never {
  throw new InvalidArgumentError("Current search API does not support offset pagination. Narrow results with --category-id, --from-date, or --to-date instead.");
}

function parseSearchDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new InvalidArgumentError(`Expected YYYY-MM-DD date: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidArgumentError(`Expected YYYY-MM-DD date: ${value}`);
  }
  return value;
}

function validateSearchDateRange(options: CommandIo, fromDate?: string, toDate?: string): boolean {
  if (fromDate && toDate && fromDate > toDate) {
    options.stderr("--from-date must be earlier than or equal to --to-date\n");
    process.exitCode = 1;
    return false;
  }
  return true;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
