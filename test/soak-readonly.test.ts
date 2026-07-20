import { describe, expect, test } from "vitest";
import { summarizeSoak } from "../scripts/soak-readonly.mjs";

function records(days: number, failures: number, diagnostic = true) {
  const total = 400;
  const start = Date.parse("2026-07-20T00:00:00.000Z");
  return Array.from({ length: total }, (_, index) => ({
    startedAt: new Date(start + (days * 86_400_000 * index) / (total - 1)).toISOString(),
    ok: index >= failures,
    diagnostic: index < failures && diagnostic ? "Run apexcn doctor --json." : undefined
  }));
}

describe("readonly soak report", () => {
  test("passes a real seven-day window at 99.5 percent with actionable failures", () => {
    const report = summarizeSoak(records(7, 2));

    expect(report).toEqual(expect.objectContaining({
      ok: true,
      elapsedDays: 7,
      operations: 400,
      failures: 2,
      successRate: 99.5,
      failuresWithActionableDiagnostics: 2
    }));
  });

  test("fails short windows, low success rates, and missing diagnostics", () => {
    expect(summarizeSoak(records(6.99, 0)).ok).toBe(false);
    expect(summarizeSoak(records(7, 3)).ok).toBe(false);
    expect(summarizeSoak(records(7, 1, false)).ok).toBe(false);
  });
});
