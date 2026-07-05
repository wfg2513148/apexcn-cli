import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, defaultConfigPath, loadConfig } from "../config.js";
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

type DoctorSnapshotCheck = {
  code: string;
  severity: "issue" | "warning";
  ok: boolean;
  message: string;
};

type DoctorSnapshotOutput = {
  kind: "doctor-snapshot";
  schemaVersion: 1;
  ok: boolean;
  diagnostics: DoctorOutput["diagnostics"] & {
    cwd: string;
    execPath: string;
  };
  checks: DoctorSnapshotCheck[];
  environment: {
    apexcnConfigPath: {
      present: boolean;
      path?: string;
    };
    apexcnHttpTimeoutMs: {
      present: boolean;
      valid: boolean;
    };
    apexcnApiKey: {
      present: boolean;
    };
  };
  config: {
    path: string;
    exists: boolean;
    readable: boolean;
    validJson: boolean;
    profileCount: number;
    currentProfile?: string;
    currentProfileExists: boolean;
    activeProfile?: {
      baseUrl: string;
      baseUrlValid: boolean;
      tokenPresent: boolean;
      tokenRedactedLength: number;
    };
  };
  agentSkill: {
    repoSkillPath: string;
    repoSkillExists: boolean;
    repoSkillMentionsSnapshot: boolean;
    installCandidates: Array<{
      path: string;
      exists: boolean;
    }>;
  };
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
      const result = await runDoctorSnapshot(options);
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
    const retry = check.retryAfterSeconds === undefined ? "" : ` retryAfterSeconds=${check.retryAfterSeconds}`;
    const window = check.windowSeconds === undefined ? "" : ` windowSeconds=${check.windowSeconds}`;
    options.stdout(`${check.ok ? "OK" : "FAIL"} ${check.name}${detail}${requestId}${retry}${window}\n`);
  }
}

function doctorOutputFormat(options: FormatOption): OutputFormat {
  if (options.json) {
    return "pretty";
  }
  return options.format ?? "text";
}

async function runDoctorSnapshot(options: DoctorCommandOptions): Promise<DoctorSnapshotOutput> {
  const configPath = options.configPath ?? defaultConfigPath();
  const checks: DoctorSnapshotCheck[] = [];
  const config = await inspectConfig(configPath, checks);
  const environment = inspectEnvironment(checks);
  const agentSkill = await inspectAgentSkill();

  if (!agentSkill.installCandidates.some((candidate) => candidate.exists)) {
    checks.push({
      code: "agent-skill-missing",
      severity: "warning",
      ok: false,
      message: "No installed apexcn-cli agent skill was found in common locations"
    });
  }

  return {
    kind: "doctor-snapshot",
    schemaVersion: 1,
    ok: checks.every((check) => check.severity !== "issue"),
    diagnostics: {
      ...diagnostics(configPath),
      cwd: process.cwd(),
      execPath: process.execPath
    },
    checks,
    environment,
    config,
    agentSkill
  };
}

async function inspectConfig(configPath: string, checks: DoctorSnapshotCheck[]): Promise<DoctorSnapshotOutput["config"]> {
  const empty = {
    path: configPath,
    exists: false,
    readable: false,
    validJson: false,
    profileCount: 0,
    currentProfileExists: false
  };
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    checks.push({
      code: "config-unreadable",
      severity: "issue",
      ok: false,
      message: isNodeError(error) && error.code === "ENOENT" ? "Config file does not exist" : "Config file is not readable"
    });
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    checks.push({ code: "config-invalid-json", severity: "issue", ok: false, message: "Config file is not valid JSON" });
    return { ...empty, exists: true, readable: true };
  }

  const root = isRecord(parsed) ? parsed : {};
  const profilesRoot = isRecord(root.profiles) ? root.profiles : {};
  const currentProfile = typeof root.current === "string" ? root.current : undefined;
  const profileCount = Object.keys(profilesRoot).length;
  const currentValue = currentProfile ? profilesRoot[currentProfile] : undefined;
  const currentProfileExists = currentProfile !== undefined && Object.prototype.hasOwnProperty.call(profilesRoot, currentProfile);
  const output: DoctorSnapshotOutput["config"] = {
    path: configPath,
    exists: true,
    readable: true,
    validJson: true,
    profileCount,
    currentProfile,
    currentProfileExists
  };

  if (!currentProfile) {
    checks.push({ code: "no-active-profile", severity: "issue", ok: false, message: "No active profile is configured" });
    return output;
  }
  if (!currentProfileExists || !isRecord(currentValue)) {
    checks.push({ code: "missing-current-profile", severity: "issue", ok: false, message: "The active profile is not present in profiles" });
    return output;
  }

  const baseUrl = typeof currentValue.baseUrl === "string" ? currentValue.baseUrl : "";
  const token = typeof currentValue.token === "string" ? currentValue.token : "";
  const baseUrlValid = isValidHttpUrl(baseUrl);
  output.activeProfile = {
    baseUrl,
    baseUrlValid,
    tokenPresent: token.trim().length > 0,
    tokenRedactedLength: token ? redactTokenForSnapshot(token).length : 0
  };
  if (!baseUrlValid) {
    checks.push({ code: "invalid-base-url", severity: "issue", ok: false, message: "Active profile baseUrl must be an absolute http or https URL" });
  }
  if (!token.trim()) {
    checks.push({ code: "missing-token", severity: "warning", ok: false, message: "Active profile token is missing or blank" });
  }
  return output;
}

function inspectEnvironment(checks: DoctorSnapshotCheck[]): DoctorSnapshotOutput["environment"] {
  const timeout = process.env.APEXCN_HTTP_TIMEOUT_MS;
  const timeoutValid = timeout === undefined || (Number.isInteger(Number(timeout)) && Number(timeout) > 0);
  if (!timeoutValid) {
    checks.push({ code: "invalid-timeout-env", severity: "issue", ok: false, message: "APEXCN_HTTP_TIMEOUT_MS must be a positive integer when set" });
  }
  const apiKeyPresent = Boolean(process.env.APEXCN_API_KEY);
  if (!apiKeyPresent) {
    checks.push({ code: "api-key-env-missing", severity: "warning", ok: false, message: "APEXCN_API_KEY is not set in the environment" });
  }
  return {
    apexcnConfigPath: {
      present: process.env.APEXCN_CONFIG_PATH !== undefined,
      path: process.env.APEXCN_CONFIG_PATH
    },
    apexcnHttpTimeoutMs: {
      present: timeout !== undefined,
      valid: timeoutValid
    },
    apexcnApiKey: {
      present: apiKeyPresent
    }
  };
}

async function inspectAgentSkill(): Promise<DoctorSnapshotOutput["agentSkill"]> {
  const home = homedir();
  const repoSkillPath = join(process.cwd(), "agent-skill", "SKILL.md");
  const installCandidates = [
    join(home, ".codex", "skills", "apexcn-cli", "SKILL.md"),
    join(home, ".agents", "skills", "apexcn-cli", "SKILL.md"),
    join(home, ".claude", "skills", "apexcn-cli", "SKILL.md")
  ];
  const repoSkill = await readOptionalText(repoSkillPath);
  return {
    repoSkillPath,
    repoSkillExists: repoSkill !== undefined,
    repoSkillMentionsSnapshot: repoSkill?.includes("doctor snapshot") ?? false,
    installCandidates: await Promise.all(installCandidates.map(async (path) => ({
      path,
      exists: await pathExists(path)
    })))
  };
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

function isValidHttpUrl(value: string): boolean {
  if (value.trim() !== value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function redactTokenForSnapshot(token: string): string {
  if (token.length <= 8) {
    return "[redacted]";
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EACCES")) {
      return undefined;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await readOptionalText(path)) !== undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
