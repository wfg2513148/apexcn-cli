import { isLosslessNumber, isSafeNumber, LosslessNumber, parse, stringify } from "lossless-json";

export function isExactSafeIntegerInput(value: string): boolean {
  const text = value.trim();
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return false;
  if (!text) return true;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return isSafeNumber(text.replace(/^\+/, ""), { approx: false });
  }
  try {
    return BigInt(text) === BigInt(parsed);
  } catch {
    return false;
  }
}

export function precisePositiveIdKey(value: unknown): string | undefined {
  const text = isLosslessNumber(value) ? value.value
    : typeof value === "number" && Number.isSafeInteger(value) ? String(value)
      : typeof value === "string" && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim()) ? value.trim() : undefined;
  if (!text) return undefined;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  const digits = `${match[1]}${fraction}`.replace(/^0+/, "");
  if (!digits) return undefined;
  const trailingZeros = /0+$/.exec(digits)?.[0].length ?? 0;
  const rawExponent = match[3] ?? "0";
  if (rawExponent.replace(/^[+-]?0*/, "").length > 20) return undefined;
  const exponent = BigInt(rawExponent) - BigInt(fraction.length) + BigInt(trailingZeros);
  if (exponent < 0n) return undefined;
  const significantDigits = trailingZeros ? digits.slice(0, -trailingZeros) : digits;
  return `${significantDigits}e${exponent}`;
}

export class UnsafeApiIdError extends Error {
  constructor(message = "Unsafe or imprecise numeric identifier; refusing to select or write a topic.") {
    super(message);
    this.name = "UnsafeApiIdError";
  }
}

export function containsImpreciseNumbers(value: unknown): boolean {
  if (isLosslessNumber(value)) return true;
  if (Array.isArray(value)) return value.some(containsImpreciseNumbers);
  return typeof value === "object" && value !== null && Object.values(value).some(containsImpreciseNumbers);
}

export function safeApiId(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (isLosslessNumber(value)) throw new UnsafeApiIdError();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) throw new UnsafeApiIdError();
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value) && isExactSafeIntegerInput(value)) {
    const id = Number(value);
    if (id > 0) return id;
  }
  throw new UnsafeApiIdError();
}

const apiIdFields = new Set(["id", "topicid", "topicids", "threadid", "replyid", "replyids", "postid", "parentpostid", "targetid", "categoryid", "confirmid", "ifversion"]);

export function normalizeApiForSelection(value: unknown, key?: string): unknown {
  const normalizedKey = key?.replace(/[_-]/g, "").toLowerCase();
  const isId = normalizedKey !== undefined && apiIdFields.has(normalizedKey);
  const numericText = typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
  if (isId && (isLosslessNumber(value) || typeof value === "number" || (normalizedKey !== "id" && numericText))) {
    safeApiId(value);
  }
  if (isLosslessNumber(value)) return Number(value.value);
  if (Array.isArray(value)) return value.map((item) => normalizeApiForSelection(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, normalizeApiForSelection(child, childKey)]));
  }
  return value;
}

export function toNativeApiNumbers(value: unknown): unknown {
  if (isLosslessNumber(value)) return Number(value.value);
  if (Array.isArray(value)) return value.map(toNativeApiNumbers);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toNativeApiNumbers(child)]));
  }
  return value;
}

export function normalizeTopicForSelection(value: unknown, replySelection: "all" | "evidence" | "none" = "all"): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isLosslessNumber(value)) return toNativeApiNumbers(value);
  const root = value as Record<string, unknown>;
  const topic = typeof root.topic === "object" && root.topic !== null && !Array.isArray(root.topic)
    ? root.topic as Record<string, unknown> : root;
  for (const key of ["id", "topicId", "threadId"]) safeApiId(topic[key]);
  const replies = Array.isArray(root.replies) ? root.replies : replySelection === "all" && Array.isArray(topic.replies) ? topic.replies : [];
  const selected = replySelection === "none" ? [] : replySelection === "evidence"
    ? replies.filter((item) => typeof item === "object" && item !== null)
      .sort((left, right) => Number((right as Record<string, unknown>).isUseful === true) - Number((left as Record<string, unknown>).isUseful === true))
      .slice(0, 3)
    : replies;
  for (const item of selected) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const reply = item as Record<string, unknown>;
    for (const key of ["replyId", "id", "postId", "topicId"]) safeApiId(reply[key]);
  }
  return toNativeApiNumbers(value);
}

export function assertSafeWriteTarget(path: string, body: Record<string, unknown>): void {
  const patterns = [
    /^\/api\/v1\/topics$/,
    /^\/api\/v1\/topics\/(\d+)(?:\/(?:replies|favorite|subscription))?$/,
    /^\/api\/v1\/topics\/(\d+)\/replies\/(\d+)\/correct-answer$/,
    /^\/api\/v1\/replies\/(\d+)(?:\/favorite)?$/
  ];
  const match = patterns.map((pattern) => pattern.exec(path)).find(Boolean);
  if (!match) throw new UnsafeApiIdError();
  normalizeApiForSelection(body);
  for (const key of ["topicId", "replyId", "parentPostId", "categoryId", "confirmId", "ifVersion"]) {
    if (body[key] !== undefined && body[key] !== null) safeApiId(body[key]);
  }
  for (const id of match.slice(1)) if (id !== undefined) safeApiId(id);
}

export function parsePreciseJson(text: string): unknown {
  return parse(text, undefined, {
    parseNumber: (value: string) => isSafeNumber(value, { approx: false }) ? Number(value) : new LosslessNumber(value)
  });
}

export function parseGuardedIdJson(text: string): unknown {
  return normalizeApiForSelection(parsePreciseJson(text));
}

export function stringifyPreciseJson(value: unknown, pretty: boolean): string {
  const output = stringify(value, undefined, pretty ? 2 : undefined);
  if (output === undefined) throw new Error("Unable to serialize JSON response.");
  return output;
}
