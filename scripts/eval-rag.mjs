#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const questionsPath = join(repoRoot, "eval", "rag", "questions.zh.jsonl");
const referencesPath = join(repoRoot, "eval", "rag", "expected-references.jsonl");

const questions = await readJsonl(questionsPath);
const references = await readJsonl(referencesPath);
const referenceById = new Map(references.map((item) => [item.id, item]));
const missingReferences = questions.filter((item) => !referenceById.has(item.id)).map((item) => item.id);
const duplicateIds = duplicateValues(questions.map((item) => item.id));
const tagCoverage = new Set(questions.flatMap((item) => Array.isArray(item.tags) ? item.tags : []));

const report = {
  kind: "rag-eval-baseline",
  schemaVersion: 1,
  questionCount: questions.length,
  expectedReferenceCount: references.length,
  duplicateIds,
  missingReferences,
  tagCount: tagCoverage.size,
  metrics: {
    answerability: "pending-run",
    citationCoverage: "pending-run",
    referenceHitRate: "pending-run",
    unsupportedClaimRate: "pending-run",
    lowConfidenceBehavior: "pending-run"
  },
  ok: questions.length >= 30 && duplicateIds.length === 0 && missingReferences.length === 0
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

async function readJsonl(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: ${error.message}`);
      }
    });
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}
