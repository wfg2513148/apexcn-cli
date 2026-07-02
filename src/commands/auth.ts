import { Command } from "commander";
import {
  ConfigFileError,
  DEFAULT_BASE_URL,
  clearCurrentProfile,
  loadConfig,
  removeProfile,
  setCurrentProfileName,
  setProfile
} from "../config.js";

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
    .option("--no-switch", "save the profile without making it current")
    .action(async (commandOptions: { token: string; baseUrl: string; profile: string; switch?: boolean }) => {
      if (commandOptions.token.trim().length === 0) {
        options.stderr("Token must not be blank\n");
        process.exitCode = 1;
        return;
      }
      if (commandOptions.profile.trim().length === 0) {
        options.stderr("Profile must not be blank\n");
        process.exitCode = 1;
        return;
      }
      if (commandOptions.baseUrl.trim().length === 0) {
        options.stderr("Base URL must not be blank\n");
        process.exitCode = 1;
        return;
      }
      if (!isValidBaseUrl(commandOptions.baseUrl)) {
        options.stderr("Base URL must be an absolute http or https URL\n");
        process.exitCode = 1;
        return;
      }
      try {
        await setProfile(
          commandOptions.profile,
          { baseUrl: commandOptions.baseUrl, token: commandOptions.token },
          options.configPath,
          { overwriteInvalid: true, switchCurrent: commandOptions.switch !== false }
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
    .command("list")
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
      const names = Object.keys(config.profiles).sort();
      const current = config.current && config.profiles[config.current] ? config.current : undefined;
      const profiles = names.map((name) => ({
        name,
        current: name === current,
        baseUrl: config.profiles[name].baseUrl,
        token: redactToken(config.profiles[name].token)
      }));

      if (commandOptions.json) {
        options.stdout(`${JSON.stringify({ current, profiles }, null, 2)}\n`);
        return;
      }
      if (profiles.length === 0) {
        options.stdout("No profiles configured\n");
        return;
      }
      for (const profile of profiles) {
        options.stdout(`${profile.current ? "*" : " "} ${profile.name} ${profile.baseUrl} ${profile.token}\n`);
      }
    });

  auth
    .command("use")
    .argument("<profile>")
    .action(async (profile: string) => {
      try {
        const ok = await setCurrentProfileName(profile, options.configPath);
        if (!ok) {
          options.stderr(`Profile not found: ${profile}\n`);
          process.exitCode = 1;
          return;
        }
      } catch (error) {
        if (printConfigError(error, options)) {
          return;
        }
        throw error;
      }
      options.stdout(`Using profile ${profile}\n`);
    });

  auth
    .command("remove")
    .argument("<profile>")
    .action(async (profile: string) => {
      try {
        const ok = await removeProfile(profile, options.configPath);
        if (!ok) {
          options.stderr(`Profile not found: ${profile}\n`);
          process.exitCode = 1;
          return;
        }
      } catch (error) {
        if (printConfigError(error, options)) {
          return;
        }
        throw error;
      }
      options.stdout(`Removed profile ${profile}\n`);
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

function isValidBaseUrl(value: string): boolean {
  if (value.trim() !== value) {
    return false;
  }
  const prefix = value.startsWith("http://") ? "http://" : value.startsWith("https://") ? "https://" : undefined;
  if (!prefix) {
    return false;
  }
  const hostStart = value.slice(prefix.length, prefix.length + 1);
  if (!hostStart || hostStart === "/" || hostStart === "?" || hostStart === "#") {
    return false;
  }

  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function printConfigError(error: unknown, options: CommandIo): boolean {
  if (!(error instanceof ConfigFileError)) {
    return false;
  }
  options.stderr(`${error.message}\n`);
  process.exitCode = 1;
  return true;
}
