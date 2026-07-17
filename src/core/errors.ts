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
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: redactSecretText(error.message),
        retryable: true,
        remediation: remediationForTransportError(error)
      }
    };
  }
  if (error instanceof TimeoutError) {
    return {
      ok: false,
      error: {
        code: "TIMEOUT",
        message: redactSecretText(error.message),
        retryable: true,
        remediation: remediationForTransportError(error)
      }
    };
  }
  if (error instanceof Error) {
    return { ok: false, error: { code: "UNEXPECTED_ERROR", message: redactSecretText(error.message), retryable: false } };
  }
  return { ok: false, error: { code: "UNEXPECTED_ERROR", message: "Unexpected error", retryable: false } };
}

export function stableErrorCode(error: HttpError | NetworkError | TimeoutError): string {
  if (error instanceof HttpError) {
    return httpCode(error.status);
  }
  return error instanceof TimeoutError ? "TIMEOUT" : "NETWORK_ERROR";
}

export function remediationForHttpError(error: HttpError, token?: string): ErrorRemediation | undefined {
  if (error.status === 401) {
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
  if (error.status === 403) {
    return {
      code: "PERMISSION_DENIED",
      message: "The active account is authenticated but is not allowed to perform this operation.",
      actions: [
        "Run `apexcn auth audit --json` to inspect the active credential source and profile.",
        "Confirm that the active profile and baseUrl target the intended community environment.",
        "Ask a community administrator to verify the account permission for this operation.",
        "Retry the command and include requestId when requesting support."
      ]
    };
  }
  if (error.status === 404) {
    return {
      code: "RESOURCE_NOT_FOUND",
      message: "The requested resource or endpoint was not found.",
      actions: [
        "Verify the topic, reply, category, or user identifier supplied to the command.",
        "Use the corresponding list or search command to discover the current identifier.",
        "Run `apexcn doctor --json` if the endpoint itself may be unavailable.",
        "Retry against the expected profile and baseUrl."
      ]
    };
  }
  if (error.status === 409) {
    return {
      code: "STATE_CONFLICT",
      message: "The remote resource changed or the requested operation conflicts with its current state.",
      actions: [
        "Fetch the resource again before retrying the operation.",
        "Regenerate any preview or workflow approval from the latest resource state.",
        "Review the new request diff and obtain approval again when required.",
        "Retry only after the current state and approved request match."
      ]
    };
  }
  if (error.status === 429) {
    const waitAction = error.retryAfterSeconds === undefined
      ? "Wait before retrying the command."
      : `Wait at least ${error.retryAfterSeconds} seconds before retrying the command.`;
    return {
      code: "RATE_LIMIT_BACKOFF",
      message: "The server rate limit has been reached.",
      actions: [
        waitAction,
        "Reduce request frequency or page size for repeated automation.",
        "Avoid parallel retries while the rate-limit window is active.",
        "Use requestId and the reported window when escalating persistent throttling."
      ]
    };
  }
  if (error.status >= 500) {
    return {
      code: "SERVER_TEMPORARILY_UNAVAILABLE",
      message: "The server failed to complete the request and may recover without a client change.",
      actions: [
        "Retry after a short delay; avoid immediate repeated requests.",
        "Run `apexcn doctor --json` to distinguish local configuration from server availability.",
        "Confirm the service status with the community operator if failures persist.",
        "Include requestId and HTTP status in the support report."
      ]
    };
  }
  return undefined;
}

export function remediationForTransportError(error: NetworkError | TimeoutError): ErrorRemediation {
  if (error instanceof TimeoutError) {
    return {
      code: "REQUEST_TIMEOUT",
      message: "The server did not respond within the configured timeout.",
      actions: [
        "Run `apexcn doctor --json` to check connectivity and the active baseUrl.",
        "Retry once after confirming that the network and ORDS service are reachable.",
        "Increase `APEXCN_HTTP_TIMEOUT_MS` only when the endpoint is known to be slow.",
        "Include the timeout duration and endpoint host when requesting support."
      ]
    };
  }
  return {
    code: "NETWORK_UNREACHABLE",
    message: "The CLI could not establish a network connection to the configured service.",
    actions: [
      "Confirm that the device has network access and DNS resolution works.",
      "Run `apexcn auth show --json` to verify the active baseUrl.",
      "Run `apexcn doctor --json` to capture a redacted connectivity diagnosis.",
      "Check proxy, VPN, firewall, and ORDS service availability before retrying."
    ]
  };
}

export function formatTransportErrorText(error: NetworkError | TimeoutError): string {
  const remediation = remediationForTransportError(error);
  return [
    redactSecretText(error.message),
    `Diagnosis: ${remediation.message}`,
    "Next steps:",
    ...remediation.actions.map((action, index) => `  ${index + 1}. ${action}`),
    ""
  ].join("\n");
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
    `${error.status === 401 ? "Auth diagnosis" : "Diagnosis"}: ${remediation.message}`,
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
