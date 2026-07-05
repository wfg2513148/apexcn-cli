import { readFile } from "node:fs/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { blockText, fieldText, isRecord, itemsFromData, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption, type JsonOption } from "../output.js";
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
  preview?: boolean;
};

type ErrorFormatOption = {
  json?: boolean;
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
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/categories", { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatCategoryListText);
      });
    });
  return category;
}

export function createStatsCommand(options: ApiCommandOptions): Command {
  const stats = new Command("stats");

  stats
    .command("category")
    .description("show per-category aggregate statistics")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/category-stats", { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatCategoryStatsText);
      });
    });

  stats
    .command("topic")
    .description("show topic aggregate statistics")
    .option("--tag <tag>", "exact tag name", parseNonBlankText)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption & { tag?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/topic-stats", {
          token: session.token,
          query: { tag: commandOptions.tag }
        });
        printData(options, data, outputFormat(commandOptions), formatTopicStatsText);
      });
    });

  stats
    .command("tag")
    .description("show exact tag usage statistics")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/tag-stats", { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatTagStatsText);
      });
    });

  return stats;
}

export function createAdminCommand(options: ApiCommandOptions): Command {
  const admin = new Command("admin");
  admin
    .command("list")
    .description("list public community admins")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/admin-list", { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatAdminListText);
      });
    });
  return admin;
}

export function createSearchCommand(options: ApiCommandOptions): Command {
  return new Command("search")
    .argument("<keyword>")
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--page-size <n>", "page size, 1-50", parseSearchPageSize)
    .option("--cursor <cursor>", "cursor from page.nextCursor", parseCursor)
    .option("--offset <n>", "backward-compatible numeric offset", parseNonNegativeInteger)
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD", parseSearchDate)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (keyword: string, commandOptions: FormatOption & { categoryId?: number; pageSize?: number; cursor?: string; offset?: number; fromDate?: string; toDate?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateSearchDateRange(options, commandOptions.fromDate, commandOptions.toDate, commandOptions)) {
        return;
      }
      const normalizedKeyword = normalizeSearchKeyword(keyword);
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/search", {
          token: session.token,
          query: {
            keyword: normalizedKeyword,
            categoryId: commandOptions.categoryId,
            pageSize: commandOptions.pageSize,
            cursor: commandOptions.cursor,
            offset: commandOptions.offset,
            fromDate: commandOptions.fromDate,
            toDate: commandOptions.toDate
          }
        });
        printData(options, searchOutput(data, keyword, normalizedKeyword), outputFormat(commandOptions), formatSearchText);
      });
    });
}

export function createResearchCommand(options: ApiCommandOptions): Command {
  return new Command("research")
    .argument("<keyword>")
    .option("--limit <n>", "topics to fetch, 1-10", parseResearchLimit)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD", parseSearchDate)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (keyword: string, commandOptions: FormatOption & { limit?: number; categoryId?: number; fromDate?: string; toDate?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateSearchDateRange(options, commandOptions.fromDate, commandOptions.toDate, commandOptions)) {
        return;
      }
      const normalizedKeyword = normalizeSearchKeyword(keyword);
      await runApi(options, commandOptions, async (session) => {
        const limit = commandOptions.limit ?? 3;
        const search = await requestJson(session.baseUrl, "/api/v1/search", {
          token: session.token,
          query: {
            keyword: normalizedKeyword,
            pageSize: limit,
            categoryId: commandOptions.categoryId,
            fromDate: commandOptions.fromDate,
            toDate: commandOptions.toDate
          }
        });
        const items = itemsFromData(search).slice(0, limit);
        const topics = [];
        const topicRequestIds = [];
        const errors = [];
        for (const [sourceItemIndex, item] of items.entries()) {
          const id = topicIdFromSearchItem(item);
          if (id !== undefined) {
            try {
              const topic = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
              topics.push(researchTopicFromData(topic, sourceItemIndex));
              if (isRecord(topic) && topic.requestId) {
                topicRequestIds.push(topic.requestId);
              }
            } catch (error) {
              errors.push(researchTopicError(error, id, sourceItemIndex, session));
            }
          }
        }
        const data = {
          query: compactBody({
            keyword,
            normalizedKeyword: normalizedKeyword === keyword ? undefined : normalizedKeyword,
            limit,
            categoryId: commandOptions.categoryId,
            fromDate: commandOptions.fromDate,
            toDate: commandOptions.toDate
          }),
          items,
          topics,
          links: researchLinks(items, topics),
          requestIds: {
            search: isRecord(search) ? search.requestId : undefined,
            topics: topicRequestIds
          },
          errors
        };
        if (errors.length > 0) {
          process.exitCode = 1;
        }
        printData(options, data, outputFormat(commandOptions), formatResearchText);
      });
    });
}

export function createTopicCommand(options: ApiCommandOptions): Command {
  const topic = new Command("topic").alias("thread");

  topic
    .command("recent")
    .option("--page-size <n>", "page size, 1-50", parseSearchPageSize)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--since-hours <n>", "updated within the last N hours", parsePositiveInteger)
    .option("--cursor <cursor>", "cursor from page.nextCursor", parseCursor)
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD", parseSearchDate)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption & { pageSize?: number; categoryId?: number; sinceHours?: number; cursor?: string; fromDate?: string; toDate?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateSearchDateRange(options, commandOptions.fromDate, commandOptions.toDate, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const recent = await recentTopics(session, commandOptions);
        printData(options, recent, outputFormat(commandOptions), formatRecentTopicsText);
      });
    });

  topic
    .command("view")
    .argument("<id>", "topic id", parsePositiveInteger)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (id: number, commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
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
    .option("--preview", "preview the API request without sending it")
    .action(async (commandOptions: JsonOption & DryRunOption & TopicWriteOptions & { categoryId?: number }) => {
      await runApi(options, commandOptions, async (session) => {
        if (isRequestPreview(commandOptions) && commandOptions.categoryId === undefined) {
          printError(options, { type: "validation", message: `Missing --category-id in ${requestPreviewMode(commandOptions)} mode`, exitCode: 1 }, undefined, commandOptions.json);
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
        if (isRequestPreview(commandOptions)) {
          printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
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
    .option("--preview", "preview the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & TopicWriteOptions & { categoryId?: number }) => {
      await runApi(options, commandOptions, async (session) => {
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
        if (isRequestPreview(commandOptions)) {
          printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
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
    .option("--preview", "preview the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & { yes?: boolean; force?: boolean; confirmTitle?: string }) => {
      if (!commandOptions.yes || !commandOptions.force || !commandOptions.confirmTitle) {
        if (isRequestPreview(commandOptions)) {
          printError(options, { type: "safety", message: "Refusing to delete topic without --yes --force --confirm-title", exitCode: 1 }, undefined, commandOptions.json);
          process.exitCode = 1;
          return;
        }
        if (processStdin.isTTY === true && !commandOptions.yes && !commandOptions.force) {
          await runApi(options, commandOptions, async (session) => {
            const topic = await requestJson<{ topic?: { title?: string; createdByName?: string; categoryName?: string } }>(session.baseUrl, `/api/v1/topics/${id}`, {
              token: session.token
            });
            const title = topic.topic?.title;
            if (!title) {
              printError(options, { type: "validation", message: "Unable to load topic for confirmation", exitCode: 1 }, undefined, commandOptions.json);
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
              printError(options, { type: "safety", message: "Delete cancelled", exitCode: 1 }, undefined, commandOptions.json);
              process.exitCode = 1;
              return;
            }
            const data = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token, method: "DELETE" });
            printData(options, data, commandOptions.json);
          });
          return;
        }
        printError(options, { type: "safety", message: "Refusing to delete topic without --yes --force --confirm-title", exitCode: 1 }, undefined, commandOptions.json);
        process.exitCode = 1;
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const request = { method: "DELETE", path: `/api/v1/topics/${id}` };
        if (isRequestPreview(commandOptions)) {
          printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
          return;
        }
        const topic = await requestJson<{ topic?: { title?: string } }>(session.baseUrl, `/api/v1/topics/${id}`, {
          token: session.token
        });
        if (topic.topic?.title !== commandOptions.confirmTitle) {
          printError(options, { type: "safety", message: "Refusing to delete topic because --confirm-title does not match", exitCode: 1 }, undefined, commandOptions.json);
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
    .option("--preview", "preview the API request without sending it")
    .action(async (topicId: number, commandOptions: JsonOption & DryRunOption & ReplyWriteOptions) => {
      await runApi(options, commandOptions, async (session) => {
        const request = {
          method: "POST",
          path: `/api/v1/topics/${topicId}/replies`,
          body: compactBody({
            content: await contentFromOptions(commandOptions, options),
            parentPostId: commandOptions.parentPostId
          })
        };
        if (isRequestPreview(commandOptions)) {
          printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
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
    .option("--preview", "preview the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & ReplyWriteOptions) => {
      await runApi(options, commandOptions, async (session) => {
        const request = {
          method: "POST",
          path: `/api/v1/replies/${id}`,
          body: { content: await contentFromOptions(commandOptions, options) }
        };
        if (isRequestPreview(commandOptions)) {
          printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
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
    .option("--preview", "preview the API request without sending it")
    .action(async (id: number, commandOptions: JsonOption & DryRunOption & { yes?: boolean; force?: boolean }) => {
      if (!commandOptions.yes || !commandOptions.force) {
        if (isRequestPreview(commandOptions)) {
          printError(options, { type: "safety", message: "Refusing to delete reply without --yes --force", exitCode: 1 }, undefined, commandOptions.json);
          process.exitCode = 1;
          return;
        }
        if (processStdin.isTTY === true && !commandOptions.yes && !commandOptions.force) {
          const confirmed = await promptText("Type delete to delete this reply: ");
          if (confirmed !== "delete") {
            printError(options, { type: "safety", message: "Delete cancelled", exitCode: 1 }, undefined, commandOptions.json);
            process.exitCode = 1;
            return;
          }
          await runApi(options, commandOptions, async (session) => {
            const data = await requestJson(session.baseUrl, `/api/v1/replies/${id}`, { token: session.token, method: "DELETE" });
            printData(options, data, commandOptions.json);
          });
          return;
        }
        printError(options, { type: "safety", message: "Refusing to delete reply without --yes --force", exitCode: 1 }, undefined, commandOptions.json);
        process.exitCode = 1;
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const request = { method: "DELETE", path: `/api/v1/replies/${id}` };
        if (isRequestPreview(commandOptions)) {
          printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
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
      .option("--preview", "preview the API request without sending it")
      .action(async (topicId: number, commandOptions: JsonOption & DryRunOption) => {
        await runApi(options, commandOptions, async (session) => {
          const request = {
            path: `/api/v1/topics/${topicId}/${name}`,
            method: action === "add" ? "POST" : "DELETE"
          };
          if (isRequestPreview(commandOptions)) {
            printDryRun(options, session, request, requestPreviewMode(commandOptions), commandOptions.json);
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
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/ask", {
          token: session.token,
          method: "POST",
          body: compactBody({ question, topK: commandOptions.topK })
        });
        printData(options, enrichAskReferences(data), outputFormat(commandOptions), formatAskText);
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

async function runApi(options: ApiCommandOptions, commandOptions: ErrorFormatOption, callback: (session: Session) => Promise<void>): Promise<void> {
  let session: Session | undefined;
  try {
    session = await loadSession(options, commandOptions);
    if (!session) {
      return;
    }
    await callback(session);
  } catch (error) {
    if (error instanceof HttpError) {
      const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
      printError(options, {
        type: "http",
        message: redactSecret(error.message, session?.token),
        status: error.status,
        requestId: error.requestId,
        exitCode: 1
      }, `HTTP ${error.status}: ${redactSecret(error.message, session?.token)}${requestId}\n`, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof CliValidationError) {
      printError(options, { type: "validation", message: error.message, exitCode: 1 }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof ConfigFileError) {
      printError(options, { type: "config", message: error.message, exitCode: 1 }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof NetworkError) {
      printError(options, { type: "network", message: error.message, exitCode: 1 }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof TimeoutError) {
      printError(options, { type: "timeout", message: error.message, exitCode: 1 }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function loadSession(options: ApiCommandOptions, commandOptions: ErrorFormatOption): Promise<Session | undefined> {
  const config = await loadConfig(options.configPath);
  const profile = config.current;
  const current = profile ? config.profiles[profile] : undefined;
  if (!profile || !current) {
    printError(options, { type: "no-profile", message: "No active profile", exitCode: 1 }, undefined, commandOptions.json);
    process.exitCode = 1;
    return undefined;
  }
  return { profile, ...current };
}

function printDryRun(options: CommandIo, session: Session, request: ApiRequestPlan, mode: "dry-run" | "preview", json?: boolean): void {
  printData(options, compactBody({
    dryRun: true,
    preview: mode === "preview",
    mode,
    profile: session.profile,
    baseUrl: session.baseUrl,
    method: request.method,
    path: request.path,
    query: request.query,
    body: request.body
  }), json);
}

function isRequestPreview(options: DryRunOption): boolean {
  return options.dryRun === true || options.preview === true;
}

function requestPreviewMode(options: DryRunOption): "dry-run" | "preview" {
  return options.preview === true && options.dryRun !== true ? "preview" : "dry-run";
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

function formatCategoryStatsText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => [
    fieldText(item.id),
    fieldText(item.name),
    fieldText(item.topicCount),
    fieldText(item.replyCount),
    fieldText(item.featuredCount)
  ].join("\t")).join("\n");
}

function formatTopicStatsText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const tagCounts = Array.isArray(data.tagCounts) ? data.tagCounts.filter(isRecord) : [];
  const summary = lines([
    line("topicCount", data.topicCount),
    line("featuredTopicCount", data.featuredTopicCount),
    line("tag", data.tag),
    line("includesLockedTopics", data.includesLockedTopics),
    line("includesHiddenReplies", data.includesHiddenReplies),
    line("requestId", data.requestId)
  ]);
  const tags = tagCounts.map((item) => `${fieldText(item.tag)}\t${fieldText(item.topicCount)}`).join("\n");
  return [summary, tags ? `tagCounts:\n${tags}` : undefined].filter(Boolean).join("\n");
}

function formatTagStatsText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => [
    fieldText(item.tag),
    fieldText(item.topicCount),
    fieldText(item.matchMode)
  ].join("\t")).join("\n");
}

function formatAdminListText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => [
    fieldText(item.id),
    fieldText(item.nickname),
    fieldText(item.roleName),
    fieldText(item.roleLevel),
    publicContactsText(item.publicContacts)
  ].join("\t")).join("\n");
}

function formatSearchText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => `${fieldText(item.id)}\t${fieldText(item.title)}\t${fieldText(item.url)}`).join("\n");
}

function formatRecentTopicsText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map((item) => [
    fieldText(item.id),
    fieldText(item.title),
    fieldText(item.updatedDate),
    fieldText(item.createdDate),
    fieldText(item.url ?? item.threadUrl)
  ].join("\t")).join("\n");
}

function formatResearchText(data: unknown): string {
  if (!isRecord(data) || !isRecord(data.query) || !Array.isArray(data.topics)) {
    return "";
  }
  const keyword = fieldText(data.query.keyword);
  const topics = data.topics.filter(isRecord);
  const errors = Array.isArray(data.errors) ? data.errors.filter(isRecord) : [];
  const sections = topics.map((topic, index) => lines([
    `${index + 1}. ${fieldText(topic.title ?? topic.topicTitle ?? `topic ${index + 1}`)}`,
    line("URL", topic.url ?? topic.threadUrl),
    line("Original URL", topic.originalUrl),
    blockLine("Excerpt", excerptText(topic.content ?? topic.body ?? topic.summary ?? topic.excerpt))
  ]));
  const errorLines = errors.map((error) => `- item ${fieldText(error.sourceItemIndex)} topic ${fieldText(error.id)}: ${fieldText(error.type)} ${fieldText(error.message)}`);
  return lines([
    keyword ? `Research: ${keyword}` : "Research",
    `Topics: ${topics.length}`,
    ...sections,
    errorLines.length > 0 ? "Errors:" : undefined,
    ...errorLines
  ]);
}

function searchOutput(data: unknown, originalKeyword: string, normalizedKeyword: string): unknown {
  if (originalKeyword === normalizedKeyword || !isRecord(data)) {
    return data;
  }
  const query = isRecord(data.query) ? data.query : {};
  return {
    ...data,
    query: compactBody({
      ...query,
      keyword: originalKeyword,
      normalizedKeyword
    })
  };
}

async function recentTopics(
  session: Session,
  options: { pageSize?: number; categoryId?: number; sinceHours?: number; cursor?: string; fromDate?: string; toDate?: string }
): Promise<Record<string, unknown>> {
  const pageSize = options.pageSize ?? 20;
  const sinceHours = options.sinceHours ?? (!options.fromDate && !options.toDate ? 48 : undefined);
  const since = sinceHours === undefined ? undefined : new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const fromDate = options.fromDate ?? (since ? dateOnly(since) : undefined);
  const query = compactBody({
    pageSize,
    categoryId: options.categoryId,
    sinceHours,
    since: since?.toISOString(),
    cursor: options.cursor,
    fromDate,
    toDate: options.toDate
  });
  try {
    const topics = await requestJson(session.baseUrl, "/api/v1/topics", {
      token: session.token,
      query: {
        pageSize,
        categoryId: options.categoryId,
        cursor: options.cursor,
        fromDate,
        toDate: options.toDate
      }
    });
    return {
      kind: "topic-recent",
      source: "topics",
      query,
      items: itemsFromData(topics).filter((item) => !since || isOnOrAfter(item.updatedDate ?? item.createdDate, since)),
      page: isRecord(topics) ? topics.page : undefined,
      requestIds: {
        topics: isRecord(topics) ? [topics.requestId].filter(Boolean) : []
      },
      errors: []
    };
  } catch (error) {
    if (!isTopicsListUnsupported(error)) {
      throw error;
    }
  }
  return recentTopicsFromSearchFallback(session, {
    pageSize,
    categoryId: options.categoryId,
    sinceHours,
    since,
    cursor: options.cursor,
    fromDate,
    toDate: options.toDate
  });
}

async function recentTopicsFromSearchFallback(
  session: Session,
  options: { pageSize: number; categoryId?: number; sinceHours?: number; since?: Date; cursor?: string; fromDate?: string; toDate?: string }
): Promise<Record<string, unknown>> {
  const search = await requestJson(session.baseUrl, "/api/v1/search", {
    token: session.token,
    query: {
      keyword: "%",
      pageSize: options.pageSize,
      categoryId: options.categoryId,
      cursor: options.cursor,
      fromDate: options.fromDate,
      toDate: options.toDate
    }
  });
  const items = itemsFromData(search).filter((item) => !options.since || isOnOrAfter(item.updatedDate ?? item.createdDate, options.since));
  const recentItems = [];
  const topicRequestIds = [];
  const errors = [];
  for (const [sourceItemIndex, item] of items.entries()) {
    const id = topicIdFromSearchItem(item);
    if (id === undefined) {
      recentItems.push(item);
      continue;
    }
    try {
      const topic = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
      recentItems.push(recentTopicFromData(topic, item, sourceItemIndex));
      if (isRecord(topic) && topic.requestId) {
        topicRequestIds.push(topic.requestId);
      }
    } catch (error) {
      errors.push(researchTopicError(error, id, sourceItemIndex, session));
      recentItems.push(item);
    }
  }
  if (errors.length > 0) {
    process.exitCode = 1;
  }
  return {
    kind: "topic-recent",
    source: "search-fallback",
    query: compactBody({
      pageSize: options.pageSize,
      categoryId: options.categoryId,
      sinceHours: options.sinceHours,
      since: options.since?.toISOString(),
      cursor: options.cursor,
      fromDate: options.fromDate,
      toDate: options.toDate,
      searchKeyword: "%"
    }),
    items: recentItems,
    page: isRecord(search) ? search.page : undefined,
    requestIds: {
      search: isRecord(search) ? search.requestId : undefined,
      topics: topicRequestIds
    },
    errors
  };
}

function formatTopicText(data: unknown): string {
  const topic = topicFromData(data);
  if (!topic) {
    return "";
  }
  return lines([
    line("id", topic.id),
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

function enrichAskReferences(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const output = { ...data };
  for (const key of ["sources", "citations", "items"]) {
    const value = output[key];
    if (Array.isArray(value)) {
      output[key] = value.map((item) => isRecord(item) ? enrichAskReference(item) : item);
    }
  }
  return output;
}

function enrichAskReference(source: Record<string, unknown>): Record<string, unknown> {
  const topicId = topicIdFromAskReference(source);
  const topicUrl = source.url ?? source.threadUrl ?? (topicId === undefined ? undefined : `https://oracleapex.cn/t/${topicId}`);
  return compactBody({
    ...source,
    url: topicUrl,
    threadUrl: source.threadUrl ?? topicUrl,
    originalUrl: source.originalUrl ?? source.source_url
  });
}

function topicIdFromAskReference(source: Record<string, unknown>): number | undefined {
  const direct = topicIdFromSearchItem(source);
  if (direct !== undefined) {
    return direct;
  }
  for (const key of ["doc_id", "card_link"]) {
    const value = source[key];
    if (typeof value !== "string") {
      continue;
    }
    const match = /(?:P14_THREAD_ID:|\/t\/)(\d+)/.exec(value);
    if (match) {
      return Number(match[1]);
    }
    if (/^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function topicIdFromSearchItem(item: Record<string, unknown>): number | undefined {
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

function researchLinks(items: Array<Record<string, unknown>>, topics: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const fallbackKeys = new Set<string>();
  for (const item of [...items, ...topics]) {
    const link = compactBody({
      id: item.id ?? item.topicId ?? item.threadId,
      title: item.title ?? item.topicTitle,
      url: item.url ?? item.threadUrl,
      originalUrl: item.originalUrl,
      createdDate: item.createdDate,
      updatedDate: item.updatedDate
    });
    if (Object.keys(link).length === 0) {
      continue;
    }
    const key = linkKey(link, fallbackKeys);
    merged.set(key, compactBody({ ...merged.get(key), ...link }));
  }
  return [...merged.values()];
}

function researchTopicFromData(data: unknown, sourceItemIndex: number): Record<string, unknown> {
  const topic = topicFromData(data) ?? {};
  const content = topic.content ?? topic.body;
  return compactBody({
    sourceItemIndex,
    id: topic.id ?? topic.topicId ?? topic.threadId,
    title: topic.title ?? topic.topicTitle,
    url: topic.url ?? topic.threadUrl,
    originalUrl: topic.originalUrl,
    createdDate: topic.createdDate,
    updatedDate: topic.updatedDate,
    content,
    excerpt: topic.summary ?? topic.excerpt ?? (content ? excerptText(content) : undefined),
    requestId: isRecord(data) ? data.requestId : undefined
  });
}

function recentTopicFromData(data: unknown, source: Record<string, unknown>, sourceItemIndex: number): Record<string, unknown> {
  const topic = topicFromData(data) ?? {};
  return compactBody({
    ...source,
    sourceItemIndex,
    id: topic.id ?? source.id ?? source.topicId ?? source.threadId,
    categoryId: topic.categoryId ?? source.categoryId,
    categoryName: topic.categoryName ?? source.categoryName,
    title: topic.title ?? source.title ?? source.topicTitle,
    url: topic.url ?? topic.threadUrl ?? source.url ?? source.threadUrl,
    threadUrl: topic.threadUrl ?? topic.url ?? source.threadUrl ?? source.url,
    originalUrl: topic.originalUrl ?? source.originalUrl,
    createdDate: topic.createdDate ?? source.createdDate,
    updatedDate: topic.updatedDate ?? source.updatedDate,
    viewCount: topic.viewCount ?? source.viewCount,
    tags: topic.tags ?? source.tags,
    requestId: isRecord(data) ? data.requestId : undefined
  });
}

function linkKey(link: Record<string, unknown>, fallbackKeys: Set<string>): string {
  const id = fieldText(link.id);
  if (id) {
    return `id:${id}`;
  }
  for (const key of [link.url, link.originalUrl].map(fieldText).filter(Boolean)) {
    if (!fallbackKeys.has(key)) {
      fallbackKeys.add(key);
    }
    return `url:${key}`;
  }
  return `anon:${fallbackKeys.size}`;
}

function researchTopicError(error: unknown, id: number, sourceItemIndex: number, session: Session): Record<string, unknown> {
  if (error instanceof HttpError) {
    return compactBody({
      sourceItemIndex,
      id,
      type: "http",
      message: redactSecret(error.message, session.token),
      status: error.status,
      requestId: error.requestId
    });
  }
  if (error instanceof NetworkError) {
    return { sourceItemIndex, id, type: "network", message: error.message };
  }
  if (error instanceof TimeoutError) {
    return { sourceItemIndex, id, type: "timeout", message: error.message };
  }
  throw error;
}

function isTopicsListUnsupported(error: unknown): boolean {
  return error instanceof HttpError && [404, 405, 555].includes(error.status);
}

function excerptText(value: unknown): string {
  const text = blockText(value);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
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
    printError(options, { type: "validation", message: "Missing --category-id in non-interactive mode" });
    process.exitCode = 1;
    return undefined;
  }

  const data = await requestJson<{ items?: Array<{ id: number; name: string; canCreateTopic?: boolean }> }>(session.baseUrl, "/api/v1/categories", {
    token: session.token
  });
  const categories = (data.items ?? []).filter((item) => item.canCreateTopic !== false);
  if (categories.length === 0) {
    printError(options, { type: "validation", message: "No categories are available for topic creation" });
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
    printError(options, { type: "validation", message: "Invalid category selection" });
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

function parseResearchLimit(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 10) {
    throw new InvalidArgumentError("Expected --limit to be between 1 and 10");
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

function parseCursor(value: string): string {
  const cursor = value.trim();
  if (!cursor) {
    throw new InvalidArgumentError("Expected a non-empty cursor");
  }
  return cursor;
}

function parseNonBlankText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new InvalidArgumentError("Expected a non-empty value");
  }
  return text;
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

function validateSearchDateRange(options: CommandIo, fromDate?: string, toDate?: string, commandOptions?: ErrorFormatOption): boolean {
  if (fromDate && toDate && fromDate > toDate) {
    printError(options, { type: "validation", message: "--from-date must be earlier than or equal to --to-date", exitCode: 1 }, undefined, commandOptions?.json);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isOnOrAfter(value: unknown, since: Date): boolean {
  if (typeof value !== "string") {
    return true;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return true;
  }
  return date.getTime() >= since.getTime();
}

function normalizeSearchKeyword(keyword: string): string {
  return keyword.replace(/\bAPEX\s*Lang\b/gi, "ApexLang");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function publicContactsText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.filter(isRecord).map((contact) => {
    const type = fieldText(contact.type ?? contact.kind ?? contact.name);
    const label = fieldText(contact.label ?? contact.value ?? contact.url);
    return [type, label].filter(Boolean).join(":");
  }).filter(Boolean).join(",");
}
