import { loadConfig, setProfile, removeProfile, type ProfileConfig } from "../config.js";

export type CredentialAuditResult = {
  ok: boolean;
  profile: string;
  store: "file" | "env" | "fallback";
  tokenPresent: boolean;
  selectedStore?: "file" | "env";
  backends?: Array<{ store: "file" | "env"; available: boolean }>;
  issues: Array<{ code: string; message: string }>;
};

export interface CredentialStore {
  kind: "file" | "env" | "fallback";
  get(profile: string): Promise<string | undefined>;
  set(profile: string, token: string, profileConfig?: Omit<ProfileConfig, "token">): Promise<void>;
  remove(profile: string): Promise<void>;
  audit(profile: string): Promise<CredentialAuditResult>;
}

type DirectCredentialStore = CredentialStore & { kind: "file" | "env" };

export function fileCredentialStore(configPath?: string): DirectCredentialStore {
  return {
    kind: "file",
    async get(profile) {
      return (await loadConfig(configPath)).profiles[profile]?.token;
    },
    async set(profile, token, profileConfig = { baseUrl: "https://oracleapex.cn/ords/api" }) {
      await setProfile(profile, { ...profileConfig, token }, configPath);
    },
    async remove(profile) {
      await removeProfile(profile, configPath);
    },
    async audit(profile) {
      const config = await loadConfig(configPath);
      const tokenPresent = Boolean(config.profiles[profile]?.token);
      return {
        ok: tokenPresent,
        profile,
        store: "file",
        tokenPresent,
        issues: tokenPresent ? [] : [{ code: "missing-token", message: `No token stored for profile ${profile}` }]
      };
    }
  };
}

export function envCredentialStore(env: NodeJS.ProcessEnv = process.env, variableName = "APEXCN_API_KEY"): DirectCredentialStore {
  return {
    kind: "env",
    async get() {
      return env[variableName];
    },
    async set() {
      throw new Error("Environment credential store is read-only. Set the environment variable outside apexcn-cli.");
    },
    async remove() {
      throw new Error("Environment credential store is read-only. Remove the environment variable outside apexcn-cli.");
    },
    async audit(profile) {
      const tokenPresent = Boolean(env[variableName]);
      return {
        ok: tokenPresent,
        profile,
        store: "env",
        tokenPresent,
        issues: tokenPresent ? [] : [{ code: "missing-env-token", message: `${variableName} is not set` }]
      };
    }
  };
}

export function fallbackCredentialStore(primary: DirectCredentialStore, fallback: DirectCredentialStore): CredentialStore {
  return {
    kind: "fallback",
    async get(profile) {
      return (await primary.get(profile)) || fallback.get(profile);
    },
    async set(profile, token, profileConfig) {
      await fallback.set(profile, token, profileConfig);
    },
    async remove(profile) {
      await fallback.remove(profile);
    },
    async audit(profile) {
      const [primaryAudit, fallbackAudit] = await Promise.all([
        primary.audit(profile),
        fallback.audit(profile)
      ]);
      const selected = primaryAudit.tokenPresent ? primary : fallbackAudit.tokenPresent ? fallback : undefined;
      return {
        ok: selected !== undefined,
        profile,
        store: "fallback",
        tokenPresent: selected !== undefined,
        selectedStore: selected?.kind === "file" || selected?.kind === "env" ? selected.kind : undefined,
        backends: [
          { store: primary.kind, available: primaryAudit.tokenPresent },
          { store: fallback.kind, available: fallbackAudit.tokenPresent }
        ],
        issues: selected
          ? []
          : [{ code: "missing-fallback-token", message: "No credential is available from the primary or fallback store" }]
      };
    }
  };
}

export function profileCredentialStore(
  profile: ProfileConfig,
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env
): CredentialStore {
  const file = fileCredentialStore(configPath);
  return profile.tokenEnv
    ? fallbackCredentialStore(envCredentialStore(env, profile.tokenEnv), file)
    : file;
}
