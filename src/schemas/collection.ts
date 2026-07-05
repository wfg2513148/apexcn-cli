import { assertArray, assertNumber, assertRecord, assertString } from "./common.js";

export function assertCollectionQueryResult(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "collection query result");
  if (value.kind !== "collection-query-result") {
    throw new Error("collection query result kind must be collection-query-result");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("collection query result schemaVersion must be 1");
  }
  if (value.engine !== "bm25") {
    throw new Error("collection query result engine must be bm25");
  }
  assertString(value.query, "query");
  assertArray(value.results, "results");
  for (const [index, result] of value.results.entries()) {
    assertRecord(result, `results[${index}]`);
    assertNumber(result.score, `results[${index}].score`);
    assertArray(result.matchedTerms, `results[${index}].matchedTerms`);
  }
}
