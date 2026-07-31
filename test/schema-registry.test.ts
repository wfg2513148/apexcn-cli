import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { afterEach, describe, expect, test } from "vitest";
import { createProgram } from "../src/index.js";
import { COMMAND_DESCRIPTORS } from "../src/core/command-registry.js";
import {
  listPublicSchemas,
  publicSchemaCompatibilityIssues,
  publicSchemaForId,
  schemaIdForCommand
} from "../src/schemas/registry.js";

describe("public JSON Schema registry", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test("maps every public JSON command to a concrete exportable versioned schema", () => {
    const jsonCommands = COMMAND_DESCRIPTORS.filter((command) => command.supportsJson);
    const schemas = listPublicSchemas();
    const schemaIds = new Set(schemas.map((schema) => schema.id));

    expect(jsonCommands.length).toBeGreaterThanOrEqual(75);
    expect(schemaIds.has("apexcn-error-v1")).toBe(true);
    expect(jsonCommands.every((command) => command.jsonContract?.successSchemaId !== "public-json-object-v1")).toBe(true);
    for (const command of jsonCommands) {
      const schemaId = schemaIdForCommand(command.id);
      expect(command.jsonContract?.successSchemaId, command.id).toBe(schemaId);
      expect(schemaIds.has(schemaId), command.id).toBe(true);
      expect(publicSchemaForId(schemaId), command.id).toEqual(expect.objectContaining({
        $schema: "http://json-schema.org/draft-07/schema#",
        $id: expect.any(String),
        title: expect.any(String),
        type: "object",
        "x-apexcn-schema-version": 1,
        "x-apexcn-command-ids": expect.arrayContaining([command.id])
      }));
    }
  });

  test("detects unversioned breaking schema drift", () => {
    const previous = {
      $id: "https://example.test/example-v1.schema.json",
      type: "object",
      required: ["kind"],
      properties: {
        kind: { type: "string" },
        items: { type: "array" }
      },
      "x-apexcn-schema-version": 1
    };
    expect(publicSchemaCompatibilityIssues(previous, {
      ...previous,
      required: ["kind", "newField"],
      properties: {
        kind: { type: "number" }
      }
    })).toEqual([
      "property type changed: kind",
      "property removed: items",
      "required property added: newField"
    ]);
    expect(publicSchemaCompatibilityIssues(previous, {
      ...previous,
      $id: "https://example.test/example-v2.schema.json",
      "x-apexcn-schema-version": 2
    })).toEqual([]);
  });

  test("publishes the ask URL and visible citation contract", () => {
    expect(publicSchemaForId("ask-response-v1")).toEqual(expect.objectContaining({
      properties: expect.objectContaining({
        requestUrl: { type: "string", format: "uri" },
        references: expect.objectContaining({ type: "array" }),
        synthesisPolicy: expect.objectContaining({ type: "object" })
      })
    }));
  });

  test("publishes a strict administrator operations aggregate contract", () => {
    const schema = publicSchemaForId("admin-operations-response-v1");

    expect(schema).toEqual(expect.objectContaining({
      required: ["kind", "schemaVersion", "requestId", "window", "filter", "totals", "daily", "operations", "errors", "keywords"],
      additionalProperties: false,
      properties: expect.objectContaining({
        kind: { const: "admin-operations" },
        schemaVersion: { const: 1 },
        requestId: { type: "string", pattern: "^req_" },
        window: expect.objectContaining({
          type: "object",
          required: ["from", "to", "days"],
          additionalProperties: false
        }),
        filter: expect.objectContaining({
          type: "object",
          required: ["client", "limit"],
          additionalProperties: false
        }),
        totals: expect.objectContaining({
          type: "object",
          required: ["calls", "successCount", "failureCount"],
          additionalProperties: false
        }),
        daily: expect.objectContaining({ type: "array" }),
        operations: expect.objectContaining({ type: "array" }),
        errors: expect.objectContaining({ type: "array" }),
        keywords: expect.objectContaining({ type: "array" })
      })
    }));
    expect(JSON.stringify(schema)).not.toMatch(/authorization|api.?key|requestBody|question/i);
  });

  test("validates administrator operations fixtures and rejects sensitive or unknown fields", () => {
    const schema = publicSchemaForId("admin-operations-response-v1");
    const validate = new Ajv({ allErrors: true, strict: false, formats: { date: /^\d{4}-\d{2}-\d{2}$/ } }).compile(schema);
    const fixture = {
      kind: "admin-operations",
      schemaVersion: 1,
      requestId: "req_admin_operations",
      window: { from: "2026-07-01", to: "2026-07-07", days: 7 },
      filter: { client: "apexcn-cli", limit: 20, user: { id: 42, nickname: "Alice" } },
      totals: { calls: 4, successCount: 3, failureCount: 1 },
      daily: [{ date: "2026-07-01", calls: 4, successCount: 3, failureCount: 1 }],
      operations: [{ route: "/api/v1/search", operation: "search", calls: 4, successCount: 3, failureCount: 1 }],
      errors: [{ httpStatus: 400, errorCode: "VALIDATION_ERROR", route: "/api/v1/search", operation: "search", calls: 1 }],
      keywords: [{ date: "2026-07-01", route: "/api/v1/search", operation: "search", keyword: "apex", calls: 2 }]
    };

    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    for (const invalid of [
      { ...fixture, requestId: "req-admin-operations" },
      { ...fixture, authorization: "Bearer secret" },
      { ...fixture, filter: { ...fixture.filter, apiKey: "secret" } },
      { ...fixture, operations: [{ ...fixture.operations[0], requestBody: { keyword: "apex" } }] },
      { ...fixture, keywords: [{ ...fixture.keywords[0], question: "private ask body" }] }
    ]) {
      expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });

  test("lists, shows, and bundles schemas through the public CLI", async () => {
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "schema", "list", "--json"]);
    const list = JSON.parse(stdout.join(""));
    expect(list).toEqual(expect.objectContaining({
      kind: "schema-list",
      schemaVersion: 1,
      schemas: expect.arrayContaining([
        expect.objectContaining({ id: "search-response-v1", version: 1 })
      ])
    }));

    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "schema", "show", "search-response-v1", "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      $schema: "http://json-schema.org/draft-07/schema#",
      "x-apexcn-schema-version": 1,
      "x-apexcn-command-ids": ["search"]
    }));

    const outputDir = await mkdtemp(join(tmpdir(), "apexcn-schema-bundle-"));
    const output = join(outputDir, "schemas.json");
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "schema", "bundle", "--output", output, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "schema-bundle-written",
      schemaVersion: 1,
      output,
      schemaCount: list.schemas.length
    }));
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(expect.objectContaining({
      kind: "schema-bundle",
      schemaVersion: 1,
      schemas: expect.any(Object)
    }));
  });

  test("fails closed for an unknown schema id", async () => {
    const stderr: string[] = [];
    const program = createProgram({
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "schema", "show", "missing-response-v1", "--json"]);

    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        code: "UNKNOWN_SCHEMA",
        message: "Unknown public schema: missing-response-v1",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });
});
