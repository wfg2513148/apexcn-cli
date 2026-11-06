import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: async () => "1", close: () => {} })
}));

import { createProgram } from "../src/index.js";

afterEach(() => { vi.unstubAllGlobals(); process.exitCode = undefined; });

test("interactive topic creation rejects an unsafe category ID before preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "apexcn-category-precision-"));
  const previous = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  try {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetch = vi.fn(async () => new Response('{"items":[{"id":9007199254740993,"name":"unsafe"}]}', { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const program = createProgram({ configPath: join(root, "config.json"), stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "synthetic-test-token", "--base-url", "https://example.invalid/ords", "--profile", "test"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "topic", "create", "--title", "Example", "--content", "Example body", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(stdout.join("")).not.toContain("write-preview");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    if (previous) Object.defineProperty(process.stdin, "isTTY", previous);
    else delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    await rm(root, { recursive: true, force: true });
  }
});
