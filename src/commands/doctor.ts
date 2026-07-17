import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, defaultConfigPath, loadConfig } from "../config.js";
import { createDoctorSnapshot, type DoctorSnapshotOutput } from "../core/doctor-snapshot.js";
import { DEFAULT_USER_AGENT, HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { fieldText, isRecord, parseOutputFormat, printData, validateFormatOptions, type FormatOption, type OutputFormat } from "../output.js";
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
  retryAfterSeconds?: number;
  windowSeconds?: number;
  suggestions?: string[];
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
  const doctor = new Command("doctor")
    .description("check apexcn-cli installation, auth, and API reachability")
    .enablePositionalOptions()
    .option("--check-ask <question>", "also check the RAG ask endpoint with a read-only question")
    .option("--timeout-ms <ms>", "per-request timeout in milliseconds", parseTimeoutMs)
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat));

  doctor
    .command("snapshot")
    .description("print a local support snapshot without calling the API")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action(async (commandOptions: FormatOption) => {
      const outputOptions = { ...doctor.opts(), ...commandOptions };
      if (!validateFormatOptions(options, outputOptions)) {
        return;
      }
      const result = await createDoctorSnapshot(options.configPath);
      printDoctorSnapshot(options, result, outputOptions);
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  doctor.action(async (commandOptions: FormatOption & { checkAsk?: string; timeoutMs?: number }) => {
    if (!validateFormatOptions(options, commandOptions)) {
      return;
    }
    if (commandOptions.checkAsk !== undefined && commandOptions.checkAsk.trim().length === 0) {
      options.stderr("--check-ask must not be blank\n");
      process.exitCode = 1;
      return;
    }
    let result: DoctorOutput;
    try {
      result = await runDoctor(options, commandOptions);
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

  return doctor;
}

async function runDoctor(options: DoctorCommandOptions, commandOptions: { checkAsk?: string; timeoutMs?: number } = {}): Promise<DoctorOutput> {
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
  checks.push(await checkApi("me", session, "/api/v1/me", undefined, { timeoutMs: commandOptions.timeoutMs }));
  checks.push(await checkApi("categories", session, "/api/v1/categories", undefined, { timeoutMs: commandOptions.timeoutMs }));
  checks.push(await checkApi("search", session, "/api/v1/search", { keyword: "APEX", pageSize: 1 }, { timeoutMs: commandOptions.timeoutMs }));
  if (commandOptions.checkAsk !== undefined) {
    checks.push(await checkApi("ask", session, "/api/v1/ask", undefined, {
      method: "POST",
      body: { question: commandOptions.checkAsk, topK: 1 },
      timeoutMs: commandOptions.timeoutMs
    }));
  }

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
  query?: Record<string, string | number>,
  requestOptions: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<DoctorCheck> {
  try {
    const data = await requestJson<{ requestId?: string }>(session.baseUrl, path, {
      token: session.token,
      query,
      method: requestOptions.method,
      body: requestOptions.body,
      timeoutMs: requestOptions.timeoutMs
    });
    return { name, ok: true, requestId: data.requestId };
  } catch (error) {
    if (error instanceof HttpError) {
      return {
        name,
        ok: false,
        message: redactSecret(error.message, session.token),
        status: error.status,
        requestId: error.requestId,
        retryAfterSeconds: error.retryAfterSeconds,
        windowSeconds: error.windowSeconds
      };
    }
    if (error instanceof NetworkError) {
      return { name, ok: false, message: error.message };
    }
    if (error instanceof TimeoutError) {
      return { name, ok: false, message: error.message, suggestions: doctorTimeoutSuggestions(name) };
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
    const retry = check.retryAfterSeconds === undefined ? "" : ` retryAfterSeconds=${check.retryAfterSeconds}`;
    const window = check.windowSeconds === undefined ? "" : ` windowSeconds=${check.windowSeconds}`;
    options.stdout(`${check.ok ? "OK" : "FAIL"} ${check.name}${detail}${requestId}${retry}${window}\n`);
    for (const suggestion of check.suggestions ?? []) {
      options.stdout(`  - ${suggestion}\n`);
    }
  }
}

function doctorTimeoutSuggestions(name: string): string[] {
  const common = [
    "Retry with a larger --timeout-ms value when the network or ORDS endpoint is slow.",
    "Run apexcn doctor snapshot --json to collect local diagnostics without making API calls."
  ];
  if (name === "ask") {
    return [
      ...common,
      "Use apexcn search <keywords> --json or apexcn research <keywords> --json as a bounded fallback."
    ];
  }
  return common;
}

function doctorOutputFormat(options: FormatOption): OutputFormat {
  if (options.json) {
    return "pretty";
  }
  return options.format ?? "text";
}

function printDoctorSnapshot(options: CommandIo, result: DoctorSnapshotOutput, commandOptions: FormatOption): void {
  const format = doctorOutputFormat(commandOptions);
  if (format === "json" || format === "pretty") {
    printData(options, result, format);
    return;
  }

  options.stdout(`apexcn doctor snapshot: ${result.ok ? "ok" : "failed"}\n`);
  options.stdout(`CLI Version: ${result.diagnostics.cliVersion}\nConfig Path: ${result.config.path}\n`);
  options.stdout(`Config: exists=${result.config.exists} readable=${result.config.readable} validJson=${result.config.validJson} profiles=${result.config.profileCount}\n`);
  options.stdout(`Environment: APEXCN_CONFIG_PATH=${result.environment.apexcnConfigPath.present ? "present" : "missing"} APEXCN_HTTP_TIMEOUT_MS=${result.environment.apexcnHttpTimeoutMs.valid ? "valid" : "invalid"} APEXCN_API_KEY=${result.environment.apexcnApiKey.present ? "present" : "missing"}\n`);
  for (const check of result.checks) {
    options.stdout(`${check.severity.toUpperCase()} ${fieldText(check.code)}: ${fieldText(check.message)}\n`);
  }
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

function parseTimeoutMs(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer timeout: ${value}`);
  }
  return parsed;
}
