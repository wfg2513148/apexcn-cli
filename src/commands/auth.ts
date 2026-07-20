import { Command } from "commander";
import {
  ConfigFileError,
  DEFAULT_BASE_URL,
  clearCurrentProfile,
  defaultConfigPath,
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
    .option("--token <token>", "file credential used directly or as fallback")
    .option("--token-env <name>", "environment variable used before the file credential")
    .option("--base-url <url>", "ORDS base URL", DEFAULT_BASE_URL)
    .option("--profile <profile>", "profile name", "prod")
    .option("--no-switch", "save the profile without making it current")
    .action(async (commandOptions: { token?: string; tokenEnv?: string; baseUrl: string; profile: string; switch?: boolean }) => {
      if (commandOptions.token === undefined && commandOptions.tokenEnv === undefined) {
        options.stderr("Provide --token, --token-env, or both\n");
        process.exitCode = 1;
        return;
      }
      if (commandOptions.token !== undefined && commandOptions.token.trim().length === 0) {
        options.stderr("Token must not be blank\n");
        process.exitCode = 1;
        return;
      }
      if (commandOptions.tokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(commandOptions.tokenEnv)) {
        options.stderr("Token environment variable name is invalid\n");
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
        let fileToken = commandOptions.token;
        if (fileToken === undefined) {
          try {
            fileToken = (await loadConfig(options.configPath)).profiles[commandOptions.profile]?.token ?? "";
          } catch (error) {
            if (!(error instanceof ConfigFileError)) {
              throw error;
            }
            fileToken = "";
          }
        }
        await setProfile(
          commandOptions.profile,
          { baseUrl: commandOptions.baseUrl, token: fileToken, tokenEnv: commandOptions.tokenEnv },
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
        ...(config.profiles[name].tokenEnv
          ? { credentialStore: "env-fallback", tokenEnv: config.profiles[name].tokenEnv }
          : {}),
        token: config.profiles[name].token ? redactToken(config.profiles[name].token) : ""
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
    .command("audit")
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
      const audit = authAudit(config as unknown, options.configPath ?? defaultConfigPath(), process.env);
      if (!audit.ok) {
        process.exitCode = 1;
      }
      if (commandOptions.json) {
        options.stdout(`${JSON.stringify(audit, null, 2)}\n`);
        return;
      }
      options.stdout(`${audit.ok ? "auth audit: ok" : "auth audit: issues found"}\n`);
      for (const issue of audit.issues) {
        options.stdout(`ISSUE ${issue.code}${issue.profile ? ` ${issue.profile}` : ""}: ${issue.message}\n`);
      }
      for (const warning of audit.warnings) {
        options.stdout(`WARN ${warning.code}${warning.profile ? ` ${warning.profile}` : ""}: ${warning.message}\n`);
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

      const redactedToken = current.token ? redactToken(current.token) : "";
      const credentialStore = current.tokenEnv ? "env-fallback" : "file";
      if (commandOptions.json) {
        options.stdout(`${JSON.stringify({
          profile,
          baseUrl: current.baseUrl,
          ...(current.tokenEnv ? { credentialStore, tokenEnv: current.tokenEnv } : {}),
          token: redactedToken
        }, null, 2)}\n`);
        return;
      }

      options.stdout(`Profile: ${profile}\nBase URL: ${current.baseUrl}\nCredential Store: ${credentialStore}\nToken: ${redactedToken || "[environment only]"}\n`);
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

type AuthAuditFinding = {
  code: string;
  message: string;
  profile?: string;
};

function authAudit(config: unknown, configPath: string, env: NodeJS.ProcessEnv = process.env): {
  kind: "auth-audit";
  schemaVersion: 1;
  ok: boolean;
  configPath: string;
  current?: string;
  profileCount: number;
  issues: AuthAuditFinding[];
  warnings: AuthAuditFinding[];
  profiles: Array<Record<string, unknown>>;
} {
  const issues: AuthAuditFinding[] = [];
  const warnings: AuthAuditFinding[] = [];
  const root = isRecord(config) ? config : {};
  const profilesRoot = isRecord(root.profiles) ? root.profiles : {};
  const current = typeof root.current === "string" ? root.current : undefined;
  const names = Object.keys(profilesRoot).sort();

  if (names.length === 0) {
    issues.push({ code: "no-profiles", message: "No auth profiles are configured." });
  }
  if (!current) {
    issues.push({ code: "no-active-profile", message: "No active profile is configured." });
  } else if (!Object.prototype.hasOwnProperty.call(profilesRoot, current)) {
    issues.push({ code: "missing-current-profile", message: "The active profile is not present in profiles.", profile: current });
  }

  const baseUrlProfiles = new Map<string, string[]>();
  const profiles = names.map((name) => {
    const value = profilesRoot[name];
    if (!isRecord(value)) {
      issues.push({ code: "invalid-profile", message: "Profile entry must be an object.", profile: name });
      return { name, current: name === current, valid: false };
    }
    const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
    const token = typeof value.token === "string" ? value.token : "";
    const tokenEnv = typeof value.tokenEnv === "string" ? value.tokenEnv : undefined;
    const envTokenPresent = tokenEnv ? Boolean(env[tokenEnv]) : false;
    if (!isValidBaseUrl(baseUrl)) {
      issues.push({ code: "invalid-base-url", message: "Profile baseUrl must be an absolute http or https URL.", profile: name });
    } else {
      const items = baseUrlProfiles.get(baseUrl) ?? [];
      items.push(name);
      baseUrlProfiles.set(baseUrl, items);
      if (baseUrl.startsWith("http://")) {
        warnings.push({ code: "insecure-base-url", message: "Profile uses http instead of https.", profile: name });
      }
    }
    if (!token.trim() && !envTokenPresent) {
      issues.push({
        code: tokenEnv ? "missing-fallback-token" : "missing-token",
        message: tokenEnv
          ? `Neither ${tokenEnv} nor the file fallback provides a token.`
          : "Profile token is missing or blank.",
        profile: name
      });
    }
    return {
      name,
      current: name === current,
      baseUrl,
      credentialStore: tokenEnv ? "env-fallback" : "file",
      tokenEnv: tokenEnv ? { name: tokenEnv, present: envTokenPresent } : undefined,
      token: {
        present: token.trim().length > 0,
        redacted: token ? redactToken(token) : "",
        length: token.length
      }
    };
  });

  for (const [baseUrl, namesForUrl] of baseUrlProfiles) {
    if (namesForUrl.length > 1) {
      for (const name of namesForUrl) {
        warnings.push({ code: "duplicate-base-url", message: `Multiple profiles use ${baseUrl}.`, profile: name });
      }
    }
  }

  return {
    kind: "auth-audit",
    schemaVersion: 1,
    ok: issues.length === 0,
    configPath,
    current,
    profileCount: names.length,
    issues,
    warnings,
    profiles
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printConfigError(error: unknown, options: CommandIo): boolean {
  if (!(error instanceof ConfigFileError)) {
    return false;
  }
  options.stderr(`${error.message}\n`);
  process.exitCode = 1;
  return true;
}
