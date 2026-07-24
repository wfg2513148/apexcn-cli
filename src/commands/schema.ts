import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { printData, printError, type JsonOption } from "../output.js";
import { listPublicSchemas, publicSchemaBundle, publicSchemaForId } from "../schemas/registry.js";
import { CLI_VERSION } from "../version.js";
import type { CommandIo } from "./auth.js";

export function createSchemaCommand(io: CommandIo): Command {
  const schema = new Command("schema").description("inspect and export public JSON Schemas");

  schema
    .command("list")
    .description("list public JSON Schemas")
    .option("--json", "pretty-print JSON")
    .action((options: JsonOption) => {
      printData(io, {
        kind: "schema-list",
        schemaVersion: 1,
        product: "apexcn-cli",
        version: CLI_VERSION,
        schemas: listPublicSchemas()
      }, options.json);
    });

  schema
    .command("show")
    .description("show one public JSON Schema")
    .argument("<schema-id>")
    .option("--json", "pretty-print JSON")
    .action((schemaId: string, options: JsonOption) => {
      const value = publicSchemaForId(schemaId);
      if (!value) {
        printError(io, {
          type: "validation",
          code: "UNKNOWN_SCHEMA",
          message: `Unknown public schema: ${schemaId}`,
          exitCode: 1
        }, undefined, options.json);
        process.exitCode = 1;
        return;
      }
      printData(io, value, options.json);
    });

  schema
    .command("bundle")
    .description("write all public JSON Schemas to one versioned bundle")
    .requiredOption("--output <path>", "output JSON file")
    .option("--json", "pretty-print JSON")
    .action(async (options: JsonOption & { output: string }) => {
      const output = resolve(options.output);
      const schemas = publicSchemaBundle();
      const bundle = {
        kind: "schema-bundle",
        schemaVersion: 1,
        product: "apexcn-cli",
        version: CLI_VERSION,
        schemas
      };
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      printData(io, {
        kind: "schema-bundle-written",
        schemaVersion: 1,
        output,
        schemaCount: Object.keys(schemas).length
      }, options.json);
    });

  return schema;
}
