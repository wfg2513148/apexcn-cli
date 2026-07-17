import { describe, expect, test } from "vitest";
import { createProgram } from "../../src/index.js";

describe("MCP CLI", () => {
  test("mcp tools exposes readonly tools by default and preview tools only when requested", async () => {
    const stdout: string[] = [];
    const program = createProgram({ stdout: (text) => stdout.push(text), stderr: () => undefined });
    await program.parseAsync(["node", "apexcn", "mcp", "tools", "--json"]);
    const readonly = JSON.parse(stdout.join("")) as { tools: Array<{ name: string; exposure: string }> };

    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "mcp", "tools", "--allow-preview-write", "--json"]);
    const preview = JSON.parse(stdout.join("")) as { tools: Array<{ name: string; exposure: string }> };

    expect(readonly.tools.every((tool) => tool.exposure === "readonly")).toBe(true);
    expect(preview.tools.map((tool) => tool.name)).toContain("apexcn_topic_create_preview");
  });

  test("mcp tools exports a JSON Schema", async () => {
    const stdout: string[] = [];
    const program = createProgram({ stdout: (text) => stdout.push(text), stderr: () => undefined });

    await program.parseAsync(["node", "apexcn", "mcp", "tools", "--json-schema"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "apexcn-cli MCP tool manifest"
    }));
  });

  test("mcp serve refuses execute-write", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({ stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });

    await program.parseAsync(["node", "apexcn", "mcp", "serve", "--allow-execute-write"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("MCP execute-write is intentionally unavailable");
    expect(stderr.join("")).toContain("preview-only write plans");
    expect(stderr.join("")).toContain("apexcn workflow");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
