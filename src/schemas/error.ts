import { assertRecord, assertString, isRecord } from "./common.js";

export function assertApexcnErrorBody(value: unknown): asserts value is {
  ok: false;
  error: { code: string; message: string; status?: number; requestId?: string; retryable?: boolean };
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
}
