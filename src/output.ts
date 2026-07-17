import { InvalidArgumentError } from "commander";
import type { CommandIo } from "./commands/auth.js";
import { redactSecretText } from "./core/secret-redaction.js";

export type OutputFormat = "json" | "pretty" | "text";

export type JsonOption = {
  json?: boolean;
};

export type FormatOption = JsonOption & {
  format?: OutputFormat;
};

export type ErrorPayload = {
  type: string;
  code?: string;
  message: string;
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  windowSeconds?: number;
  remediation?: {
    code: string;
    message: string;
    actions: string[];
  };
  exitCode?: number;
};

export function parseOutputFormat(value: string): OutputFormat {
  if (value === "json" || value === "pretty" || value === "text") {
    return value;
  }
  throw new InvalidArgumentError(`Expected output format json, pretty, or text: ${value}`);
}

export function validateFormatOptions(options: CommandIo, commandOptions: FormatOption): boolean {
  if (commandOptions.json && commandOptions.format && commandOptions.format !== "pretty") {
    printError(options, { type: "validation", message: "--json can only be combined with --format pretty", exitCode: 1 }, undefined, commandOptions.json);
    process.exitCode = 1;
    return false;
  }
  return true;
}

export function outputFormat(options: FormatOption): OutputFormat {
  if (options.json) {
    return "pretty";
  }
  return options.format ?? "json";
}

export function printData(options: CommandIo, data: unknown, formatOrJson?: OutputFormat | boolean, textFormatter?: (data: unknown) => string): void {
  const format = typeof formatOrJson === "string" ? formatOrJson : formatOrJson ? "pretty" : "json";
  if (format === "text" && textFormatter) {
    const text = textFormatter(data);
    options.stdout(text ? `${text}\n` : "");
    return;
  }
  options.stdout(`${JSON.stringify(data, null, format === "pretty" ? 2 : 0)}\n`);
}

export function printError(options: CommandIo, error: ErrorPayload, fallbackText?: string, json?: boolean): void {
  if (json || process.env.APEXCN_ERROR_FORMAT === "json") {
    options.stderr(`${JSON.stringify({ ok: false, error: withoutUndefined(error) })}\n`);
    return;
  }
  options.stderr(fallbackText ?? `${error.message}\n`);
}

export function formatCliUsageError(message: string): string {
  const cleanMessage = redactSecretText(message)
    .replace(/^error:\s*/i, "")
    .trim();
  return `${JSON.stringify({
    ok: false,
    error: {
      type: "validation",
      code: cliUsageErrorCode(cleanMessage),
      message: cleanMessage,
      exitCode: 1
    }
  })}\n`;
}

export function itemsFromData(data: unknown): Array<Record<string, unknown>> {
  if (!isRecord(data) || !Array.isArray(data.items)) {
    return [];
  }
  return data.items.filter(isRecord);
}

export function fieldText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).replace(/[\t\r\n]+/g, " ");
}

export function blockText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withoutUndefined(input: ErrorPayload): ErrorPayload {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as ErrorPayload;
}

function cliUsageErrorCode(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("unknown command")) return "UNKNOWN_COMMAND";
  if (normalized.includes("unknown option")) return "UNKNOWN_OPTION";
  if (normalized.includes("required option") && normalized.includes("not specified")) return "MISSING_OPTION";
  if (normalized.includes("missing required argument")) return "MISSING_ARGUMENT";
  if (normalized.includes("argument missing")) return "MISSING_OPTION_VALUE";
  if (normalized.includes("too many arguments")) return "TOO_MANY_ARGUMENTS";
  if (normalized.includes("invalid") || normalized.includes("expected")) return "INVALID_ARGUMENT";
  return "CLI_USAGE_ERROR";
}
