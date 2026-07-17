import { readFile } from "node:fs/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { formatHttpErrorText, formatTransportErrorText, remediationForHttpError, remediationForTransportError, stableErrorCode } from "../core/errors.js";
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

type TopicFilterOptions = {
  categoryId?: number;
  pageSize?: number;
  cursor?: string;
  offset?: number;
  from?: string;
  to?: string;
  fromDate?: string;
  toDate?: string;
  tag?: string;
  tags?: string;
  author?: string;
  authorId?: number;
  sourceDomain?: string;
  originalUrl?: string;
  contentType?: string;
  sourceType?: string;
  status?: string;
  view?: string;
  sort?: string;
  featured?: boolean;
  pinned?: boolean;
  locked?: boolean;
  unanswered?: boolean;
  hasUsefulReply?: boolean;
};

type StatsFilterOptions = {
  from?: string;
  to?: string;
  fromDate?: string;
  toDate?: string;
  top?: number;
  limit?: number;
  pageSize?: number;
};

type AskFilterOptions = {
  topK?: number;
  categoryId?: number;
  from?: string;
  to?: string;
  fromDate?: string;
  toDate?: string;
  tag?: string;
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
    .option("--from <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--from-date <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption & StatsFilterOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateDateOptions(options, commandOptions, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/category-stats", {
          token: session.token,
          query: dateQuery(commandOptions)
        });
        printData(options, data, outputFormat(commandOptions), formatCategoryStatsText);
      });
    });

  stats
    .command("topic")
    .description("show topic aggregate statistics")
    .option("--tag <tag>", "exact tag name", parseNonBlankText)
    .option("--from <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--from-date <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--top <n>", "top tag count, 1-50", parseTopSize)
    .option("--limit <n>", "top tag count alias, 1-50", parseTopSize)
    .option("--page-size <n>", "top tag count compatibility alias, 1-50", parseTopSize)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption & StatsFilterOptions & { tag?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateDateOptions(options, commandOptions, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/topic-stats", {
          token: session.token,
          query: {
            tag: commandOptions.tag,
            ...dateQuery(commandOptions),
            ...statsTopQuery(commandOptions)
          }
        });
        printData(options, data, outputFormat(commandOptions), formatTopicStatsText);
      });
    });

  stats
    .command("tag")
    .description("show exact tag usage statistics")
    .option("--from <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--from-date <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--top <n>", "top tag count, 1-50", parseTopSize)
    .option("--limit <n>", "top tag count alias, 1-50", parseTopSize)
    .option("--page-size <n>", "top tag count compatibility alias, 1-50", parseTopSize)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption & StatsFilterOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateDateOptions(options, commandOptions, commandOptions)) {
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/tag-stats", {
          token: session.token,
          query: {
            ...dateQuery(commandOptions),
            ...statsTopQuery(commandOptions)
          }
        });
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
  const search = new Command("search")
    .argument("<keyword>")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat));
  addTopicFilterOptions(search);
  return search.action(async (keyword: string, commandOptions: FormatOption & TopicFilterOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateDateOptions(options, commandOptions, commandOptions)) {
        return;
      }
      const normalizedKeyword = normalizeSearchKeyword(keyword);
      await runApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/search", {
          token: session.token,
          query: {
            keyword: normalizedKeyword,
            ...topicFilterQuery(commandOptions)
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
    .addOption(new Option("--top-k <n>", "alias for --limit, topics to fetch, 1-10").argParser(parseResearchLimit).conflicts("limit"))
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD", parseSearchDate)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (keyword: string, commandOptions: FormatOption & { limit?: number; topK?: number; categoryId?: number; fromDate?: string; toDate?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateSearchDateRange(options, commandOptions.fromDate, commandOptions.toDate, commandOptions)) {
        return;
      }
      const normalizedKeyword = normalizeSearchKeyword(keyword);
      await runApi(options, commandOptions, async (session) => {
        const limit = commandOptions.limit ?? commandOptions.topK ?? 3;
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

  const list = topic.command("list")
    .description("list topics with server-side filters")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat));
  addTopicFilterOptions(list);
  list.action(async (commandOptions: FormatOption & TopicFilterOptions) => {
    if (!validateFormatOptions(options, commandOptions)) {
      return;
    }
    if (!validateDateOptions(options, commandOptions, commandOptions)) {
      return;
    }
    await runApi(options, commandOptions, async (session) => {
      const data = await requestJson(session.baseUrl, "/api/v1/topics", {
        token: session.token,
        query: topicFilterQuery(commandOptions)
      });
      printData(options, data, outputFormat(commandOptions), formatTopicListText);
    });
  });

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
            content: await optionalContentFromOptions(commandOptions, options, { implicitStdin: false }),
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
    .option("--context <text>", "explicit context for a short follow-up question", parseNonBlankText)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--from <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--from-date <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--tag <tag>", "exact tag filter", parseNonBlankText)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (question: string, commandOptions: FormatOption & AskFilterOptions & { context?: string }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      if (!validateDateOptions(options, commandOptions, commandOptions)) {
        return;
      }
      if (!commandOptions.context && isContextDependentAskQuestion(question)) {
        printData(options, askNeedsContextFallback(question), outputFormat(commandOptions), formatAskText);
        return;
      }
      await runApi(options, commandOptions, async (session) => {
        const apiQuestion = askQuestionWithContext(question, commandOptions.context);
        let data: unknown;
        try {
          data = await requestJson(session.baseUrl, "/api/v1/ask", {
            token: session.token,
            method: "POST",
            body: compactBody({
              question: apiQuestion,
              topK: commandOptions.topK,
              categoryId: commandOptions.categoryId,
              ...dateQuery(commandOptions),
              tag: commandOptions.tag
            })
          });
        } catch (error) {
          if (error instanceof HttpError && error.status === 429) {
            data = askRateLimitFallback(error, apiQuestion, session.token);
          } else {
            throw error;
          }
        }
        printData(options, enrichAskReferences(data, apiQuestion), outputFormat(commandOptions), formatAskText);
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
      printError(options, {
        type: "http",
        code: stableErrorCode(error),
        message: redactSecret(error.message, session?.token),
        status: error.status,
        requestId: error.requestId,
        retryAfterSeconds: error.retryAfterSeconds,
        windowSeconds: error.windowSeconds,
        remediation: remediationForHttpError(error, session?.token),
        exitCode: 1
      }, formatHttpErrorText(error, session?.token), commandOptions.json);
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
      printError(options, {
        type: "network",
        code: stableErrorCode(error),
        message: error.message,
        remediation: remediationForTransportError(error),
        exitCode: 1
      }, formatTransportErrorText(error), commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof TimeoutError) {
      printError(options, {
        type: "timeout",
        code: stableErrorCode(error),
        message: error.message,
        remediation: remediationForTransportError(error),
        exitCode: 1
      }, formatTransportErrorText(error), commandOptions.json);
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

async function optionalContentFromOptions(
  options: { content?: string; contentFile?: string },
  commandOptions: ApiCommandOptions,
  readOptions: { implicitStdin?: boolean } = {}
): Promise<string | undefined> {
  if (options.contentFile) {
    return readContentFile(options.contentFile, commandOptions);
  }
  if (options.content !== undefined) {
    return options.content;
  }
  if (readOptions.implicitStdin !== false && isStdinTTY(commandOptions) !== true) {
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

function addTopicFilterOptions(command: Command): Command {
  return command
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--page-size <n>", "page size, 1-50", parseSearchPageSize)
    .option("--cursor <cursor>", "cursor from page.nextCursor", parseCursor)
    .option("--offset <n>", "backward-compatible numeric offset", parseNonNegativeInteger)
    .option("--from <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--from-date <date>", "inclusive activity-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive activity-to date, YYYY-MM-DD", parseSearchDate)
    .option("--tag <tag>", "exact tag filter", parseNonBlankText)
    .option("--tags <csv>", "comma-separated exact tags; all must match", parseNonBlankText)
    .option("--author <text>", "author nickname substring or author id text", parseNonBlankText)
    .option("--author-id <id>", "exact author id", parsePositiveInteger)
    .option("--source-domain <domain>", "normalized original URL domain", parseNonBlankText)
    .option("--original-url <text>", "original source URL substring", parseNonBlankText)
    .option("--content-type <type>", "derived content type, such as article or topic", parseNonBlankText)
    .option("--source-type <type>", "derived source type, such as external or community", parseNonBlankText)
    .option("--status <status>", "topic status: locked, open, featured, pinned, unanswered, solved, useful", parseNonBlankText)
    .option("--view <view>", "topic view: recent, featured, pinned, unanswered, hot, popular", parseNonBlankText)
    .option("--sort <sort>", "sort mode: recent, updated, created, viewCount, replies, hot", parseNonBlankText)
    .option("--featured", "only featured topics")
    .option("--pinned", "only pinned topics")
    .option("--locked", "only locked topics")
    .option("--unanswered", "only unanswered topics")
    .option("--has-useful-reply", "only topics with useful replies");
}

function topicFilterQuery(options: TopicFilterOptions): Record<string, string | number | boolean | undefined> {
  return {
    categoryId: options.categoryId,
    pageSize: options.pageSize,
    cursor: options.cursor,
    offset: options.offset,
    ...dateQuery(options),
    tag: options.tag,
    tags: options.tags,
    author: options.author,
    authorId: options.authorId,
    sourceDomain: options.sourceDomain,
    originalUrl: options.originalUrl,
    contentType: options.contentType,
    sourceType: options.sourceType,
    status: options.status,
    view: options.view,
    sort: options.sort,
    featured: options.featured,
    pinned: options.pinned,
    locked: options.locked,
    unanswered: options.unanswered,
    hasUsefulReply: options.hasUsefulReply
  };
}

function dateQuery(options: { from?: string; to?: string; fromDate?: string; toDate?: string }): { fromDate?: string; toDate?: string } {
  return {
    fromDate: options.fromDate ?? options.from,
    toDate: options.toDate ?? options.to
  };
}

function statsTopQuery(options: StatsFilterOptions): { top?: number; limit?: number; pageSize?: number } {
  if (options.top !== undefined) {
    return { top: options.top };
  }
  if (options.limit !== undefined) {
    return { limit: options.limit };
  }
  return { pageSize: options.pageSize };
}

function validateDateOptions(
  options: CommandIo,
  dates: { from?: string; to?: string; fromDate?: string; toDate?: string },
  commandOptions?: ErrorFormatOption
): boolean {
  if (dates.from && dates.fromDate && dates.from !== dates.fromDate) {
    printError(options, { type: "validation", message: "--from and --from-date must match when both are provided", exitCode: 1 }, undefined, commandOptions?.json);
    process.exitCode = 1;
    return false;
  }
  if (dates.to && dates.toDate && dates.to !== dates.toDate) {
    printError(options, { type: "validation", message: "--to and --to-date must match when both are provided", exitCode: 1 }, undefined, commandOptions?.json);
    process.exitCode = 1;
    return false;
  }
  const query = dateQuery(dates);
  return validateSearchDateRange(options, query.fromDate, query.toDate, commandOptions);
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
  if (isRecord(data) && itemsFromData(data).length === 0 && isRecord(data.emptyResult)) {
    return formatEmptySearchText(data);
  }
  return formatTopicListText(data);
}

function formatEmptySearchText(data: Record<string, unknown>): string {
  const emptyResult = isRecord(data.emptyResult) ? data.emptyResult : {};
  return lines([
    fieldText(emptyResult.message) || "No search results.",
    textListBlock("Try:", emptyResult.suggestions),
    textListBlock("Related commands:", emptyResult.commands),
    line("requestId", data.requestId)
  ]);
}

function formatTopicListText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map(formatTopicSummaryRow).join("\n");
}

function formatRecentTopicsText(data: unknown): string {
  const items = itemsFromData(data);
  return items.map(formatTopicSummaryRow).join("\n");
}

function formatTopicSummaryRow(item: Record<string, unknown>): string {
  return [
    fieldText(item.id ?? item.topicId),
    fieldText(item.title),
    fieldText(item.categoryName ?? item.categoryId),
    fieldText(item.createdByName ?? item.createdBy),
    fieldText(item.updatedDate),
    fieldText(item.sourceDomain),
    tagsText(item.tags),
    fieldText(item.replyCount),
    fieldText(item.usefulReplyCount),
    fieldText(item.viewCount),
    topicFlagsText(item),
    fieldText(item.canonicalUrl ?? item.threadUrl ?? item.url)
  ].join("\t");
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
  if (!isRecord(data)) {
    return data;
  }
  const query = isRecord(data.query) ? data.query : {};
  const output = {
    ...data,
    query: compactBody({
      ...query,
      keyword: originalKeyword,
      normalizedKeyword: originalKeyword === normalizedKeyword ? undefined : normalizedKeyword
    })
  };
  if (itemsFromData(data).length === 0) {
    return {
      ...output,
      emptyResult: emptySearchResult(originalKeyword, normalizedKeyword)
    };
  }
  if (originalKeyword === normalizedKeyword) {
    return data;
  }
  return output;
}

function emptySearchResult(originalKeyword: string, normalizedKeyword: string): Record<string, unknown> {
  const keyword = fieldText(originalKeyword).trim();
  const fallbackKeyword = normalizedKeyword !== originalKeyword ? normalizedKeyword : keyword;
  return {
    message: `No results for "${keyword}".`,
    suggestions: [
      "Try fewer or broader keywords.",
      "Try related Chinese and English terms.",
      "Remove category, tag, author, or date filters if you used them.",
      fallbackKeyword && fallbackKeyword !== keyword ? `Try normalized keyword: ${fallbackKeyword}` : undefined
    ].filter(Boolean),
    commands: [
      `apexcn search ${quoteCliArgForHelp(keyword)} --page-size 10 --json`,
      `apexcn research ${quoteCliArgForHelp(keyword)} --limit 5 --json`,
      `apexcn topic recent --page-size 10 --json`
    ]
  };
}

function quoteCliArgForHelp(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function textListBlock(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  return `${label}\n${value.map((item) => `- ${fieldText(item)}`).filter((lineText) => lineText !== "- ").join("\n")}`;
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
    line("URL", topic.canonicalUrl ?? topic.threadUrl ?? topic.url),
    line("Thread URL", topic.threadUrl),
    line("Original URL", topic.originalUrl),
    line("Source", topic.sourceDomain),
    line("Tags", tagsText(topic.tags)),
    line("Replies", topic.replyCount),
    line("Useful replies", topic.usefulReplyCount),
    line("Views", topic.viewCount),
    line("Flags", topicFlagsText(topic)),
    blockLine("Content", topic.content ?? topic.body ?? topic.summary ?? topic.excerpt),
    line("requestId", isRecord(data) ? data.requestId : undefined)
  ]);
}

function formatAskText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  if (data.answerable === false || isRecord(data.fallback)) {
    return formatAskFallbackText(data);
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
    blockLine(filtersText(data.filters) ? "Scoped Answer" : "Answer", answer),
    line("confidence", data.confidence),
    blockLine("limitations", limitationsText(data.limitations)),
    line("filters", filtersText(data.filters)),
    sourceLines.length > 0 ? (filtersText(data.filters) ? "Scoped references:" : "Sources:") : undefined,
    ...sourceLines,
    line("requestId", data.requestId)
  ]);
}

function formatAskFallbackText(data: Record<string, unknown>): string {
  const fallback = isRecord(data.fallback) ? data.fallback : {};
  const suggestedQueries = textList(fallback.suggestedQueries);
  const suggestedCommands = textList(fallback.suggestedCommands);
  return lines([
    "Answerable: false",
    blockLine("Reason", fallback.message ?? "没有找到可引用的社区资料，因此未将回答作为可信结论输出。"),
    line("confidence", data.confidence),
    line("retryAfterSeconds", data.retryAfterSeconds),
    line("windowSeconds", data.windowSeconds),
    suggestedQueries ? `Suggested queries:\n${suggestedQueries}` : undefined,
    suggestedCommands ? `Suggested commands:\n${suggestedCommands}` : undefined,
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
  for (const key of ["sources", "citations", "references", "items"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function enrichAskReferences(data: unknown, question?: string): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const output = normalizeAskResponse(data);
  for (const key of ["sources", "citations", "references", "items"]) {
    const value = output[key];
    if (Array.isArray(value)) {
      output[key] = value.map((item) => isRecord(item) ? enrichAskReference(item) : item);
    }
  }
  return withAskFallback(output, question);
}

function normalizeAskResponse(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.data)) {
    return { ...data };
  }
  const inner = data.data;
  return compactBody({
    status: data.status,
    message: data.message,
    ...inner,
    answer: inner.answer,
    references: Array.isArray(inner.references) ? inner.references : undefined,
    requestId: inner.requestId ?? inner.request_id ?? data.requestId ?? data.request_id,
    requestUrl: inner.requestUrl ?? inner.request_url
  });
}

function withAskFallback(data: Record<string, unknown>, question?: string): Record<string, unknown> {
  if (isRecord(data.fallback)) {
    return data;
  }
  const reason = askFallbackReason(data);
  if (!reason) {
    return data;
  }
  const suggestedQueries = askSuggestedQueries(question ?? data.question ?? data.query);
  return compactBody({
    ...data,
    answerable: false,
    noTrustedReferences: true,
    fallback: {
      reason,
      message: askFallbackMessage(reason),
      suggestedQueries,
      suggestedCommands: askSuggestedCommands(suggestedQueries)
    }
  });
}

function askNeedsContextFallback(question: string): Record<string, unknown> {
  const suggestedQueries = askSuggestedQueries(question);
  return {
    answerable: false,
    needsContext: true,
    fallback: {
      reason: "needs-context",
      message: askFallbackMessage("needs-context"),
      suggestedQueries,
      suggestedCommands: askSuggestedCommands(suggestedQueries)
    }
  };
}

function askRateLimitFallback(error: HttpError, question: string, token?: string): Record<string, unknown> {
  const suggestedQueries = askSuggestedQueries(question);
  return compactBody({
    answerable: false,
    rateLimited: true,
    retryAfterSeconds: error.retryAfterSeconds,
    windowSeconds: error.windowSeconds,
    requestId: error.requestId,
    error: {
      type: "http",
      status: error.status,
      message: redactSecret(error.message, token)
    },
    fallback: {
      reason: "rate-limited",
      message: askFallbackMessage("rate-limited", error.retryAfterSeconds),
      suggestedQueries,
      suggestedCommands: askSuggestedCommands(suggestedQueries)
    }
  });
}

function askFallbackReason(data: Record<string, unknown>): string | undefined {
  const error = isRecord(data.error) ? data.error : {};
  const code = fieldText(error.code ?? data.code);
  const message = fieldText(error.message ?? data.message);
  if (/NO[_-]?(TRUSTED[_-]?)?(REFERENCE|SOURCE)S?/i.test(`${code} ${message}`)
    || /no trusted references?|no references?|没有.*引用|无.*引用/.test(`${code} ${message}`)) {
    return "no-trusted-references";
  }
  if (isLowAskConfidence(data.confidence)) {
    return "low-confidence";
  }
  return sourcesFromData(data).length === 0 ? "no-trusted-references" : undefined;
}

function askQuestionWithContext(question: string, context?: string): string {
  if (!context) {
    return question;
  }
  return `上下文：${context.trim()}\n追问：${question}`;
}

function isContextDependentAskQuestion(question: string): boolean {
  const normalized = fieldText(question).replace(/[?？。！!]+$/g, "").trim();
  if (!normalized) {
    return false;
  }
  const lowered = normalized.toLowerCase();
  if (/\b(apex|ords|rest|api|sql|plsql|json|oauth|token|interactive\s+grid)\b/i.test(lowered)) {
    return false;
  }
  if (/[A-Za-z0-9]{2,}/.test(normalized)) {
    return false;
  }
  if (/^(那|它|这个|那个|其|如果|最后|先|服务端|客户端|怎么|在哪|哪里|能按顺序)/.test(normalized)) {
    return normalized.length <= 18;
  }
  return /^(那|它|这个|那个|先|最后).*(怎么|哪里|哪|确认|整理|顺序|不行)/.test(normalized) && normalized.length <= 24;
}

function isLowAskConfidence(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value < 0.3;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return numeric < 0.3;
  }
  return ["low", "very-low", "none", "unknown", "低", "很低", "无"].includes(normalized);
}

function askFallbackMessage(reason: string, retryAfterSeconds?: number): string {
  if (reason === "needs-context") {
    return "这个追问缺少上一轮问题或引用上下文。请把完整背景写进问题，或使用 --context 提供上一轮主题后再问。";
  }
  if (reason === "rate-limited") {
    const retry = retryAfterSeconds === undefined ? "" : `请等待 ${retryAfterSeconds} 秒后重试，或先用 search/research 获取引用资料。`;
    return `服务端触发限流，因此本次未生成回答。${retry}`;
  }
  if (reason === "low-confidence") {
    return "回答置信度过低，因此未将服务端回答作为可信结论输出。请先用 search 或 research 查找可引用资料。";
  }
  return "没有找到可引用的社区资料，因此未将服务端回答作为可信结论输出。请先用 search 或 research 查找相关帖子。";
}

function askSuggestedQueries(value: unknown): string[] {
  const text = fieldText(value).replace(/[?？。！!]+$/g, "").trim();
  if (!text) {
    return [];
  }
  const compact = text.replace(/\s+/g, " ").slice(0, 120).trim();
  return Array.from(new Set([compact])).filter(Boolean);
}

function askSuggestedCommands(queries: string[]): string[] {
  const query = queries[0];
  if (!query) {
    return ["apexcn search <keywords> --json", "apexcn research <keywords> --json"];
  }
  const quoted = quoteCliArg(query);
  return [`apexcn search ${quoted} --json`, `apexcn research ${quoted} --json`];
}

function quoteCliArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function textList(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((item) => `- ${fieldText(item)}`).filter((lineText) => lineText !== "- ").join("\n");
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

function parseTopSize(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 50) {
    throw new InvalidArgumentError("Expected top size to be between 1 and 50");
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

function tagsText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(fieldText).filter(Boolean).join(",");
  }
  return fieldText(value);
}

function topicFlagsText(item: Record<string, unknown>): string {
  return [
    item.isFeatured === true ? "featured" : undefined,
    item.isPinned === true ? "pinned" : undefined,
    item.isLocked === true ? "locked" : undefined
  ].filter(Boolean).join(",");
}

function filtersText(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return Object.entries(value)
    .map(([key, filterValue]) => [key, fieldText(filterValue)].filter(Boolean).join("="))
    .filter(Boolean)
    .join(" ");
}

function limitationsText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(fieldText).filter(Boolean).join("\n");
  }
  return blockText(value);
}
