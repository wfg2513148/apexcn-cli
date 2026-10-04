import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";
import { SUPPORTED_API_CONTRACT_VERSIONS } from "../src/core/capability-compatibility.js";

afterEach(() => { vi.unstubAllGlobals(); process.exitCode = undefined; });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "apexcn-language-"));
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ current: "test", profiles: {
    test: { baseUrl: "https://community.invalid/ords/dev", token: "abcdefghijklmnopqrstuvwxyz" }
  }}));
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); calls.push(url);
    const lang = url.searchParams.get("lang") ?? "zh-cn";
    if (url.pathname.endsWith("/capabilities")) return Response.json({
      kind: "capabilities", contractVersion: "0.10.0-candidate",
      supportedContractVersions: [...SUPPORTED_API_CONTRACT_VERSIONS], requestId: "req_cap",
      capabilities: [{ id: "personal-community", available: true, endpoints: ["/me/search"] }]
    });
    if (url.pathname.endsWith("/me")) return Response.json({ user: { id: 1 }, requestId: "req_me" });
    if (url.pathname.endsWith("/topics/42")) return Response.json({ requestId: "req_detail", contentLanguage: lang,
      topic: { id: 42, createdBy: 1, title: lang === "en" ? "English APEX" : "中文 APEX",
        content: "Original ```code``` | table | 😀", translationStatus: "STALE",
        url: "https://oracleapex.cn/t/42", canonicalUrl: "https://oracleapex.cn/t/42" },
      replies: [{ id: 12, content: "原文回复", isUseful: true }]
    });
    return Response.json({ requestId: "req_list", contentLanguage: lang,
      items: [{ id: 42, topicId: 42, title: "APEX", url: "https://oracleapex.cn/t/42" }], page: { hasMore: false } });
  }));
  const output: string[] = [];
  const program = createProgram({ configPath, stdout: t => output.push(t), stderr: () => undefined });
  const override = (command: typeof program): void => { command.exitOverride(); command.commands.forEach(override); };
  override(program);
  const run = async (args: string[]) => { output.length = 0; await program.parseAsync(args, { from: "user" }); return JSON.parse(output.join("")); };
  return { program, run, calls };
}

test.each([
  ["category", "list"], ["stats", "category"], ["search", "APEX"],
  ["topic", "list"], ["topic", "recent"], ["topic", "view", "42"],
  ["me", "topics"], ["me", "replies"], ["me", "favorites"], ["me", "subscriptions"],
  ["me", "dashboard"], ["me", "search", "APEX"],
  ["research", "APEX"], ["rag", "retrieve", "APEX", "--query", "APEX"]
])("public language selection reaches every content request: %s", async (...args: string[]) => {
  const { run, calls } = await fixture();
  await run([...args, "--lang", "en", "--json"]);
  const reads = calls.filter(u => !u.pathname.endsWith("/me") && !u.pathname.endsWith("/capabilities") && !u.pathname.endsWith("/me/stats"));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(u => u.searchParams.get("lang") === "en")).toBe(true);
  expect(calls.filter(u => u.pathname.endsWith("/me") || u.pathname.endsWith("/capabilities")).every(u => !u.searchParams.has("lang"))).toBe(true);
});

test("a second parse returns to default language and invalid language sends no request", async () => {
  const { run, calls } = await fixture();
  await run(["category", "list", "--lang", "en", "--json"]);
  await run(["category", "list", "--json"]);
  expect(calls.at(-1)?.searchParams.has("lang")).toBe(false);
  calls.length = 0;
  await expect(run(["category", "list", "--lang", "fr", "--json"])).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test("manifest and derived evidence expose language without translating replies", async () => {
  const { run } = await fixture();
  const manifest = await run(["commands", "--json"]);
  expect(manifest.commands.find((c: { path: string }) => c.path === "topic view").options.join(" ")).toContain("--lang");
  const research = await run(["research", "APEX", "--lang", "en", "--json"]);
  expect(research.topics[0]).toMatchObject({ contentLanguage: "en", translationStatus: "STALE" });
  const rag = await run(["rag", "retrieve", "APEX", "--query", "APEX", "--lang", "en", "--json"]);
  expect(rag.evidence.find((e: { type: string }) => e.type === "topic")).toMatchObject({ contentLanguage: "en", translationStatus: "STALE" });
  expect(rag.evidence.find((e: { type: string }) => e.type === "correct-answer").content).toBe("原文回复");
});


test("all sixteen language commands and their topic alias have the documented option", async () => {
  const { run, calls } = await fixture(); const manifest = await run(["commands", "--json"]);
  const ids = new Set(["category.list", "stats.category", "search", "topic.list", "topic.recent", "topic.view", "me.dashboard", "me.search", "me.topics", "me.replies", "me.favorites", "me.subscriptions", "research", "rag.retrieve", "collection.build", "collection.favorites"]);
  const actual = manifest.commands.filter((c: { options: string[] }) => c.options.some(o => o.startsWith("--lang"))).map((c: { id: string }) => c.id);
  expect(new Set(actual)).toEqual(ids);
  await run(["thread", "view", "42", "--lang", "en", "--json"]);
  expect(calls.filter(u => u.pathname.endsWith("/topics/42")).length).toBeGreaterThan(0);
  expect(calls.filter(u => u.pathname.endsWith("/topics/42")).every(u => u.searchParams.get("lang") === "en")).toBe(true);
});
