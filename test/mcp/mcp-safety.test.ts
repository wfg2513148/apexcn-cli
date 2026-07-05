import { describe, expect, test, vi } from "vitest";
import { callMcpTool } from "../../src/mcp/tools.js";
import { mcpPolicy } from "../../src/mcp/tool-registry.js";

describe("MCP safety boundaries", () => {
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
});
