import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertAskResponse } from "../../src/schemas/ask.js";
import { assertCollectionQueryResult } from "../../src/schemas/collection.js";
import { assertDoctorSnapshot } from "../../src/schemas/doctor.js";
import { assertApexcnErrorBody } from "../../src/schemas/error.js";
import { assertMcpToolsManifest } from "../../src/schemas/mcp.js";
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

  test("fixture contracts validate public JSON shapes", () => {
    expect(() => assertSearchResponse(fixture("search.ok.json"))).not.toThrow();
    expect(() => assertSearchResponse(fixture("search.empty.json"))).not.toThrow();
    expect(() => assertTopicResponse(fixture("topic.ok.json"))).not.toThrow();
    expect(() => assertAskResponse(fixture("ask.ok.json"))).not.toThrow();
    expect(() => assertResearchBundle(fixture("research.ok.json"))).not.toThrow();
    expect(() => assertDoctorSnapshot(fixture("doctor-snapshot.ok.json"))).not.toThrow();
    expect(() => assertWorkflowPlan(fixture("workflow-plan.ok.json"))).not.toThrow();
    expect(() => assertCollectionQueryResult(fixture("collection-query.ok.json"))).not.toThrow();
    expect(() => assertMcpToolsManifest(fixture("mcp-tools.ok.json"))).not.toThrow();
    expect(() => assertApexcnErrorBody(fixture("error.http-401.json"))).not.toThrow();
  });

  test("contract validators reject missing stable fields", () => {
    expect(() => assertCollectionQueryResult({ kind: "collection-query-result", schemaVersion: 1, engine: "tfidf", query: "x", results: [] })).toThrow();
    expect(() => assertMcpToolsManifest({ kind: "mcp-tools", schemaVersion: 1, policy: { allowExecuteWrite: true }, tools: [] })).toThrow();
  });
});
