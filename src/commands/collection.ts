import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, normalize, sep } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { ConfigFileError } from "../config.js";
import { formatHttpErrorText, formatTransportErrorText, remediationForHttpError, remediationForTransportError, stableErrorCode } from "../core/errors.js";
import { loadRuntimeSession } from "../core/runtime-session.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { buildIndexRecord, createIndexMeta, isCollectionIndexRecord, queryIndex, type CollectionIndexRecord } from "../core/knowledge/collection-index.js";
import { bundleHash, collectionContentHash, topicCanonicalHash } from "../core/knowledge/collection-assets.js";
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
  incremental?: boolean;
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

type BundlePathOptions = {
  bundle: string;
  json?: boolean;
};

type ExportOptions = {
  dir: string;
  output: string;
  json?: boolean;
};

type ImportOptions = BundlePathOptions & {
  outputDir: string;
};

type RestoreOptions = BundlePathOptions & {
  dir: string;
};

type SyncOptions = {
  dir: string;
  json?: boolean;
};

type FavoritesOptions = {
  outputDir: string;
  pageSize?: number;
  json?: boolean;
};

type AutomationPlanOptions = {
  dir: string;
  query?: string[];
  topK?: number;
  output: string;
  json?: boolean;
};

type AutomationRunOptions = {
  plan: string;
  output: string;
  json?: boolean;
};

type TopicSource = {
  type: "query";
  query: string;
  searchIndex: number;
} | {
  type: "explicit";
} | {
  type: "favorite";
  relationCreatedDate?: string;
  provenance: Record<string, unknown>;
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
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("index")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--incremental", "reuse unchanged index records from the prior index")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: IndexOptions) => {
      try {
        await indexCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
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
        handleCollectionError(options, error, commandOptions.json);
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
        handleCollectionError(options, error, commandOptions.json);
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
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("sync")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: SyncOptions) => {
      try {
        await syncCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("favorites")
    .requiredOption("--output-dir <dir>", "directory for collection artifacts")
    .option("--page-size <n>", "favorites per page, 1-50", parsePageSize)
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: FavoritesOptions) => {
      try {
        await buildFavoritesCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("export")
    .requiredOption("--dir <dir>", "collection directory")
    .requiredOption("--output <file>", "output bundle file")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: ExportOptions) => {
      try {
        await exportCollection(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("verify-bundle")
    .requiredOption("--bundle <file>", "collection bundle file")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: BundlePathOptions) => {
      try {
        await verifyCollectionBundle(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("import")
    .requiredOption("--bundle <file>", "collection bundle file")
    .requiredOption("--output-dir <dir>", "new collection directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: ImportOptions) => {
      try {
        await importCollectionBundle(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  collection
    .command("restore")
    .requiredOption("--bundle <file>", "collection bundle file")
    .requiredOption("--dir <dir>", "collection directory to restore")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: RestoreOptions) => {
      try {
        await restoreCollectionBundle(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  const automation = collection.command("automation");
  automation
    .command("plan")
    .requiredOption("--dir <dir>", "collection directory")
    .option("--query <text>", "offline query to run; repeatable", collectText, [])
    .option("--top-k <n>", "maximum results per query, 1-50", parseTopK)
    .requiredOption("--output <file>", "automation plan file")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: AutomationPlanOptions) => {
      try {
        await createAutomationPlan(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });
  automation
    .command("run")
    .requiredOption("--plan <file>", "automation plan file")
    .requiredOption("--output <file>", "automation result file")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: AutomationRunOptions) => {
      try {
        await runAutomationPlan(options, commandOptions);
      } catch (error) {
        handleCollectionError(options, error, commandOptions.json);
      }
    });

  return collection;
}

async function buildCollection(io: CollectionCommandOptions, options: BuildOptions): Promise<void> {
  const queries = (options.query ?? []).map((query) => query.trim()).filter(Boolean);
  const explicitTopicIds = options.topicId ?? [];
  if (queries.length === 0 && explicitTopicIds.length === 0) {
    printError(io, { type: "validation", message: "Provide at least one --query or --topic-id." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  if (!validateDateRange(io, options.fromDate, options.toDate, options.json)) {
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
  const topicFiles: Array<{ id: number; canonicalHash: string } & FileEvidence> = [];
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
      const canonicalHash = topicCanonicalHash(artifact);
      const evidence = await writeJsonWithEvidence(path, artifact);
      topicFiles.push({ id, canonicalHash, ...evidence, path: relativePath });
      topicRecords.push({
        id,
        title: topicTitle(result),
        url: topicUrl(result),
        originalUrl: topicOriginalUrl(result),
        sources,
        file: relativePath,
        canonicalHash
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
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    contentHash: collectionContentHash(topicRecords.map((topic) => ({ id: topic.id, canonicalHash: topic.canonicalHash }))),
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
    printError(io, { type: "validation", message: `Invalid collection: ${errorMessage(error)}` }, undefined, options.json);
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
  const loaded = await readCollectionFile(io, options.dir, options.json);
  if (!loaded) {
    return;
  }
  const { collection, content } = loaded;
  let records: CollectionSearchRecord[];
  let rebuiltCount = 0;
  let reusedCount = 0;
  try {
    if (options.incremental) {
      const incremental = await incrementalCollectionSearchRecords(options.dir, collection);
      records = incremental.records;
      rebuiltCount = incremental.rebuiltCount;
      reusedCount = incremental.reusedCount;
    } else {
      const verification = await collectionVerificationReport(options.dir, collection);
      if (!verification.ok) {
        printError(io, { type: "validation", message: "Collection verification failed before indexing." }, undefined, options.json);
        process.exitCode = 1;
        return;
      }
      records = await collectionSearchRecords(options.dir, collection);
      rebuiltCount = records.length;
    }
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection topic artifact: ${errorMessage(error)}` }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
  const indexEvidence = await writeTextWithEvidence(join(options.dir, "index.jsonl"), jsonl);
  const meta = createIndexMeta({
    createdAt: collection.createdAt,
    records,
    sourceCollectionContent: content,
    indexFile: indexEvidence
  });
  await writeJsonWithEvidence(join(options.dir, "index.meta.json"), meta);
  printData(io, {
    kind: "collection-index",
    schemaVersion: 1,
    engine: "bm25",
    mode: options.incremental ? "incremental" : "full",
    dir: options.dir,
    topicCount: records.length,
    documentCount: records.length,
    tokenCount: meta.tokenCount,
    rebuiltCount,
    reusedCount,
    files: {
      index: join(options.dir, "index.jsonl"),
      meta: join(options.dir, "index.meta.json")
    }
  }, options.json === true);
}

async function queryCollection(io: CommandIo, query: string, options: QueryOptions): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    printError(io, { type: "validation", message: "Query must not be blank." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  let records: CollectionSearchRecord[];
  try {
    records = parseCollectionSearchRecords(await readFile(join(options.dir, "index.jsonl"), "utf8"));
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection index: ${errorMessage(error)}` }, undefined, options.json);
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
    printError(io, { type: "validation", message: `Invalid collection index: ${errorMessage(error)}` }, undefined, options.json);
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

async function syncCollection(io: CollectionCommandOptions, options: SyncOptions): Promise<void> {
  const loaded = await readCollectionFile(io, options.dir, options.json);
  if (!loaded) {
    return;
  }
  const verification = await collectionVerificationReport(options.dir, loaded.collection);
  if (!verification.ok) {
    printError(io, { type: "validation", message: "Collection verification failed before sync." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const session = await loadSession(io);
  if (!session) {
    return;
  }
  if (normalizedBaseUrl(session.baseUrl) !== normalizedBaseUrl(loaded.collection.source.baseUrl)) {
    printError(io, { type: "validation", message: "Active profile base URL does not match the collection source." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const topicFiles = loaded.collection.files.topics.filter(isRecord);
  const fileById = new Map(topicFiles.filter((file) => typeof file.id === "number").map((file) => [file.id as number, file]));
  const topics: Array<Record<string, unknown>> = [];
  const files: Array<Record<string, unknown>> = [];
  let changedCount = 0;
  let unchangedCount = 0;
  let removedCount = 0;
  for (const topic of loaded.collection.topics.filter(isRecord)) {
    const id = typeof topic.id === "number" ? topic.id : undefined;
    const relativePath = fieldText(topic.file);
    if (id === undefined || !relativePath) {
      continue;
    }
    try {
      const result = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
      const sources = Array.isArray(topic.sources) ? topic.sources : [];
      const artifact = {
        kind: "collection-topic",
        schemaVersion: 1,
        id,
        sources,
        request: { method: "GET", path: `/api/v1/topics/${id}` },
        requestId: requestIdFrom(result),
        result
      };
      const canonicalHash = topicCanonicalHash(artifact);
      if (canonicalHash === topic.canonicalHash) {
        topics.push(topic);
        const oldFile = fileById.get(id);
        if (oldFile) files.push(oldFile);
        unchangedCount += 1;
        continue;
      }
      const evidence = await writeJsonWithEvidence(join(options.dir, relativePath), artifact);
      topics.push({
        ...topic,
        title: topicTitle(result),
        url: topicUrl(result),
        originalUrl: topicOriginalUrl(result),
        canonicalHash
      });
      files.push({ id, canonicalHash, ...evidence, path: relativePath });
      changedCount += 1;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        await unlink(join(options.dir, relativePath));
        removedCount += 1;
        continue;
      }
      throw error;
    }
  }
  const indexText = collectionIndexMarkdown(topics, []);
  const indexFile = { ...await writeTextWithEvidence(join(options.dir, "index.md"), indexText), path: "index.md" };
  const updated = {
    ...loaded.collection,
    schemaVersion: 2,
    syncedAt: new Date().toISOString(),
    contentHash: collectionContentHash(topics.map((topic) => ({ id: Number(topic.id), canonicalHash: fieldText(topic.canonicalHash) }))),
    topicCount: topics.length,
    topics,
    errors: [],
    files: { index: indexFile, topics: files }
  };
  await writeJsonWithEvidence(join(options.dir, "collection.json"), updated);
  printData(io, {
    kind: "collection-sync",
    schemaVersion: 1,
    dir: options.dir,
    topicCount: topics.length,
    changedCount,
    unchangedCount,
    removedCount,
    contentHash: updated.contentHash
  }, options.json === true);
}

async function buildFavoritesCollection(io: CollectionCommandOptions, options: FavoritesOptions): Promise<void> {
  const session = await loadSession(io);
  if (!session) {
    return;
  }
  const pageSize = options.pageSize ?? 50;
  const items: Array<{ item: Record<string, unknown>; requestId?: string }> = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  do {
    const data = await requestJson(session.baseUrl, "/api/v1/me/favorites/export", {
      token: session.token,
      query: { pageSize, cursor }
    });
    pageCount += 1;
    for (const item of itemsFromData(data)) {
      items.push({ item, requestId: requestIdFrom(data) });
    }
    const page = isRecord(data) && isRecord(data.page) ? data.page : {};
    const next = typeof page.nextCursor === "string" && page.nextCursor.length > 0 ? page.nextCursor : undefined;
    if (next && seenCursors.has(next)) {
      throw new Error("Favorite export repeated a pagination cursor.");
    }
    if (next) seenCursors.add(next);
    cursor = next;
  } while (cursor);

  const topicsDir = join(options.outputDir, "topics");
  await mkdir(topicsDir, { recursive: true });
  const topics: Array<Record<string, unknown>> = [];
  const files: Array<Record<string, unknown>> = [];
  const seenIds = new Set<number>();
  const errors: Array<Record<string, unknown>> = [];
  let excludedReplyCount = 0;
  for (const { item, requestId } of items) {
    const targetType = favoriteTargetType(item);
    if (targetType === "POST") {
      excludedReplyCount += 1;
      errors.push({
        targetType,
        topicId: positiveIdFromKeys(item, ["topicId", "threadId"]),
        replyId: positiveIdFromKeys(item, ["replyId", "postId", "targetId", "id"]),
        unavailableReason: "REPLY_FAVORITE_EXCLUDED"
      });
      continue;
    }
    const id = positiveIdFromKeys(item, ["topicId", "threadId", "targetId", "id"]);
    if (id === undefined || item.unavailableReason) {
      errors.push({
        targetType: targetType ?? "THREAD",
        topicId: id,
        unavailableReason: item.unavailableReason ?? "INVALID_FAVORITE_EXPORT_ITEM"
      });
      continue;
    }
    if (seenIds.has(id)) {
      throw new Error(`Favorite export returned duplicate topic ${id}.`);
    }
    seenIds.add(id);
    const provenance = isRecord(item.provenance) ? item.provenance : { source: "favorite", topicId: id };
    const sources: TopicSource[] = [{
      type: "favorite",
      relationCreatedDate: fieldText(item.relationCreatedDate) || undefined,
      provenance
    }];
    const result = {
      requestId,
      topic: {
        id,
        title: item.title,
        content: item.content ?? item.body,
        url: item.url ?? item.threadUrl,
        originalUrl: item.originalUrl,
        relationCreatedDate: item.relationCreatedDate,
        updatedDate: item.updatedDate,
        provenance
      }
    };
    const relativePath = join("topics", `${id}.json`);
    const artifact = {
      kind: "collection-topic",
      schemaVersion: 1,
      id,
      sources,
      request: { method: "GET", path: "/api/v1/me/favorites/export" },
      requestId,
      result
    };
    const canonicalHash = topicCanonicalHash(artifact);
    const evidence = await writeJsonWithEvidence(join(options.outputDir, relativePath), artifact);
    topics.push({ id, title: item.title, url: item.url ?? item.threadUrl, sources, file: relativePath, canonicalHash });
    files.push({ id, canonicalHash, ...evidence, path: relativePath });
  }
  const indexFile = { ...await writeTextWithEvidence(join(options.outputDir, "index.md"), collectionIndexMarkdown(topics, errors)), path: "index.md" };
  const collection = {
    kind: "collection",
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    contentHash: collectionContentHash(topics.map((topic) => ({ id: Number(topic.id), canonicalHash: fieldText(topic.canonicalHash) }))),
    source: {
      profile: session.profile,
      baseUrl: session.baseUrl,
      queries: [],
      topicIds: topics.map((topic) => topic.id),
      favoriteExport: true,
      favoriteTargetPolicy: "topics-only"
    },
    topicCount: topics.length,
    excludedReplyCount,
    topics,
    errors,
    files: { index: indexFile, topics: files }
  };
  await writeJsonWithEvidence(join(options.outputDir, "collection.json"), collection);
  if (errors.length > 0) process.exitCode = 1;
  printData(io, {
    kind: "collection-favorites",
    schemaVersion: 1,
    outputDir: options.outputDir,
    topicCount: topics.length,
    excludedReplyCount,
    unavailableCount: errors.length,
    pageCount,
    contentHash: collection.contentHash
  }, options.json === true);
}

type CollectionBundle = {
  kind: "collection-bundle";
  schemaVersion: 1;
  collectionContentHash: string;
  documentCount: number;
  files: Array<{ path: string; size: number; sha256: string; content: string }>;
  bundleHash: string;
};

async function exportCollection(io: CommandIo, options: ExportOptions): Promise<void> {
  const loaded = await readCollectionFile(io, options.dir, options.json);
  if (!loaded) return;
  const verification = await collectionVerificationReport(options.dir, loaded.collection);
  if (!verification.ok) {
    printError(io, { type: "validation", message: "Collection verification failed before export." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const paths = [
    "collection.json",
    fieldText(loaded.collection.files.index.path),
    ...loaded.collection.files.topics.filter(isRecord).map((file) => fieldText(file.path)),
    "index.jsonl",
    "index.meta.json"
  ].filter(Boolean);
  const files: CollectionBundle["files"] = [];
  for (const path of [...new Set(paths)].sort()) {
    try {
      const content = await readFile(join(options.dir, path), "utf8");
      files.push({ path, size: Buffer.byteLength(content), sha256: sha256Hex(Buffer.from(content)), content });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT" || !["index.jsonl", "index.meta.json"].includes(path)) throw error;
    }
  }
  const payload = {
    kind: "collection-bundle" as const,
    schemaVersion: 1 as const,
    collectionContentHash: loaded.collection.contentHash ?? fieldText(verification.contentHash),
    documentCount: loaded.collection.topicCount,
    files
  };
  const bundle: CollectionBundle = { ...payload, bundleHash: bundleHash(payload) };
  await writeJsonWithEvidence(options.output, bundle);
  printData(io, { kind: "collection-export", schemaVersion: 1, output: options.output, documentCount: bundle.documentCount, bundleHash: bundle.bundleHash }, options.json === true);
}

async function verifyCollectionBundle(io: CommandIo, options: BundlePathOptions): Promise<void> {
  const report = await bundleVerificationReport(options.bundle);
  if (!report.ok) process.exitCode = 1;
  printData(io, report, options.json === true);
}

async function importCollectionBundle(io: CommandIo, options: ImportOptions): Promise<void> {
  const bundle = await readVerifiedBundle(options.bundle);
  if (!bundle) {
    printError(io, { type: "validation", message: "Collection bundle verification failed." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  let entries: string[] = [];
  try {
    entries = await readdir(options.outputDir);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  if (entries.length > 0) {
    printError(io, { type: "validation", message: "Import output directory must be empty." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  await mkdir(options.outputDir, { recursive: true });
  await writeBundleFiles(options.outputDir, bundle);
  const collection = JSON.parse(await readFile(join(options.outputDir, "collection.json"), "utf8")) as unknown;
  const verification = await collectionVerificationReport(options.outputDir, collection);
  if (!verification.ok) {
    printError(io, { type: "validation", message: "Imported collection verification failed." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  printData(io, { kind: "collection-import", schemaVersion: 1, outputDir: options.outputDir, documentCount: bundle.documentCount, restoredFileCount: bundle.files.length }, options.json === true);
}

async function restoreCollectionBundle(io: CommandIo, options: RestoreOptions): Promise<void> {
  const bundle = await readVerifiedBundle(options.bundle);
  if (!bundle) {
    printError(io, { type: "validation", message: "Collection bundle verification failed." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  await writeBundleFiles(options.dir, bundle);
  const collection = JSON.parse(await readFile(join(options.dir, "collection.json"), "utf8")) as unknown;
  const verification = await collectionVerificationReport(options.dir, collection);
  if (!verification.ok) {
    printError(io, { type: "validation", message: "Restored collection verification failed." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  printData(io, { kind: "collection-restore", schemaVersion: 1, dir: options.dir, documentCount: bundle.documentCount, restoredFileCount: bundle.files.length }, options.json === true);
}

async function bundleVerificationReport(path: string): Promise<Record<string, unknown> & { ok: boolean }> {
  const issues: Array<{ code: string; path?: string }> = [];
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return { kind: "collection-bundle-verification", schemaVersion: 1, ok: false, documentCount: 0, issues: [{ code: "invalid-bundle" }] };
  }
  if (!isCollectionBundle(value)) {
    return { kind: "collection-bundle-verification", schemaVersion: 1, ok: false, documentCount: 0, issues: [{ code: "invalid-bundle" }] };
  }
  const payload = { kind: value.kind, schemaVersion: value.schemaVersion, collectionContentHash: value.collectionContentHash, documentCount: value.documentCount, files: value.files };
  if (bundleHash(payload) !== value.bundleHash) issues.push({ code: "bundle-hash-mismatch" });
  const seenPaths = new Set<string>();
  for (const file of value.files) {
    if (seenPaths.has(file.path)) issues.push({ code: "duplicate-path", path: file.path });
    seenPaths.add(file.path);
    if (!safeRelativePath(file.path)) issues.push({ code: "unsafe-path", path: file.path });
    if (Buffer.byteLength(file.content) !== file.size || sha256Hex(Buffer.from(file.content)) !== file.sha256) {
      issues.push({ code: "file-hash-mismatch", path: file.path });
    }
  }
  verifyEmbeddedBundle(value, issues);
  return { kind: "collection-bundle-verification", schemaVersion: 1, ok: issues.length === 0, documentCount: value.documentCount, collectionContentHash: value.collectionContentHash, bundleHash: value.bundleHash, fileCount: value.files.length, issues };
}

function verifyEmbeddedBundle(bundle: CollectionBundle, issues: Array<{ code: string; path?: string }>): void {
  const collectionFile = bundle.files.find((file) => file.path === "collection.json");
  if (!collectionFile) {
    issues.push({ code: "missing-collection-manifest", path: "collection.json" });
    return;
  }
  let collection: unknown;
  try {
    collection = JSON.parse(collectionFile.content) as unknown;
  } catch {
    issues.push({ code: "invalid-collection-manifest", path: "collection.json" });
    return;
  }
  if (!isValidCollectionSchema(collection)) {
    issues.push({ code: "invalid-collection-manifest", path: "collection.json" });
    return;
  }
  if (collection.topicCount !== bundle.documentCount || (collection.contentHash ?? "") !== bundle.collectionContentHash) {
    issues.push({ code: "bundle-collection-mismatch", path: "collection.json" });
  }
  const collectionTopics = collection.topics.filter(isRecord);
  const collectionTopicFiles = collection.files.topics.filter(isRecord);
  if (collectionTopics.length !== collection.topicCount || collectionTopicFiles.length !== collection.topicCount) {
    issues.push({ code: "bundle-topic-count-mismatch", path: "collection.json" });
  }
  const topicCounts = countedIds(collectionTopics);
  const fileCounts = countedIds(collectionTopicFiles);
  if ([...topicCounts.values(), ...fileCounts.values()].some((count) => count !== 1)
    || [...topicCounts.keys()].some((id) => !fileCounts.has(id))
    || [...fileCounts.keys()].some((id) => !topicCounts.has(id))) {
    issues.push({ code: "bundle-topic-coverage-mismatch", path: "collection.json" });
  }
  const topicsById = new Map(collectionTopics.filter((topic) => typeof topic.id === "number").map((topic) => [topic.id as number, topic]));
  const filesByPath = new Map(bundle.files.map((file) => [file.path, file]));
  const canonicalEntries: Array<{ id: number; canonicalHash: string }> = [];
  for (const evidence of [collection.files.index, ...collection.files.topics.filter(isRecord)]) {
    const path = fieldText(evidence.path);
    const file = filesByPath.get(path);
    if (!file) {
      issues.push({ code: "missing-managed-file", path });
      continue;
    }
    if (evidence.size !== file.size || evidence.sha256 !== file.sha256) {
      issues.push({ code: "manifest-file-mismatch", path });
    }
    if (path.startsWith("topics/")) {
      try {
        const artifact = JSON.parse(file.content) as unknown;
        const canonicalHash = topicCanonicalHash(artifact);
        const id = isRecord(artifact) && typeof artifact.id === "number" ? artifact.id : undefined;
        if (id !== undefined) canonicalEntries.push({ id, canonicalHash });
        if (collection.schemaVersion === 2 && evidence.canonicalHash !== canonicalHash) {
          issues.push({ code: "canonical-hash-mismatch", path });
        }
        if (collection.schemaVersion === 2 && id !== undefined && topicsById.get(id)?.canonicalHash !== canonicalHash) {
          issues.push({ code: "topic-canonical-hash-mismatch", path });
        }
      } catch {
        issues.push({ code: "invalid-topic-artifact", path });
      }
    }
  }
  if (collection.schemaVersion === 2 && collectionContentHash(canonicalEntries) !== collection.contentHash) {
    issues.push({ code: "content-hash-mismatch", path: "collection.json" });
  }
}

async function readVerifiedBundle(path: string): Promise<CollectionBundle | undefined> {
  const report = await bundleVerificationReport(path);
  if (!report.ok) return undefined;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isCollectionBundle(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function writeBundleFiles(dir: string, bundle: CollectionBundle): Promise<void> {
  for (const file of bundle.files) {
    if (!safeRelativePath(file.path)) throw new Error(`Unsafe bundle path: ${file.path}`);
    const path = join(dir, normalize(file.path));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, file.content, "utf8");
  }
}

function isCollectionBundle(value: unknown): value is CollectionBundle {
  return isRecord(value)
    && value.kind === "collection-bundle"
    && value.schemaVersion === 1
    && typeof value.collectionContentHash === "string"
    && typeof value.documentCount === "number"
    && typeof value.bundleHash === "string"
    && Array.isArray(value.files)
    && value.files.every((file) => isRecord(file) && typeof file.path === "string" && typeof file.size === "number" && typeof file.sha256 === "string" && typeof file.content === "string");
}

function safeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\0")) return false;
  const normalized = normalize(path);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

function normalizedBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function createAutomationPlan(io: CommandIo, options: AutomationPlanOptions): Promise<void> {
  const loaded = await readCollectionFile(io, options.dir, options.json);
  if (!loaded) return;
  const payload = {
    kind: "collection-automation-plan" as const,
    schemaVersion: 1 as const,
    mode: "offline" as const,
    collectionDir: options.dir,
    queries: (options.query ?? []).map((query) => ({ query: query.trim(), topK: options.topK ?? 10 })).filter((item) => item.query.length > 0)
  };
  const plan = { ...payload, planHash: bundleHash(payload) };
  await writeJsonWithEvidence(options.output, plan);
  printData(io, { kind: "collection-automation-plan", schemaVersion: 1, output: options.output, planHash: plan.planHash, networkRequests: 0, unattendedWriteRequests: 0 }, options.json === true);
}

async function runAutomationPlan(io: CommandIo, options: AutomationRunOptions): Promise<void> {
  const plan = JSON.parse(await readFile(options.plan, "utf8")) as unknown;
  if (!isAutomationPlan(plan)) {
    printError(io, { type: "validation", message: "Invalid collection automation plan." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const payload = { kind: plan.kind, schemaVersion: plan.schemaVersion, mode: plan.mode, collectionDir: plan.collectionDir, queries: plan.queries };
  if (bundleHash(payload) !== plan.planHash) {
    printError(io, { type: "validation", message: "Collection automation plan hash mismatch." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const loaded = await readCollectionFile(io, plan.collectionDir, options.json);
  if (!loaded) return;
  const verification = await collectionVerificationReport(plan.collectionDir, loaded.collection);
  if (!verification.ok) {
    printError(io, { type: "validation", message: "Collection verification failed before automation." }, undefined, options.json);
    process.exitCode = 1;
    return;
  }
  const executionHash = bundleHash({ planHash: plan.planHash, contentHash: loaded.collection.contentHash ?? verification.contentHash });
  try {
    const existing = JSON.parse(await readFile(options.output, "utf8")) as unknown;
    if (isRecord(existing) && existing.executionHash === executionHash) {
      printData(io, { ...existing, duplicateSuppressed: true }, options.json === true);
      return;
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  await indexCollection({ stdout: () => undefined, stderr: io.stderr }, { dir: plan.collectionDir, incremental: true, json: true });
  const records = parseCollectionSearchRecords(await readFile(join(plan.collectionDir, "index.jsonl"), "utf8"));
  const queries = plan.queries.map((item) => ({ query: item.query, results: queryIndex(records, item.query, { topK: item.topK }) }));
  const result = {
    kind: "collection-automation-result",
    schemaVersion: 1,
    mode: "offline",
    planHash: plan.planHash,
    executionHash,
    contentHash: loaded.collection.contentHash ?? verification.contentHash,
    documentCount: loaded.collection.topicCount,
    queries,
    networkRequests: 0,
    unattendedWriteRequests: 0,
    duplicateSuppressed: false
  };
  await writeJsonWithEvidence(options.output, result);
  printData(io, result, options.json === true);
}

function isAutomationPlan(value: unknown): value is { kind: "collection-automation-plan"; schemaVersion: 1; mode: "offline"; collectionDir: string; queries: Array<{ query: string; topK: number }>; planHash: string } {
  return isRecord(value)
    && value.kind === "collection-automation-plan"
    && value.schemaVersion === 1
    && value.mode === "offline"
    && typeof value.collectionDir === "string"
    && typeof value.planHash === "string"
    && Array.isArray(value.queries)
    && value.queries.every((item) => isRecord(item) && typeof item.query === "string" && typeof item.topK === "number");
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
  const canonicalEntries: Array<{ id: number; canonicalHash: string }> = [];
  evidence.push(await verifyFileEvidence(dir, collection.files.index, "index", issues));
  for (const file of topicFiles) {
    evidence.push(await verifyFileEvidence(dir, file, "topic", issues));
    const canonicalHash = await verifyTopicArtifact(dir, file, issues);
    if (canonicalHash && typeof file.id === "number") {
      canonicalEntries.push({ id: file.id, canonicalHash });
      if (collection.schemaVersion === 2 && file.canonicalHash !== canonicalHash) {
        issues.push({ code: "canonical-hash-mismatch", message: "Topic canonical hash does not match.", path: fieldText(file.path) });
      }
    }
  }
  const computedContentHash = collectionContentHash(canonicalEntries);
  if (collection.schemaVersion === 2 && collection.contentHash !== computedContentHash) {
    issues.push({ code: "content-hash-mismatch", message: "Collection content hash does not match canonical topic content." });
  }
  return { ...verificationResult(dir, issues, evidence), contentHash: computedContentHash };
}

type CollectionSearchRecord = CollectionIndexRecord;

async function readCollectionFile(io: CommandIo, dir: string, json?: boolean): Promise<{ collection: ValidCollection; content: string } | undefined> {
  const collectionPath = join(dir, "collection.json");
  let collection: unknown;
  let content: string;
  try {
    content = await readFile(collectionPath, "utf8");
    collection = JSON.parse(content) as unknown;
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid collection: ${errorMessage(error)}` }, undefined, json);
    process.exitCode = 1;
    return undefined;
  }
  if (!isValidCollectionSchema(collection)) {
    printError(io, { type: "validation", message: "collection.json has an invalid schema." }, undefined, json);
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
    const topicDataRecord = topicData(result);
    const title = topicTitle(result) ?? fieldText(topic.title || `Topic ${id}`);
    records.push(buildIndexRecord({
      topicId: id,
      title,
      fields: collectionRecordFields(topicDataRecord, title),
      sourcePath: file,
      sourceHash: typeof topic.canonicalHash === "string" ? topic.canonicalHash : topicCanonicalHash(artifact),
      url: topicUrl(result) ?? (fieldText(topic.url) || undefined)
    }));
  }
  return records;
}

async function incrementalCollectionSearchRecords(dir: string, collection: ValidCollection): Promise<{ records: CollectionSearchRecord[]; rebuiltCount: number; reusedCount: number }> {
  let previous: CollectionSearchRecord[] = [];
  try {
    previous = parseCollectionSearchRecords(await readFile(join(dir, "index.jsonl"), "utf8"));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  const previousById = new Map(previous.map((record) => [record.topicId, record]));
  const records: CollectionSearchRecord[] = [];
  let rebuiltCount = 0;
  let reusedCount = 0;
  for (const topic of collection.topics.filter(isRecord).sort((left, right) => Number(left.id) - Number(right.id))) {
    const id = typeof topic.id === "number" ? topic.id : undefined;
    const canonicalHash = fieldText(topic.canonicalHash);
    const old = id === undefined ? undefined : previousById.get(id);
    if (old && canonicalHash && old.sourceHash === canonicalHash) {
      records.push(old);
      reusedCount += 1;
      continue;
    }
    const singleCollection = { ...collection, topics: [topic] };
    const [record] = await collectionSearchRecords(dir, singleCollection);
    if (record) {
      records.push(record);
      rebuiltCount += 1;
    }
  }
  return { records, rebuiltCount, reusedCount };
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
  schemaVersion: 1 | 2;
  createdAt: string;
  contentHash?: string;
  source: { profile: string; baseUrl: string; queries: unknown[]; topicIds: unknown[] };
  topicCount: number;
  topics: unknown[];
  errors: unknown[];
  files: { index: Record<string, unknown>; topics: unknown[] };
};

function isValidCollectionSchema(value: unknown): value is ValidCollection {
  return isRecord(value)
    && value.kind === "collection"
    && (value.schemaVersion === 1 || value.schemaVersion === 2)
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
    && Array.isArray(value.files.topics)
    && (value.schemaVersion === 1 || typeof value.contentHash === "string");
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

async function verifyTopicArtifact(dir: string, file: Record<string, unknown>, issues: CollectionIssue[]): Promise<string | undefined> {
  const resolved = collectionFilePath(dir, file.path, "topic", issues);
  if (!resolved) {
    return undefined;
  }
  try {
    const artifact = JSON.parse(await readFile(resolved.absolutePath, "utf8")) as unknown;
    if (!isRecord(artifact) || artifact.kind !== "collection-topic" || artifact.schemaVersion !== 1 || artifact.id !== file.id || !Array.isArray(artifact.sources) || !isRecord(artifact.request) || artifact.request.method !== "GET" || !isRecord(artifact.result)) {
      issues.push({ code: "invalid-topic-artifact", message: "Topic artifact schema is invalid.", path: resolved.relativePath });
      return undefined;
    }
    return topicCanonicalHash(artifact);
  } catch (error) {
    issues.push({ code: "invalid-topic-artifact", message: `Topic artifact is invalid JSON: ${errorMessage(error)}`, path: resolved.relativePath });
    return undefined;
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
    const runtime = await loadRuntimeSession(options.configPath);
    if (!runtime.ok) {
      printError(options, {
        type: "no-profile",
        message: runtime.reason === "no-profile" ? "No active profile" : `No credential is available for profile ${runtime.profile}`
      });
      process.exitCode = 1;
      return undefined;
    }
    return runtime.session;
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
  for (const key of ["id", "topicId", "threadId", "targetId"]) {
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

function favoriteTargetType(item: Record<string, unknown>): "THREAD" | "POST" | undefined {
  const value = fieldText(item.targetType ?? item.objectType ?? item.favoriteType).trim().toUpperCase();
  if (value === "POST" || value === "REPLY") {
    return "POST";
  }
  if (value === "THREAD" || value === "TOPIC") {
    return "THREAD";
  }
  return positiveIdFromKeys(item, ["replyId", "postId"]) === undefined ? undefined : "POST";
}

function positiveIdFromKeys(item: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
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

function collectionRecordFields(topic: Record<string, unknown>, fallbackTitle: string): { title: string; tags: string[]; category?: string; content: string; replies: string } {
  const replies = [];
  if (Array.isArray(topic.replies)) {
    for (const reply of topic.replies.filter(isRecord)) {
      replies.push(fieldText(reply.content), fieldText(reply.body));
    }
  }
  return {
    title: fieldText(topic.title) || fallbackTitle,
    tags: Array.isArray(topic.tags) ? topic.tags.map(fieldText).filter(Boolean) : [],
    category: isRecord(topic.category) ? fieldText(topic.category.name) : fieldText(topic.category) || undefined,
    content: [topic.content, topic.body, topic.summary].map(fieldText).filter(Boolean).join(" "),
    replies: replies.filter(Boolean).join(" ")
  };
}

function sourcesText(sources: Record<string, unknown>[]): string {
  return sources.map((source) => source.type === "query"
    ? `query:${fieldText(source.query)}#${fieldText(source.searchIndex)}`
    : source.type === "favorite"
      ? `favorite:${fieldText(source.relationCreatedDate)}`
      : "explicit").join(", ");
}

function validateDateRange(io: CommandIo, fromDate?: string, toDate?: string, json?: boolean): boolean {
  if (fromDate && toDate && fromDate > toDate) {
    printError(io, { type: "validation", message: "--from-date must be before or equal to --to-date" }, undefined, json);
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

function parsePageSize(value: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed > 50) {
    throw new InvalidArgumentError(`Expected --page-size between 1 and 50: ${value}`);
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

function handleCollectionError(io: CommandIo, error: unknown, json?: boolean): void {
  if (error instanceof HttpError) {
    printError(io, {
      type: "http",
      code: stableErrorCode(error),
      message: redactSecret(error.message),
      status: error.status,
      requestId: error.requestId,
      remediation: remediationForHttpError(error)
    }, formatHttpErrorText(error), json);
    process.exitCode = 1;
    return;
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    printError(io, {
      type: error instanceof TimeoutError ? "timeout" : "network",
      code: stableErrorCode(error),
      message: error.message,
      remediation: remediationForTransportError(error)
    }, formatTransportErrorText(error), json);
    process.exitCode = 1;
    return;
  }
  throw error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
