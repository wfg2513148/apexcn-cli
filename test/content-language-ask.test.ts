import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

afterEach(() => { vi.unstubAllGlobals(); process.exitCode = undefined; });

async function fixture(response?: (body: Record<string, unknown>) => Response) {
  const root = await mkdtemp(join(tmpdir(), "apexcn-ask-language-"));
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ current: "test", profiles: {
    test: { baseUrl: "https://community.invalid/ords/dev", token: "abcdefghijklmnopqrstuvwxyz" }
  }}));
  const calls: { url: URL; method?: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, method: init?.method, body });
    if (response) return response(body);
    return Response.json({ contentLanguage: body.lang, answer: "A grounded answer", requestId: "req_ask",
      references: [{ topicId: 42, title: "Stored article edition",
        threadUrl: `https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=server-checksum&lang=${body.lang}` }]
    });
  }));
  const output: string[] = [];
  const program = createProgram({ configPath, stdout: t => output.push(t), stderr: () => undefined });
  const override = (command: typeof program): void => { command.exitOverride(); command.commands.forEach(override); };
  override(program);
  const run = async (args: string[]) => { output.length = 0; await program.parseAsync(args, { from: "user" }); return JSON.parse(output.join("")); };
  return { run, calls };
}

test.each([
  ["How do I configure ORDS?", "中文历史上下文", undefined, "en"],
  ["如何配置 ORDS？", "English history", undefined, "zh-cn"],
  ["APEX の使用方法は？", undefined, undefined, "en"],
  ["Comment utiliser ORDS ?", undefined, undefined, "en"],
  ["English question", "中文上下文", "zh-cn", "zh-cn"],
  ["中文问题", "English history", "en", "en"]
])("ask selects the original question before composing context: %s", async (question, context, override, language) => {
  const { run, calls } = await fixture();
  const result = await run(["ask", question, ...(context ? ["--context", context] : []),
    ...(override ? ["--lang", override] : []), "--top-k", "2", "--json"]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: "POST", body: { lang: language, topK: 2 } });
  expect(calls[0].url.pathname).toBe("/ords/dev/api/v1/ask");
  expect(calls[0].url.searchParams.has("lang")).toBe(false);
  expect(calls[0].body.question).toBe(context ? `上下文：${context}\n追问：${question}` : question);
  expect(result.contentLanguage).toBe(language);
  expect(result.references[0].threadUrl).toBe(`https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=server-checksum&lang=${language}`);
});

test.each([
  ["no-trusted-references", () => Response.json({ answer: "Unsupported answer", references: [] })],
  ["low-confidence", () => Response.json({ answer: "Uncertain answer", confidence: "low", references: [{ topicId: 42 }] })],
  ["rate-limited", () => Response.json({ error: { message: "Rate limit exceeded", retryAfterSeconds: 12 } }, { status: 429 })]
])("English ask fallback remains English: %s", async (reason, response) => {
  const { run } = await fixture(response);
  const result = await run(["ask", "How do I configure ORDS?", "--json"]);
  expect(result.answerable).toBe(false);
  expect(result.fallback.reason).toBe(reason);
  expect(result.fallback.message).toMatch(/sources|confidence|rate limit/);
  expect(result.fallback.message).not.toMatch(/\p{Script=Han}/u);
  if (reason === "rate-limited") expect(result.fallback.message).toContain("Retry after 12 seconds");
});

test("ask rejects an invalid language before HTTP and does not retain an earlier override", async () => {
  const { run, calls } = await fixture();
  await expect(run(["ask", "English question", "--lang", "fr", "--json"])).rejects.toThrow();
  expect(calls).toHaveLength(0);
  await run(["ask", "English question", "--lang", "zh-cn", "--json"]);
  await run(["ask", "English question", "--json"]);
  await run(["ask", "中文问题", "--json"]);
  expect(calls.map(c => c.body.lang)).toEqual(["zh-cn", "en", "zh-cn"]);
});
