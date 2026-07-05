import { createHash } from "node:crypto";
import { termFrequency, tokenize } from "./tokenize.js";
import { scoreBm25, type Bm25Document } from "./bm25.js";

export type CollectionIndexRecord = {
  kind: "collection-index-record";
  schemaVersion: 1;
  engine: "bm25";
  topicId: number;
  title: string;
  url?: string;
  sourcePath: string;
  terms: Record<string, number>;
  documentLength: number;
  excerpt: string;
};

export type CollectionIndexMeta = {
  kind: "collection-index-meta";
  schemaVersion: 2;
  engine: "bm25";
  createdAt: string;
  documentCount: number;
  tokenCount: number;
  averageDocumentLength: number;
  fieldWeights: {
    title: 3;
    tags: 2;
    content: 1;
  };
  sourceCollectionHash: string;
  fields: string[];
  files: {
    index: { path: "index.jsonl"; size: number; sha256: string };
  };
};

export type CollectionQueryResult = {
  topicId: number;
  title: string;
  score: number;
  matchedTerms: string[];
  sourcePath: string;
  excerpt: string;
  url?: string;
  explain?: {
    terms: Array<{ term: string; score: number }>;
  };
  explanation?: Record<string, number>;
};

export function buildIndexRecord(input: { topicId: number; title: string; text: string; sourcePath: string; url?: string }): CollectionIndexRecord {
  const tokens = tokenize(input.text);
  return {
    kind: "collection-index-record",
    schemaVersion: 1,
    engine: "bm25",
    topicId: input.topicId,
    title: input.title,
    url: input.url,
    sourcePath: input.sourcePath,
    terms: termFrequency(tokens),
    documentLength: tokens.length,
    excerpt: excerptText(input.text)
  };
}

export function queryIndex(records: CollectionIndexRecord[], query: string, options: { topK?: number; explain?: boolean } = {}): CollectionQueryResult[] {
  const queryTerms = tokenize(query);
  const documents: Bm25Document[] = records.map((record) => ({
    id: String(record.topicId),
    terms: record.terms,
    length: record.documentLength
  }));
  const scores = scoreBm25(queryTerms, documents);
  const byId = new Map(records.map((record) => [String(record.topicId), record]));
  return scores
    .filter((score) => score.score > 0)
    .sort((left, right) => right.score - left.score || Number(left.id) - Number(right.id))
    .slice(0, options.topK ?? 10)
    .map((score) => {
      const record = byId.get(score.id);
      if (!record) {
        throw new Error(`Missing indexed record for score ${score.id}`);
      }
      const matchedTerms = Object.keys(score.contributions);
      return {
        topicId: record.topicId,
        title: record.title,
        score: score.score,
        matchedTerms,
        sourcePath: record.sourcePath,
        excerpt: record.excerpt,
        url: record.url,
        explain: options.explain ? { terms: Object.entries(score.contributions).map(([term, value]) => ({ term, score: value })) } : undefined,
        explanation: options.explain ? score.contributions : undefined
      };
    });
}

export function createIndexMeta(input: { createdAt: string; records: CollectionIndexRecord[]; sourceCollectionContent: string; indexFile: { size: number; sha256: string } }): CollectionIndexMeta {
  return {
    kind: "collection-index-meta",
    schemaVersion: 2,
    engine: "bm25",
    createdAt: input.createdAt,
    documentCount: input.records.length,
    tokenCount: input.records.reduce((sum, record) => sum + record.documentLength, 0),
    averageDocumentLength: input.records.length === 0
      ? 0
      : Number((input.records.reduce((sum, record) => sum + record.documentLength, 0) / input.records.length).toFixed(2)),
    fieldWeights: {
      title: 3,
      tags: 2,
      content: 1
    },
    sourceCollectionHash: `sha256:${sha256Hex(Buffer.from(input.sourceCollectionContent, "utf8"))}`,
    fields: ["title", "content", "tags", "category"],
    files: {
      index: { path: "index.jsonl", size: input.indexFile.size, sha256: input.indexFile.sha256 }
    }
  };
}

export function isCollectionIndexRecord(value: unknown): value is CollectionIndexRecord {
  return typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "collection-index-record"
    && (value as { schemaVersion?: unknown }).schemaVersion === 1
    && typeof (value as { topicId?: unknown }).topicId === "number"
    && typeof (value as { title?: unknown }).title === "string"
    && typeof (value as { sourcePath?: unknown }).sourcePath === "string"
    && typeof (value as { documentLength?: unknown }).documentLength === "number"
    && typeof (value as { excerpt?: unknown }).excerpt === "string"
    && typeof (value as { terms?: unknown }).terms === "object"
    && (value as { terms?: unknown }).terms !== null
    && Object.values((value as { terms: Record<string, unknown> }).terms).every((count) => typeof count === "number");
}

function excerptText(text: string): string {
  const normalized = text.replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
