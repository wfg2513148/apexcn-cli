import { describe, expect, test } from "vitest";
import {
  SUPPORTED_API_CONTRACT_VERSIONS,
  assessCapabilityCompatibility
} from "../src/core/capability-compatibility.js";

function inventory(contractVersion: string, current = false) {
  return {
    kind: "capabilities",
    contractVersion,
    ...(current ? { supportedContractVersions: [...SUPPORTED_API_CONTRACT_VERSIONS] } : {}),
    capabilities: [
      { id: "personal-community", available: true, endpoints: ["/api/v1/me"] },
      { id: "notifications", available: false, unavailableReason: "NOT_IMPLEMENTED" }
    ],
    requestId: `req-${contractVersion}`
  };
}

describe("API capability compatibility window", () => {
  test("accepts current and two previous contracts", () => {
    const results = SUPPORTED_API_CONTRACT_VERSIONS.map((version, index) =>
      assessCapabilityCompatibility(inventory(version, index === 0))
    );

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.ok && result.status === "compatible")).toBe(true);
    expect(results.map((result) => result.negotiationMode)).toEqual(["versioned", "legacy", "legacy"]);
  });

  test("rejects future, too-old, malformed, and missing required capabilities", () => {
    expect(assessCapabilityCompatibility(inventory("0.9.0-candidate")).status).toBe("unsupported");
    expect(assessCapabilityCompatibility(inventory("0.4.3-candidate")).status).toBe("unsupported");
    expect(assessCapabilityCompatibility({ kind: "capabilities", contractVersion: "0.8.0-candidate" }).status).toBe("malformed");
    expect(assessCapabilityCompatibility(inventory("0.8.0-candidate", true), ["notifications"])).toEqual(expect.objectContaining({
      ok: false,
      status: "missing-capability",
      missingCapabilities: ["notifications"]
    }));
  });
});
