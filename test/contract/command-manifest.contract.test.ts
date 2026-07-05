import { describe, expect, test } from "vitest";
import { createProgram } from "../../src/index.js";
import { assertCommandManifest } from "../../src/schemas/command-manifest.js";

describe("command manifest contract", () => {
  test("commands --json validates against the additive manifest v2 contract", async () => {
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "commands", "--json"]);

    const manifest = JSON.parse(stdout.join("")) as unknown;
    expect(() => assertCommandManifest(manifest)).not.toThrow();
    expect(manifest).toEqual(expect.objectContaining({
      schemaVersion: 1,
      manifestVersion: 2,
      product: "apexcn-cli"
    }));
  });
});
