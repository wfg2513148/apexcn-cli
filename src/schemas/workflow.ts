import { assertArray, assertRecord, assertString } from "./common.js";

export function assertWorkflowPlan(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "workflow plan");
  assertString(value.kind, "kind");
  if (value.kind !== "workflow-plan") {
    throw new Error("workflow plan kind must be workflow-plan");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("workflow plan schemaVersion must be 1");
  }
  if (value.steps !== undefined) {
    assertArray(value.steps, "steps");
  }
}

export function assertWorkflowPreview(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "workflow preview");
  if (value.willExecute !== undefined && value.willExecute !== false) {
    throw new Error("workflow preview willExecute must be false");
  }
  if (value.request !== undefined) {
    assertRecord(value.request, "request");
  }
}
