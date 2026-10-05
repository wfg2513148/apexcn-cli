import { InvalidArgumentError } from "commander";
import type { RequestJsonOptions } from "../http.js";
import { currentContentLanguage } from "./request-context.js";

export type ContentLanguage = "zh-cn" | "en";

export const CONTENT_LANGUAGE_COMMANDS = new Set([
  "category.list", "stats.category", "search", "topic.list", "topic.recent", "topic.view",
  "me.dashboard", "me.search", "me.topics", "me.replies", "me.favorites", "me.subscriptions",
  "research", "rag.retrieve", "collection.build", "collection.favorites", "ask"
]);

const CONTENT_LANGUAGE_PATH = /^\/api\/v1\/(?:categories|category-stats|search|topics(?:\/\d+(?:\/visual)?)?|me\/(?:topics|replies|favorites(?:\/export)?|subscriptions|search))$/;

export function parseContentLanguage(value: string): ContentLanguage {
  if (value !== "zh-cn" && value !== "en") {
    throw new InvalidArgumentError("Content language must be zh-cn or en.");
  }
  return value;
}

/** Select the stored edition from the user's input, before retrieval rewrites it. */
export function inferContentLanguage(input: string): ContentLanguage {
  const hasChineseCharacters = /\p{Script=Han}/u.test(input);
  const hasJapaneseOrKoreanCharacters = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(input);
  return hasChineseCharacters && !hasJapaneseOrKoreanCharacters ? "zh-cn" : "en";
}

export function commandContentLanguage(
  commandId: string | undefined,
  args: readonly unknown[],
  options: { lang?: ContentLanguage; query?: string[] }
): ContentLanguage | undefined {
  if (options.lang) return options.lang;
  if (["search", "research", "rag.retrieve", "me.search", "ask"].includes(commandId ?? "")) {
    return typeof args[0] === "string" ? inferContentLanguage(args[0]) : undefined;
  }
  if (commandId === "collection.build" && options.query?.length) {
    return inferContentLanguage(options.query.join(" "));
  }
  return undefined;
}

export function contentLanguageQuery(
  path: string,
  method: string | undefined,
  query?: RequestJsonOptions["query"]
): RequestJsonOptions["query"] {
  const language = currentContentLanguage();
  if (!language || (method ?? "GET").toUpperCase() !== "GET" || !CONTENT_LANGUAGE_PATH.test(path)) {
    return query;
  }
  return { lang: language, ...query };
}
