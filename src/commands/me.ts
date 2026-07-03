import { Command, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { fieldText, isRecord, outputFormat, parseOutputFormat, printData, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

export type MeCommandOptions = CommandIo & {
  configPath?: string;
};

export function createMeCommand(options: MeCommandOptions): Command {
  return new Command("me")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .option("--verbose", "print request diagnostics")
    .action(async (commandOptions: FormatOption & { verbose?: boolean }) => {
      let token: string | undefined;
      try {
        if (!validateFormatOptions(options, commandOptions)) {
          return;
        }
        const config = await loadConfig(options.configPath);
        const profile = config.current;
        const current = profile ? config.profiles[profile] : undefined;

        if (!profile || !current) {
          options.stderr("No active profile\n");
          process.exitCode = 1;
          return;
        }

        token = current.token;
        const me = await requestJson(current.baseUrl, "/api/v1/me", { token: current.token });
        if (commandOptions.verbose) {
          options.stderr(`GET ${current.baseUrl.replace(/\/+$/, "")}/api/v1/me\n`);
        }
        printData(options, me, outputFormat(commandOptions), formatMeText);
      } catch (error) {
        if (error instanceof HttpError) {
          const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
          options.stderr(`HTTP ${error.status}: ${redactSecret(error.message, token)}${requestId}\n`);
          process.exitCode = 1;
          return;
        }
        if (error instanceof ConfigFileError) {
          options.stderr(`${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        if (error instanceof NetworkError) {
          options.stderr(`${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        if (error instanceof TimeoutError) {
          options.stderr(`${error.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });
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

function line(label: string, value: unknown): string | undefined {
  const text = fieldText(value);
  return text ? `${label}: ${text}` : undefined;
}
