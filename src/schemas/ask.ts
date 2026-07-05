import { assertRecord, assertString } from "./common.js";

export function assertAskResponse(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "ask response");
  if (value.answer !== undefined) {
    assertString(value.answer, "answer");
  }
  if (value.references !== undefined && !Array.isArray(value.references)) {
    throw new Error("references must be an array");
  }
}
