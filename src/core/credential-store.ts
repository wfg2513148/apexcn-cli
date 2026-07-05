import { loadConfig, setProfile, removeProfile, type ProfileConfig } from "../config.js";

export type CredentialAuditResult = {
  ok: boolean;
  profile: string;
  store: "file" | "env";
  tokenPresent: boolean;
  issues: Array<{ code: string; message: string }>;
};

export interface CredentialStore {
  kind: "file" | "env";
  get(profile: string): Promise<string | undefined>;
  set(profile: string, token: string, profileConfig?: Omit<ProfileConfig, "token">): Promise<void>;
  remove(profile: string): Promise<void>;
  audit(profile: string): Promise<CredentialAuditResult>;
}

export function fileCredentialStore(configPath?: string): CredentialStore {
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

export function envCredentialStore(env: NodeJS.ProcessEnv = process.env, variableName = "APEXCN_API_KEY"): CredentialStore {
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
