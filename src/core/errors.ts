import { HttpError, NetworkError, TimeoutError } from "../http.js";
import { redactSecrets, redactSecretText } from "./secret-redaction.js";

export type ErrorRemediation = {
  code: string;
  message: string;
  actions: string[];
};

export type ApexcnErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
    requestId?: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
    windowSeconds?: number;
    remediation?: ErrorRemediation;
    details?: unknown;
  };
};

export function errorBodyFrom(error: unknown, token?: string): ApexcnErrorBody {
  if (error instanceof HttpError) {
    return {
      ok: false,
      error: {
        code: httpCode(error.status),
        message: redactSecretText(token ? error.message.split(token).join("[redacted]") : error.message),
        status: error.status,
        requestId: error.requestId,
        retryable: error.status === 429 || error.status >= 500,
        retryAfterSeconds: error.retryAfterSeconds,
        windowSeconds: error.windowSeconds,
        remediation: remediationForHttpError(error, token),
        details: redactSecrets(error.body)
      }
    };
  }
  if (error instanceof NetworkError) {
    return { ok: false, error: { code: "NETWORK_ERROR", message: error.message, retryable: true } };
  }
  if (error instanceof TimeoutError) {
    return { ok: false, error: { code: "TIMEOUT", message: error.message, retryable: true } };
  }
  if (error instanceof Error) {
    return { ok: false, error: { code: "UNEXPECTED_ERROR", message: redactSecretText(error.message), retryable: false } };
  }
  return { ok: false, error: { code: "UNEXPECTED_ERROR", message: "Unexpected error", retryable: false } };
}

export function remediationForHttpError(error: HttpError, token?: string): ErrorRemediation | undefined {
  if (error.status !== 401) {
    return undefined;
  }
  return {
    code: token ? "TOKEN_REJECTED_BY_SERVER" : "AUTH_TOKEN_REQUIRED",
    message: token
      ? "A local API token is configured, but the server rejected it."
      : "The server requires a valid API token.",
    actions: [
      "Run `apexcn auth show --json` to confirm the active profile and baseUrl.",
      "Run `apexcn auth set-token --token <new-token> --profile <profile>` to refresh the token.",
      "Check that the active profile points at the expected ORDS baseUrl.",
      "Retry the command and include requestId when asking for server-side support."
    ]
  };
}

export function formatHttpErrorText(error: HttpError, token?: string): string {
  const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
  const retry = error.retryAfterSeconds === undefined ? "" : ` retryAfterSeconds=${error.retryAfterSeconds}`;
  const window = error.windowSeconds === undefined ? "" : ` windowSeconds=${error.windowSeconds}`;
  const hint = error.status === 429 && error.retryAfterSeconds !== undefined ? ` Retry after ${error.retryAfterSeconds}s.` : "";
  const base = `HTTP ${error.status}: ${redactedHttpMessage(error.message, token)}${requestId}${retry}${window}${hint}`;
  const remediation = remediationForHttpError(error, token);
  if (!remediation) {
    return `${base}\n`;
  }
  return [
    base,
    `Auth diagnosis: ${remediation.message}`,
    "Next steps:",
    ...remediation.actions.map((action, index) => `  ${index + 1}. ${action}`),
    ""
  ].join("\n");
}

function httpCode(status: number): string {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return `HTTP_${status}`;
}

function redactedHttpMessage(message: string, token?: string): string {
  const withoutToken = token ? message.split(token).join("[redacted]") : message;
  return redactSecretText(withoutToken);
}
