import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError } from "../config.js";
import { assessCapabilityCompatibility } from "../core/capability-compatibility.js";
import { formatHttpErrorText, formatTransportErrorText, remediationForHttpError, remediationForTransportError, stableErrorCode } from "../core/errors.js";
import { loadRuntimeSession } from "../core/runtime-session.js";
import { redactSecrets } from "../core/secret-redaction.js";
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
    .option("--redact", "redact privacy-sensitive account fields (default behavior)")
    .option("--include-private", "include private account fields such as the full email address")
    .action(async (commandOptions: FormatOption & { verbose?: boolean; redact?: boolean; includePrivate?: boolean }) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runMeApi(options, commandOptions, async (session) => {
        const data = await requestJson(session.baseUrl, "/api/v1/me", { token: session.token });
        if (commandOptions.verbose) {
          options.stderr(`GET ${session.baseUrl.replace(/\/+$/, "")}/api/v1/me\n`);
        }
        printData(options, commandOptions.includePrivate ? redactSecrets(data) : redactMeOutput(data), outputFormat(commandOptions), formatMeText);
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
        printData(options, redactMeOutput(data), outputFormat(commandOptions), formatMeStatsText);
      });
    });

  me
    .command("dashboard")
    .description("show the current user's personal dashboard")
    .option("--page-size <n>", "items per personal section, 1-50", parsePageSize, 5)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async function(this: Command, rawOptions: FormatOption & { pageSize: number } | Command) {
      const commandOptions = commandOptionsFrom<FormatOption & { pageSize: number }>(this, rawOptions);
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runMeApi(options, commandOptions, async (session) => {
        const query = { pageSize: commandOptions.pageSize };
        const [stats, created, replied, favorited, subscribed] = await Promise.all([
          requestJson(session.baseUrl, "/api/v1/me/stats", { token: session.token }),
          requestJson(session.baseUrl, "/api/v1/me/topics", { token: session.token, query }),
          requestJson(session.baseUrl, "/api/v1/me/replies", { token: session.token, query }),
          requestJson(session.baseUrl, "/api/v1/me/favorites", { token: session.token, query }),
          requestJson(session.baseUrl, "/api/v1/me/subscriptions", { token: session.token, query })
        ]);
        printData(options, redactMeOutput({
          kind: "me-dashboard",
          pageSize: commandOptions.pageSize,
          stats,
          created,
          replied,
          favorited,
          subscribed
        }), outputFormat(commandOptions), formatMeDashboardText);
      });
    });

  me
    .command("search")
    .description("search only within the current user's personal dashboard")
    .argument("<keyword>", "title or topic-body keyword", parsePersonalKeyword)
    .option("--scope <scopes>", "comma-separated: created,replied,favorited,subscribed", parsePersonalScopes)
    .option("--page-size <n>", "page size, 1-50", parsePageSize)
    .option("--cursor <cursor>", "opaque cursor returned by the previous page", parseNonBlankCursor)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async function(
      this: Command,
      keyword: string,
      rawOptions: FormatOption & { scope?: string; pageSize?: number; cursor?: string } | Command
    ) {
      const commandOptions = commandOptionsFrom<FormatOption & { scope?: string; pageSize?: number; cursor?: string }>(this, rawOptions);
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runMeApi(options, commandOptions, async (session) => {
        const capabilities = await requestJson(session.baseUrl, "/api/v1/capabilities", { token: session.token });
        const compatibility = assessCapabilityCompatibility(capabilities, ["personal-community"]);
        const entries = isRecord(capabilities) && Array.isArray(capabilities.capabilities)
          ? capabilities.capabilities.filter(isRecord)
          : [];
        const personalCommunity = entries.find((item) => item.id === "personal-community");
        const endpointAdvertised = personalCommunity?.available === true
          && Array.isArray(personalCommunity.endpoints)
          && personalCommunity.endpoints.includes("/me/search");
        if (!compatibility.ok || !endpointAdvertised) {
          printData(options, {
            kind: "me-search",
            available: false,
            status: "UNAVAILABLE",
            unavailableReason: compatibility.ok ? "CAPABILITY_NOT_ADVERTISED" : "CAPABILITY_INCOMPATIBLE",
            clientCompatibility: compatibility,
            requestId: isRecord(capabilities) ? capabilities.requestId : undefined
          }, outputFormat(commandOptions), formatUnavailableCapabilityText);
          process.exitCode = 1;
          return;
        }
        const data = await requestJson(session.baseUrl, "/api/v1/me/search", {
          token: session.token,
          query: {
            keyword,
            scope: commandOptions.scope,
            pageSize: commandOptions.pageSize,
            cursor: commandOptions.cursor
          }
        });
        printData(options, redactMeOutput(data), outputFormat(commandOptions), formatPersonalSearchText);
      });
    });

  for (const item of [
    { name: "capabilities", path: "/api/v1/capabilities", formatter: formatCapabilitiesText, description: "discover server personal-workbench capabilities" },
    { name: "notifications", path: "/api/v1/notifications", formatter: formatUnavailableCapabilityText, description: "read current user notifications when available" },
    { name: "inbox", path: "/api/v1/inbox", formatter: formatUnavailableCapabilityText, description: "read current user inbox when available" },
    { name: "rules", path: "/api/v1/community/rules", formatter: formatUnavailableCapabilityText, description: "read authoritative community rules when available" },
    { name: "privacy", path: "/api/v1/privacy-policy", formatter: formatUnavailableCapabilityText, description: "read the authoritative privacy policy when available" }
  ] as const) {
    const command = me
      .command(item.name)
      .description(item.description)
      .option("--json", "pretty-print JSON")
      .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat));
    if (item.name === "capabilities") {
      command.option("--require-capability <ids...>", "fail closed unless each capability id is available");
    }
    command.action(async function(this: Command, rawOptions: FormatOption & { requireCapability?: string[] } | Command) {
        const commandOptions = commandOptionsFrom<FormatOption & { requireCapability?: string[] }>(this, rawOptions);
        if (!validateFormatOptions(options, commandOptions)) {
          return;
        }
        await runMeApi(options, commandOptions, async (session) => {
          const data = item.name === "capabilities"
            ? await requestJson(session.baseUrl, item.path, { token: session.token })
            : await readCapabilityEndpoint(session, item.name, item.path);
          const output = item.name === "capabilities"
            ? capabilityOutput(data, commandOptions.requireCapability)
            : redactMeOutput(data);
          if (item.name === "capabilities" && isRecord(output) && isRecord(output.clientCompatibility) && output.clientCompatibility.ok !== true) {
            process.exitCode = 1;
          }
          printData(options, output, outputFormat(commandOptions), item.formatter);
        });
      });
  }

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
      .option("--cursor <cursor>", "opaque cursor returned by the previous page", parseNonBlankCursor)
      .option("--json", "pretty-print JSON")
      .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
      .action(async function(this: Command, rawOptions: FormatOption & { pageSize?: number; offset?: number; cursor?: string } | Command) {
        const commandOptions = commandOptionsFrom<FormatOption & { pageSize?: number; offset?: number; cursor?: string }>(this, rawOptions);
        if (!validateFormatOptions(options, commandOptions)) {
          return;
        }
        if (commandOptions.offset !== undefined && commandOptions.cursor !== undefined) {
          printError(options, { type: "validation", message: "--offset cannot be combined with --cursor", exitCode: 1 }, undefined, commandOptions.json);
          process.exitCode = 1;
          return;
        }
        await runMeApi(options, commandOptions, async (session) => {
          const data = await requestJson(session.baseUrl, item.path, {
            token: session.token,
            query: { pageSize: commandOptions.pageSize, offset: commandOptions.offset, cursor: commandOptions.cursor }
          });
          printData(options, redactMeOutput(data), outputFormat(commandOptions), item.formatter);
        });
      });
  }

  return me;
}

async function readCapabilityEndpoint(
  session: Session,
  name: "notifications" | "inbox" | "rules" | "privacy",
  path: string
): Promise<unknown> {
  const data = await requestJson(session.baseUrl, "/api/v1/capabilities", { token: session.token });
  const capabilities = isRecord(data) && Array.isArray(data.capabilities) ? data.capabilities.filter(isRecord) : [];
  const capabilityId = name === "rules" ? "community-rules" : name === "privacy" ? "privacy-policy" : name;
  const capability = capabilities.find((item) => item.id === capabilityId);
  if (capability?.available === false) {
    return {
      kind: capabilityId,
      available: false,
      status: "UNAVAILABLE",
      unavailableReason: capability.unavailableReason,
      requestId: isRecord(data) ? data.requestId : undefined
    };
  }
  return requestJson(session.baseUrl, path, { token: session.token });
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
    const runtime = await loadRuntimeSession(options.configPath);
    if (!runtime.ok) {
      const noProfile = runtime.reason === "no-profile";
      printError(options, {
        type: "no-profile",
        code: noProfile ? "NO_ACTIVE_PROFILE" : "NO_CREDENTIAL",
        message: noProfile ? "No active profile" : `No credential is available for profile ${runtime.profile}`,
        remediation: {
          code: "PROFILE_CONFIGURATION_REQUIRED",
          message: noProfile
            ? "Select or configure an authenticated profile before using personal commands."
            : "Configure an available file or environment credential before using personal commands.",
          actions: noProfile
            ? [
                "Run `apexcn auth show --json` to inspect configured profiles.",
                "Run `apexcn auth use <profile>` to select an existing profile.",
                "Run `apexcn auth set-token --token <token> --profile <profile>` to configure a profile."
              ]
            : [
                "Set the profile's configured token environment variable.",
                "Run `apexcn auth set-token --token <token> --profile <profile>` to configure a file credential."
              ]
        }
      }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }

    token = runtime.session.token;
    await callback(runtime.session);
  } catch (error) {
    if (error instanceof HttpError) {
      printError(options, {
        type: "http",
        code: stableErrorCode(error),
        message: redactSecret(error.message, token),
        status: error.status,
        requestId: error.requestId,
        retryAfterSeconds: error.retryAfterSeconds,
        windowSeconds: error.windowSeconds,
        remediation: remediationForHttpError(error, token)
      }, formatHttpErrorText(error, token), commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof ConfigFileError) {
      printError(options, { type: "config", message: error.message }, undefined, commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof NetworkError) {
      printError(options, {
        type: "network",
        code: stableErrorCode(error),
        message: error.message,
        remediation: remediationForTransportError(error)
      }, formatTransportErrorText(error), commandOptions.json);
      process.exitCode = 1;
      return;
    }
    if (error instanceof TimeoutError) {
      printError(options, {
        type: "timeout",
        code: stableErrorCode(error),
        message: error.message,
        remediation: remediationForTransportError(error)
      }, formatTransportErrorText(error), commandOptions.json);
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

function redactMeOutput(data: unknown): unknown {
  return redactPrivateFields(redactSecrets(data));
}

function maskEmail(value: unknown): unknown {
  const email = fieldText(value);
  if (!email) {
    return value;
  }
  const at = email.indexOf("@");
  if (at <= 0) {
    return "[redacted]";
  }
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

const PRIVATE_FIELD_KEYS = new Set([
  "address",
  "birthdate",
  "birthday",
  "email",
  "ip",
  "ipaddress",
  "lastloginip",
  "mobile",
  "phone",
  "phonenumber",
  "postaladdress",
  "realname"
]);

function redactPrivateFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPrivateFields);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!PRIVATE_FIELD_KEYS.has(normalized)) {
      return [key, redactPrivateFields(nested)];
    }
    return [key, normalized === "email" ? maskEmail(nested) : "[redacted]"];
  }));
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

function formatMeDashboardText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  const stats = isRecord(data.stats) ? data.stats : {};
  const sections = [
    ["created", data.created],
    ["replied", data.replied],
    ["favorited", data.favorited],
    ["subscribed", data.subscribed]
  ] as const;
  return [
    line("authoredTopicCount", stats.authoredTopicCount ?? stats.topicCount),
    line("authoredReplyCount", stats.authoredReplyCount ?? stats.replyCount),
    line("favoriteCount", stats.favoriteCount),
    line("subscriptionCount", stats.subscriptionCount),
    ...sections.flatMap(([label, value]) => [
      `${label}:`,
      ...formatDashboardItems(value)
    ])
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function formatDashboardItems(data: unknown): string[] {
  return itemsFromData(data).flatMap((item) => {
    const topic = isRecord(item.topic) ? item.topic : {};
    const communityUrl = fieldText(item.replyUrl ?? item.url ?? item.threadUrl ?? item.canonicalUrl ?? item.visualUrl ?? topic.url ?? topic.threadUrl ?? topic.canonicalUrl ?? topic.visualUrl);
    const originalUrl = fieldText(item.originalUrl ?? topic.originalUrl);
    return [
      `- ${fieldText(item.title ?? item.topicTitle ?? topic.title)}`,
      communityUrl ? `  communityUrl: ${communityUrl}` : "",
      originalUrl ? `  originalUrl: ${originalUrl}` : ""
    ].filter(Boolean);
  });
}

function formatPersonalSearchText(data: unknown): string {
  return itemsFromData(data).flatMap((item) => [
    line("title", item.title),
    line("matchedScopes", Array.isArray(item.matchedScopes) ? item.matchedScopes.join(",") : item.matchedScopes),
    line("updatedDate", item.updatedDate),
    line("communityUrl", item.url ?? item.threadUrl ?? item.canonicalUrl ?? item.visualUrl),
    line("originalUrl", item.originalUrl),
    ""
  ].filter((value): value is string => value !== undefined)).join("\n").trimEnd();
}

function formatCapabilitiesText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.capabilities)) {
    return "";
  }
  const compatibility = isRecord(data.clientCompatibility) ? data.clientCompatibility : {};
  return [
    `compatibility: ${fieldText(compatibility.status)}`,
    `contractVersion: ${fieldText(compatibility.contractVersion)}`,
    ...data.capabilities.filter(isRecord).map((capability) => [
    fieldText(capability.id),
    fieldText(capability.available),
    Array.isArray(capability.endpoints) ? capability.endpoints.map(fieldText).filter(Boolean).join(",") : "",
    fieldText(capability.unavailableReason)
    ].join("\t"))
  ].join("\n");
}

function capabilityOutput(data: unknown, requiredCapabilities: string[] = []): Record<string, unknown> {
  const redacted = redactMeOutput(data);
  const base = isRecord(redacted) ? redacted : {};
  return {
    ...base,
    clientCompatibility: assessCapabilityCompatibility(data, requiredCapabilities)
  };
}

function formatUnavailableCapabilityText(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  return [
    line("kind", data.kind),
    line("available", data.available),
    line("status", data.status),
    line("unavailableReason", data.unavailableReason),
    line("requestId", data.requestId)
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function formatTopicListText(data: unknown): string {
  return itemsFromData(data).map((item) => [
    fieldText(item.id ?? item.topicId),
    fieldText(item.title),
    fieldText(item.version),
    fieldText(item.canEdit),
    fieldText(item.canDelete),
    fieldText(item.createdDate),
    fieldText(item.updatedDate),
    fieldText(item.url ?? item.threadUrl),
    fieldText(item.originalUrl)
  ].join("\t")).join("\n");
}

function formatReplyListText(data: unknown): string {
  return itemsFromData(data).map((item) => {
    const topic = isRecord(item.topic) ? item.topic : {};
    return [
      fieldText(item.id ?? item.replyId ?? item.postId),
      fieldText(item.topicId ?? topic.id ?? topic.topicId),
      fieldText(item.parentPostId),
      fieldText(item.version),
      fieldText(item.canEdit),
      fieldText(item.canDelete),
      fieldText(topic.title ?? item.topicTitle),
      fieldText(item.createdDate),
      fieldText(item.updatedDate),
      fieldText(item.replyUrl ?? item.url ?? topic.url ?? topic.threadUrl),
      fieldText(item.originalUrl ?? topic.originalUrl)
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
    fieldText(item.url ?? item.threadUrl),
    fieldText(item.originalUrl)
  ].join("\t")).join("\n");
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

function parseNonBlankCursor(value: string): string {
  if (!value.trim()) {
    throw new InvalidArgumentError("Expected a non-empty cursor");
  }
  return value;
}

function parsePersonalKeyword(value: string): string {
  const keyword = value.trim();
  if (!keyword) {
    throw new InvalidArgumentError("Expected a non-empty personal-dashboard keyword");
  }
  if (keyword.length > 1000) {
    throw new InvalidArgumentError("Expected personal-dashboard keyword to contain at most 1000 characters");
  }
  return keyword;
}

const PERSONAL_SCOPES = new Set(["created", "replied", "favorited", "subscribed"]);

function parsePersonalScopes(value: string): string {
  const scopes = [...new Set(value.split(",").map((scope) => scope.trim().toLowerCase()).filter(Boolean))];
  if (scopes.length === 0 || scopes.some((scope) => !PERSONAL_SCOPES.has(scope))) {
    throw new InvalidArgumentError("Expected --scope to contain only created,replied,favorited,subscribed");
  }
  return scopes.join(",");
}
