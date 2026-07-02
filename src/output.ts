import { InvalidArgumentError } from "commander";
import type { CommandIo } from "./commands/auth.js";

export type OutputFormat = "json" | "pretty" | "text";

export type JsonOption = {
  json?: boolean;
};

export type FormatOption = JsonOption & {
  format?: OutputFormat;
};

export function parseOutputFormat(value: string): OutputFormat {
  if (value === "json" || value === "pretty" || value === "text") {
    return value;
  }
  throw new InvalidArgumentError(`Expected output format json, pretty, or text: ${value}`);
}

export function validateFormatOptions(options: CommandIo, commandOptions: FormatOption): boolean {
  if (commandOptions.json && commandOptions.format && commandOptions.format !== "pretty") {
    options.stderr("--json can only be combined with --format pretty\n");
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
