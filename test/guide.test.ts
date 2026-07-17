import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";
import { assertNoviceGuide } from "../src/schemas/guide.js";

describe("curated novice guides", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each(["learning", "compatibility", "deployment", "security", "performance"])(
    "prints the %s guide as a stable local JSON contract",
    async (view) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);

      await createProgram({
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      }).parseAsync(["node", "apexcn", "guide", view, "--json"]);

      const output = JSON.parse(stdout.join(""));
      expect(() => assertNoviceGuide(output)).not.toThrow();
      expect(output).toEqual(expect.objectContaining({
        kind: "novice-guide",
        schemaVersion: 1,
        view,
        steps: expect.any(Array),
        limitations: expect.arrayContaining([
          expect.stringContaining("not an Oracle support statement")
        ])
      }));
      expect(output.steps.length).toBeGreaterThan(0);
      expect(stderr).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  test("uses explicit APEX and ORDS versions in compatibility queries", async () => {
    const stdout: string[] = [];

    await createProgram({
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    }).parseAsync([
      "node",
      "apexcn",
      "guide",
      "compatibility",
      "--apex-version",
      "24.2",
      "--ords-version",
      "24.4",
      "--json"
    ]);

    const output = JSON.parse(stdout.join(""));
    expect(output.context).toEqual({ apexVersion: "24.2", ordsVersion: "24.4" });
    expect(JSON.stringify(output.steps)).toContain("APEX 24.2 ORDS 24.4");
  });

  test("prints a concise executable text checklist", async () => {
    const stdout: string[] = [];

    await createProgram({
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    }).parseAsync(["node", "apexcn", "guide", "deployment", "--format", "text"]);

    expect(stdout.join("")).toContain("APEX 部署检查清单");
    expect(stdout.join("")).toContain("apexcn research");
    expect(stdout.join("")).toContain("限制：");
  });
});
