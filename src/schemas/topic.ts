import { assertReadProvenance, assertRecord, assertString, isRecord } from "./common.js";

export function assertTopicResponse(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "topic response");
  assertReadProvenance(value);
  const topic = isRecord(value.topic) ? value.topic : value;
  assertRecord(topic, "topic");
  if (topic.title !== undefined) {
    assertString(topic.title, "topic.title");
  }
  if (topic.id !== undefined && typeof topic.id !== "number" && typeof topic.id !== "string") {
    throw new Error("topic.id must be a number or string");
  }
}
