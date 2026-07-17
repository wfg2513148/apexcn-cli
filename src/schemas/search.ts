import { assertArray, assertReadProvenance, assertRecord, assertString, isRecord } from "./common.js";

export function assertSearchResponse(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "search response");
  assertReadProvenance(value, "search-results");
  if (value.items !== undefined) {
    assertArray(value.items, "items");
    for (const [index, item] of value.items.entries()) {
      assertRecord(item, `items[${index}]`);
      if (item.title !== undefined) {
        assertString(item.title, `items[${index}].title`);
      }
    }
  }
  if (value.page !== undefined && !isRecord(value.page)) {
    throw new Error("page must be an object");
  }
}
