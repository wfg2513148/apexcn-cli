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

export function assertSafeApiNumbers(value: unknown): void {
  if (containsImpreciseNumbers(value)) throw new UnsafeApiIdError();
}

export function safeApiId(value: unknown): number | undefined {
  if (isLosslessNumber(value)) throw new UnsafeApiIdError();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new UnsafeApiIdError();
    return value > 0 ? value : undefined;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    if (!isExactSafeIntegerInput(value)) throw new UnsafeApiIdError();
    const id = Number(value);
    return id > 0 ? id : undefined;
  }
  return undefined;
}

export function parsePreciseJson(text: string): unknown {
  return parse(text, undefined, {
    parseNumber: (value: string) => isSafeNumber(value, { approx: false }) ? Number(value) : new LosslessNumber(value)
  });
}

export function stringifyPreciseJson(value: unknown, pretty: boolean): string {
  const output = stringify(value, undefined, pretty ? 2 : undefined);
  if (output === undefined) throw new Error("Unable to serialize JSON response.");
  return output;
}
