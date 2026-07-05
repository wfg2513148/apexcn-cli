import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, normalize, sep } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { buildIndexRecord, createIndexMeta, isCollectionIndexRecord, queryIndex, type CollectionIndexRecord } from "../core/knowledge/collection-index.js";
import { fieldText, isRecord, itemsFromData, printData, printError } from "../output.js";
import type { CommandIo } from "./auth.js";

type CollectionCommandOptions = CommandIo & {
  configPath?: string;
};

type Session = {
  profile: string;
  baseUrl: string;
  token: string;
};

type BuildOptions = {
  query?: string[];
  topicId?: number[];
  limit?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  outputDir?: string;
  json?: boolean;
};

type VerifyOptions = {
  dir: string;
  json?: boolean;
};

type IndexOptions = {
  dir: string;
  json?: boolean;
};

type QueryOptions = {
  dir: string;
  topK?: number;
  explain?: boolean;
  json?: boolean;
};

type StatsOptions = {
  dir: string;
  json?: boolean;
};

type TopicSource = {
  type: "query" | "explicit";
  query?: string;
  searchIndex?: number;
};

type FileEvidence = {
  path: string;
  sha256: string;
  size: number;
};

type CollectionIssue = {
  code: string;
  message: string;
  path?: string;
};

export function createCollectionCommand(options: CollectionCommandOptions): Command {
  const collection = new Command("collection");

  collection
    .command("build")
    .option("--query <keyword>", "search keyword; repeatable", collectText, [])
    .option("--topic-id <id>", "explicit topic id; repeatable", collectPositiveInteger, [])
    .option("--limit <n>", "topics per query, 1-10", parseCollectionLimit)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--from-date <date>", "inclusive updated-from date, YYYY-MM-DD", parseSearchDate)
    .option("--to-date <date>", "inclusive updated-to date, YYYY-MM-DD", parseSearchDate)
    .requiredOption("--output-dir <dir>", "directory for collection artifacts")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: BuildOptions) => {
      try {
        await buildCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error);
      }
    });

  collection
    .command("index")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: IndexOptions) => {
      try {
        await indexCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error);
      }
    });

  collection
    .command("query")
    .argument("<query>", "local collection query")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--top-k <n>", "maximum results, 1-50", parseTopK)
    .option("--explain", "include BM25 per-term score contribution")
    .option("--json", "pretty-print JSON")
    .action(async (query: string, commandOptions: QueryOptions) => {
      try {
        await queryCollection(options, query, commandOptions);
      } catch (error) {
        handleCollectionError(options, error);
      }
    });

  collection
    .command("stats")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: StatsOptions) => {
      try {
        await collectionStats(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error);
      }
    });

  collection
    .command("verify")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: VerifyOptions) => {
      try {
        await verifyCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error);
      }
    });

  return collection;
}

async function buildCollection(io: CollectionCommandOptions, options: BuildOptions): Promise<void> {
  const queries = (options.query ?? []).map((query) => query.trim()).filter(Boolean);
  const explicitTopicIds = options.topicId ?? [];
  if (queries.length === 0 && explicitTopicIds.length === 0) {
    printError(io, { type: "validation", message: "Provide at least one --query or --topic-id." });
    process.exitCode = 1;
    return;
  }
  if (!validateDateRange(io, options.fromDate, options.toDate)) {
    return;
  }
  const session = await loadSession(io);
  if (!session) {
    return;
  }

  const outputDir = options.outputDir ?? ".";
  const topicsDir = join(outputDir, "topics");
  await mkdir(topicsDir, { recursive: true });
  const limit = options.limit ?? 3;
  const candidates = new Map<number, TopicSource[]>();
  const errors: Array<Record<string, unknown>> = [];

  for (const query of queries) {
    const search = await requestJson(session.baseUrl, "/api/v1/search", {
      token: session.token,
      query: {
        keyword: query,
        pageSize: limit,
        categoryId: options.categoryId,
        fromDate: options.fromDate,
        toDate: options.toDate
      }
    });
    for (const [searchIndex, item] of itemsFromData(search).slice(0, limit).entries()) {
      const id = topicIdFromItem(item);
      if (id !== undefined) {
        addTopicSource(candidates, id, { type: "query", query, searchIndex });
      }
    }
  }
  for (const id of explicitTopicIds) {
    addTopicSource(candidates, id, { type: "explicit" });
  }

  const topicRecords = [];
  const topicFiles: Array<{ id: number } & FileEvidence> = [];
  for (const [id, sources] of candidates.entries()) {
    const relativePath = join("topics", `${id}.json`);
    const path = join(outputDir, relativePath);
    try {
      const result = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
      const artifact = {
        kind: "collection-topic",
        schemaVersion: 1,
        id,
        sources,
        request: { method: "GET", path: `/api/v1/topics/${id}` },
        requestId: requestIdFrom(result),
        result
      };
      const evidence = await writeJsonWithEvidence(path, artifact);
      topicFiles.push({ id, ...evidence, path: relativePath });
      topicRecords.push({
        id,
        title: topicTitle(result),
        url: topicUrl(result),
        originalUrl: topicOriginalUrl(result),
        sources,
        file: relativePath
      });
    } catch (error) {
      errors.push({
        id,
        sources,
        message: redactSecret(errorMessage(error), session.token),
        requestId: error instanceof HttpError ? error.requestId : undefined
      });
    }
  }

  const indexPath = join(outputDir, "index.md");
  const index = collectionIndexMarkdown(topicRecords, errors);
  const indexFile = { ...await writeTextWithEvidence(indexPath, index), path: "index.md" };
  const collection = {
    kind: "collection",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: {
      profile: session.profile,
      baseUrl: session.baseUrl,
      queries,
      topicIds: explicitTopicIds,
      limit,
      categoryId: options.categoryId,
      fromDate: options.fromDate,
      toDate: options.toDate
    },
    topicCount: topicRecords.length,
    topics: topicRecords,
    errors,
    files: {
      index: indexFile,
      topics: topicFiles
    }
  };
  const collectionPath = join(outputDir, "collection.json");
  await writeJsonWithEvidence(collectionPath, collection);
  if (errors.length > 0) {
    process.exitCode = 1;
  }
  printData(io, {
    kind: "collection-build",
    schemaVersion: 1,
    outputDir,
    topicCount: topicRecords.length,
    errorCount: errors.length,
    files: {
      collection: collectionPath,
      index: indexPath,
      topics: topicFiles.map((file) => file.path)
    }
  }, options.json === true);
}

async function verifyCollection(io: CommandIo, options: VerifyOptions): Promise<void> {
  const collectionPath = join(options.dir, "collection.json");
  let collection: unknown;
  try {
    collection = JSON.parse(await readFile(collectionPath, "utf8")) as unknown;
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection: ${errorMessage(error)}` });
    process.exitCode = 1;
    return;
  }
  const report = await collectionVerificationReport(options.dir, collection);
  if (!report.ok) {
    process.exitCode = 1;
  }
  printData(io, report, options.json === true);
}

async function indexCollection(io: CommandIo, options: IndexOptions): Promise<void> {
  const loaded = await readCollectionFile(io, options.dir);
  if (!loaded) {
    return;
  }
  const { collection, content } = loaded;
  const verification = await collectionVerificationReport(options.dir, collection);
  if (!verification.ok) {
    printError(io, { type: "validation", message: "Collection verification failed before indexing." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  let records: CollectionSearchRecord[];
  try {
    records = await collectionSearchRecords(options.dir, collection);
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection topic artifact: ${errorMessage(error)}` }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
  const indexEvidence = await writeTextWithEvidence(join(options.dir, "index.jsonl"), jsonl);
  const meta = createIndexMeta({
    createdAt: new Date().toISOString(),
    records,
    sourceCollectionContent: content,
    indexFile: indexEvidence
  });
  await writeJsonWithEvidence(join(options.dir, "index.meta.json"), meta);
  printData(io, {
    kind: "collection-index",
    schemaVersion: 1,
    engine: "bm25",
    dir: options.dir,
    topicCount: records.length,
    documentCount: records.length,
    tokenCount: meta.tokenCount,
    files: {
      index: join(options.dir, "index.jsonl"),
      meta: join(options.dir, "index.meta.json")
    }
  }, options.json === true);
}

async function queryCollection(io: CommandIo, query: string, options: QueryOptions): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    printError(io, { type: "validation", message: "Query must not be blank." });
    process.exitCode = 1;
    return;
  }
  let records: CollectionSearchRecord[];
  try {
    records = parseCollectionSearchRecords(await readFile(join(options.dir, "index.jsonl"), "utf8"));
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection index: ${errorMessage(error)}` });
    process.exitCode = 1;
    return;
  }
  const results = queryIndex(records, trimmed, { topK: options.topK, explain: options.explain === true });
  printData(io, {
    kind: "collection-query-result",
    schemaVersion: 1,
    engine: "bm25",
    dir: options.dir,
    query: trimmed,
    topK: options.topK ?? 10,
    resultCount: results.length,
    results
  }, options.json === true);
}

async function collectionStats(io: CommandIo, options: StatsOptions): Promise<void> {
  let records: CollectionSearchRecord[];
  let meta: unknown;
  try {
    records = parseCollectionSearchRecords(await readFile(join(options.dir, "index.jsonl"), "utf8"));
    meta = JSON.parse(await readFile(join(options.dir, "index.meta.json"), "utf8")) as unknown;
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection index: ${errorMessage(error)}` });
    process.exitCode = 1;
    return;
  }
  printData(io, {
    kind: "collection-index-stats",
    schemaVersion: 1,
    engine: "bm25",
    dir: options.dir,
    documentCount: records.length,
    averageDocumentLength: records.length === 0
      ? 0
      : Number((records.reduce((sum, record) => sum + record.documentLength, 0) / records.length).toFixed(2)),
    tokenCount: records.reduce((sum, record) => sum + record.documentLength, 0),
    uniqueTermCount: new Set(records.flatMap((record) => Object.keys(record.terms))).size,
    meta
  }, options.json === true);
}

function parseCollectionSearchRecords(text: string): CollectionSearchRecord[] {
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((item) => item.line.length > 0)
    .map((item) => {
      const parsed = JSON.parse(item.line) as unknown;
      if (!isCollectionSearchRecord(parsed)) {
        const legacy = legacyCollectionIndexRecord(parsed);
        if (!legacy) {
          throw new Error(`index.jsonl line ${item.index + 1} has an invalid schema`);
        }
        return legacy;
      }
      return parsed;
    });
}

async function collectionVerificationReport(dir: string, collection: unknown): Promise<Record<string, unknown> & { ok: boolean }> {
  const issues: CollectionIssue[] = [];
  if (!isValidCollectionSchema(collection)) {
    issues.push({ code: "invalid-collection", message: "collection.json has an invalid schema.", path: join(dir, "collection.json") });
    return verificationResult(dir, issues, []);
  }
  const topicFiles = collection.files.topics.filter(isRecord);
  const topics = collection.topics.filter(isRecord);
  if (topics.length !== topicFiles.length || collection.topicCount !== topics.length) {
    issues.push({ code: "topic-count-mismatch", message: "Collection topic count does not match topic files." });
  }
  verifyTopicCoverage(topics, topicFiles, issues);
  const evidence = [];
  evidence.push(await verifyFileEvidence(dir, collection.files.index, "index", issues));
  for (const file of topicFiles) {
    evidence.push(await verifyFileEvidence(dir, file, "topic", issues));
    await verifyTopicArtifact(dir, file, issues);
  }
  return verificationResult(dir, issues, evidence);
}

type CollectionSearchRecord = CollectionIndexRecord;

async function readCollectionFile(io: CommandIo, dir: string): Promise<{ collection: ValidCollection; content: string } | undefined> {
  const collectionPath = join(dir, "collection.json");
  let collection: unknown;
  let content: string;
  try {
    content = await readFile(collectionPath, "utf8");
    collection = JSON.parse(content) as unknown;
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection: ${errorMessage(error)}` });
    process.exitCode = 1;
    return undefined;
  }
  if (!isValidCollectionSchema(collection)) {
    printError(io, { type: "validation", message: "collection.json has an invalid schema." });
    process.exitCode = 1;
    return undefined;
  }
  return { collection, content };
}

async function collectionSearchRecords(dir: string, collection: ValidCollection): Promise<CollectionSearchRecord[]> {
  const records: CollectionSearchRecord[] = [];
  for (const topic of collection.topics.filter(isRecord)) {
    const id = typeof topic.id === "number" ? topic.id : undefined;
    const file = fieldText(topic.file);
    if (id === undefined || !file) {
      continue;
    }
    const issues: CollectionIssue[] = [];
    const resolved = collectionFilePath(dir, file, "topic", issues);
    if (!resolved) {
      throw new Error(issues[0]?.message ?? `Invalid topic file path for topic ${id}`);
    }
    const artifact = JSON.parse(await readFile(resolved.absolutePath, "utf8")) as unknown;
    const result = isRecord(artifact) ? artifact.result : undefined;
    const title = topicTitle(result) ?? fieldText(topic.title || `Topic ${id}`);
    const text = collectionRecordText(result, title);
    records.push(buildIndexRecord({
      topicId: id,
      title,
      text,
      sourcePath: file,
      url: topicUrl(result) ?? (fieldText(topic.url) || undefined)
    }));
  }
  return records;
}

function legacyCollectionIndexRecord(value: unknown): CollectionSearchRecord | undefined {
  if (!isRecord(value)
    || value.kind !== "collection-index-record"
    || value.schemaVersion !== 1
    || typeof value.topicId !== "number"
    || typeof value.title !== "string"
    || typeof value.url !== "string"
    || typeof value.excerpt !== "string"
    || !isRecord(value.terms)) {
    return undefined;
  }
  const terms: Record<string, number> = {};
  for (const [term, count] of Object.entries(value.terms)) {
    if (typeof count === "number") {
      terms[term] = count;
    }
  }
  return {
    kind: "collection-index-record",
    schemaVersion: 1,
    engine: "bm25",
    topicId: value.topicId,
    title: value.title,
    url: value.url,
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : `topics/${value.topicId}.json`,
    terms,
    documentLength: Object.values(terms).reduce((sum, count) => sum + count, 0),
    excerpt: value.excerpt
  };
}

type ValidCollection = {
  kind: "collection";
  schemaVersion: 1;
  createdAt: string;
  source: { profile: string; baseUrl: string; queries: unknown[]; topicIds: unknown[] };
  topicCount: number;
  topics: unknown[];
  errors: unknown[];
  files: { index: Record<string, unknown>; topics: unknown[] };
};

function isValidCollectionSchema(value: unknown): value is ValidCollection {
  return isRecord(value)
    && value.kind === "collection"
    && value.schemaVersion === 1
    && typeof value.createdAt === "string"
    && isRecord(value.source)
    && typeof value.source.profile === "string"
    && typeof value.source.baseUrl === "string"
    && Array.isArray(value.source.queries)
    && Array.isArray(value.source.topicIds)
    && typeof value.topicCount === "number"
    && Array.isArray(value.topics)
    && Array.isArray(value.errors)
    && isRecord(value.files)
    && isRecord(value.files.index)
    && Array.isArray(value.files.topics);
}

function verifyTopicCoverage(topics: Array<Record<string, unknown>>, topicFiles: Array<Record<string, unknown>>, issues: CollectionIssue[]): void {
  const topicIds = countedIds(topics);
  const fileIds = countedIds(topicFiles);
  for (const [id, count] of topicIds) {
    if (count > 1) {
      issues.push({ code: "duplicate-topic-entry", message: `Collection topic id is duplicated: ${id}` });
    }
    if (!fileIds.has(id)) {
      issues.push({ code: "missing-topic-file-entry", message: `Collection topic id has no topic file entry: ${id}` });
    }
  }
  for (const [id, count] of fileIds) {
    if (count > 1) {
      issues.push({ code: "duplicate-topic-file-entry", message: `Collection topic file id is duplicated: ${id}` });
    }
    if (!topicIds.has(id)) {
      issues.push({ code: "topic-count-mismatch", message: `Topic file id is not listed in collection topics: ${id}` });
    }
  }
}

function countedIds(items: Array<Record<string, unknown>>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (typeof item.id === "number") {
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    }
  }
  return counts;
}

function verificationResult(dir: string, issues: CollectionIssue[], files: Array<Record<string, unknown>>): Record<string, unknown> & { ok: boolean } {
  return {
    kind: "collection-verification",
    schemaVersion: 1,
    dir,
    ok: issues.length === 0,
    issues,
    files
  };
}

async function verifyFileEvidence(dir: string, file: Record<string, unknown>, kind: string, issues: CollectionIssue[]): Promise<Record<string, unknown>> {
  const resolved = collectionFilePath(dir, file.path, kind, issues);
  if (!resolved) {
    return { kind, exists: false };
  }
  try {
    const content = await readFile(resolved.absolutePath);
    const sha256 = sha256Hex(content);
    if (file.sha256 !== sha256) {
      issues.push({ code: kind === "topic" ? "topic-hash-mismatch" : "index-hash-mismatch", message: `${kind} file hash does not match.`, path: resolved.relativePath });
    }
    if (file.size !== content.byteLength) {
      issues.push({ code: kind === "topic" ? "topic-hash-mismatch" : "index-hash-mismatch", message: `${kind} file size does not match.`, path: resolved.relativePath });
    }
    return { kind, path: resolved.relativePath, exists: true, size: content.byteLength, sha256 };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      issues.push({ code: kind === "topic" ? "missing-topic-file" : "missing-index-file", message: `${kind} file is missing.`, path: resolved.relativePath });
      return { kind, path: resolved.relativePath, exists: false };
    }
    throw error;
  }
}

async function verifyTopicArtifact(dir: string, file: Record<string, unknown>, issues: CollectionIssue[]): Promise<void> {
  const resolved = collectionFilePath(dir, file.path, "topic", issues);
  if (!resolved) {
    return;
  }
  try {
    const artifact = JSON.parse(await readFile(resolved.absolutePath, "utf8")) as unknown;
    if (!isRecord(artifact) || artifact.kind !== "collection-topic" || artifact.schemaVersion !== 1 || artifact.id !== file.id || !Array.isArray(artifact.sources) || !isRecord(artifact.request) || artifact.request.method !== "GET" || !isRecord(artifact.result)) {
      issues.push({ code: "invalid-topic-artifact", message: "Topic artifact schema is invalid.", path: resolved.relativePath });
    }
  } catch (error) {
    issues.push({ code: "invalid-topic-artifact", message: `Topic artifact is invalid JSON: ${errorMessage(error)}`, path: resolved.relativePath });
  }
}

function collectionFilePath(dir: string, value: unknown, kind: string, issues: CollectionIssue[]): { relativePath: string; absolutePath: string } | undefined {
  const relativePath = fieldText(value);
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes("\0")) {
    issues.push({ code: kind === "topic" ? "invalid-topic-artifact" : "invalid-collection", message: `${kind} file path must be a relative path inside the collection.`, path: relativePath });
    return undefined;
  }
  const normalized = normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    issues.push({ code: kind === "topic" ? "invalid-topic-artifact" : "invalid-collection", message: `${kind} file path escapes the collection directory.`, path: relativePath });
    return undefined;
  }
  return { relativePath: normalized, absolutePath: join(dir, normalized) };
}

function collectionIndexMarkdown(topics: Array<Record<string, unknown>>, errors: Array<Record<string, unknown>>): string {
  const lines = ["# APEXCN Collection", ""];
  if (topics.length === 0) {
    lines.push("No topics were collected.", "");
  }
  for (const topic of topics) {
    lines.push(`## ${fieldText(topic.title || `Topic ${topic.id}`)}`);
    lines.push("");
    lines.push(`- ID: ${fieldText(topic.id)}`);
    if (topic.url) {
      lines.push(`- URL: ${fieldText(topic.url)}`);
    }
    if (topic.originalUrl) {
      lines.push(`- Original URL: ${fieldText(topic.originalUrl)}`);
    }
    lines.push(`- Sources: ${sourcesText(Array.isArray(topic.sources) ? topic.sources.filter(isRecord) : [])}`);
    lines.push("");
  }
  if (errors.length > 0) {
    lines.push("## Errors", "");
    for (const error of errors) {
      lines.push(`- Topic ${fieldText(error.id)}: ${fieldText(error.message)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function loadSession(options: CollectionCommandOptions): Promise<Session | undefined> {
  try {
    const config = await loadConfig(options.configPath);
    const profile = config.current;
    const current = profile ? config.profiles[profile] : undefined;
    if (!profile || !current) {
      printError(options, { type: "no-profile", message: "No active profile" });
      process.exitCode = 1;
      return undefined;
    }
    return { profile, ...current };
  } catch (error) {
    if (error instanceof ConfigFileError) {
      printError(options, { type: "config", message: error.message });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

function addTopicSource(candidates: Map<number, TopicSource[]>, id: number, source: TopicSource): void {
  const sources = candidates.get(id);
  if (sources) {
    sources.push(source);
    return;
  }
  candidates.set(id, [source]);
}

async function writeJsonWithEvidence(path: string, data: unknown): Promise<FileEvidence> {
  return writeTextWithEvidence(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeTextWithEvidence(path: string, text: string): Promise<FileEvidence> {
  const content = Buffer.from(text, "utf8");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return { path, size: content.byteLength, sha256: sha256Hex(content) };
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function topicIdFromItem(item: Record<string, unknown>): number | undefined {
  for (const key of ["id", "topicId", "threadId"]) {
    const value = item[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function topicData(data: unknown): Record<string, unknown> {
  return isRecord(data) && isRecord(data.topic) ? data.topic : isRecord(data) ? data : {};
}

function topicTitle(data: unknown): string | undefined {
  const topic = topicData(data);
  return typeof topic.title === "string" ? topic.title : undefined;
}

function topicUrl(data: unknown): string | undefined {
  const topic = topicData(data);
  return typeof topic.url === "string" ? topic.url : typeof topic.threadUrl === "string" ? topic.threadUrl : undefined;
}

function topicOriginalUrl(data: unknown): string | undefined {
  const topic = topicData(data);
  return typeof topic.originalUrl === "string" ? topic.originalUrl : undefined;
}

function requestIdFrom(data: unknown): string | undefined {
  return isRecord(data) && typeof data.requestId === "string" ? data.requestId : undefined;
}

function isCollectionSearchRecord(value: unknown): value is CollectionSearchRecord {
  return isCollectionIndexRecord(value);
}

function collectionRecordText(result: unknown, fallbackTitle: string): string {
  const topic = topicData(result);
  const parts = [
    fallbackTitle,
    topic.title,
    topic.content,
    topic.body,
    topic.summary,
    Array.isArray(topic.tags) ? topic.tags.join(" ") : undefined,
    isRecord(topic.category) ? topic.category.name : topic.category
  ];
  if (Array.isArray(topic.replies)) {
    for (const reply of topic.replies.filter(isRecord)) {
      parts.push(reply.content, reply.body);
    }
  }
  return parts.map(fieldText).filter(Boolean).join(" ");
}

function sourcesText(sources: Record<string, unknown>[]): string {
  return sources.map((source) => source.type === "query" ? `query:${fieldText(source.query)}#${fieldText(source.searchIndex)}` : "explicit").join(", ");
}

function validateDateRange(io: CommandIo, fromDate?: string, toDate?: string): boolean {
  if (fromDate && toDate && fromDate > toDate) {
    printError(io, { type: "validation", message: "--from-date must be before or equal to --to-date" });
    process.exitCode = 1;
    return false;
  }
  return true;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer: ${value}`);
  }
  return parsed;
}

function parseCollectionLimit(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 10) {
    throw new InvalidArgumentError(`Expected a limit between 1 and 10: ${value}`);
  }
  return parsed;
}

function parseTopK(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 50) {
    throw new InvalidArgumentError(`Expected --top-k between 1 and 50: ${value}`);
  }
  return parsed;
}

function parseSearchDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidArgumentError(`Expected date YYYY-MM-DD: ${value}`);
  }
  return value;
}

function collectText(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectPositiveInteger(value: string, previous: number[]): number[] {
  return [...previous, parsePositiveInteger(value)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handleCollectionError(io: CommandIo, error: unknown): void {
  if (error instanceof HttpError) {
    const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
    printError(io, {
      type: "http",
      message: redactSecret(error.message),
      status: error.status,
      requestId: error.requestId
    }, `HTTP ${error.status}: ${redactSecret(error.message)}${requestId}\n`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    printError(io, { type: error instanceof TimeoutError ? "timeout" : "network", message: error.message });
    process.exitCode = 1;
    return;
  }
  throw error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
