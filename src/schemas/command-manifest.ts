import { assertArray, assertNumber, assertRecord, assertString, isRecord } from "./common.js";

const CAPABILITIES = new Set(["read", "write", "local", "workflow", "auth", "diagnostic"]);
const API_EFFECTS = new Set(["no-network", "api-read", "api-write", "destructive"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "destructive"]);
const MCP_EXPOSURES = new Set(["none", "readonly", "preview-only", "blocked"]);

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
  assertEnum(value.mcpExposure, MCP_EXPOSURES, `${label}.mcpExposure`);
  if (typeof value.authRequired !== "boolean") {
    throw new Error(`${label}.authRequired must be a boolean`);
  }
  if (typeof value.supportsJson !== "boolean" || typeof value.supportsPreview !== "boolean" || typeof value.supportsDryRun !== "boolean") {
    throw new Error(`${label}.supports* fields must be booleans`);
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
