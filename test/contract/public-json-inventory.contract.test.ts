import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { afterEach, describe, expect, test } from "vitest";
import { createProgram } from "../../src/index.js";

const repoRoot = join(__dirname, "..", "..");
const knownSchemaIds = new Set([
  "apexcn-error-v1",
  "ask-response-v1",
  "collection-query-v1",
  "command-manifest-v2",
  "doctor-snapshot-v1",
  "mcp-tools-v1",
  "novice-guide-v1",
  "public-json-object-v1",
  "research-bundle-v1",
  "search-response-v1",
  "topic-response-v1",
  "workflow-plan-v1"
]);

describe("public JSON contract inventory", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test("maps every declared JSON command to a known schema and real contract test", async () => {
    const manifest = await commandManifest();
    const jsonCommands = manifest.commands.filter((command) => command.supportsJson);

    expect(jsonCommands.length).toBeGreaterThan(50);
    for (const command of manifest.commands) {
      const hasJsonOutputOption = command.options.includes("--json")
        || command.options.some((option) => option.startsWith("--format"));
      expect(command.supportsJson, command.path).toBe(hasJsonOutputOption);
      if (!command.supportsJson) {
        expect(command.jsonContract, command.path).toBeNull();
        continue;
      }
      expect(command.jsonContract, command.path).toEqual({
        successSchemaId: expect.any(String),
        errorSchemaId: "apexcn-error-v1",
        testFile: expect.any(String)
      });
      expect(knownSchemaIds.has(command.jsonContract.successSchemaId), command.path).toBe(true);
      expect(knownSchemaIds.has(command.jsonContract.errorSchemaId), command.path).toBe(true);
      expect(existsSync(join(repoRoot, command.jsonContract.testFile)), command.path).toBe(true);
    }
  });

  test("returns the stable JSON error envelope for every declared JSON command", async () => {
    const manifest = await commandManifest();
    for (const command of manifest.commands.filter((entry) => entry.supportsJson)) {
      const stderr: string[] = [];
      const program = createProgram({
        stdout: () => undefined,
        stderr: (text) => stderr.push(text)
      });
      exitOverrideTree(program);
      const jsonFlags = command.options.includes("--json") ? ["--json"] : ["--format", "json"];

      await expect(
        program.parseAsync(["node", "apexcn", ...command.path.split(" "), "--definitely-invalid", ...jsonFlags])
      ).rejects.toMatchObject({ code: expect.stringMatching(/^commander\./) });

      const payload = JSON.parse(stderr.join(""));
      expect(payload, command.path).toEqual({
        ok: false,
        error: expect.objectContaining({
          type: "validation",
          code: expect.stringMatching(
            /^(UNKNOWN_OPTION|MISSING_OPTION|MISSING_ARGUMENT|MISSING_OPTION_VALUE|INVALID_ARGUMENT|CLI_USAGE_ERROR)$/
          ),
          message: expect.any(String),
          exitCode: 1
        })
      });
    }
  });
});

async function commandManifest(): Promise<{
  commands: Array<{
    path: string;
    options: string[];
    supportsJson: boolean;
    jsonContract: {
      successSchemaId: string;
      errorSchemaId: string;
      testFile: string;
    } | null;
  }>;
}> {
  const stdout: string[] = [];
  await createProgram({
    stdout: (text) => stdout.push(text),
    stderr: () => undefined
  }).parseAsync(["node", "apexcn", "commands", "--json"]);
  return JSON.parse(stdout.join(""));
}

function exitOverrideTree(command: Command): void {
  command.exitOverride((error) => {
    throw error;
  });
  for (const child of command.commands) {
    exitOverrideTree(child);
  }
}
