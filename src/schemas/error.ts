import { assertRecord, assertString, isRecord } from "./common.js";

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
