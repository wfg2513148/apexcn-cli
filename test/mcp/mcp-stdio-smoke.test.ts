import { describe, expect, test } from "vitest";
import { handleMcpRequest } from "../../src/mcp/server.js";
import { mcpPolicy } from "../../src/mcp/tool-registry.js";

describe("MCP stdio JSON-RPC smoke", () => {
  test("supports initialize and tools/list", async () => {
    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      result: expect.objectContaining({ serverInfo: expect.objectContaining({ name: "apexcn-cli" }) })
    }));

    await expect(handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      result: expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: "apexcn_search" })]) })
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
});
