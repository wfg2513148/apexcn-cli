import { HttpError, NetworkError, TimeoutError } from "../http.js";
import { redactSecrets, redactSecretText } from "./secret-redaction.js";

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

function httpCode(status: number): string {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return `HTTP_${status}`;
}
