import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { callMcpTool } from "../../src/mcp/tools.js";
import { mcpPolicy } from "../../src/mcp/tool-registry.js";

describe("MCP safety boundaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preview-only write tools never issue network writes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await callMcpTool("apexcn_reply_create_preview", { topicId: 1, content: "reply" }, mcpPolicy(true));

    expect(result).toEqual(expect.objectContaining({ ok: true, willExecute: false }));
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("doctor snapshot redacts environment token", async () => {
    process.env.APEXCN_API_KEY = "abcdefghijklmnopqrstuvwxyz";
    const result = await callMcpTool("apexcn_doctor_snapshot", {}, mcpPolicy(false));

    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    delete process.env.APEXCN_API_KEY;
  });

  test("the complete readonly allowlist issues no community write requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "apexcn-mcp-readonly-"));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({
      current: "test",
      profiles: {
        test: { baseUrl: "https://example.test/ords/api", token: "readonly-test-token" }
      }
    }));
    const requests: Array<{ method: string; url: string }> = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ method: init?.method ?? "GET", url });
      const body = url.includes("/api/v1/search")
        ? { items: [], requestId: "req-search" }
        : { items: [], requestId: "req-read" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);

    const calls: Array<[string, Record<string, unknown>]> = [
      ["apexcn_admin_list", {}],
      ["apexcn_search", { query: "ORDS" }],
      ["apexcn_topic_view", { topicId: 1 }],
      ["apexcn_topic_list", {}],
      ["apexcn_topic_recent", {}],
      ["apexcn_category_list", {}],
      ["apexcn_ask", { question: "ORDS 401" }],
      ["apexcn_research", { query: "ORDS" }],
      ["apexcn_doctor_snapshot", {}],
      ["apexcn_workflow_plan", { goal: "research-only", keyword: "ORDS" }]
    ];
    for (const [name, args] of calls) {
      await callMcpTool(name, args, mcpPolicy(false), { configPath });
    }

    const writeRequests = requests.filter((request) =>
      request.method !== "GET" && !request.url.includes("/api/v1/ask")
    );
    expect(writeRequests).toEqual([]);
    expect(requests.some((request) => request.method === "POST" && request.url.includes("/api/v1/ask"))).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
});
