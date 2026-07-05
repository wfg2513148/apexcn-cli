import { describe, expect, test } from "vitest";
import { createProgram } from "../../src/index.js";

describe("JSON Schema export", () => {
  test("commands --json-schema exports draft-07 schema", async () => {
    const stdout: string[] = [];
    const program = createProgram({ stdout: (text) => stdout.push(text), stderr: () => undefined });

    await program.parseAsync(["node", "apexcn", "commands", "--json-schema"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "apexcn-cli command manifest"
    }));
  });
});
