import { InvalidArgumentError } from "commander";
import type { RequestJsonOptions } from "../http.js";
import { currentContentLanguage } from "./request-context.js";

export type ContentLanguage = "zh-cn" | "en";

export const CONTENT_LANGUAGE_COMMANDS = new Set([
  "category.list", "stats.category", "search", "topic.list", "topic.recent", "topic.view",
  "me.dashboard", "me.search", "me.topics", "me.replies", "me.favorites", "me.subscriptions",
  "research", "rag.retrieve", "collection.build", "collection.favorites"
]);

const CONTENT_LANGUAGE_PATH = /^\/api\/v1\/(?:categories|category-stats|search|topics(?:\/\d+(?:\/visual)?)?|me\/(?:topics|replies|favorites(?:\/export)?|subscriptions|search))$/;

export function parseContentLanguage(value: string): ContentLanguage {
  if (value !== "zh-cn" && value !== "en") {
    throw new InvalidArgumentError("Content language must be zh-cn or en.");
  }
  return value;
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
