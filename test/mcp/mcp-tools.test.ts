import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../../src/index.js";
import { callMcpTool } from "../../src/mcp/tools.js";
import { handleMcpRequest } from "../../src/mcp/server.js";
import { assertMcpCommandRegistryCoverage, mcpPolicy, mcpToolManifest } from "../../src/mcp/tool-registry.js";

describe("MCP tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("readonly policy exposes only readonly tools", () => {
    const manifest = mcpToolManifest(mcpPolicy(false));

    expect(assertMcpCommandRegistryCoverage()).toBe(true);
    expect(manifest).toEqual(expect.objectContaining({ kind: "mcp-tools" }));
    expect((manifest.tools as Array<{ exposure: string }>).every((tool) => tool.exposure === "readonly")).toBe(true);
  });

  test("readonly policy rejects preview-only write tools", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await callMcpTool("apexcn_topic_create_preview", { title: "x" }, mcpPolicy(false));

    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "MCP_READONLY_BLOCKED" }) }));
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("preview-only write tools produce non-executing plans without network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await callMcpTool("apexcn_topic_create_preview", { title: "Title", content: "Body", categoryId: 4 }, mcpPolicy(true));

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      mode: "preview",
      willExecute: false,
      request: expect.objectContaining({ method: "POST", path: "/api/v1/topics" })
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("delete preview requires strong confirmation", async () => {
    await expect(callMcpTool("apexcn_topic_delete_preview", { topicId: 1 }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR" })
    }));
  });

  test("preview-only write tools reject incomplete requests", async () => {
    await expect(callMcpTool("apexcn_topic_create_preview", { title: "Title" }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR" })
    }));
  });

  test("mcp serve rejects conflicting readonly and preview-write flags", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "mcp", "serve", "--readonly", "--allow-preview-write"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("--readonly cannot be combined with --allow-preview-write");
    expect(process.exitCode).toBe(1);
  });

  test("JSON-RPC tools/list returns MCP tools", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, mcpPolicy(false));

    expect(response).toEqual(expect.objectContaining({
      jsonrpc: "2.0",
      id: 1,
      result: expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: "apexcn_search" })]) })
    }));
  });
});
