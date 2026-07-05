import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { fieldText, isRecord, itemsFromData, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

export type MeCommandOptions = CommandIo & {
  configPath?: string;
};

export function createMeCommand(options: MeCommandOptions): Command {
  const me = new Command("me")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .option("--verbose", "print request diagnostics")
    .action(async (commandOptions: FormatOption & { verbose?: boolean }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runMeApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/me", { token: session.token });
        if (commandOptions.verbose) {
          options.stderr(`GET ${session.baseUrl.replace(/\/+$/, "")}/api/v1/me\n`);
        }
        printData(options, data, outputFormat(commandOptions), formatMeText);
      });
    });

  me
    .command("stats")
    .description("show current user aggregate activity statistics")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async function(this: Command, rawOptions: FormatOption | Command) {
      const commandOptions = commandOptionsFrom<FormatOption>(this, rawOptions);
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runMeApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/me/stats", { token: session.token });
        printData(options, data, outputFormat(commandOptions), formatMeStatsText);
      });
    });

  for (const item of [
    { name: "topics", path: "/api/v1/me/topics", formatter: formatTopicListText, description: "list current user authored topics" },
    { name: "replies", path: "/api/v1/me/replies", formatter: formatReplyListText, description: "list current user replies" },
    { name: "favorites", path: "/api/v1/me/favorites", formatter: formatTopicRelationListText, description: "list current user favorite topics" },
    { name: "subscriptions", path: "/api/v1/me/subscriptions", formatter: formatTopicRelationListText, description: "list current user subscribed topics" }
  ] as const) {
    me
      .command(item.name)
      .description(item.description)
      .option("--page-size <n>", "page size, 1-50", parsePageSize)
      .option("--offset <n>", "numeric offset", parseNonNegativeInteger)
      .option("--json", "pretty-print JSON")
      .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
      .action(async function(this: Command, rawOptions: FormatOption & { pageSize?: number; offset?: number } | Command) {
        const commandOptions = commandOptionsFrom<FormatOption & { pageSize?: number; offset?: number }>(this, rawOptions);
        if (!validateFormatOptions(options, commandOptions)) {
          return;
        }
        await runMeApi(options, commandOptions, async (session) => {
          const data = await requestJson(session.baseUrl, item.path, {
            token: session.token,
            query: { pageSize: commandOptions.pageSize, offset: commandOptions.offset }
          });
          printData(options, data, outputFormat(commandOptions), item.formatter);
        });
      });
  }

  return me;
}

function commandOptionsFrom<T extends object>(command: Command, value: T | Command): T {
  const direct = value instanceof Command ? value.opts() : value;
  const commandWithGlobals = command as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return { ...direct, ...(commandWithGlobals.optsWithGlobals?.() ?? {}) } as T;
}

type Session = {
  profile: string;
  baseUrl: string;
  token: string;
};

async function runMeApi(options: MeCommandOptions, commandOptions: { json?: boolean }, callback: (session: Session) => Promise<void>): Promise<void> {
  let token: string | undefined;
  try {
    const config = await loadConfig(options.configPath);
    const profile = config.current;
    const current = profile ? config.profiles[profile] : undefined;

    if (!profile || !current) {
      printError(options, { type: "no-profile", message: "No active profile" }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }

    token = current.token;
    await callback({ profile, ...current });
  } catch (error) {
    if (error instanceof HttpError) {
      const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
      printError(options, {
        type: "http",
        message: redactSecret(error.message, token),
        status: error.status,
        requestId: error.requestId,
        retryAfterSeconds: error.retryAfterSeconds,
        windowSeconds: error.windowSeconds
      }, httpErrorText(error, token, requestId), commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof ConfigFileError) {
      printError(options, { type: "config", message: error.message }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof NetworkError) {
      printError(options, { type: "network", message: error.message }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof TimeoutError) {
      printError(options, { type: "timeout", message: error.message }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function formatMeText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const user = isRecord(data.user) ? data.user : data;
  return [
    line("id", user.id),
    line("name", user.nickname ?? user.name),
    line("email", user.email),
    line("roleLevel", user.roleLevel ?? user.role),
    line("isMuted", user.isMuted),
    line("requestId", data.requestId)
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function formatMeStatsText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const user = isRecord(data.user) ? data.user : {};
  return [
    line("id", user.id),
    line("name", user.nickname ?? user.name),
    line("authoredTopicCount", data.authoredTopicCount),
    line("authoredFeaturedTopicCount", data.authoredFeaturedTopicCount),
    line("authoredReplyCount", data.authoredReplyCount),
    line("favoriteCount", data.favoriteCount),
    line("subscriptionCount", data.subscriptionCount),
    line("requestId", data.requestId)
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function formatTopicListText(data: unknown): string {
  return itemsFromData(data).map((item) => [
    fieldText(item.id ?? item.topicId),
    fieldText(item.title),
    fieldText(item.createdDate),
    fieldText(item.updatedDate),
    fieldText(item.url ?? item.threadUrl)
  ].join("\t")).join("\n");
}

function formatReplyListText(data: unknown): string {
  return itemsFromData(data).map((item) => {
    const topic = isRecord(item.topic) ? item.topic : {};
    return [
      fieldText(item.id ?? item.postId),
      fieldText(item.topicId ?? topic.id ?? topic.topicId),
      fieldText(topic.title ?? item.topicTitle),
      fieldText(item.createdDate),
      fieldText(item.updatedDate),
      fieldText(item.url ?? item.replyUrl ?? topic.url ?? topic.threadUrl)
    ].join("\t");
  }).join("\n");
}

function formatTopicRelationListText(data: unknown): string {
  return itemsFromData(data).map((item) => [
    fieldText(item.id ?? item.topicId ?? item.targetId),
    fieldText(item.title),
    fieldText(item.relationCreatedDate),
    fieldText(item.updatedDate),
    fieldText(item.unavailableReason),
    fieldText(item.url ?? item.threadUrl)
  ].join("\t")).join("\n");
}

function httpErrorText(error: HttpError, token: string | undefined, requestId: string): string {
  const retry = error.retryAfterSeconds === undefined ? "" : ` retryAfterSeconds=${error.retryAfterSeconds}`;
  const window = error.windowSeconds === undefined ? "" : ` windowSeconds=${error.windowSeconds}`;
  const hint = error.status === 429 && error.retryAfterSeconds !== undefined ? ` Retry after ${error.retryAfterSeconds}s.` : "";
  return `HTTP ${error.status}: ${redactSecret(error.message, token)}${requestId}${retry}${window}${hint}\n`;
}

function line(label: string, value: unknown): string | undefined {
  const text = fieldText(value);
  return text ? `${label}: ${text}` : undefined;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`Invalid number: ${value}`);
  }
  return parsed;
}

function parsePageSize(value: string): number {
  const parsed = parseNumber(value);
  if (parsed < 1 || parsed > 50) {
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
