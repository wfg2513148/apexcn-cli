import { assertArray, assertNumber, assertRecord, assertString } from "./common.js";

const GUIDE_VIEWS = new Set(["learning", "compatibility", "deployment", "security", "performance"]);

export const NOVICE_GUIDE_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/wfg2513148/apexcn-cli/schemas/novice-guide.schema.json",
  title: "apexcn-cli novice guide",
  type: "object",
  required: [
    "kind",
    "schemaVersion",
    "view",
    "title",
    "summary",
    "context",
    "steps",
    "limitations",
    "nextActions"
  ],
  properties: {
    kind: { const: "novice-guide" },
    schemaVersion: { const: 1 },
    view: { enum: [...GUIDE_VIEWS] },
    title: { type: "string" },
    summary: { type: "string" },
    context: { type: "object" },
    steps: { type: "array", minItems: 1 },
    limitations: { type: "array", minItems: 1, items: { type: "string" } },
    nextActions: { type: "array", minItems: 1, items: { type: "string" } }
  },
  additionalProperties: true
} as const;

export function assertNoviceGuide(value: unknown): asserts value is Record<string, unknown> {
  assertRecord(value, "novice guide");
  if (value.kind !== "novice-guide") {
    throw new Error("novice guide.kind must be novice-guide");
  }
  assertNumber(value.schemaVersion, "novice guide.schemaVersion");
  assertString(value.view, "novice guide.view");
  if (!GUIDE_VIEWS.has(value.view)) {
    throw new Error("novice guide.view is invalid");
  }
  assertString(value.title, "novice guide.title");
  assertString(value.summary, "novice guide.summary");
  assertRecord(value.context, "novice guide.context");
  assertArray(value.steps, "novice guide.steps");
  assertArray(value.limitations, "novice guide.limitations");
  assertArray(value.nextActions, "novice guide.nextActions");
  if (value.steps.length === 0) {
    throw new Error("novice guide.steps must not be empty");
  }
  for (const [index, item] of value.steps.entries()) {
    assertRecord(item, `novice guide.steps[${index}]`);
    assertString(item.id, `novice guide.steps[${index}].id`);
    assertString(item.title, `novice guide.steps[${index}].title`);
    assertString(item.outcome, `novice guide.steps[${index}].outcome`);
    assertArray(item.commands, `novice guide.steps[${index}].commands`);
    assertArray(item.checks, `novice guide.steps[${index}].checks`);
  }
}
