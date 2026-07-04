import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-collection-"));
  return join(dir, ".apexcn", "config.json");
}

async function tempPath(name: string) {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-collection-"));
  return join(dir, name);
}

async function configuredProgram(fetchImpl: typeof fetch) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const program = createProgram({
    configPath: await tempConfigPath(),
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  });
  await program.parseAsync([
    "node",
    "apexcn",
    "auth",
    "set-token",
    "--token",
    "abcdefghijklmnopqrstuvwxyz",
    "--base-url",
    "https://oracleapex.cn/ords/test",
    "--profile",
    "test@oci"
  ]);
  stdout.length = 0;
  return { program, stdout, stderr, fetch: vi.mocked(fetch) };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("collection commands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("collection build creates a deduplicated local knowledge collection", async () => {
    const outputDir = await tempPath("collection");
    const { program, stdout, stderr, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search") && url.includes("REST")) {
        return Response.json({ requestId: "search-rest", items: [{ id: 1, title: "REST 1" }, { id: 2, title: "REST 2" }] });
      }
      if (url.includes("/api/v1/search") && url.includes("ORDS")) {
        return Response.json({ requestId: "search-ords", items: [{ id: 2, title: "REST 2" }, { id: 3, title: "ORDS 3" }] });
      }
      const match = /\/api\/v1\/topics\/(\d+)/.exec(url);
      if (match) {
        const id = Number(match[1]);
        return Response.json({
          requestId: `topic-${id}`,
          topic: { id, title: `Topic ${id}`, url: `https://example.test/t/${id}`, originalUrl: `https://source.test/${id}` }
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "collection",
      "build",
      "--query",
      "REST",
      "--query",
      "ORDS",
      "--topic-id",
      "3",
      "--topic-id",
      "4",
      "--limit",
      "2",
      "--output-dir",
      outputDir,
      "--json"
    ]);

    expect(stderr.join("")).toBe("");
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? "GET")).toEqual(["GET", "GET", "GET", "GET", "GET", "GET"]);
    const summary = JSON.parse(stdout.join(""));
    expect(summary).toEqual(expect.objectContaining({ kind: "collection-build", topicCount: 4, errorCount: 0 }));
    const collection = await readJson(join(outputDir, "collection.json"));
    expect(collection).toEqual(expect.objectContaining({
      kind: "collection",
      schemaVersion: 1,
      topicCount: 4,
      source: expect.objectContaining({ queries: ["REST", "ORDS"], topicIds: [3, 4] })
    }));
    expect((collection.files as { topics: unknown[] }).topics).toHaveLength(4);
    expect((collection.files as { index: { path: string } }).index.path).toBe("index.md");
    const topic3 = await readJson(join(outputDir, "topics", "3.json"));
    expect(topic3).toEqual(expect.objectContaining({
      kind: "collection-topic",
      id: 3,
      sources: expect.arrayContaining([expect.objectContaining({ type: "query", query: "ORDS" }), expect.objectContaining({ type: "explicit" })])
    }));
    expect(await readFile(join(outputDir, "index.md"), "utf8")).toContain("Topic 4");

    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", outputDir, "--json"]);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ kind: "collection-verification", ok: true }));
  });

  test("collection build keeps successful artifacts when one topic fetch fails", async () => {
    const outputDir = await tempPath("partial");
    const { program, stdout, stderr } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }, { id: 2 }] });
      }
      if (url.endsWith("/api/v1/topics/1")) {
        return Response.json({ requestId: "topic-1", topic: { id: 1, title: "Topic 1" } });
      }
      return Response.json({ error: { message: "topic failed", requestId: "bad-topic" } }, { status: 500 });
    });

    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--limit", "2", "--output-dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ topicCount: 1, errorCount: 1 }));
    const collection = await readJson(join(outputDir, "collection.json"));
    expect((collection.errors as unknown[])).toHaveLength(1);
    expect(await readJson(join(outputDir, "topics", "1.json"))).toEqual(expect.objectContaining({ kind: "collection-topic", id: 1 }));
  });

  test("collection build validates required inputs before API calls", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "collection", "build", "--output-dir", await tempPath("missing")]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Provide at least one --query or --topic-id");
    expect(process.exitCode).toBe(1);
  });

  test("collection verify reports missing topic files without network", async () => {
    const outputDir = await tempPath("verify-missing");
    const { program, stdout, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }] });
      }
      return Response.json({ requestId: "topic-1", topic: { id: 1, title: "Topic 1" } });
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--output-dir", outputDir]);
    await rm(join(outputDir, "topics", "1.json"));
    stdout.length = 0;
    process.exitCode = undefined;

    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", outputDir, "--json"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    const report = JSON.parse(stdout.join(""));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-topic-file" })]));
    expect(process.exitCode).toBe(1);
  });

  test("collection verify works after moving the collection directory", async () => {
    const outputDir = await tempPath("source");
    const movedDir = await tempPath("moved");
    const { program, stdout, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }] });
      }
      return Response.json({ requestId: "topic-1", topic: { id: 1, title: "Topic 1" } });
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--output-dir", outputDir]);
    await cp(outputDir, movedDir, { recursive: true });
    stdout.length = 0;

    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", movedDir, "--json"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ ok: true }));
  });

  test("collection verify rejects unsafe paths and missing file entries", async () => {
    const outputDir = await tempPath("unsafe");
    const { program, stdout } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }, { id: 2 }] });
      }
      const id = /\/topics\/(\d+)/.exec(url)?.[1] ?? "1";
      return Response.json({ requestId: `topic-${id}`, topic: { id: Number(id), title: `Topic ${id}` } });
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--limit", "2", "--output-dir", outputDir]);
    const collection = await readJson(join(outputDir, "collection.json"));
    const files = (collection.files as { topics: Array<Record<string, unknown>> }).topics;
    files[0].path = join(outputDir, "topics", "1.json");
    files.splice(1, 1);
    await writeFile(join(outputDir, "collection.json"), `${JSON.stringify(collection, null, 2)}\n`, "utf8");
    stdout.length = 0;
    process.exitCode = undefined;

    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", outputDir, "--json"]);

    const report = JSON.parse(stdout.join(""));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-topic-artifact" }),
      expect.objectContaining({ code: "missing-topic-file-entry" })
    ]));
  });
});
