import type { ApexcnApiClient } from "./api-client.js";

export type TopicFilters = Record<string, string | number | boolean | undefined>;

export function searchTopics(client: ApexcnApiClient, keyword: string, filters: TopicFilters = {}): Promise<unknown> {
  return client.get("/api/v1/search", { keyword, ...filters });
}

export function listTopics(client: ApexcnApiClient, filters: TopicFilters = {}): Promise<unknown> {
  return client.get("/api/v1/topics", filters);
}

export function viewTopic(client: ApexcnApiClient, topicId: number): Promise<unknown> {
  return client.get(`/api/v1/topics/${topicId}`);
}

export function recentTopics(client: ApexcnApiClient, options: { pageSize?: number; categoryId?: number; fromDate?: string; toDate?: string; cursor?: string } = {}): Promise<unknown> {
  return client.get("/api/v1/topics", options);
}

export function listCategories(client: ApexcnApiClient): Promise<unknown> {
  return client.get("/api/v1/categories");
}

export function askCommunity(client: ApexcnApiClient, input: { question: string; topK?: number; categoryId?: number; fromDate?: string; toDate?: string; tag?: string }): Promise<unknown> {
  return client.post("/api/v1/ask", input);
}

export async function researchTopics(client: ApexcnApiClient, input: { query: string; limit?: number; categoryId?: number }): Promise<unknown> {
  const limit = input.limit ?? 3;
  const search = await searchTopics(client, input.query, { pageSize: limit, categoryId: input.categoryId });
  const items = isRecord(search) && Array.isArray(search.items) ? search.items.filter(isRecord).slice(0, limit) : [];
  const topics = [];
  for (const item of items) {
    const id = topicIdFrom(item);
    if (id !== undefined) {
      topics.push(await viewTopic(client, id));
    }
  }
  return { kind: "research-core", query: input.query, items, topics };
}

function topicIdFrom(item: Record<string, unknown>): number | undefined {
  const value = item.id ?? item.topicId ?? item.threadId;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
