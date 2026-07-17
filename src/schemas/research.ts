import { assertArray, assertNumber, assertReadProvenance, assertRecord, assertString, isRecord } from "./common.js";

export function assertResearchBundle(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "research bundle");
  assertReadProvenance(value, "research-bundle");
  if (value.query !== undefined) {
    if (typeof value.query !== "string" && !isRecord(value.query)) {
      throw new Error("query must be a string or object");
    }
    if (isRecord(value.query) && value.query.attemptedKeywords !== undefined) {
      assertArray(value.query.attemptedKeywords, "query.attemptedKeywords");
      value.query.attemptedKeywords.forEach((item, index) => assertString(item, `query.attemptedKeywords[${index}]`));
    }
  }
  if (value.searchAttempts !== undefined) {
    assertArray(value.searchAttempts, "searchAttempts");
    value.searchAttempts.forEach((attempt, index) => {
      assertRecord(attempt, `searchAttempts[${index}]`);
      assertString(attempt.keyword, `searchAttempts[${index}].keyword`);
      assertNumber(attempt.resultCount, `searchAttempts[${index}].resultCount`);
      if (attempt.requestId !== undefined) {
        assertString(attempt.requestId, `searchAttempts[${index}].requestId`);
      }
    });
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
