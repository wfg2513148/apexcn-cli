import { Command } from "commander";
import { ConfigFileError, DEFAULT_BASE_URL, clearCurrentProfile, loadConfig, setCurrentProfile } from "../config.js";

export type CommandIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export type AuthCommandOptions = CommandIo & {
  configPath?: string;
};

export function createAuthCommand(options: AuthCommandOptions): Command {
  const auth = new Command("auth");

  auth
    .command("set-token")
    .requiredOption("--token <token>")
    .option("--base-url <url>", "ORDS base URL", DEFAULT_BASE_URL)
    .option("--profile <profile>", "profile name", "prod")
    .action(async (commandOptions: { token: string; baseUrl: string; profile: string }) => {
      try {
        await setCurrentProfile(
          commandOptions.profile,
          { baseUrl: commandOptions.baseUrl, token: commandOptions.token },
          options.configPath,
          { overwriteInvalid: true }
        );
      } catch (error) {
        if (printConfigError(error, options)) {
          return;
        }
        throw error;
      }
      options.stdout(`Saved profile ${commandOptions.profile}\n`);
    });

  auth
    .command("show")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: { json?: boolean }) => {
      let config;
      try {
        config = await loadConfig(options.configPath);
      } catch (error) {
        if (printConfigError(error, options)) {
          return;
        }
        throw error;
      }
      const profile = config.current;
      const current = profile ? config.profiles[profile] : undefined;

      if (!profile || !current) {
        options.stderr("No active profile\n");
        process.exitCode = 1;
        return;
      }

      const redactedToken = redactToken(current.token);
      if (commandOptions.json) {
        options.stdout(`${JSON.stringify({ profile, baseUrl: current.baseUrl, token: redactedToken }, null, 2)}\n`);
        return;
      }

      options.stdout(`Profile: ${profile}\nBase URL: ${current.baseUrl}\nToken: ${redactedToken}\n`);
    });

  auth.command("logout").action(async () => {
    try {
      await clearCurrentProfile(options.configPath);
    } catch (error) {
      if (printConfigError(error, options)) {
        return;
      }
      throw error;
    }
    options.stdout("Logged out\n");
  });

  return auth;
}

export function redactToken(token: string): string {
  if (token.length <= 8) {
    return "********";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function printConfigError(error: unknown, options: CommandIo): boolean {
  if (!(error instanceof ConfigFileError)) {
    return false;
  }
  options.stderr(`${error.message}\n`);
  process.exitCode = 1;
  return true;
}
