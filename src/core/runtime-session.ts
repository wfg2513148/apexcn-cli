import { loadConfig } from "../config.js";
import { profileCredentialStore } from "./credential-store.js";

export type RuntimeSession = {
  profile: string;
  baseUrl: string;
  token: string;
  credentialStore: "file" | "env";
};

export type RuntimeSessionResult =
  | { ok: true; session: RuntimeSession }
  | { ok: false; reason: "no-profile" | "no-credential"; profile?: string };

export async function loadRuntimeSession(
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<RuntimeSessionResult> {
  const config = await loadConfig(configPath);
  const profile = config.current;
  const current = profile ? config.profiles[profile] : undefined;
  if (!profile || !current) {
    return { ok: false, reason: "no-profile" };
  }
  const store = profileCredentialStore(current, configPath, env);
  const token = await store.get(profile);
  if (!token) {
    return { ok: false, reason: "no-credential", profile };
  }
  const audit = await store.audit(profile);
  return {
    ok: true,
    session: {
      profile,
      baseUrl: current.baseUrl,
      token,
      credentialStore: audit.selectedStore ?? "file"
    }
  };
}
