import { COMMAND_DESCRIPTORS } from "../core/command-registry.js";
import { COMMAND_MANIFEST_JSON_SCHEMA } from "./command-manifest.js";
import { APEXCN_ERROR_JSON_SCHEMA } from "./error.js";
import { NOVICE_GUIDE_JSON_SCHEMA } from "./guide.js";
import { schemaIdForCommand } from "./schema-ids.js";

export { schemaIdForCommand } from "./schema-ids.js";

type PublicJsonSchema = Record<string, unknown> & {
  $schema: string;
  $id: string;
  title: string;
  type: "object";
  "x-apexcn-schema-version": number;
  "x-apexcn-command-ids": string[];
};

export type PublicSchemaSummary = {
  id: string;
  version: number;
  commandIds: string[];
  title: string;
};

const SCHEMA_BASE_URL = "https://github.com/wfg2513148/apexcn-cli/schemas";

const COMMON_PROPERTIES = {
  kind: { type: "string" },
  schemaVersion: { type: "integer", minimum: 1 },
  requestId: { type: "string" },
  requestIds: {
    anyOf: [
      { type: "array", items: { type: "string" } },
      { type: "object", additionalProperties: true }
    ]
  },
  provenance: { type: "object", additionalProperties: true },
  items: { type: "array" },
  page: { type: "object", additionalProperties: true },
  errors: { type: "array" }
} as const;

const schemaEntries = COMMAND_DESCRIPTORS
  .filter((command) => command.supportsJson)
  .map((command) => {
    const id = schemaIdForCommand(command.id);
    const baseSchema = legacySchema(id);
    const schema: PublicJsonSchema = {
      ...baseSchema,
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: `${SCHEMA_BASE_URL}/${id}.schema.json`,
      title: `apexcn-cli ${command.path.join(" ")} response`,
      type: "object",
      properties: {
        ...COMMON_PROPERTIES,
        ...(isRecord(baseSchema.properties) ? baseSchema.properties : {}),
        ...commandSpecificProperties(command.id)
      },
      additionalProperties: true,
      "x-apexcn-schema-version": 1,
      "x-apexcn-command-ids": [command.id]
    };
    return [id, schema] as const;
  });

const schemas = new Map<string, PublicJsonSchema>([
  ...schemaEntries,
  ["apexcn-error-v1", APEXCN_ERROR_JSON_SCHEMA as unknown as PublicJsonSchema]
]);

export function listPublicSchemas(): PublicSchemaSummary[] {
  return [...schemas.entries()]
    .map(([id, schema]) => ({
      id,
      version: schema["x-apexcn-schema-version"],
      commandIds: [...schema["x-apexcn-command-ids"]],
      title: schema.title
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function publicSchemaForId(id: string): PublicJsonSchema | undefined {
  return schemas.get(id);
}

export function publicSchemaBundle(): Record<string, PublicJsonSchema> {
  return Object.fromEntries([...schemas.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function publicSchemaCompatibilityIssues(
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): string[] {
  const previousVersion = previous["x-apexcn-schema-version"];
  const nextVersion = next["x-apexcn-schema-version"];
  if (previousVersion !== nextVersion || previous.$id !== next.$id) {
    return [];
  }
  const issues: string[] = [];
  if (previous.type !== next.type) {
    issues.push(`root type changed from ${String(previous.type)} to ${String(next.type)}`);
  }
  const previousProperties = isRecord(previous.properties) ? previous.properties : {};
  const nextProperties = isRecord(next.properties) ? next.properties : {};
  for (const [name, property] of Object.entries(previousProperties)) {
    if (!(name in nextProperties)) {
      issues.push(`property removed: ${name}`);
      continue;
    }
    const before = isRecord(property) ? property.type : undefined;
    const afterValue = nextProperties[name];
    const after = isRecord(afterValue) ? afterValue.type : undefined;
    if (before !== undefined && after !== undefined && JSON.stringify(before) !== JSON.stringify(after)) {
      issues.push(`property type changed: ${name}`);
    }
  }
  const previousRequired = new Set(Array.isArray(previous.required) ? previous.required.filter(isString) : []);
  const nextRequired = Array.isArray(next.required) ? next.required.filter(isString) : [];
  for (const name of nextRequired) {
    if (!previousRequired.has(name)) {
      issues.push(`required property added: ${name}`);
    }
  }
  return issues;
}

function legacySchema(id: string): Record<string, unknown> {
  if (id === "command-manifest-v2") {
    return COMMAND_MANIFEST_JSON_SCHEMA as unknown as Record<string, unknown>;
  }
  if (id === "novice-guide-v1") {
    return NOVICE_GUIDE_JSON_SCHEMA as unknown as Record<string, unknown>;
  }
  return {};
}

function commandSpecificProperties(commandId: string): Record<string, unknown> {
  if (commandId === "rag.retrieve") {
    return {
      kind: { const: "rag-evidence-bundle" },
      schemaVersion: { const: 1 },
      question: { type: "string" },
      queries: { type: "array", minItems: 1, items: { type: "string" } },
      evidence: {
        type: "array",
        items: {
          type: "object",
          required: ["evidenceId", "type", "topicId", "title", "content", "communityUrl"],
          properties: {
            evidenceId: { type: "string", pattern: "^S[1-9][0-9]*$" },
            type: { enum: ["topic", "reply", "correct-answer"] },
            topicId: { type: "integer", minimum: 1 },
            replyId: { type: "integer", minimum: 1 },
            title: { type: "string" },
            content: { type: "string" },
            communityUrl: { type: "string" },
            originalUrl: { type: "string" },
            updatedAt: { type: "string" }
          },
          additionalProperties: true
        }
      },
      answerability: {
        type: "object",
        required: ["status"],
        properties: {
          status: { enum: ["answerable", "partial", "unanswerable"] },
          reasons: { type: "array", items: { type: "string" } }
        },
        additionalProperties: true
      }
    };
  }
  if (commandId === "schema.list") {
    return {
      kind: { const: "schema-list" },
      schemaVersion: { const: 1 },
      schemas: { type: "array" }
    };
  }
  if (commandId === "schema.bundle") {
    return {
      kind: { const: "schema-bundle-written" },
      schemaVersion: { const: 1 },
      output: { type: "string" },
      schemaCount: { type: "integer", minimum: 1 }
    };
  }
  if (commandId === "me.favorites") {
    return {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            targetType: { enum: ["THREAD", "POST"] },
            topicId: { type: "integer", minimum: 1 },
            replyId: { type: "integer", minimum: 1 },
            threadUrl: { type: "string" },
            replyUrl: { type: "string" }
          },
          additionalProperties: true
        }
      }
    };
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
