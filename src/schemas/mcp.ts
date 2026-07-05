import { assertArray, assertRecord, assertString } from "./common.js";

export function assertMcpToolsManifest(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "mcp tools manifest");
  if (value.kind !== "mcp-tools") {
    throw new Error("mcp tools manifest kind must be mcp-tools");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("mcp tools manifest schemaVersion must be 1");
  }
  assertRecord(value.policy, "policy");
  if (value.policy.allowExecuteWrite !== false) {
    throw new Error("policy.allowExecuteWrite must be false");
  }
  assertArray(value.tools, "tools");
  for (const [index, tool] of value.tools.entries()) {
    assertRecord(tool, `tools[${index}]`);
    assertString(tool.name, `tools[${index}].name`);
    assertString(tool.description, `tools[${index}].description`);
    assertString(tool.exposure, `tools[${index}].exposure`);
    assertString(tool.commandId, `tools[${index}].commandId`);
    assertRecord(tool.inputSchema, `tools[${index}].inputSchema`);
  }
}
