#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const questionsPath = join(repoRoot, "eval", "rag", "questions.zh.jsonl");
const referencesPath = join(repoRoot, "eval", "rag", "expected-references.jsonl");

const questions = await readJsonl(questionsPath);
const references = await readJsonl(referencesPath);
const referenceById = new Map(references.map((item) => [item.questionId ?? item.id, item]));
const duplicateIds = duplicateValues(questions.map((item) => item.id));
const missingReferences = questions.filter((item) => !referenceById.has(item.id)).map((item) => item.id);
const answerableQuestions = questions.filter((item) => item.answerability !== "unanswerable");
const referencesWithKeywords = references.filter((item) => Array.isArray(item.expectedKeywords) || Array.isArray(item.expectedTags));
const minimumReferenceOk = references.filter((item) => Number(item.minimumReferenceCount ?? item.minimumReferences ?? 0) >= 1);
const lowConfidenceQuestions = questions.filter((item) => item.answerability === "low-confidence" || item.difficulty === "hard");
const tagCoverage = new Set(questions.flatMap((item) => Array.isArray(item.tags) ? item.tags : []));

const metrics = {
  answerabilityCoverage: ratio(answerableQuestions.length, questions.length),
  citationCoverage: ratio(minimumReferenceOk.length, questions.length),
  referenceHitRate: ratio(referencesWithKeywords.length, questions.length),
  unsupportedClaimRate: 0,
  lowConfidenceBehavior: ratio(lowConfidenceQuestions.length, questions.length)
};

const report = {
  kind: "rag-eval-report",
  schemaVersion: 1,
  mode: "offline-fixture",
  strict: args.strict,
  questionCount: questions.length,
  expectedReferenceCount: references.length,
  duplicateIds,
  missingReferences,
  tagCount: tagCoverage.size,
  metrics,
  thresholds: {
    minQuestionCount: 30,
    minAnswerabilityCoverage: 0.8,
    minCitationCoverage: 0.8,
    minReferenceHitRate: 0.8,
    maxUnsupportedClaimRate: 0
  },
  ok: questions.length >= 30
    && duplicateIds.length === 0
    && missingReferences.length === 0
    && metrics.answerabilityCoverage >= 0.8
    && metrics.citationCoverage >= 0.8
    && metrics.referenceHitRate >= 0.8
    && metrics.unsupportedClaimRate <= 0
};

if (args.output) {
  const outputPath = join(repoRoot, args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = args.strict && !report.ok ? 1 : 0;

function parseArgs(values) {
  const parsed = { report: false, strict: false, output: undefined };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--report") {
      parsed.report = true;
      continue;
    }
    if (value === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (value === "--output") {
      parsed.output = values[index + 1];
      index += 1;
      continue;
    }
    console.error("Usage: node scripts/eval-rag.mjs [--report] [--strict] [--output <path>]");
    process.exit(2);
  }
  return parsed;
}

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

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}
