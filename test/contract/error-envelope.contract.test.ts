import { describe, expect, test } from "vitest";
import { errorBodyFrom } from "../../src/core/errors.js";
import { HttpError } from "../../src/http.js";

describe("stable error envelope contract", () => {
  test("maps HTTP errors to stable redacted envelope fields", () => {
    const token = "apexcn_secret_token_1234567890";
    const body = {
      message: `Authorization: Bearer ${token}`,
      token,
      nested: { password: "plain-secret" },
      error: {
        retryAfterSeconds: 30,
        windowSeconds: 60
      }
    };
    const error = new HttpError(`token ${token} is rate limited`, 429, "Too Many Requests", "req-contract", body);

    const envelope = errorBodyFrom(error, token);

    expect(envelope).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({
        code: "RATE_LIMITED",
        message: "token [redacted] is rate limited",
        status: 429,
        requestId: "req-contract",
        retryable: true,
        retryAfterSeconds: 30,
        windowSeconds: 60
      })
    }));
    expect(JSON.stringify(envelope)).not.toContain(token);
    expect(JSON.stringify(envelope)).not.toContain("plain-secret");
  });

  test("adds actionable remediation for server-rejected tokens", () => {
    const error = new HttpError("Invalid API token", 401, "Unauthorized", "req-401", {
      error: { message: "Invalid API token", requestId: "req-401" }
    });

    const envelope = errorBodyFrom(error, "local-token");

    expect(envelope.error).toEqual(expect.objectContaining({
      code: "AUTH_REQUIRED",
      status: 401,
      requestId: "req-401",
      remediation: {
        code: "TOKEN_REJECTED_BY_SERVER",
        message: "A local API token is configured, but the server rejected it.",
        actions: expect.arrayContaining([
          "Run `apexcn auth show --json` to confirm the active profile and baseUrl.",
          "Run `apexcn auth set-token --token <new-token> --profile <profile>` to refresh the token."
        ])
      }
    }));
  });
});
