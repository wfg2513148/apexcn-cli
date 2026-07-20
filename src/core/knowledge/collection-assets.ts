import { createHash } from "node:crypto";

export type CanonicalTopicEntry = {
  id: number;
  canonicalHash: string;
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Content(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function topicCanonicalHash(artifact: unknown): string {
  if (!isRecord(artifact)) {
    throw new Error("topic artifact must be an object");
  }
  const result = isRecord(artifact.result) ? artifact.result : {};
  const topic = isRecord(result.topic) ? result.topic : result;
  return sha256Content(canonicalJson({
    id: artifact.id,
    sources: Array.isArray(artifact.sources) ? artifact.sources : [],
    topic
  }));
}

export function collectionContentHash(entries: CanonicalTopicEntry[]): string {
  return sha256Content(canonicalJson(entries
    .map((entry) => ({ id: entry.id, canonicalHash: entry.canonicalHash }))
    .sort((left, right) => left.id - right.id)));
}

export function bundleHash(payload: unknown): string {
  return sha256Content(canonicalJson(payload));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonicalValue(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
