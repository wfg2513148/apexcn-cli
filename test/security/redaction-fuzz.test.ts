import { describe, expect, test } from "vitest";
import { redactSecretText } from "../../src/core/secret-redaction.js";

const templates: Array<(secret: string) => string> = [
  (secret) => `Authorization: Bearer ${secret}`,
  (secret) => `Authorization: Basic ${secret}`,
  (secret) => `Bearer ${secret}`,
  (secret) => `token=${secret}`,
  (secret) => `api_key: "${secret}"`,
  (secret) => `{"apiKey":"${secret}"}`,
  (secret) => `'password': '${secret}'`,
  (secret) => `apexcn auth set-token --token ${secret}`,
  (secret) => `https://agent:${secret}@oracleapex.cn/ords/api`,
  (secret) => `Cookie: apexcn_session=${secret}`
];

describe("deterministic redaction fuzz qualification", () => {
  test("redacts 10,000 labeled, header, CLI, URL, JSON, and cookie secret cases", () => {
    let cases = 0;
    const leaks: Array<{ index: number; template: number }> = [];

    for (let index = 0; index < 1_000; index += 1) {
      const secret = `s3cr3t-${index.toString(16).padStart(8, "0")}-AbCdEf0123456789`;
      for (const [templateIndex, template] of templates.entries()) {
        const redacted = redactSecretText(template(secret));
        cases += 1;
        if (redacted.includes(secret)) {
          leaks.push({ index, template: templateIndex });
        }
      }
    }

    expect(cases).toBe(10_000);
    expect(leaks).toEqual([]);
  });
});
