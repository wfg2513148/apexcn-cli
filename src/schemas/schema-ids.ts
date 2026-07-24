const LEGACY_SCHEMA_IDS: Record<string, string> = {
  ask: "ask-response-v1",
  "collection.query": "collection-query-v1",
  commands: "command-manifest-v2",
  "doctor.snapshot": "doctor-snapshot-v1",
  guide: "novice-guide-v1",
  research: "research-bundle-v1",
  search: "search-response-v1",
  "topic.view": "topic-response-v1",
  "workflow.plan": "workflow-plan-v1"
};

export function schemaIdForCommand(commandId: string): string {
  return LEGACY_SCHEMA_IDS[commandId] ?? `${commandId.replaceAll(".", "-")}-response-v1`;
}
