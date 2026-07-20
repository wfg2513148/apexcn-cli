import { ConfigFileError } from "../config.js";
import { requestJson, type RequestJsonOptions } from "../http.js";
import { errorBodyFrom, type ApexcnErrorBody } from "./errors.js";
import { loadRuntimeSession } from "./runtime-session.js";

export type ApexcnSession = {
  profile: string;
  baseUrl: string;
  token: string;
};

export type ApexcnApiClient = {
  readonly session: ApexcnSession;
  get<T = unknown>(path: string, query?: RequestJsonOptions["query"]): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, query?: RequestJsonOptions["query"]): Promise<T>;
};

export async function loadApiClient(configPath?: string): Promise<ApexcnApiClient | ApexcnErrorBody> {
  try {
    const runtime = await loadRuntimeSession(configPath);
    if (!runtime.ok) {
      return {
        ok: false,
        error: {
          code: runtime.reason === "no-profile" ? "NO_ACTIVE_PROFILE" : "NO_CREDENTIAL",
          message: runtime.reason === "no-profile" ? "No active profile" : `No credential is available for profile ${runtime.profile}`,
          retryable: false
        }
      };
    }
    return createApiClient(runtime.session);
  } catch (error) {
    if (error instanceof ConfigFileError) {
      return { ok: false, error: { code: "CONFIG_ERROR", message: error.message, retryable: false } };
    }
    return errorBodyFrom(error);
  }
}

export function createApiClient(session: ApexcnSession): ApexcnApiClient {
  return {
    session,
    get: (path, query) => requestJson(session.baseUrl, path, { token: session.token, query }),
    post: (path, body, query) => requestJson(session.baseUrl, path, { token: session.token, method: "POST", body, query })
  };
}

export function isApexcnError(value: unknown): value is ApexcnErrorBody {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}
