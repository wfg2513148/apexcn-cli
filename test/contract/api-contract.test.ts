import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertAskResponse } from "../../src/schemas/ask.js";
import { assertCollectionQueryResult } from "../../src/schemas/collection.js";
import { assertDoctorSnapshot } from "../../src/schemas/doctor.js";
import { assertApexcnErrorBody } from "../../src/schemas/error.js";
import { assertResearchBundle } from "../../src/schemas/research.js";
import { assertSearchResponse } from "../../src/schemas/search.js";
import { assertTopicResponse } from "../../src/schemas/topic.js";
import { assertWorkflowPlan } from "../../src/schemas/workflow.js";

const fixturesDir = join(__dirname, "..", "fixtures", "contract");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
}

describe("API response contracts", () => {
  test("search ok and empty shapes are accepted", () => {
    expect(() => assertSearchResponse({
      kind: "search-results",
      schemaVersion: 1,
      items: [{ id: 1, title: "REST" }],
      page: { hasMore: false },
      provenance: { requestIds: ["req-search"], sources: [] }
    })).not.toThrow();
    expect(() => assertSearchResponse({
      kind: "search-results",
      schemaVersion: 1,
      items: [],
      page: { hasMore: false },
      provenance: { requestIds: ["req-empty"], sources: [] }
    })).not.toThrow();
  });

  test("topic and ask shapes validate required stable fields", () => {
    expect(() => assertTopicResponse({
      kind: "topic-detail",
      schemaVersion: 1,
      topic: { id: 1, title: "Topic" },
      replies: [],
      provenance: { requestIds: ["req-topic"], sources: [] }
    })).not.toThrow();
    expect(() => assertAskResponse({
      kind: "ask-response",
      schemaVersion: 1,
      answer: "Use ORDS privileges.",
      references: [{ topicId: 1 }],
      provenance: { requestIds: ["req-ask"], sources: [] }
    })).not.toThrow();
  });

  test("stable error envelope validates without exposing secrets", () => {
    expect(() => assertApexcnErrorBody({
      ok: false,
      error: { code: "HTTP_401", message: "Unauthorized", status: 401, requestId: "req-1", retryable: false }
    })).not.toThrow();
  });

  test("fixture contracts validate public JSON shapes", () => {
    expect(() => assertSearchResponse(fixture("search.ok.json"))).not.toThrow();
    expect(() => assertSearchResponse(fixture("search.empty.json"))).not.toThrow();
    expect(() => assertTopicResponse(fixture("topic.ok.json"))).not.toThrow();
    expect(() => assertAskResponse(fixture("ask.ok.json"))).not.toThrow();
    expect(() => assertResearchBundle(fixture("research.ok.json"))).not.toThrow();
    expect(() => assertDoctorSnapshot(fixture("doctor-snapshot.ok.json"))).not.toThrow();
    expect(() => assertWorkflowPlan(fixture("workflow-plan.ok.json"))).not.toThrow();
    expect(() => assertCollectionQueryResult(fixture("collection-query.ok.json"))).not.toThrow();
    expect(() => assertApexcnErrorBody(fixture("error.http-401.json"))).not.toThrow();
  });

  test("rejects malformed research query expansion provenance", () => {
    const value = fixture("research.ok.json") as Record<string, unknown>;
    value.searchAttempts = [{ keyword: "ORDS", resultCount: "one" }];

    expect(() => assertResearchBundle(value)).toThrow("searchAttempts[0].resultCount must be a number");
  });

  test("contract validators reject missing stable fields", () => {
    expect(() => assertCollectionQueryResult({ kind: "collection-query-result", schemaVersion: 1, engine: "tfidf", query: "x", results: [] })).toThrow();
  });
});
