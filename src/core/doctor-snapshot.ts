import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultConfigPath } from "../config.js";
import { DEFAULT_USER_AGENT } from "../http.js";
import { isRecord } from "../output.js";
import { CLI_VERSION } from "../version.js";

export type DoctorSnapshotCheck = {
  code: string;
  severity: "issue" | "warning";
  ok: boolean;
  message: string;
};

export type DoctorSnapshotOutput = {
  kind: "doctor-snapshot";
  schemaVersion: 1;
  ok: boolean;
  diagnostics: {
    cliVersion: string;
    userAgent: string;
    configPath: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    cwd: string;
    execPath: string;
  };
  checks: DoctorSnapshotCheck[];
  environment: {
    apexcnConfigPath: { present: boolean; path?: string };
    apexcnHttpTimeoutMs: { present: boolean; valid: boolean };
    apexcnApiKey: { present: boolean };
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
      credentialStore?: "env-fallback";
      tokenEnv?: { name: string; present: boolean };
      tokenPresent: boolean;
      tokenRedactedLength: number;
    };
  };
  agentSkill: {
    repoSkillPath: string;
    repoSkillExists: boolean;
    repoSkillMentionsSnapshot: boolean;
    installCandidates: Array<{ path: string; exists: boolean }>;
  };
};

export async function createDoctorSnapshot(configPath = defaultConfigPath()): Promise<DoctorSnapshotOutput> {
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
      cliVersion: CLI_VERSION,
      userAgent: DEFAULT_USER_AGENT,
      configPath,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
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
  const tokenEnv = typeof currentValue.tokenEnv === "string" ? currentValue.tokenEnv : undefined;
  const envTokenPresent = tokenEnv ? Boolean(process.env[tokenEnv]) : false;
  const baseUrlValid = isValidHttpUrl(baseUrl);
  output.activeProfile = {
    baseUrl,
    baseUrlValid,
    ...(tokenEnv ? { credentialStore: "env-fallback" as const, tokenEnv: { name: tokenEnv, present: envTokenPresent } } : {}),
    tokenPresent: envTokenPresent || token.trim().length > 0,
    tokenRedactedLength: token ? redactTokenForSnapshot(token).length : 0
  };
  if (!baseUrlValid) {
    checks.push({ code: "invalid-base-url", severity: "issue", ok: false, message: "Active profile baseUrl must be an absolute http or https URL" });
  }
  if (!token.trim() && !envTokenPresent) {
    checks.push({
      code: tokenEnv ? "missing-fallback-token" : "missing-token",
      severity: "warning",
      ok: false,
      message: tokenEnv ? `Neither ${tokenEnv} nor the file fallback provides a token` : "Active profile token is missing or blank"
    });
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
