import { describe, expect, test } from "vitest";
import { COMMAND_DESCRIPTORS, descriptorForPath } from "../../src/core/command-registry.js";

describe("command registry", () => {
  test("describes core CLI capabilities for agent consumers", () => {
    expect(COMMAND_DESCRIPTORS.length).toBeGreaterThan(40);
    expect(descriptorForPath("topic view")).toEqual(expect.objectContaining({
      id: "topic.view",
      capability: "read",
      apiEffect: "api-read"
    }));
    expect(descriptorForPath("topic delete")).toEqual(expect.objectContaining({
      riskLevel: "destructive"
    }));
  });
});
