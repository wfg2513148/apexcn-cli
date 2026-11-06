import type { Command } from "commander";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

function exitOverrideTree(command: Command): void {
  command.exitOverride((error) => { throw error; });
  command.commands.forEach(exitOverrideTree);
}

describe("unsafe integer arguments", () => {
  afterEach(() => { vi.unstubAllGlobals(); process.exitCode = undefined; });

  test.each([
    ["draft reply", ["draft", "reply", "--topic-id", "9007199254740993", "--answer", "Example reply"]],
    ["workflow plan", ["workflow", "plan", "--goal", "reply", "--topic-id", "9007199254740993"]],
    ["review topic", ["review", "topic", "--category-id", "9007199254740993"]],
    ["collection build", ["collection", "build", "--topic-id", "9007199254740993", "--output-dir", "__TEST_OUTPUT__"]],
    ["topic view", ["topic", "view", "1.0000000000000001"]],
    ["workflow fractional ID", ["workflow", "plan", "--goal", "reply", "--topic-id", "1.0000000000000001"]],
    ["topic offset", ["topic", "list", "--offset", "9007199254740993"]]
  ])("%s rejects an unsafe ID before its action", async (_name, args) => {
    const root = await mkdtemp(join(tmpdir(), "apexcn-unsafe-id-"));
    try {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request"); }));
      const program = createProgram({ configPath: join(root, "missing-config.json"), stdout: () => {}, stderr: () => {} });
      exitOverrideTree(program);
      await expect(program.parseAsync(["node", "apexcn", ...args.map((arg) => arg === "__TEST_OUTPUT__" ? join(root, "output") : arg)]))
        .rejects.toMatchObject({ code: "commander.invalidArgument" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("review reply reports an unsafe explicit topic ID without a request plan", async () => {
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text), stderr: () => {},
      readStdin: async () => "This is a sufficiently detailed example reply for validation.", isStdinTTY: () => false
    });
    await program.parseAsync(["node", "apexcn", "review", "reply", "--topic-id", "9007199254740993", "--content-file", "-", "--json"]);
    const result = JSON.parse(stdout.join(""));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-topic-id" })]));
    expect(result.requestPlan).toBeNull();
  });

  test("review reply rejects an imported draft with an unsafe topic ID", async () => {
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text), stderr: () => {}, isStdinTTY: () => false,
      readStdin: async () => '{"kind":"reply-draft","schemaVersion":1,"topicId":9007199254740993,"parentPostId":null,"content":"This is a sufficiently detailed example reply."}'
    });
    await program.parseAsync(["node", "apexcn", "review", "reply", "--draft-file", "-", "--json"]);
    const result = JSON.parse(stdout.join(""));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-draft-schema" })]));
    expect(result.requestPlan).toBeNull();
  });

  test("review reply rejects an imported draft whose fractional ID rounds to a safe integer", async () => {
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text), stderr: () => {}, isStdinTTY: () => false,
      readStdin: async () => '{"kind":"reply-draft","schemaVersion":1,"topicId":9007199254740991.1,"parentPostId":null,"content":"This is a sufficiently detailed example reply."}'
    });
    await program.parseAsync(["node", "apexcn", "review", "reply", "--draft-file", "-", "--json"]);
    const result = JSON.parse(stdout.join(""));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-draft-schema" })]));
    expect(result.requestPlan).toBeNull();
  });

  test("review reply emits no plan or suggestion for an invalid parent ID", async () => {
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text), stderr: () => {}, isStdinTTY: () => false,
      readStdin: async () => "This is a sufficiently detailed example reply for validation."
    });
    await program.parseAsync(["node", "apexcn", "review", "reply", "--topic-id", "42", "--parent-post-id", "9007199254740993", "--content-file", "-", "--json"]);
    const result = JSON.parse(stdout.join(""));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-parent-post-id" })]));
    expect(result.requestPlan).toBeNull();
    expect(result.suggestedCommand).toBeNull();
  });

  test("review reply emits no suggested command for an invalid parent ID and a real content file", async () => {
    const root = await mkdtemp(join(tmpdir(), "apexcn-review-unsafe-parent-"));
    try {
      const contentPath = join(root, "reply.md");
      await writeFile(contentPath, "This is a sufficiently detailed example reply for validation.");
      const stdout: string[] = [];
      const program = createProgram({ stdout: (text) => stdout.push(text), stderr: () => {} });
      await program.parseAsync(["node", "apexcn", "review", "reply", "--topic-id", "42", "--parent-post-id", "9007199254740993", "--content-file", contentPath, "--json"]);
      const result = JSON.parse(stdout.join(""));
      expect(result.ok).toBe(false);
      expect(result.requestPlan).toBeNull();
      expect(result.suggestedCommand).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
