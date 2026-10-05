import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";
import { topicCanonicalHash } from "../src/core/knowledge/collection-assets.js";

afterEach(() => { vi.unstubAllGlobals(); process.exitCode = undefined; });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "apexcn-language-collection-"));
  const dir = join(root, "collection");
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ current: "test", profiles: {
    test: { baseUrl: "https://community.invalid/ords/dev", token: "abcdefghijklmnopqrstuvwxyz" }
  }}));
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); calls.push(url);
    const lang = url.searchParams.get("lang") ?? "zh-cn";
    const topic = { id: 42, topicId: 42, targetType: "THREAD", title: `${lang} APEX`,
      content: `${lang} original code and table`, contentLanguage: lang,
      translationStatus: "CURRENT", url: "https://oracleapex.cn/t/42" };
    if (url.pathname.endsWith("/export")) return Response.json({ requestId: "req_favorite", contentLanguage: lang,
      items: [topic], page: { hasMore: false } });
    if (url.pathname.endsWith("/search")) return Response.json({ requestId: "req_search", contentLanguage: lang,
      items: [topic], page: { hasMore: false } });
    return Response.json({ requestId: "req_topic", contentLanguage: lang, topic });
  }));
  const out: string[] = [];
  const errors: string[] = [];
  const program = createProgram({ configPath, stdout: t => out.push(t), stderr: t => errors.push(t) });
  const run = async (args: string[]) => {
    out.length = 0; errors.length = 0; process.exitCode = undefined;
    await program.parseAsync(args, { from: "user" });
    const result = out.join("").trim();
    return result ? JSON.parse(result) : undefined;
  };
  const manifest = async () => JSON.parse(await readFile(join(dir, "collection.json"), "utf8"));
  return { dir, root, run, calls, manifest, errors };
}

test.each(["build", "favorites"])("%s saves language and sync replays it", async (action) => {
  const { dir, root, run, calls, manifest } = await fixture();
  await run(["collection", action, ...(action === "build" ? ["--topic-id", "42"] : []), "--lang", "en", "--output-dir", dir, "--json"]);
  expect((await manifest()).source.requestedContentLanguage).toBe("en");
  expect(JSON.parse(await readFile(join(dir, "topics/42.json"), "utf8")).result.topic).toMatchObject({ contentLanguage: "en", translationStatus: "CURRENT" });
  calls.length = 0;
  await run(["collection", "sync", "--dir", dir, "--json"]);
  expect(calls.every(u => u.searchParams.get("lang") === "en")).toBe(true);
  expect(JSON.parse(await readFile(join(dir, "topics/42.json"), "utf8")).result.topic.content).toBe("en original code and table");
  const bundle = join(root, "bundle.json");
  const restored = join(root, "restored");
  await run(["collection", "export", "--dir", dir, "--output", bundle, "--json"]);
  expect((await run(["collection", "verify-bundle", "--bundle", bundle, "--json"])).ok).toBe(true);
  await run(["collection", "import", "--bundle", bundle, "--output-dir", restored, "--json"]);
  expect(JSON.parse(await readFile(join(restored, "collection.json"), "utf8")).source.requestedContentLanguage).toBe("en");
});

test.each([
  ["English APEX question", "en"], ["APEX 中文问题", "zh-cn"]
])("query-based collections infer and retain language: %s", async (query, language) => {
  const { dir, run, calls, manifest } = await fixture();
  await run(["collection", "build", "--query", query, "--output-dir", dir, "--json"]);
  expect((await manifest()).source.requestedContentLanguage).toBe(language);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls.every(u => u.searchParams.get("lang") === language)).toBe(true);
  calls.length = 0;
  await run(["collection", "sync", "--dir", dir, "--json"]);
  expect(calls.every(u => u.searchParams.get("lang") === language)).toBe(true);
  expect(JSON.parse(await readFile(join(dir, "topics/42.json"), "utf8")).result.topic.contentLanguage).toBe(language);
});

test("reusing the program does not retain a previous collection query language", async () => {
  const { root, run, calls } = await fixture();
  await run(["collection", "build", "--query", "中文 APEX", "--output-dir", join(root, "zh"), "--json"]);
  calls.length = 0;
  await run(["collection", "build", "--query", "English APEX", "--output-dir", join(root, "en"), "--json"]);
  expect(calls.every(u => u.searchParams.get("lang") === "en")).toBe(true);
});

test("legacy collections retain Chinese default and malformed language is rejected before network", async () => {
  const { dir, run, calls, manifest, errors } = await fixture();
  await run(["collection", "build", "--topic-id", "42", "--output-dir", dir, "--json"]);
  const data = await manifest(); delete data.source.requestedContentLanguage;
  await writeFile(join(dir, "collection.json"), JSON.stringify(data));
  calls.length = 0;
  await run(["collection", "sync", "--dir", dir, "--json"]);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(u => (u.searchParams.get("lang") ?? "zh-cn") === "zh-cn")).toBe(true);
  const invalid = await manifest(); invalid.source.requestedContentLanguage = "fr";
  await writeFile(join(dir, "collection.json"), JSON.stringify(invalid));
  calls.length = 0;
  await run(["collection", "sync", "--dir", dir, "--json"]);
  expect(process.exitCode).toBe(1);
  expect(calls).toHaveLength(0);
  expect(JSON.parse(errors.join("")).error).toMatchObject({ type: "validation", message: "collection.json has an invalid schema." });
});


test("legacy canonical hash remains byte-identical without request language", () => {
  const artifact = { id: 42, sources: [{ type: "explicit" }], request: { method: "GET", path: "/api/v1/topics/42" },
    result: { requestId: "req_legacy", topic: { id: 42, title: "Legacy APEX", content: "Original body" } } };
  expect(topicCanonicalHash(artifact)).toBe("sha256:59b92bebaabc7b6a30928b5407887177dbbf9c96ab83c9f9f15cceeb4f7210c9");
});


test.each(["en", "zh-cn"] as const)("manifest language tampering from %s fails before sync network", async language => {
  const { dir, run, calls, manifest, errors } = await fixture();
  await run(["collection", "build", "--topic-id", "42", "--lang", language, "--output-dir", dir, "--json"]);
  const data = await manifest(); data.source.requestedContentLanguage = language === "en" ? "zh-cn" : "en";
  await writeFile(join(dir, "collection.json"), JSON.stringify(data)); calls.length = 0;
  const report = await run(["collection", "verify", "--dir", dir, "--json"]);
  expect(report.ok).toBe(false);
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "collection-language-mismatch" })]));
  await run(["collection", "sync", "--dir", dir, "--json"]);
  expect(process.exitCode).toBe(1); expect(calls).toHaveLength(0);
  expect(JSON.parse(errors.join("")).error).toMatchObject({ type: "validation", message: "Collection verification failed before sync." });
});
