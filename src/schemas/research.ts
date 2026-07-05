import { assertArray, assertRecord, assertString } from "./common.js";

export function assertResearchBundle(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "research bundle");
  if (value.query !== undefined) {
    assertString(value.query, "query");
  }
  if (value.items !== undefined) {
    assertArray(value.items, "items");
  }
  if (value.topics !== undefined) {
    assertArray(value.topics, "topics");
  }
  if (value.references !== undefined) {
    assertArray(value.references, "references");
  }
}
