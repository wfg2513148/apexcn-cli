import { assertArray, assertNumber, assertRecord, assertString, isRecord } from "./common.js";

const CAPABILITIES = new Set(["read", "write", "local", "workflow", "auth", "diagnostic"]);
const API_EFFECTS = new Set(["no-network", "api-read", "api-write", "destructive"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "destructive"]);

export const COMMAND_MANIFEST_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/wfg2513148/apexcn-cli/schemas/command-manifest.schema.json",
  title: "apexcn-cli command manifest",
  type: "object",
  required: ["schemaVersion", "manifestVersion", "product", "version", "generatedAt", "schema", "commands"],
  properties: {
    schemaVersion: { const: 1 },
    manifestVersion: { const: 2 },
    product: { const: "apexcn-cli" },
    version: { type: "string" },
    generatedAt: { type: "string" },
    schema: { type: "object" },
    commands: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "aliases", "description", "options", "safety", "examples", "id", "capability", "apiEffect", "riskLevel", "authRequired", "supportsJson", "supportsPreview", "supportsDryRun", "jsonContract"],
        properties: {
          path: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          description: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          safety: { type: "object" },
          examples: { type: "array" },
          id: { type: "string" },
          capability: { enum: [...CAPABILITIES] },
          apiEffect: { enum: [...API_EFFECTS] },
          riskLevel: { enum: [...RISK_LEVELS] },
          authRequired: { type: "boolean" },
          supportsJson: { type: "boolean" },
          supportsPreview: { type: "boolean" },
          supportsDryRun: { type: "boolean" },
          jsonContract: {
            anyOf: [
              {
                type: "object",
                required: ["successSchemaId", "errorSchemaId", "testFile"],
                properties: {
                  successSchemaId: { type: "string" },
                  errorSchemaId: { const: "apexcn-error-v1" },
                  testFile: { type: "string" }
                }
              },
              { type: "null" }
            ]
          }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
} as const;

export function assertCommandManifest(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "command manifest");
  assertNumber(value.schemaVersion, "schemaVersion");
  assertNumber(value.manifestVersion, "manifestVersion");
  assertString(value.product, "product");
  assertString(value.version, "version");
  assertString(value.generatedAt, "generatedAt");
  assertArray(value.commands, "commands");
  for (const [index, command] of value.commands.entries()) {
    assertManifestCommand(command, `commands[${index}]`);
  }
}

function assertManifestCommand(value: unknown, label: string): void {
  assertRecord(value, label);
  assertString(value.path, `${label}.path`);
  assertString(value.description, `${label}.description`);
  assertArray(value.aliases, `${label}.aliases`);
  assertArray(value.options, `${label}.options`);
  assertArray(value.examples, `${label}.examples`);
  if (value.id !== undefined) {
    assertString(value.id, `${label}.id`);
  }
  assertEnum(value.capability, CAPABILITIES, `${label}.capability`);
  assertEnum(value.apiEffect, API_EFFECTS, `${label}.apiEffect`);
  assertEnum(value.riskLevel, RISK_LEVELS, `${label}.riskLevel`);
  if (typeof value.authRequired !== "boolean") {
    throw new Error(`${label}.authRequired must be a boolean`);
  }
  if (typeof value.supportsJson !== "boolean" || typeof value.supportsPreview !== "boolean" || typeof value.supportsDryRun !== "boolean") {
    throw new Error(`${label}.supports* fields must be booleans`);
  }
  if (value.supportsJson) {
    assertRecord(value.jsonContract, `${label}.jsonContract`);
    assertString(value.jsonContract.successSchemaId, `${label}.jsonContract.successSchemaId`);
    assertString(value.jsonContract.errorSchemaId, `${label}.jsonContract.errorSchemaId`);
    assertString(value.jsonContract.testFile, `${label}.jsonContract.testFile`);
  } else if (value.jsonContract !== null) {
    throw new Error(`${label}.jsonContract must be null when JSON is unsupported`);
  }
  if (!isRecord(value.safety) || !Array.isArray(value.safety.effects) || typeof value.safety.preview !== "string") {
    throw new Error(`${label}.safety has an invalid shape`);
  }
}

function assertEnum(value: unknown, values: Set<string>, label: string): void {
  if (typeof value !== "string" || !values.has(value)) {
    throw new Error(`${label} is invalid`);
  }
}
