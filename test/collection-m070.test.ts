import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempPath(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "apexcn-m070-")), name);
}

async function configuredProgram(fetchImpl: typeof fetch) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const configPath = await tempPath("config.json");
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const program = createProgram({
    configPath,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  });
  await program.parseAsync([
    "node", "apexcn", "auth", "set-token",
    "--token", "abcdefghijklmnopqrstuvwxyz",
    "--base-url", "https://oracleapex.cn/ords/test",
    "--profile", "test@oci"
  ]);
  stdout.length = 0;
  return { program, stdout, stderr, fetch: vi.mocked(fetch) };
}

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
}

function topicResponse(id: number, content = `Content ${id}`, requestId = `topic-${id}`) {
  return Response.json({
    requestId,
    topic: {
      id,
      title: `Topic ${id}`,
      content,
      url: `https://oracleapex.cn/t/${id}`,
      updatedDate: "2026-07-20T00:00:00Z"
    }
  });
}

describe("roadmap 0.7 collection assets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("canonical content hashes ignore request ids and build time", async () => {
    let request = 0;
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: `search-${request += 1}`, items: [{ id: 1 }] });
      }
      return topicResponse(1, "Stable body", `topic-${request += 1}`);
    };
    const { program: firstProgram } = await configuredProgram(fetchImpl);
    const first = await tempPath("first");
    const second = await tempPath("second");

    await firstProgram.parseAsync(["node", "apexcn", "collection", "build", "--query", "ORDS", "--output-dir", first, "--json"]);
    const { program: secondProgram } = await configuredProgram(fetchImpl);
    await secondProgram.parseAsync(["node", "apexcn", "collection", "build", "--query", "ORDS", "--output-dir", second, "--json"]);

    const firstManifest = await readJson(join(first, "collection.json"));
    const secondManifest = await readJson(join(second, "collection.json"));
    expect(firstManifest.schemaVersion).toBe(2);
    expect(firstManifest.contentHash).toBe(secondManifest.contentHash);
    expect(firstManifest.topics[0].canonicalHash).toBe(secondManifest.topics[0].canonicalHash);
  });

  test("sync updates changed documents and incremental index reuses unchanged records", async () => {
    const contents = new Map([[1, "Alpha"], [2, "Beta"], [3, "Gamma"]]);
    const outputDir = await tempPath("incremental");
    const { program, stdout } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      }
      const id = Number(/topics\/(\d+)/.exec(url)?.[1]);
      return topicResponse(id, contents.get(id));
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "seed", "--limit", "3", "--output-dir", outputDir]);
    await program.parseAsync(["node", "apexcn", "collection", "index", "--dir", outputDir]);
    contents.set(2, "Beta changed");
    stdout.length = 0;

    await program.parseAsync(["node", "apexcn", "collection", "sync", "--dir", outputDir, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ changedCount: 1, unchangedCount: 2, removedCount: 0 }));
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "index", "--dir", outputDir, "--incremental", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ mode: "incremental", rebuiltCount: 1, reusedCount: 2 }));
    expect((await readFile(join(outputDir, "index.jsonl"), "utf8"))).toContain("Beta changed");
  });

  test("sync rejects a different active environment before any refresh request", async () => {
    const outputDir = await tempPath("source-boundary");
    const { program, stderr, fetch } = await configuredProgram(async (input) => {
      if (String(input).includes("/api/v1/search")) return Response.json({ items: [{ id: 4 }] });
      return topicResponse(4);
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "seed", "--output-dir", outputDir]);
    await program.parseAsync([
      "node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz",
      "--base-url", "https://wrong.example/ords/test", "--profile", "wrong@dev"
    ]);
    fetch.mockClear();
    stderr.length = 0;

    await program.parseAsync(["node", "apexcn", "collection", "sync", "--dir", outputDir, "--json"]);

    expect(JSON.parse(stderr.join(""))).toEqual(expect.objectContaining({ error: expect.objectContaining({ message: "Active profile base URL does not match the collection source." }) }));
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("export verify import and restore preserve collection files", async () => {
    const outputDir = await tempPath("source");
    const importedDir = await tempPath("imported");
    const bundle = await tempPath("bundle.json");
    const { program, stdout } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 7 }] });
      }
      return topicResponse(7, "Portable provenance");
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "portable", "--output-dir", outputDir]);
    await program.parseAsync(["node", "apexcn", "collection", "index", "--dir", outputDir]);

    await program.parseAsync(["node", "apexcn", "collection", "export", "--dir", outputDir, "--output", bundle]);
    const firstBundle = await readFile(bundle, "utf8");
    await program.parseAsync(["node", "apexcn", "collection", "index", "--dir", outputDir]);
    await program.parseAsync(["node", "apexcn", "collection", "export", "--dir", outputDir, "--output", bundle]);
    expect(await readFile(bundle, "utf8")).toBe(firstBundle);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "verify-bundle", "--bundle", bundle, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ ok: true, documentCount: 1 }));
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "import", "--bundle", bundle, "--output-dir", importedDir, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ documentCount: 1 }));
    await writeFile(join(importedDir, "topics", "7.json"), "corrupt\n", "utf8");
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "restore", "--bundle", bundle, "--dir", importedDir, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ restoredFileCount: expect.any(Number), documentCount: 1 }));
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "verify", "--dir", importedDir, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ ok: true, contentHash: expect.any(String) }));
  });

  test("offline automation performs zero network and suppresses duplicate output", async () => {
    const outputDir = await tempPath("offline");
    const planPath = await tempPath("plan.json");
    const resultPath = await tempPath("result.json");
    const { program, stdout } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 9 }] });
      }
      return topicResponse(9, "ORDS offline auth guidance");
    });
    await program.parseAsync(["node", "apexcn", "collection", "build", "--query", "offline", "--output-dir", outputDir]);
    const offlineFetch = vi.fn(async () => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", offlineFetch);
    await program.parseAsync([
      "node", "apexcn", "collection", "automation", "plan",
      "--dir", outputDir, "--query", "ORDS auth", "--output", planPath, "--json"
    ]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "automation", "run", "--plan", planPath, "--output", resultPath, "--json"]);
    const first = JSON.parse(stdout.join(""));
    expect(first).toEqual(expect.objectContaining({ networkRequests: 0, unattendedWriteRequests: 0, duplicateSuppressed: false }));
    expect(offlineFetch).not.toHaveBeenCalled();
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "automation", "run", "--plan", planPath, "--output", resultPath, "--json"]);
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ duplicateSuppressed: true }));
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  test("favorites import traverses the readonly export cursor and preserves provenance", async () => {
    const outputDir = await tempPath("favorites");
    const { program, stdout, fetch } = await configuredProgram(async (input, init) => {
      const url = String(input);
      expect((init?.method ?? "GET")).toBe("GET");
      if (url.endsWith("/api/v1/me/favorites/export?pageSize=2")) {
        return Response.json({
          requestId: "favorites-1",
          items: [
            { topicId: 11, title: "Favorite 11", content: "Body 11", url: "https://oracleapex.cn/t/11", relationCreatedDate: "2026-07-01", updatedDate: "2026-07-02", provenance: { source: "favorite", topicId: 11 } },
            { topicId: 12, title: "Favorite 12", content: "Body 12", url: "https://oracleapex.cn/t/12", relationCreatedDate: "2026-07-03", updatedDate: "2026-07-04", provenance: { source: "favorite", topicId: 12 } }
          ],
          page: { count: 2, hasMore: true, nextCursor: "next.favorite" }
        });
      }
      if (url.endsWith("/api/v1/me/favorites/export?pageSize=2&cursor=next.favorite")) {
        return Response.json({
          requestId: "favorites-2",
          items: [
            { topicId: 13, title: "Favorite 13", content: "Body 13", url: "https://oracleapex.cn/t/13", relationCreatedDate: "2026-07-05", updatedDate: "2026-07-06", provenance: { source: "favorite", topicId: 13 } },
            { targetId: 14, relationCreatedDate: "2026-07-07", unavailableReason: "TOPIC_NOT_FOUND", provenance: { source: "apexcn_favorites", topicAvailability: "unavailable" } }
          ],
          page: { count: 2, hasMore: false, nextCursor: null }
        });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    await program.parseAsync(["node", "apexcn", "collection", "favorites", "--page-size", "2", "--output-dir", outputDir, "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ topicCount: 3, unavailableCount: 1, pageCount: 2 }));
    expect(fetch).toHaveBeenCalledTimes(2);
    const artifact = await readJson(join(outputDir, "topics", "11.json"));
    expect(artifact.result.topic).toEqual(expect.objectContaining({ id: 11, content: "Body 11", url: "https://oracleapex.cn/t/11" }));
    expect(artifact.sources).toEqual([expect.objectContaining({ type: "favorite", provenance: expect.objectContaining({ source: "favorite", topicId: 11 }) })]);
    const manifest = await readJson(join(outputDir, "collection.json"));
    expect(manifest.errors).toEqual([expect.objectContaining({ topicId: 14, unavailableReason: "TOPIC_NOT_FOUND" })]);
    expect(process.exitCode).toBe(1);
  });

  test("bundle verification rejects tampering and unsafe duplicate paths", async () => {
    const bundlePath = await tempPath("tampered-bundle.json");
    const importDir = await tempPath("tampered-import");
    const { program, stdout } = await configuredProgram(async () => Response.json({}));
    const content = "{}\n";
    await writeFile(bundlePath, `${JSON.stringify({
      kind: "collection-bundle",
      schemaVersion: 1,
      collectionContentHash: "sha256:expected",
      documentCount: 1,
      files: [
        { path: "../escape.json", size: Buffer.byteLength(content), sha256: "wrong", content },
        { path: "../escape.json", size: Buffer.byteLength(content), sha256: "wrong", content }
      ],
      bundleHash: "sha256:wrong"
    }, null, 2)}\n`, "utf8");

    await program.parseAsync(["node", "apexcn", "collection", "verify-bundle", "--bundle", bundlePath, "--json"]);

    const report = JSON.parse(stdout.join(""));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "bundle-hash-mismatch" }),
      expect.objectContaining({ code: "unsafe-path" }),
      expect.objectContaining({ code: "duplicate-path" }),
      expect.objectContaining({ code: "file-hash-mismatch" })
    ]));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "collection", "import", "--bundle", bundlePath, "--output-dir", importDir, "--json"]);
    await expect(readFile(join(importDir, "collection.json"), "utf8")).rejects.toThrow();
    expect(process.exitCode).toBe(1);
  });

  test("automation rejects a tampered plan before any network request", async () => {
    const planPath = await tempPath("tampered-plan.json");
    const resultPath = await tempPath("result.json");
    const fetch = vi.fn(async () => { throw new Error("network forbidden"); });
    const { program, stdout, stderr } = await configuredProgram(fetch);
    vi.stubGlobal("fetch", fetch);
    await writeFile(planPath, `${JSON.stringify({
      kind: "collection-automation-plan",
      schemaVersion: 1,
      mode: "offline",
      collectionDir: "/tmp/not-used",
      queries: [],
      planHash: "sha256:tampered"
    }, null, 2)}\n`, "utf8");

    await program.parseAsync(["node", "apexcn", "collection", "automation", "run", "--plan", planPath, "--output", resultPath, "--json"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ message: "Collection automation plan hash mismatch." }) }));
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
