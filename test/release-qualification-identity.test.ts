import { describe, expect, test } from "vitest";
import { releaseQualificationIdentityMatches } from "../scripts/release-qualification-identity.mjs";

describe("packaged release qualification identity", () => {
  const oldContract = {
    targetVersion: "1.2.2",
    current: { exactTaskCount: 202 },
    approvedAdditions: [{ commandId: "admin.operations" }, { commandId: "update" }]
  };
  const nextContract = {
    targetVersion: "1.3.0",
    current: { exactTaskCount: 204 },
    approvedAdditions: [{ commandId: "admin.operations" }, { commandId: "update" }, { commandId: "admin.operations-v2" }]
  };

  test("accepts the frozen 1.2 and planned 1.3 identities", () => {
    expect(releaseQualificationIdentityMatches({ targetVersion: "1.1.5", current: { exactTaskCount: 200 }, approvedAdditions: [{ commandId: "admin.operations" }] }, "1.1.5")).toBe(true);
    expect(releaseQualificationIdentityMatches(oldContract, "1.2.2")).toBe(true);
    expect(releaseQualificationIdentityMatches(nextContract, "1.3.0")).toBe(true);
  });

  test("rejects wrong versions, denominators, missing or extra additions, and unknown release lines", () => {
    expect(releaseQualificationIdentityMatches(nextContract, "1.2.2")).toBe(false);
    expect(releaseQualificationIdentityMatches({ ...nextContract, current: { exactTaskCount: 202 } }, "1.3.0")).toBe(false);
    expect(releaseQualificationIdentityMatches({ ...nextContract, approvedAdditions: nextContract.approvedAdditions.slice(0, 2) }, "1.3.0")).toBe(false);
    expect(releaseQualificationIdentityMatches({ ...nextContract, approvedAdditions: [...nextContract.approvedAdditions, { commandId: "unexpected" }] }, "1.3.0")).toBe(false);
    expect(releaseQualificationIdentityMatches({ ...nextContract, targetVersion: "1.4.0" }, "1.4.0")).toBe(false);
  });
});
