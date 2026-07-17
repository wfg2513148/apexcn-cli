import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createIterationContext,
  serializeIterationContext,
  validateIterationSummary
} from "../scripts/compact-iteration-context.mjs";

const repoRoot = join(__dirname, "..");
const temporaryDirectories: string[] = [];

function loadJson(path: string) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function validSummary() {
  return {
    milestoneId: "0.2",
    enhancedCapabilities: ["Installer feedback is clearer."],
    unexpectedProblems: ["npm pack changed its JSON shape."],
    rootCauses: ["The parser assumed a single npm version."],
    preventionActions: ["Keep compatibility fixtures for supported npm versions."],
    nextMilestoneGoal: "Complete the remaining 0.2 acceptance criteria.",
    expectedResults: ["Independent novice validation passes."],
    majorRisks: ["A server contract gap may require apexcn-forums work."]
  };
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("iteration context compaction", () => {
  test("builds a bounded handoff with active issues and resume order", () => {
    const packageJson = loadJson("package.json");
    const context = createIterationContext({
      summary: validSummary(),
      packageJson,
      roadmap: loadJson("roadmap.json"),
      issues: loadJson("issues.json"),
      release: {
        tag: `v${packageJson.version}`,
        url: `https://github.com/wfg2513148/apexcn-cli/releases/tag/v${packageJson.version}`
      },
      git: {
        branch: "main",
        commit: "abc123"
      },
      generatedAt: "2026-07-17T00:00:00.000Z"
    });
    const output = serializeIterationContext(context, 12_288);

    expect(context).toEqual(expect.objectContaining({
      kind: "apexcn-iteration-context",
      schemaVersion: 1,
      release: expect.objectContaining({ version: packageJson.version, tag: `v${packageJson.version}` }),
      repository: { branch: "main", commit: "abc123" },
      activeIssues: expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), title: expect.any(String) })
      ])
    }));
    expect(context.resume.readOrder).toEqual([
      "reports/iteration-context.json",
      "roadmap.json",
      "issues.json"
    ]);
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(12_288);
  });

  test("rejects incomplete and oversized summaries", () => {
    const packageJson = loadJson("package.json");
    expect(validateIterationSummary({ milestoneId: "0.2" })).toContain(
      "enhancedCapabilities must be a non-empty string array"
    );

    const context = createIterationContext({
      summary: {
        ...validSummary(),
        enhancedCapabilities: ["x".repeat(13_000)]
      },
      packageJson,
      roadmap: loadJson("roadmap.json"),
      issues: loadJson("issues.json"),
      release: { tag: `v${packageJson.version}`, url: "https://example.test/release" },
      git: { branch: "main", commit: "abc123" }
    });

    expect(() => serializeIterationContext(context, 12_288)).toThrow(/maximum is 12288/);
  });

  test("redacts secrets before writing the handoff", () => {
    const packageJson = loadJson("package.json");
    const summary = validSummary();
    summary.unexpectedProblems = ["Authorization: Bearer top-secret-token"];
    summary.rootCauses = ["APEXCN_API_KEY=top-secret-key was present"];
    const context = createIterationContext({
      summary,
      packageJson,
      roadmap: loadJson("roadmap.json"),
      issues: loadJson("issues.json"),
      release: { tag: `v${packageJson.version}`, url: "https://example.test/release" },
      git: { branch: "main", commit: "abc123" }
    });
    const output = serializeIterationContext(context, 12_288);

    expect(output).not.toContain("top-secret-token");
    expect(output).not.toContain("top-secret-key");
    expect(output).toContain("[REDACTED]");
  });

  test("supports an offline CLI mode for deterministic tests only", () => {
    const packageJson = loadJson("package.json");
    const directory = mkdtempSync(join(tmpdir(), "apexcn-context-"));
    temporaryDirectories.push(directory);
    const summaryPath = join(directory, "summary.json");
    const outputPath = join(directory, "context.json");
    writeFileSync(summaryPath, JSON.stringify(validSummary()));

    const output = execFileSync("node", [
      "scripts/compact-iteration-context.mjs",
      "--summary",
      summaryPath,
      "--release-url",
      `https://example.test/releases/v${packageJson.version}`,
      "--output",
      outputPath,
      "--offline"
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const context = JSON.parse(readFileSync(outputPath, "utf8"));

    expect(output).toContain("Iteration context written");
    expect(context.kind).toBe("apexcn-iteration-context");
    expect(context.release.tag).toBe(`v${packageJson.version}`);
  });
});
