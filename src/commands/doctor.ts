import { Command, Option } from "commander";
import { ConfigFileError, defaultConfigPath, loadConfig } from "../config.js";
import { DEFAULT_USER_AGENT, HttpError, NetworkError, requestJson } from "../http.js";
import { parseOutputFormat, printData, validateFormatOptions, type FormatOption, type OutputFormat } from "../output.js";
import { CLI_VERSION } from "../version.js";
import type { CommandIo } from "./auth.js";

export type DoctorCommandOptions = CommandIo & {
  configPath?: string;
};

type DoctorCheck = {
  name: string;
  ok: boolean;
  message?: string;
  status?: number;
  requestId?: string;
};

type DoctorOutput = {
  ok: boolean;
  diagnostics: {
    cliVersion: string;
    userAgent: string;
    configPath: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  profile?: {
    name: string;
    baseUrl: string;
  };
  checks: DoctorCheck[];
};

export function createDoctorCommand(options: DoctorCommandOptions): Command {
  return new Command("doctor")
    .description("check apexcn-cli installation, auth, and API reachability")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      let result: DoctorOutput;
      try {
        result = await runDoctor(options);
      } catch (error) {
        if (!(error instanceof ConfigFileError)) {
          throw error;
        }
        result = {
          ok: false,
          diagnostics: diagnostics(error.configPath),
          checks: [{ name: "profile", ok: false, message: error.message }]
        };
      }
      printDoctor(options, result, commandOptions);
      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}

async function runDoctor(options: DoctorCommandOptions): Promise<DoctorOutput> {
  const configPath = options.configPath ?? defaultConfigPath();
  const config = await loadConfig(configPath);
  const profile = config.current;
  const current = profile ? config.profiles[profile] : undefined;
  const checks: DoctorCheck[] = [];

  if (!profile || !current) {
    checks.push({ name: "profile", ok: false, message: "No active profile" });
    return { ok: false, diagnostics: diagnostics(configPath), checks };
  }

  checks.push({ name: "profile", ok: true });
  const session = { baseUrl: current.baseUrl, token: current.token };
  checks.push(await checkApi("me", session, "/api/v1/me"));
  checks.push(await checkApi("categories", session, "/api/v1/categories"));
  checks.push(await checkApi("search", session, "/api/v1/search", { keyword: "APEX", pageSize: 1 }));

  return {
    ok: checks.every((check) => check.ok),
    diagnostics: diagnostics(configPath),
    profile: { name: profile, baseUrl: current.baseUrl },
    checks
  };
}

async function checkApi(
  name: string,
  session: { baseUrl: string; token: string },
  path: string,
  query?: Record<string, string | number>
): Promise<DoctorCheck> {
  try {
    const data = await requestJson<{ requestId?: string }>(session.baseUrl, path, { token: session.token, query });
    return { name, ok: true, requestId: data.requestId };
  } catch (error) {
    if (error instanceof HttpError) {
      return { name, ok: false, message: error.message, status: error.status, requestId: error.requestId };
    }
    if (error instanceof NetworkError) {
      return { name, ok: false, message: error.message };
    }
    throw error;
  }
}

function printDoctor(options: CommandIo, result: DoctorOutput, commandOptions: FormatOption): void {
  const format = doctorOutputFormat(commandOptions);
  if (format === "json" || format === "pretty") {
    printData(options, result, format);
    return;
  }

  options.stdout(`apexcn doctor: ${result.ok ? "ok" : "failed"}\n`);
  options.stdout(`CLI Version: ${result.diagnostics.cliVersion}\nUser Agent: ${result.diagnostics.userAgent}\nConfig Path: ${result.diagnostics.configPath}\n`);
  if (result.profile) {
    options.stdout(`Profile: ${result.profile.name}\nBase URL: ${result.profile.baseUrl}\n`);
  }
  for (const check of result.checks) {
    const detail = check.message ? ` - ${check.message}` : "";
    const requestId = check.requestId ? ` requestId=${check.requestId}` : "";
    options.stdout(`${check.ok ? "OK" : "FAIL"} ${check.name}${detail}${requestId}\n`);
  }
}

function doctorOutputFormat(options: FormatOption): OutputFormat {
  if (options.json) {
    return "pretty";
  }
  return options.format ?? "text";
}

function diagnostics(configPath: string): DoctorOutput["diagnostics"] {
  return {
    cliVersion: CLI_VERSION,
    userAgent: DEFAULT_USER_AGENT,
    configPath,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  };
}
