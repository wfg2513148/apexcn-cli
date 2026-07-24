import { assertRecord, assertString, isRecord } from "./common.js";

export const APEXCN_ERROR_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/wfg2513148/apexcn-cli/schemas/apexcn-error-v1.schema.json",
  title: "apexcn-cli error response",
  type: "object",
  required: ["ok", "error"],
  properties: {
    ok: { const: false },
    error: {
      type: "object",
      required: ["type", "message"],
      properties: {
        type: { type: "string" },
        code: { type: "string" },
        message: { type: "string" },
        status: { type: "integer" },
        requestId: { type: "string" },
        retryAfterSeconds: { type: "number" },
        windowSeconds: { type: "number" },
        exitCode: { type: "integer" },
        remediation: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            actions: { type: "array", items: { type: "string" } }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    }
  },
  additionalProperties: false,
  "x-apexcn-schema-version": 1,
  "x-apexcn-command-ids": []
} as const;

export function assertApexcnErrorBody(value: unknown): asserts value is {
  ok: false;
  error: {
    code: string;
    message: string;
    status?: number;
    requestId?: string;
    retryable?: boolean;
    remediation?: { code: string; message: string; actions: string[] };
  };
} {
  assertRecord(value, "error body");
  if (value.ok !== false) {
    throw new Error("error body ok must be false");
  }
  if (!isRecord(value.error)) {
    throw new Error("error body error must be an object");
  }
  assertString(value.error.code, "error.code");
  assertString(value.error.message, "error.message");
  if (value.error.remediation !== undefined) {
    assertRecord(value.error.remediation, "error.remediation");
    assertString(value.error.remediation.code, "error.remediation.code");
    assertString(value.error.remediation.message, "error.remediation.message");
    if (!Array.isArray(value.error.remediation.actions) || !value.error.remediation.actions.every((action) => typeof action === "string")) {
      throw new Error("error.remediation.actions must be a string array");
    }
  }
}
