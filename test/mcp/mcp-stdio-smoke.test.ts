import { describe, expect, test } from "vitest";
import { handleMcpRequest } from "../../src/mcp/server.js";
import { mcpPolicy } from "../../src/mcp/tool-registry.js";
import { callMcpTool } from "../../src/mcp/tools.js";

describe("MCP stdio JSON-RPC smoke", () => {
  test("supports initialize and tools/list", async () => {
    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      result: expect.objectContaining({ serverInfo: expect.objectContaining({ name: "apexcn-cli" }) })
    }));

    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      result: expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: "apexcn_search" })]) })
    }));
  });

  test("notifications/initialized has no response", async () => {
    await expect(handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, mcpPolicy(false))).resolves.toBeUndefined();
  });

  test("returns JSON-RPC errors for parse and unsupported methods", async () => {
    await expect(handleMcpRequest({ parseError: "Unexpected token" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: -32700 })
    }));
    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 9, method: "resources/list" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: -32601 })
    }));
  });

  test("tools/call returns readonly blocked for preview tools in readonly mode", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "apexcn_topic_create_preview", arguments: { title: "T", content: "C", categoryId: 1 } }
    }, mcpPolicy(false));

    expect(response).toEqual(expect.objectContaining({
      result: expect.objectContaining({ isError: true })
    }));
  });

  test("preview tools are listed only when preview-write is enabled", async () => {
    const readonly = await handleMcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/list" }, mcpPolicy(false));
    const preview = await handleMcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/list" }, mcpPolicy(true));

    expect(JSON.stringify(readonly)).not.toContain("apexcn_topic_create_preview");
    expect(JSON.stringify(preview)).toContain("apexcn_topic_create_preview");
  });

  test("unknown tool returns ok false", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "apexcn_missing", arguments: {} }
    }, mcpPolicy(false));

    expect(response).toEqual(expect.objectContaining({
      result: expect.objectContaining({ isError: true })
    }));
    expect(JSON.stringify(response)).toContain("MCP_TOOL_NOT_FOUND");
  });

  test("doctor snapshot redacts API key", async () => {
    const previous = process.env.APEXCN_API_KEY;
    process.env.APEXCN_API_KEY = "apexcn_secret_token_123456";
    try {
      const result = await callMcpTool("apexcn_doctor_snapshot", {}, mcpPolicy(false));
      expect(JSON.stringify(result)).not.toContain("apexcn_secret_token_123456");
    } finally {
      if (previous === undefined) {
        delete process.env.APEXCN_API_KEY;
      } else {
        process.env.APEXCN_API_KEY = previous;
      }
    }
  });

  test("delete preview requires explicit confirmation", async () => {
    await expect(callMcpTool("apexcn_reply_delete_preview", { replyId: 3 }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR" })
    }));
    await expect(callMcpTool("apexcn_reply_delete_preview", { replyId: 3, confirmTitle: "delete reply" }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: true,
      willExecute: false
    }));
  });
});
