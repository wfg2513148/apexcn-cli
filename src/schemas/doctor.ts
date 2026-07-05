import { assertRecord, assertString } from "./common.js";

export function assertDoctorSnapshot(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "doctor snapshot");
  if (value.kind !== undefined) {
    assertString(value.kind, "kind");
  }
  if (value.schemaVersion !== undefined && typeof value.schemaVersion !== "number") {
    throw new Error("schemaVersion must be a number");
  }
  if (value.diagnostics !== undefined) {
    assertRecord(value.diagnostics, "diagnostics");
  }
}
