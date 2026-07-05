import { describe, expect, test } from "vitest";
import { redactSecretText, redactSecrets } from "../src/core/secret-redaction.js";
import { callMcpTool } from "../src/mcp/tools.js";
import { mcpPolicy } from "../src/mcp/tool-registry.js";

describe("cross-surface secret redaction", () => {
  test("redacts common CLI and artifact secret text patterns", () => {
    const secret = "abcdef1234567890";
    const redacted = redactSecretText([
      `Authorization: Bearer ${secret}`,
      `Bearer ${secret}`,
      `APEXCN_API_KEY=${secret}`,
      `api_key=${secret}`,
      `token: ${secret}`,
      "password=secret",
      "Cookie: sid=secret",
      "Set-Cookie: sid=secret"
    ].join("\n"));

    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain("password=secret");
    expect(redacted).not.toContain("sid=secret");
    expect(redacted).toContain("[redacted]");
  });

  test("redacts nested arrays and objects", () => {
    const result = redactSecrets({
      messages: [
        { Authorization: "Bearer abcdef1234567890" },
        { body: "token=abcdef1234567890" }
      ]
    });

    expect(JSON.stringify(result)).not.toContain("abcdef1234567890");
  });

  test("MCP validation errors do not echo secret inputs", async () => {
    const result = await callMcpTool("apexcn_topic_create_preview", {
      title: "token=abcdef1234567890"
    }, mcpPolicy(true));

    expect(JSON.stringify(result)).not.toContain("abcdef1234567890");
  });
});
