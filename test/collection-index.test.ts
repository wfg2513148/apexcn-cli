import { describe, expect, test } from "vitest";
import { scoreBm25 } from "../src/core/knowledge/bm25.js";
import { buildIndexRecord, queryIndex } from "../src/core/knowledge/collection-index.js";
import { tokenize } from "../src/core/knowledge/tokenize.js";

describe("collection BM25 index", () => {
  test("tokenizes mixed Chinese and English search text", () => {
    expect(tokenize("ORDS 认证失败 REST API")).toEqual(expect.arrayContaining(["ords", "认证", "失败", "认证失败", "rest", "api"]));
  });

  test("BM25 ranks the more relevant document first", () => {
    const records = [
      buildIndexRecord({ topicId: 1, title: "General REST", text: "REST API overview", sourcePath: "topics/1.json" }),
      buildIndexRecord({ topicId: 2, title: "ORDS auth", text: "ORDS 认证失败 ORDS REST 401 认证", sourcePath: "topics/2.json" })
    ];

    const results = queryIndex(records, "ORDS 认证失败", { topK: 2, explain: true });

    expect(results[0]).toEqual(expect.objectContaining({ topicId: 2, matchedTerms: expect.arrayContaining(["ords", "认证", "失败"]) }));
    expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);
    expect(results[0].explanation).toEqual(expect.objectContaining({ ords: expect.any(Number) }));
  });

  test("empty collections and no-match queries return empty scores", () => {
    expect(scoreBm25(["ords"], [])).toEqual([]);
    expect(queryIndex([], "ORDS")).toEqual([]);
  });
});
