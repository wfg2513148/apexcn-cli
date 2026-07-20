#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../dist/config.js";
import { requestJson } from "../dist/http.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const resultsPath = resolve(repoRoot, "eval/retrieval/results/v0.30.0-dev.json");
const questionsPath = resolve(repoRoot, "eval/retrieval/questions.zh.jsonl");
const outputPath = resolve(argumentValue("--output") ?? resolve(repoRoot, "eval/collection/real-topics.jsonl"));
const oraclePath = resolve(argumentValue("--oracle-output") ?? resolve(repoRoot, "eval/collection/oracle.jsonl"));
const manifestPath = resolve(dirname(outputPath), "corpus-source.json");
const snapshotPath = argumentValue("--from-snapshot");
const snapshotManifestPath = argumentValue("--snapshot-manifest");

const results = JSON.parse(readFileSync(resultsPath, "utf8"));
const questions = readFileSync(questionsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const oracle = questions
  .filter((question) => question.answerability === "answerable")
  .map((question) => ({
    id: question.id,
    query: question.searchQuery,
    expectedTopicIds: question.expectedTopicIds,
    minimumMatchedTerms: question.minimumMatchedTerms
  }));
const oracleText = oracle.map((record) => JSON.stringify(record)).join("\n") + "\n";
if (process.argv.includes("--oracle-only")) {
  mkdirSync(dirname(oraclePath), { recursive: true });
  writeFileSync(oraclePath, oracleText);
  process.stdout.write(`${JSON.stringify({ oracleCount: oracle.length, oraclePath, oracleSha256: sha256(oracleText) })}\n`);
  process.exit(0);
}
const topicIds = [...new Set(results.retrievalRuns.flatMap((run) => run.resultIds ?? []))].sort((left, right) => left - right);
let records = [];
let sourceEnvironment = results.environment;
let sourceEnvironmentHash = results.environmentHash;
let snapshotSource;
if (snapshotPath || snapshotManifestPath) {
  if (!snapshotPath || !snapshotManifestPath) throw new Error("--from-snapshot and --snapshot-manifest are required together.");
  const snapshotText = readFileSync(resolve(snapshotPath), "utf8");
  const snapshotManifestText = readFileSync(resolve(snapshotManifestPath), "utf8");
  const snapshotManifest = JSON.parse(snapshotManifestText);
  const snapshotRecords = snapshotText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const snapshotIds = snapshotRecords.map((record) => Number(record.topicId));
  if (snapshotRecords.length !== topicIds.length || new Set(snapshotIds).size !== topicIds.length
    || topicIds.some((topicId) => !snapshotIds.includes(topicId))
    || snapshotRecords.some((record) => record.availability !== "available")) {
    throw new Error("Snapshot must contain every frozen real topic exactly once and all must be available.");
  }
  records = snapshotRecords.map((topic) => ({
    topicId: Number(topic.topicId),
    title: text(topic.title),
    content: text(topic.content),
    url: text(topic.url),
    updatedDate: text(topic.updatedDate),
    tags: Array.isArray(topic.tags) ? topic.tags.map(text).filter(Boolean) : [],
    category: typeof topic.category === "object" && topic.category !== null ? text(topic.category.name) : text(topic.category),
    provenance: { source: "apexcn-dev-readonly-snapshot", endpoint: `/api/v1/topics/${topic.topicId}`, sourceDataset: results.dataset.version, snapshot: topic.provenance }
  }));
  sourceEnvironment = { name: snapshotManifest.environment, method: snapshotManifest.network?.method, requestCount: snapshotManifest.network?.requestCount, writeRequestCount: snapshotManifest.network?.writeRequestCount };
  sourceEnvironmentHash = snapshotManifest.environmentHash;
  snapshotSource = { jsonlSha256: sha256(snapshotText), manifestSha256: sha256(snapshotManifestText), availableCount: snapshotManifest.availableCount, unavailableCount: snapshotManifest.unavailableCount };
} else {
  const config = await loadConfig();
  const profile = config.current;
  const session = profile ? config.profiles[profile] : undefined;
  if (!profile || !session) {
    throw new Error("A configured readonly profile is required to freeze the real collection corpus.");
  }
  for (const topicId of topicIds) {
    const response = await requestJson(session.baseUrl, `/api/v1/topics/${topicId}`, { token: session.token });
    const topic = response?.topic ?? response;
    if (!topic || Number(topic.id ?? topic.topicId ?? topic.threadId) !== topicId) {
      throw new Error(`Topic ${topicId} did not return a matching public topic payload.`);
    }
    records.push({
      topicId,
      title: text(topic.title),
      content: text(topic.content ?? topic.body ?? topic.summary),
      url: text(topic.url ?? topic.threadUrl),
      updatedDate: text(topic.updatedDate ?? topic.updatedAt),
      tags: Array.isArray(topic.tags) ? topic.tags.map(text).filter(Boolean) : [],
      category: typeof topic.category === "object" && topic.category !== null ? text(topic.category.name) : text(topic.category),
      provenance: { source: "apexcn-live-readonly", endpoint: `/api/v1/topics/${topicId}`, sourceDataset: results.dataset.version, sourceEnvironmentHash: results.environmentHash }
    });
  }
}

const recordsText = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, recordsText);
writeFileSync(oraclePath, oracleText);
const manifest = {
  kind: "apexcn-collection-corpus-source",
  schemaVersion: 1,
  realTopicCount: records.length,
  syntheticTopicCount: 10000 - records.length,
  totalDocumentCount: 10000,
  realPercent: Number(((records.length / 10000) * 100).toFixed(2)),
  syntheticPercent: Number((((10000 - records.length) / 10000) * 100).toFixed(2)),
  sourceDataset: results.dataset,
  sourceScorer: results.scorer,
  sourceEnvironment,
  sourceEnvironmentHash,
  snapshotSource,
  realTopicsSha256: sha256(recordsText),
  oracleSha256: sha256(oracleText),
  integrityRules: [
    "all topic ids are unique",
    "synthetic documents use unique ids and unique content markers",
    "no repeated document is used to reach 10000 documents",
    "ranking oracle is frozen before collection implementation benchmarking"
  ]
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ realTopicCount: records.length, oracleCount: oracle.length, outputPath, oraclePath, manifestPath, realTopicsSha256: manifest.realTopicsSha256, oracleSha256: manifest.oracleSha256 })}\n`);

function text(value) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
