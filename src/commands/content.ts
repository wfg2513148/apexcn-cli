import { readFile } from "node:fs/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, requestJson } from "../http.js";
import type { CommandIo } from "./auth.js";

type ApiCommandOptions = CommandIo & {
  configPath?: string;
};

type Session = {
  baseUrl: string;
  token: string;
};

type JsonOption = {
  json?: boolean;
};

export function createCategoryCommand(options: ApiCommandOptions): Command {
  const category = new Command("category");
  category
    .command("list")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: JsonOption) => {
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/categories", { token: session.token });
        printData(options, data, commandOptions.json);
      });
    });
  return category;
}

export function createSearchCommand(options: ApiCommandOptions): Command {
  return new Command("search")
    .argument("<keyword>")
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--page-size <n>", "page size", parsePositiveInteger)
    .addOption(new Option("--offset <n>", "unsupported; current search API ignores offset").argParser(rejectUnsupportedOffset).hideHelp())
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD")
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD")
    .option("--json", "pretty-print JSON")
    .action(async (keyword: string, commandOptions: JsonOption & { categoryId?: number; pageSize?: number; offset?: number; fromDate?: string; toDate?: string }) => {
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
        printData(options, data, commandOptions.json);
      });
    });
}

export function createTopicCommand(options: ApiCommandOptions): Command {
  const topic = new Command("topic").alias("thread");

  topic
    .command("view")
    .argument("<id>", "topic id", parsePositiveInteger)
    .option("--json", "pretty-print JSON")
    .action(async (id: number, commandOptions: JsonOption) => {
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
        printData(options, data, commandOptions.json);
      });
    });

  topic
    .command("create")
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .requiredOption("--title <title>")
    .option("--content <text>")
    .option("--content-file <path>")
    .option("--tags <csv>")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: JsonOption & TopicWriteOptions & { categoryId?: number }) => {
      await runApi(options, async (session) => {
        const categoryId = commandOptions.categoryId ?? await promptCategoryId(options, session);
        if (categoryId === undefined) {
          return;
        }
        const data = await requestJson(session.baseUrl, "/api/v1/topics", {
          token: session.token,
          method: "POST",
          body: compactBody({
            categoryId,
            title: commandOptions.title,
            content: await contentFromOptions(commandOptions),
            tags: commandOptions.tags
          })
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
    .option("--content <text>")
    .option("--content-file <path>")
    .option("--tags <csv>")
    .option("--json", "pretty-print JSON")
    .action(async (id: number, commandOptions: JsonOption & TopicWriteOptions & { categoryId?: number }) => {
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, {
          token: session.token,
          method: "POST",
          body: compactBody({
            categoryId: commandOptions.categoryId,
            title: commandOptions.title,
            content: await optionalContentFromOptions(commandOptions),
            tags: commandOptions.tags
          })
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
    .action(async (id: number, commandOptions: JsonOption & { yes?: boolean; force?: boolean; confirmTitle?: string }) => {
      if (!commandOptions.yes || !commandOptions.force || !commandOptions.confirmTitle) {
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
    .option("--content <text>")
    .option("--content-file <path>")
    .option("--json", "pretty-print JSON")
    .action(async (topicId: number, commandOptions: JsonOption & ReplyWriteOptions) => {
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, `/api/v1/topics/${topicId}/replies`, {
          token: session.token,
          method: "POST",
          body: compactBody({
            content: await contentFromOptions(commandOptions),
            parentPostId: commandOptions.parentPostId
          })
        });
        printData(options, data, commandOptions.json);
      });
    });

  reply
    .command("update")
    .alias("edit")
    .argument("<id>", "reply id", parsePositiveInteger)
    .option("--content <text>")
    .option("--content-file <path>")
    .option("--json", "pretty-print JSON")
    .action(async (id: number, commandOptions: JsonOption & ReplyWriteOptions) => {
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, `/api/v1/replies/${id}`, {
          token: session.token,
          method: "POST",
          body: { content: await contentFromOptions(commandOptions) }
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
    .action(async (id: number, commandOptions: JsonOption & { yes?: boolean; force?: boolean }) => {
      if (!commandOptions.yes || !commandOptions.force) {
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
        const data = await requestJson(session.baseUrl, `/api/v1/replies/${id}`, { token: session.token, method: "DELETE" });
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
      .action(async (topicId: number, commandOptions: JsonOption) => {
        await runApi(options, async (session) => {
          const data = await requestJson(session.baseUrl, `/api/v1/topics/${topicId}/${name}`, {
            token: session.token,
            method: action === "add" ? "POST" : "DELETE"
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
    .action(async (question: string, commandOptions: JsonOption & { topK?: number }) => {
      await runApi(options, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/ask", {
          token: session.token,
          method: "POST",
          body: compactBody({ question, topK: commandOptions.topK })
        });
        printData(options, data, commandOptions.json);
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
  return current;
}

function printData(options: CommandIo, data: unknown, json?: boolean): void {
  options.stdout(`${JSON.stringify(data, null, json ? 2 : 0)}\n`);
}

async function contentFromOptions(options: { content?: string; contentFile?: string }): Promise<string> {
  const content = await optionalContentFromOptions(options);
  if (!content) {
    throw new CliValidationError("content is required");
  }
  return content;
}

async function optionalContentFromOptions(options: { content?: string; contentFile?: string }): Promise<string | undefined> {
  if (options.contentFile) {
    return readContentFile(options.contentFile);
  }
  if (options.content !== undefined) {
    return options.content;
  }
  if (processStdin.isTTY !== true) {
    return readStdin();
  }
  return undefined;
}

async function readContentFile(path: string): Promise<string> {
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

function readStdin(): Promise<string> {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
