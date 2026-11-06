import { isLosslessNumber, isSafeNumber, LosslessNumber, parse, splitNumber, stringify } from "lossless-json";

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
  const rawExponent = /e([+-]?\d+)$/i.exec(text)?.[1];
  if (rawExponent !== undefined && !Number.isSafeInteger(Number(rawExponent))) return undefined;
  const { sign, digits, exponent } = splitNumber(text);
  if (sign || digits === "0" || !Number.isSafeInteger(exponent) || exponent < digits.length - 1) return undefined;
  return `${digits}e${exponent}`;
}

export class UnsafeApiIdError extends Error {
  constructor() {
    super("Unsafe or imprecise numeric value in the server response; refusing to select or write a topic.");
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

const apiIdFields = new Set(["id", "topicid", "threadid", "replyid", "postid", "parentpostid", "targetid", "categoryid", "confirmid", "ifversion"]);

export function normalizeApiForSelection(value: unknown, key?: string): unknown {
  const normalizedKey = key?.replace(/[_-]/g, "").toLowerCase();
  const isId = normalizedKey !== undefined && apiIdFields.has(normalizedKey);
  const numericText = typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
  if (isId && (isLosslessNumber(value) || typeof value === "number" || (normalizedKey !== "id" && numericText))) {
    safeApiId(value);
  }
  if (isLosslessNumber(value)) return Number(value.value);
  if (Array.isArray(value)) return value.map((item) => normalizeApiForSelection(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, normalizeApiForSelection(child, childKey)]));
  }
  return value;
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
