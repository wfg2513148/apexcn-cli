import { describe, expect, it } from "vitest";
import { errorBodyFrom } from "../../src/core/errors.js";
import { HttpError, NetworkError, TimeoutError } from "../../src/http.js";
import { assertApexcnErrorBody } from "../../src/schemas/error.js";

const secret = "apexcn_test_secret_1234567890";

describe("actionable error matrix contract", () => {
  it("covers the eight required failure classes with stable remediation", () => {
    const cases = [
      new HttpError(`Bearer ${secret} was rejected`, 401, "Unauthorized", "req-401", {}),
      new HttpError("Permission denied", 403, "Forbidden", "req-403", {}),
      new HttpError("Topic not found", 404, "Not Found", "req-404", {}),
      new HttpError("Topic changed", 409, "Conflict", "req-409", {}),
      new HttpError("Too many requests", 429, "Too Many Requests", "req-429", {
        retryAfterSeconds: 30,
        windowSeconds: 60
      }),
      new HttpError("Service unavailable", 503, "Service Unavailable", "req-503", {}),
      new NetworkError("https://forums.example.test/ords/apexcn/api/v1/topics", new Error(`token=${secret}`)),
      new TimeoutError("https://forums.example.test/ords/apexcn/api/v1/topics", 5_000)
    ];
    const expectedCodes = [
      "AUTH_REQUIRED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMITED",
      "SERVER_ERROR",
      "NETWORK_ERROR",
      "TIMEOUT"
    ];

    expect(cases).toHaveLength(8);
    cases.forEach((failure, index) => {
      const body = errorBodyFrom(failure, secret);
      assertApexcnErrorBody(body);
      expect(body.error.code).toBe(expectedCodes[index]);
      expect(body.error.remediation?.code).toBeTruthy();
      expect(body.error.remediation?.message).toBeTruthy();
      expect(body.error.remediation?.actions.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(body)).not.toContain(secret);
    });
  });

  it("uses the server retry interval in rate-limit guidance", () => {
    const body = errorBodyFrom(new HttpError(
      "Too many requests",
      429,
      "Too Many Requests",
      "req-rate",
      { retryAfterSeconds: 45 }
    ));

    expect(body.error.remediation?.actions[0]).toContain("45 seconds");
    expect(body.error.retryAfterSeconds).toBe(45);
  });
});
