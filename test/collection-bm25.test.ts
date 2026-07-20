import { describe, expect, test } from "vitest";
import { buildIndexRecord, createIndexMeta, queryIndex } from "../src/core/knowledge/collection-index.js";

describe("collection BM25 weighting", () => {
  test("title hits outrank body-only hits through field weights", () => {
    const titleHit = buildIndexRecord({
      topicId: 1,
      title: "ORDS 401 authentication",
      fields: {
        title: "ORDS 401 authentication",
        content: "Troubleshooting checklist"
      },
      sourcePath: "topics/1.json"
    });
    const bodyHit = buildIndexRecord({
      topicId: 2,
      title: "Generic REST notes",
      fields: {
        title: "Generic REST notes",
        content: "ORDS 401 appears in the body once"
      },
      sourcePath: "topics/2.json"
    });

    const results = queryIndex([bodyHit, titleHit], "ORDS 401", { topK: 2, explain: true });

    expect(results.map((result) => result.topicId)).toEqual([1, 2]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].explain?.terms).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "ords", score: expect.any(Number) })
    ]));
  });

  test("index meta reports the same field weights used by the indexer", () => {
    const record = buildIndexRecord({
      topicId: 1,
      title: "APEX_MAIL",
      fields: { title: "APEX_MAIL", tags: ["APEX"], content: "Mail sending" },
      sourcePath: "topics/1.json"
    });
    const meta = createIndexMeta({
      createdAt: "2026-07-05T00:00:00.000Z",
      records: [record],
      sourceCollectionContent: "{}",
      indexFile: { size: 1, sha256: "sha256:test" }
    });

    expect(meta).toEqual(expect.objectContaining({
      schemaVersion: 3,
      engine: "bm25",
      fieldWeights: { title: 3, tags: 2, content: 1 },
      averageDocumentLength: expect.any(Number)
    }));
  });
});
