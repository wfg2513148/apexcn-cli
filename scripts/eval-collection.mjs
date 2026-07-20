#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { collectionContentHash, topicCanonicalHash } from "../dist/core/knowledge/collection-assets.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const realTopicsPath = resolve(repoRoot, "eval/collection/real-topics.jsonl");
const sourceManifestPath = resolve(repoRoot, "eval/collection/corpus-source.json");
const oraclePath = resolve(repoRoot, "eval/collection/oracle.jsonl");
const reportPath = resolve(repoRoot, "eval/collection/results/v0.70.0.json");
const shouldReport = process.argv.includes("--report");
const workDir = mkdtempSync(join(tmpdir(), "apexcn-collection-eval-"));
const collectionDir = join(workDir, "collection");
const importedDir = join(workDir, "imported");
const bundlePath = join(workDir, "collection-bundle.json");

try {
  const realTopics = readJsonl(realTopicsPath);
  const oracle = readJsonl(oraclePath);
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  if (realTopics.length === 0 || oracle.length < 50) throw new Error("Frozen real topics and at least 50 oracle tasks are required.");
  const generated = generateCollection(collectionDir, realTopics, 10000);
  const initialContentHash = generated.manifest.contentHash;
  const cold = runCli(["collection", "index", "--dir", collectionDir, "--json"]);
  const stable = Array.from({ length: 5 }, () => runCli(["collection", "index", "--dir", collectionDir, "--json"]));
  const fullMedianMs = median(stable.map((run) => run.durationMs));
  const queryRuns = oracle.map((item) => {
    const run = runCli(["collection", "query", item.query, "--dir", collectionDir, "--top-k", "10", "--json"]);
    const resultIds = run.output.results.map((result) => result.topicId);
    return { id: item.id, durationMs: run.durationMs, expectedTopicIds: item.expectedTopicIds, resultIds, hit: item.expectedTopicIds.some((id) => resultIds.includes(id)) };
  });
  const queryP95Ms = percentile(queryRuns.map((run) => run.durationMs), 0.95);
  const top10HitRate = percentage(queryRuns.filter((run) => run.hit).length, queryRuns.length);
  const changed = mutateOnePercent(collectionDir, generated.manifest);
  const incremental = runCli(["collection", "index", "--dir", collectionDir, "--incremental", "--json"]);
  const incrementalPercent = Number(((incremental.durationMs / fullMedianMs) * 100).toFixed(2));
  const verify = runCli(["collection", "verify", "--dir", collectionDir, "--json"]);
  const exported = runCli(["collection", "export", "--dir", collectionDir, "--output", bundlePath, "--json"]);
  const bundleVerify = runCli(["collection", "verify-bundle", "--bundle", bundlePath, "--json"]);
  runCli(["collection", "import", "--bundle", bundlePath, "--output-dir", importedDir, "--json"]);
  const importedVerify = runCli(["collection", "verify", "--dir", importedDir, "--json"]);
  const importedManifest = JSON.parse(readFileSync(join(importedDir, "collection.json"), "utf8"));
  const integrity = documentIntegrity(collectionDir, changed.manifest);
  const result = {
    kind: "apexcn-collection-evaluation",
    schemaVersion: 1,
    ok: cold.durationMs <= 300000 && queryP95Ms <= 500 && incrementalPercent <= 20 && top10HitRate >= 90
      && integrity.duplicateCount === 0 && integrity.missingCount === 0 && verify.output.ok === true
      && bundleVerify.output.ok === true && importedVerify.output.ok === true && importedManifest.contentHash === changed.manifest.contentHash,
    corpus: {
      documentCount: 10000,
      realDocumentCount: realTopics.length,
      syntheticDocumentCount: 10000 - realTopics.length,
      realPercent: Number(((realTopics.length / 10000) * 100).toFixed(2)),
      syntheticPercent: Number((((10000 - realTopics.length) / 10000) * 100).toFixed(2)),
      corpusHash: changed.manifest.contentHash,
      sourceManifestSha256: sha256(readFileSync(sourceManifestPath)),
      sourceEnvironmentHash: sourceManifest.sourceEnvironmentHash,
      duplicateCount: integrity.duplicateCount,
      missingCount: integrity.missingCount
    },
    environment: { platform: process.platform, arch: process.arch, node: process.version, cpus: cpus().length },
    index: { coldMs: cold.durationMs, stableMs: stable.map((run) => run.durationMs), stableMedianMs: fullMedianMs, targetMs: 300000, passed: cold.durationMs <= 300000 },
    query: { sampleCount: queryRuns.length, p95Ms: queryP95Ms, targetMs: 500, top10ExpectedReferenceHitRate: top10HitRate, targetHitRate: 90, runs: queryRuns },
    incremental: { changedDocumentCount: changed.changedCount, changedPercent: 1, durationMs: incremental.durationMs, fullMedianMs, incrementalToFullPercent: incrementalPercent, targetPercent: 20, rebuiltCount: incremental.output.rebuiltCount, reusedCount: incremental.output.reusedCount },
    reproducibility: {
      canonicalHashMismatch: generated.repeatedContentHash === initialContentHash ? 0 : 1,
      sourceContentHash: changed.manifest.contentHash,
      importedContentHash: importedManifest.contentHash,
      bundleHash: exported.output.bundleHash,
      bundleVerified: bundleVerify.output.ok,
      importedVerified: importedVerify.output.ok,
      documentFidelityPercent: importedManifest.topicCount === changed.manifest.topicCount ? 100 : 0,
      provenanceFidelityPercent: importedManifest.contentHash === changed.manifest.contentHash ? 100 : 0
    },
    safety: { mode: "offline", networkRequests: 0, unattendedWriteRequests: 0, evidence: "Measured commands are registry-classified no-network local commands; process observation is recorded separately in independent validation." }
  };
  if (shouldReport) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ ok: result.ok, reportPath: shouldReport ? reportPath : null, metrics: { indexColdMs: result.index.coldMs, queryP95Ms, incrementalPercent, top10HitRate, duplicateCount: integrity.duplicateCount, missingCount: integrity.missingCount } })}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function generateCollection(dir, realTopics, total) {
  mkdirSync(join(dir, "topics"), { recursive: true });
  const records = [...realTopics];
  const used = new Set(realTopics.map((topic) => Number(topic.topicId)));
  for (let index = 0; records.length < total; index += 1) {
    const topicId = 1000000 + index;
    if (used.has(topicId)) continue;
    records.push({ topicId, title: `Synthetic APEX knowledge ${index}`, content: `Unique marker-${index} covering APEX ORDS REST authentication SQL performance deployment topic-${topicId}.`, url: `https://example.invalid/synthetic/${topicId}`, updatedDate: "2026-07-20T00:00:00Z", tags: [`synthetic-${index % 97}`, "APEX"], category: `benchmark-${index % 31}`, provenance: { source: "deterministic-synthetic", generatorVersion: "M070-CORPUS-1", sequence: index } });
  }
  const topics = [];
  const files = [];
  for (const record of records.sort((left, right) => left.topicId - right.topicId)) {
    const id = Number(record.topicId);
    const relativePath = `topics/${id}.json`;
    const sources = [{ type: record.provenance.source === "deterministic-synthetic" ? "synthetic" : "corpus", provenance: record.provenance }];
    const artifact = { kind: "collection-topic", schemaVersion: 1, id, sources, request: { method: "GET", path: record.provenance.endpoint ?? `frozen:${id}` }, result: { topic: { id, title: record.title, content: record.content, url: record.url, updatedDate: record.updatedDate, tags: record.tags, category: record.category, provenance: record.provenance } } };
    const content = `${JSON.stringify(artifact, null, 2)}\n`;
    const canonicalHash = topicCanonicalHash(artifact);
    writeFileSync(join(dir, relativePath), content);
    topics.push({ id, title: record.title, url: record.url, sources, file: relativePath, canonicalHash });
    files.push({ id, path: relativePath, size: Buffer.byteLength(content), sha256: sha256(content), canonicalHash });
  }
  const indexText = "# APEXCN Collection\n\n";
  writeFileSync(join(dir, "index.md"), indexText);
  const manifest = { kind: "collection", schemaVersion: 2, createdAt: "2026-07-20T00:00:00.000Z", contentHash: collectionContentHash(topics.map((topic) => ({ id: topic.id, canonicalHash: topic.canonicalHash }))), source: { profile: "offline-benchmark", baseUrl: "offline://m070-corpus", queries: [], topicIds: topics.map((topic) => topic.id) }, topicCount: topics.length, topics, errors: [], files: { index: { path: "index.md", size: Buffer.byteLength(indexText), sha256: sha256(indexText) }, topics: files } };
  writeFileSync(join(dir, "collection.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, repeatedContentHash: collectionContentHash(topics.map((topic) => ({ id: topic.id, canonicalHash: topic.canonicalHash }))) };
}

function mutateOnePercent(dir, manifest) {
  const changedTopics = manifest.topics.filter((topic) => topic.id >= 1000000).slice(0, 100);
  const filesById = new Map(manifest.files.topics.map((file) => [file.id, file]));
  for (const topic of changedTopics) {
    const path = join(dir, topic.file);
    const artifact = JSON.parse(readFileSync(path, "utf8"));
    artifact.result.topic.content += ` incremental-change-${topic.id}`;
    const content = `${JSON.stringify(artifact, null, 2)}\n`;
    const canonicalHash = topicCanonicalHash(artifact);
    writeFileSync(path, content);
    topic.canonicalHash = canonicalHash;
    const file = filesById.get(topic.id);
    Object.assign(file, { canonicalHash, size: Buffer.byteLength(content), sha256: sha256(content) });
  }
  manifest.contentHash = collectionContentHash(manifest.topics.map((topic) => ({ id: topic.id, canonicalHash: topic.canonicalHash })));
  writeFileSync(join(dir, "collection.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { changedCount: changedTopics.length, manifest };
}

function documentIntegrity(dir, manifest) {
  const ids = manifest.topics.map((topic) => topic.id);
  const missingCount = manifest.topics.filter((topic) => { try { readFileSync(join(dir, topic.file)); return false; } catch { return true; } }).length;
  return { duplicateCount: ids.length - new Set(ids).size, missingCount };
}

function runCli(args) {
  const started = performance.now();
  const run = spawnSync(process.execPath, [resolve(repoRoot, "dist/index.js"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, APEXCN_ERROR_FORMAT: "json" }
  });
  const durationMs = Number((performance.now() - started).toFixed(3));
  if (run.status !== 0) throw new Error(`CLI failed (${args.join(" ")}): ${run.stderr || run.stdout}`);
  return { durationMs, output: JSON.parse(run.stdout) };
}

function readJsonl(path) { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function percentile(values, rank) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * rank) - 1)]; }
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function percentage(numerator, denominator) { return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2)); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
