import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

const testRoots = new Set<string>();

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-collection-"));
  testRoots.add(dir);
  return join(dir, ".apexcn", "config.json");
}

async function tempPath(name: string) {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-collection-"));
  testRoots.add(dir);
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
  afterEach(async () => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    await Promise.all([...testRoots].map((root) => rm(root, { recursive: true, force: true })));
    testRoots.clear();
  });

  test.each(["9007199254740993", "9007199254740991.1", '"9007199254740993"'])("collection build refuses an imprecise search ID %s before topic fetch", async (id) => {
    const outputDir = await tempPath("unsafe-search");
    const { program, stderr, fetch } = await configuredProgram(async () =>
      new Response(`{"requestId":"req-search","items":[{"id":${id},"title":"unsafe"}]}`, { headers: { "content-type": "application/json" } })
    );

    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "synthetic", "--output-dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection build checks the selected IDs after ignoring a numeric placeholder", async () => {
    const outputDir = await tempPath("unsafe-search-placeholder");
    const { program, stderr, fetch } = await configuredProgram(async () =>
      new Response('{"items":[9007199254740993,{"id":1},{"id":2},{"id":9007199254740991.1}]}', { headers: { "content-type": "application/json" } })
    );
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "synthetic", "--limit", "3", "--output-dir", outputDir, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    await rm(outputDir, { recursive: true, force: true });
  });

  test("favorites import rejects an imprecise topic ID before writing a topic", async () => {
    const outputDir = await tempPath("unsafe-favorite");
    const { program, stderr, fetch } = await configuredProgram(async () =>
      new Response('{"requestId":"req-favorites","items":[{"targetType":"THREAD","topicId":9007199254740991.1,"title":"unsafe"}],"page":{"nextCursor":null}}', { headers: { "content-type": "application/json" } })
    );

    await program.parseAsync(["node", "apexcn", "collection", "favorites", "--output-dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(readFile(join(outputDir, "topics", "9007199254740991.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(outputDir, { recursive: true, force: true });
  });

  test("favorites import does not fall back from an unsafe topic ID to a different ID", async () => {
    const outputDir = await tempPath("unsafe-favorite-alias");
    const { program, stderr, fetch } = await configuredProgram(async () =>
      new Response('{"items":[{"targetType":"THREAD","topicId":"9.007199254740993e15","id":42,"title":"unsafe"}],"page":{"nextCursor":null}}', { headers: { "content-type": "application/json" } })
    );

    await program.parseAsync(["node", "apexcn", "collection", "favorites", "--output-dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(readFile(join(outputDir, "topics", "42.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await rm(outputDir, { recursive: true, force: true });
  });

  test.each(['"9007199254740993"', '"not-an-id"'])("favorites import validates ID %s before overwriting any existing topic", async (badId) => {
    const outputDir = await tempPath("unsafe-favorite-existing");
    await mkdir(join(outputDir, "topics"), { recursive: true });
    await writeFile(join(outputDir, "topics", "42.json"), "existing topic");
    const { program, stderr } = await configuredProgram(async () =>
      new Response(`{"items":[{"targetType":"THREAD","id":"42"},{"targetType":"THREAD","id":${badId}}],"page":{"nextCursor":null}}`, { headers: { "content-type": "application/json" } })
    );

    await program.parseAsync(["node", "apexcn", "collection", "favorites", "--output-dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(await readFile(join(outputDir, "topics", "42.json"), "utf8")).toBe("existing topic");
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection verify and sync reject a manifest whose ID was rounded", async () => {
    const outputDir = await tempPath("unsafe-manifest");
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ topic: { id: Number.MAX_SAFE_INTEGER, title: "safe" } }));
    await program.parseAsync(["node", "apexcn", "collection", "build", "--topic-id", "9007199254740991", "--output-dir", outputDir, "--json"]);
    expect(process.exitCode).toBeUndefined();
    const manifestPath = join(outputDir, "collection.json");
    const manifest = await readFile(manifestPath, "utf8");
    expect(manifest).toContain('"id": 9007199254740991');
    await writeFile(manifestPath, manifest.replace('"id": 9007199254740991', '"id": 9007199254740991.1'));
    stdout.length = 0;
    stderr.length = 0;
    fetch.mockClear();

    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", outputDir, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);

    process.exitCode = undefined;
    stdout.length = 0;
    stderr.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "sync", "--dir", outputDir, "--json"]);
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).not.toHaveBeenCalled();
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection verify rejects an unsafe source topicIds array", async () => {
    const outputDir = await tempPath("unsafe-source-ids");
    const { program, stdout, stderr } = await configuredProgram(async () => Response.json({ topic: { id: 42, title: "safe" } }));
    await program.parseAsync(["node", "apexcn", "collection", "build", "--topic-id", "42", "--output-dir", outputDir, "--json"]);
    expect(process.exitCode).toBeUndefined();
    const manifestPath = join(outputDir, "collection.json");
    const manifest = await readFile(manifestPath, "utf8");
    const changed = manifest.replace(/"topicIds":\s*\[\s*42\s*\]/, '"topicIds": [9007199254740993]');
    expect(changed).not.toBe(manifest);
    await writeFile(manifestPath, changed);
    stdout.length = 0;
    stderr.length = 0;

    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    await rm(outputDir, { recursive: true, force: true });
  });

  test.each(["null", '"42"'])("collection sync rejects a nonnumeric manifest target ID %s", async (badId) => {
    const outputDir = await tempPath("invalid-manifest-id");
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ topic: { id: 42, title: "safe" } }));
    await program.parseAsync(["node", "apexcn", "collection", "build", "--topic-id", "42", "--output-dir", outputDir, "--json"]);
    expect(process.exitCode).toBeUndefined();
    const manifestPath = join(outputDir, "collection.json");
    const manifest = await readFile(manifestPath, "utf8");
    expect(manifest).toContain('"id": 42');
    await writeFile(manifestPath, manifest.replace('"id": 42', `"id": ${badId}`));
    stdout.length = 0;
    stderr.length = 0;
    fetch.mockClear();

    await program.parseAsync(["node", "apexcn", "collection", "sync", "--dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).not.toHaveBeenCalled();
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection sync rejects an unsafe reply ID before changing existing files", async () => {
    const outputDir = await tempPath("unsafe-sync");
    let syncing = false;
    const { program, stdout, stderr } = await configuredProgram(async (input) => {
      const isSecond = String(input).includes("/topics/2");
      const body = syncing && isSecond
        ? '{"topic":{"id":2,"title":"unsafe"},"replies":[{"id":9007199254740993}]}'
        : JSON.stringify({ topic: { id: isSecond ? 2 : 1, title: syncing ? "changed" : "original" } });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--topic-id", "1", "--topic-id", "2", "--output-dir", outputDir, "--json"]);
    expect(process.exitCode).toBeUndefined();
    const manifest = await readFile(join(outputDir, "collection.json"), "utf8");
    const firstTopic = await readFile(join(outputDir, "topics", "1.json"), "utf8");
    syncing = true;
    stdout.length = 0;
    stderr.length = 0;

    await program.parseAsync(["node", "apexcn", "collection", "sync", "--dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(await readFile(join(outputDir, "collection.json"), "utf8")).toBe(manifest);
    expect(await readFile(join(outputDir, "topics", "1.json"), "utf8")).toBe(firstTopic);
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection query rejects an unsafe ID in a local index", async () => {
    const outputDir = await tempPath("unsafe-index");
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "index.jsonl"), '{"kind":"collection-index-record","schemaVersion":1,"engine":"bm25","topicId":9007199254740993,"title":"oracle","sourcePath":"topics/42.json","terms":{"oracle":1},"documentLength":1,"excerpt":"oracle"}\n');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({ stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });

    await program.parseAsync(["node", "apexcn", "collection", "query", "oracle", "--dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(stdout.join("")).toBe("");
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection stats rejects an unsafe ID in index metadata", async () => {
    const outputDir = await tempPath("unsafe-index-meta");
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "index.jsonl"), '{"kind":"collection-index-record","schemaVersion":1,"engine":"bm25","topicId":42,"title":"oracle","sourcePath":"topics/42.json","terms":{"oracle":1},"documentLength":1,"excerpt":"oracle"}\n');
    await writeFile(join(outputDir, "index.meta.json"), '{"sourceDocuments":[{"topicId":9007199254740993}]}');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({ stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });

    await program.parseAsync(["node", "apexcn", "collection", "stats", "--dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(stdout.join("")).toBe("");
    await rm(outputDir, { recursive: true, force: true });
  });

  test("collection can verify a topic with an unrelated large author ID", async () => {
    const outputDir = await tempPath("large-author");
    const { program, stdout, stderr } = await configuredProgram(async () =>
      new Response('{"topic":{"id":42,"title":"safe","author":{"id":9007199254740993},"score":0.123456789012345678}}', { headers: { "content-type": "application/json" } })
    );
    await program.parseAsync(["node", "apexcn", "collection", "build", "--topic-id", "42", "--output-dir", outputDir, "--json"]);
    expect(process.exitCode).toBeUndefined();
    stdout.length = 0;
    stderr.length = 0;

    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", outputDir, "--json"]);

    expect(process.exitCode).toBeUndefined();
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({ ok: true });
    await rm(outputDir, { recursive: true, force: true });
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
    expect(summary).toEqual(expect.objectContaining({
      kind: "collection-build",
      topicCount: 4,
      errorCount: 0,
      requestIds: ["search-rest", "search-ords", "topic-1", "topic-2", "topic-3", "topic-4"]
    }));
    const collection = await readJson(join(outputDir, "collection.json"));
    expect(collection).toEqual(expect.objectContaining({
      kind: "collection",
      schemaVersion: 2,
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
      if (url.endsWith("/api/v1/topics/1?lang=en")) {
        return Response.json({ requestId: "topic-1", topic: { id: 1, title: "Topic 1" } });
      }
      return Response.json({ error: { message: "topic failed", requestId: "bad-topic" } }, { status: 500 });
    });

    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--limit", "2", "--output-dir", outputDir, "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      topicCount: 1,
      errorCount: 1,
      requestIds: ["search", "topic-1", "bad-topic"]
    }));
    const collection = await readJson(join(outputDir, "collection.json"));
    expect((collection.errors as unknown[])).toHaveLength(1);
    expect(await readJson(join(outputDir, "topics", "1.json"))).toEqual(expect.objectContaining({ kind: "collection-topic", id: 1 }));
  });

  test("collection sync preserves request ids from every topic read", async () => {
    const outputDir = await tempPath("sync-request-ids");
    const topicRequestCounts = new Map<number, number>();
    const { program, stdout, stderr } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search-build", items: [{ id: 1 }, { id: 2 }] });
      }
      const id = Number(/\/api\/v1\/topics\/(\d+)/.exec(url)?.[1]);
      const requestCount = (topicRequestCounts.get(id) ?? 0) + 1;
      topicRequestCounts.set(id, requestCount);
      if (id === 2 && requestCount === 2) {
        return Response.json({ error: { message: "Topic not found", requestId: "topic-2-missing" } }, { status: 404 });
      }
      return Response.json({
        requestId: `topic-${id}-${requestCount === 1 ? "build" : "sync"}`,
        topic: { id, title: `Topic ${id}` }
      });
    });

    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--limit", "2", "--output-dir", outputDir, "--json"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "sync", "--dir", outputDir, "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "collection-sync",
      topicCount: 1,
      unchangedCount: 1,
      removedCount: 1,
      requestIds: ["topic-1-sync", "topic-2-missing"]
    }));
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

  test("collection index and query work offline", async () => {
    const outputDir = await tempPath("indexed");
    const { program, stdout, stderr, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1, title: "ORDS 401" }] });
      }
      return Response.json({
        requestId: "topic-1",
        topic: {
          id: 1,
          title: "ORDS 401 troubleshooting",
          content: "Check REST privilege, authentication scheme, and ORDS user mapping."
        }
      });
    });

    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "ORDS", "--output-dir", outputDir, "--json"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "index", "--dir", outputDir, "--json"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ kind: "collection-index", engine: "bm25", documentCount: 1 }));
    expect(await readFile(join(outputDir, "index.jsonl"), "utf8")).toContain("collection-index-record");
    const meta = await readJson(join(outputDir, "index.meta.json"));
    expect(meta).toEqual(expect.objectContaining({
      kind: "collection-index-meta",
      schemaVersion: 3,
      engine: "bm25",
      documentCount: 1,
      averageDocumentLength: expect.any(Number),
      fieldWeights: { title: 3, tags: 2, content: 1 }
    }));

    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "query", "ORDS 401", "--dir", outputDir, "--top-k", "5", "--explain", "--json"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    const query = JSON.parse(stdout.join(""));
    expect(query).toEqual(expect.objectContaining({ kind: "collection-query-result", engine: "bm25", topK: 5, resultCount: 1 }));
    expect(query.results[0]).toEqual(expect.objectContaining({
      topicId: 1,
      score: expect.any(Number),
      matchedTerms: expect.arrayContaining(["ords", "401"]),
      sourcePath: "topics/1.json",
      excerpt: expect.stringContaining("ORDS 401")
    }));
    expect(query.results[0].explain).toEqual(expect.objectContaining({
      terms: expect.arrayContaining([expect.objectContaining({ term: "ords", score: expect.any(Number) })])
    }));
    expect(query.results[0].explanation).toEqual(expect.objectContaining({ ords: expect.any(Number) }));

    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "stats", "--dir", outputDir, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "collection-index-stats",
      engine: "bm25",
      documentCount: 1,
      averageDocumentLength: expect.any(Number)
    }));
  });

  test("collection index fails when collection paths are invalid", async () => {
    const outputDir = await tempPath("index-invalid-path");
    const { program, stdout, stderr } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }] });
      }
      return Response.json({ requestId: "topic-1", topic: { id: 1, title: "Topic 1" } });
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--output-dir", outputDir]);
    const collection = await readJson(join(outputDir, "collection.json"));
    ((collection.files as { topics: Array<Record<string, unknown>> }).topics[0]).path = "../escape.json";
    await writeFile(join(outputDir, "collection.json"), `${JSON.stringify(collection, null, 2)}\n`, "utf8");
    stdout.length = 0;
    stderr.length = 0;
    process.exitCode = undefined;

    await program.parseAsync(["node", "apexcn", "collection", "index", "--dir", outputDir, "--json"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Collection verification failed before indexing");
    expect(process.exitCode).toBe(1);
  });

  test("collection query fails on malformed index records", async () => {
    const outputDir = await tempPath("query-malformed");
    const { program, stdout, stderr } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }] });
      }
      return Response.json({ requestId: "topic-1", topic: { id: 1, title: "Topic 1" } });
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "REST", "--output-dir", outputDir]);
    await writeFile(join(outputDir, "index.jsonl"), "{\"kind\":\"broken\"}\n", "utf8");
    stdout.length = 0;
    stderr.length = 0;
    process.exitCode = undefined;

    await program.parseAsync(["node", "apexcn", "collection", "query", "REST", "--dir", outputDir, "--json"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: "Invalid collection index: index.jsonl line 1 has an invalid schema"
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("collection query emits a JSON error when the index is missing", async () => {
    const outputDir = await tempPath("query-missing-index");
    const { program, stdout, stderr } = await configuredProgram();
    process.exitCode = undefined;

    await program.parseAsync(["node", "apexcn", "collection", "query", "REST", "--dir", outputDir, "--json"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: expect.stringContaining("Invalid collection index: ENOENT")
      }
    });
    expect(process.exitCode).toBe(1);
  });
});
