import { describe, expect, test } from "vitest";
import { redactSecretText, redactSecrets } from "../../src/core/secret-redaction.js";

describe("secret redaction", () => {
  test("redacts common credential strings", () => {
    const text = [
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "api_key=plain-secret",
      "password: hunter2",
      "Set-Cookie: sid=secret"
    ].join("\n");

    const redacted = redactSecretText(text);

    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("plain-secret");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("sid=secret");
    expect(redacted).toContain("[redacted]");
  });

  test("redacts nested secret object values", () => {
    expect(redactSecrets({
      token: "abc123",
      nested: {
        apiKey: "key123",
        "X-APEXCN-API-Key": "header-key",
        Authorization: "Custom short",
        "set-cookie": "sid=secret",
        ok: true
      }
    })).toEqual({
      token: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        "X-APEXCN-API-Key": "[redacted]",
        Authorization: "[redacted]",
        "set-cookie": "[redacted]",
        ok: true
      }
    });
  });
});
