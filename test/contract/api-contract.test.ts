import { describe, expect, test } from "vitest";
import { assertAskResponse } from "../../src/schemas/ask.js";
import { assertApexcnErrorBody } from "../../src/schemas/error.js";
import { assertSearchResponse } from "../../src/schemas/search.js";
import { assertTopicResponse } from "../../src/schemas/topic.js";

describe("API response contracts", () => {
  test("search ok and empty shapes are accepted", () => {
    expect(() => assertSearchResponse({ items: [{ id: 1, title: "REST" }], page: { hasMore: false } })).not.toThrow();
    expect(() => assertSearchResponse({ items: [], page: { hasMore: false } })).not.toThrow();
  });

  test("topic and ask shapes validate required stable fields", () => {
    expect(() => assertTopicResponse({ topic: { id: 1, title: "Topic" }, replies: [] })).not.toThrow();
    expect(() => assertAskResponse({ answer: "Use ORDS privileges.", references: [{ topicId: 1 }] })).not.toThrow();
  });

  test("stable error envelope validates without exposing secrets", () => {
    expect(() => assertApexcnErrorBody({
      ok: false,
      error: { code: "HTTP_401", message: "Unauthorized", status: 401, requestId: "req-1", retryable: false }
    })).not.toThrow();
  });
});
