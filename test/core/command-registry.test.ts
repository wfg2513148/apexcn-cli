import { describe, expect, test } from "vitest";
import { COMMAND_DESCRIPTORS, descriptorForPath, mcpPreviewDescriptors, mcpReadonlyDescriptors } from "../../src/core/command-registry.js";

describe("command registry", () => {
  test("describes core CLI capabilities for agent consumers", () => {
    expect(COMMAND_DESCRIPTORS.length).toBeGreaterThan(40);
    expect(descriptorForPath("topic view")).toEqual(expect.objectContaining({
      id: "topic.view",
      capability: "read",
      apiEffect: "api-read",
      mcpExposure: "readonly"
    }));
    expect(descriptorForPath("topic delete")).toEqual(expect.objectContaining({
      riskLevel: "destructive",
      mcpExposure: "preview-only"
    }));
  });

  test("separates readonly and preview-only MCP exposures", () => {
    expect(mcpReadonlyDescriptors().map((item) => item.id)).toContain("search");
    expect(mcpPreviewDescriptors().map((item) => item.id)).toContain("topic.create");
    expect(mcpReadonlyDescriptors().some((item) => item.apiEffect === "destructive")).toBe(false);
  });
});
