import { describe, expect, test } from "vitest";
import { MCP_TOOL_MANIFEST_JSON_SCHEMA, mcpPolicy, mcpToolManifest } from "../../src/mcp/tool-registry.js";

describe("MCP tool schema contract", () => {
  test("schema describes stable MCP tool manifest fields", () => {
    expect(MCP_TOOL_MANIFEST_JSON_SCHEMA).toEqual(expect.objectContaining({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: expect.arrayContaining(["kind", "schemaVersion", "policy", "tools"])
    }));
  });

  test("readonly manifest excludes preview-only tools and keeps execute disabled", () => {
    const manifest = mcpToolManifest(mcpPolicy(false)) as {
      kind: string;
      schemaVersion: number;
      policy: { allowExecuteWrite: boolean };
      tools: Array<{ name: string; exposure: string; commandId: string; inputSchema: unknown }>;
    };

    expect(manifest.kind).toBe("mcp-tools");
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.policy.allowExecuteWrite).toBe(false);
    expect(manifest.tools.every((tool) => tool.exposure === "readonly")).toBe(true);
    expect(manifest.tools.every((tool) => tool.commandId && typeof tool.inputSchema === "object")).toBe(true);
    expect(manifest.tools.map((tool) => tool.name)).not.toContain("apexcn_topic_delete_preview");
  });

  test("preview manifest includes preview-only tools with input schema", () => {
    const manifest = mcpToolManifest(mcpPolicy(true)) as {
      policy: { allowExecuteWrite: boolean };
      tools: Array<{ name: string; exposure: string; inputSchema: { required?: string[] } }>;
    };
    const deleteTool = manifest.tools.find((tool) => tool.name === "apexcn_topic_delete_preview");

    expect(manifest.policy.allowExecuteWrite).toBe(false);
    expect(deleteTool).toEqual(expect.objectContaining({
      exposure: "preview-only",
      inputSchema: expect.objectContaining({ required: expect.arrayContaining(["confirmTitle"]) })
    }));
  });
});
