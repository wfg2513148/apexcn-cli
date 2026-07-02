import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProfileConfig = {
  baseUrl: string;
  token: string;
};

export type ApexcnConfig = {
  current?: string;
  profiles: Record<string, ProfileConfig>;
};

export const DEFAULT_BASE_URL = "https://oracleapex.cn/ords/api";

export class ConfigFileError extends Error {
  readonly configPath: string;

  constructor(configPath: string) {
    super(`Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.`);
    this.name = "ConfigFileError";
    this.configPath = configPath;
  }
}

export function defaultConfigPath(home = homedir()): string {
  return join(home, ".apexcn", "config.json");
}

export async function loadConfig(configPath = defaultConfigPath()): Promise<ApexcnConfig> {
  try {
    const text = await readFile(configPath, "utf8");
    let parsed: Partial<ApexcnConfig>;
    try {
      parsed = JSON.parse(text) as Partial<ApexcnConfig>;
    } catch {
      throw new ConfigFileError(configPath);
    }
    return {
      ...parsed,
      profiles: parsed.profiles ?? {}
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { profiles: {} };
    }
    throw error;
  }
}

export async function saveConfig(config: ApexcnConfig, configPath = defaultConfigPath()): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmodConfigFile(configPath);
}

export async function setCurrentProfile(
  profile: string,
  profileConfig: ProfileConfig,
  configPath = defaultConfigPath()
): Promise<void> {
  const config = await loadConfig(configPath);
  await saveConfig(
    {
      current: profile,
      profiles: {
        ...config.profiles,
        [profile]: profileConfig
      }
    },
    configPath
  );
}

export async function clearCurrentProfile(configPath = defaultConfigPath()): Promise<void> {
  const config = await loadConfig(configPath);
  const next: ApexcnConfig = { profiles: config.profiles };
  await saveConfig(next, configPath);
}

async function chmodConfigFile(configPath: string): Promise<void> {
  try {
    await chmod(configPath, 0o600);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOSYS" || error.code === "EPERM")) {
      return;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
