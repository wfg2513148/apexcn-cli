import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");

describe("RAG eval report", () => {
  test("report explains offline fixture limits", () => {
    const report = JSON.parse(execFileSync("node", ["scripts/eval-rag.mjs", "--report"], {
      cwd: repoRoot,
      encoding: "utf8"
    }));

    expect(report).toEqual(expect.objectContaining({
      kind: "rag-eval-report",
      mode: "offline-fixture",
      doesNotCallLiveApi: true,
      ok: true
    }));
    expect(report.doesNotMeasure).toContain("actual model answer correctness");
    expect(report.notMeasured).toEqual(expect.objectContaining({
      unsupportedClaimRate: expect.stringContaining("not measured")
    }));
    expect(report.metrics).not.toHaveProperty("unsupportedClaimRate");
  });

  test("strict mode fails on duplicate question ids and missing references", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-rag-eval-"));
    const questions = join(dir, "questions.jsonl");
    const references = join(dir, "references.jsonl");
    writeFileSync(questions, [
      JSON.stringify({ id: "dup", question: "ORDS 401?", tags: ["ORDS"], answerability: "answerable" }),
      JSON.stringify({ id: "dup", question: "ORDS 403?", tags: ["ORDS"], answerability: "answerable" })
    ].join("\n") + "\n");
    writeFileSync(references, `${JSON.stringify({ questionId: "other", expectedKeywords: ["ORDS"], minimumReferenceCount: 1 })}\n`);

    const result = spawnSync("node", ["scripts/eval-rag.mjs", "--strict", "--questions", questions, "--references", references], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.duplicateIds).toEqual(["dup"]);
    expect(report.missingReferences).toEqual(["dup", "dup"]);
    expect(report.ok).toBe(false);
  });
});
