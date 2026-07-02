import { Command } from "commander";
import { loadConfig } from "../config.js";
import { HttpError, requestJson } from "../http.js";
import type { CommandIo } from "./auth.js";

export type MeCommandOptions = CommandIo & {
  configPath?: string;
};

export function createMeCommand(options: MeCommandOptions): Command {
  return new Command("me")
    .option("--json", "print JSON")
    .option("--verbose", "print request diagnostics")
    .action(async (commandOptions: { json?: boolean; verbose?: boolean }) => {
      const config = await loadConfig(options.configPath);
      const profile = config.current;
      const current = profile ? config.profiles[profile] : undefined;

      if (!profile || !current) {
        options.stderr("No active profile\n");
        process.exitCode = 1;
        return;
      }

      try {
        const me = await requestJson(current.baseUrl, "/api/v1/me", { token: current.token });
        if (commandOptions.verbose) {
          options.stderr(`GET ${current.baseUrl.replace(/\/+$/, "")}/api/v1/me\n`);
        }
        options.stdout(`${JSON.stringify(me, null, commandOptions.json ? 2 : 0)}\n`);
      } catch (error) {
        if (error instanceof HttpError) {
          const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
          options.stderr(`HTTP ${error.status}: ${error.message}${requestId}\n`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });
}
