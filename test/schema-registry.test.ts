import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
