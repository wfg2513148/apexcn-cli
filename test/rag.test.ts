import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function configuredProgram(fetchImpl: typeof fetch) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const configPath = join(await mkdtemp(join(tmpdir(), "apexcn-rag-")), "config.json");
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

describe("local-AI RAG evidence retrieval", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("refuses an unsafe search result ID rather than fetching a rounded topic", async () => {
    const { program, stderr, fetch } = await configuredProgram(async () =>
      new Response('{"requestId":"req-search","items":[{"id":9007199254740993,"title":"unsafe"}]}', { headers: { "content-type": "application/json" } })
    );

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "example", "--query", "example", "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("refuses an imprecise topic detail ID rather than publishing it as evidence", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async (input) => {
      const body = String(input).includes("/api/v1/search")
        ? '{"items":[{"id":42,"title":"safe search"}]}'
        : '{"topic":{"id":9007199254740991.1,"title":"unsafe detail","threadUrl":"https://example.invalid/t/42"}}';
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "example", "--query", "example", "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(stdout.join("")).toBe("");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("refuses an unsafe reply ID string instead of rounding evidence", async () => {
    const { program, stdout, stderr } = await configuredProgram(async (input) => {
      const body = String(input).includes("/api/v1/search")
        ? '{"items":[{"id":42}]}'
        : '{"topic":{"id":42,"threadUrl":"https://example.invalid/t/42"},"replies":[{"replyId":"9007199254740993","content":"unsafe"}]}';
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "example", "--query", "example", "--json"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toMatch(/unsafe|imprecise/i);
    expect(stdout.join("")).toBe("");
  });

  test("allows an unrelated high-precision score and large author IDs in topic details", async () => {
    const { program, stdout } = await configuredProgram(async (input) => {
      const body = String(input).includes("/api/v1/search")
        ? '{"items":[{"id":42}]}'
        : '{"topic":{"id":42,"createdBy":9007199254740993,"author":{"id":9007199254740993},"score":0.123456789012345678,"threadUrl":"https://example.invalid/t/42","title":"safe"}}';
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "example", "--query", "example", "--json"]);

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdout.join("")).evidence).toEqual(expect.arrayContaining([expect.objectContaining({ topicId: 42 })]));
  });

  test("ignores an unsafe reply ID outside the three selected evidence replies", async () => {
    const { program, stdout } = await configuredProgram(async (input) => {
      const body = String(input).includes("/api/v1/search")
        ? '{"items":[{"id":42}]}'
        : '{"topic":{"id":42,"threadUrl":"https://example.invalid/t/42"},"replies":[{"replyId":1,"content":"a"},{"replyId":2,"content":"b"},{"replyId":3,"content":"c"},{"replyId":9007199254740993,"content":"unused"}]}';
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "example", "--query", "example", "--json"]);

    expect(process.exitCode).toBeUndefined();
    const result = JSON.parse(stdout.join(""));
    expect(result.evidence.filter((item: { type: string }) => item.type === "reply")).toHaveLength(3);
  });

  test("ignores an unsafe nested reply list that RAG does not consume", async () => {
    const { program, stdout } = await configuredProgram(async (input) => {
      const body = String(input).includes("/api/v1/search")
        ? '{"items":[{"id":42}]}'
        : '{"topic":{"id":42,"threadUrl":"https://example.invalid/t/42","replies":[{"replyId":9007199254740993}]}}';
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "example", "--query", "example", "--json"]);

    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdout.join("")).evidence).toEqual(expect.arrayContaining([expect.objectContaining({ topicId: 42 })]));
  });

  test("uses only readonly search and topic detail endpoints and emits citable evidence", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/search?lang=zh-cn&keyword=ORDS&pageSize=2")) {
        return Response.json({
          items: [{ id: 42, title: "ORDS 401" }],
          requestId: "req-search-ords"
        });
      }
      if (url.endsWith("/api/v1/search?lang=zh-cn&keyword=REST&pageSize=2")) {
        return Response.json({
          items: [{ id: 42, title: "ORDS 401" }, { id: 43, title: "REST 权限" }],
          requestId: "req-search-rest"
        });
      }
      if (url.endsWith("/api/v1/topics/42?lang=zh-cn")) {
        return Response.json({
          topic: {
            id: 42,
            title: "ORDS 401",
            content: "调用接口时返回 401。",
            threadUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=topic-42-checksum",
            originalUrl: "https://example.com/ords-401",
            updatedDate: "2026-07-23T10:00:00Z"
          },
          replies: [{
            replyId: 90,
            content: "检查 ORDS privilege 和 OAuth client role。",
            isUseful: true,
            replyUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=topic-42-checksum#post_90",
            updatedDate: "2026-07-23T11:00:00Z"
          }],
          requestId: "req-topic-42"
        });
      }
      if (url.endsWith("/api/v1/topics/43?lang=zh-cn")) {
        return Response.json({
          topic: {
            id: 43,
            title: "REST 权限",
            content: "REST Enabled SQL 权限说明。",
            threadUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:43&cs=topic-43-checksum"
          },
          replies: [],
          requestId: "req-topic-43"
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync([
      "node", "apexcn", "rag", "retrieve", "APEX 中 ORDS 401 怎么排查？",
      "--query", "ORDS",
      "--query", "REST",
      "--top-k", "2",
      "--json"
    ]);

    const output = JSON.parse(stdout.join(""));
    expect(output).toEqual(expect.objectContaining({
      kind: "rag-evidence-bundle",
      schemaVersion: 1,
      question: "APEX 中 ORDS 401 怎么排查？",
      queries: ["ORDS", "REST"],
      answerability: expect.objectContaining({ status: "answerable" }),
      provenance: expect.objectContaining({
        requestIds: expect.arrayContaining(["req-search-ords", "req-search-rest", "req-topic-42", "req-topic-43"]),
        sources: expect.arrayContaining([
          expect.objectContaining({
            evidenceId: "S1",
            title: "ORDS 401",
            communityUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=topic-42-checksum"
          })
        ])
      })
    }));
    expect(output.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceId: "S1",
        type: "topic",
        topicId: 42,
        communityUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=topic-42-checksum",
        originalUrl: "https://example.com/ords-401"
      }),
      expect.objectContaining({
        type: "correct-answer",
        topicId: 42,
        replyId: 90,
        communityUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=topic-42-checksum#post_90"
      })
    ]));
    expect(output.synthesisPolicy).toEqual(expect.objectContaining({
      visibleCitationLabel: "title",
      forbidBareEvidenceIdLabels: true
    }));
    const urls = fetch.mock.calls.map(([input]) => String(input));
    expect(urls).not.toEqual(expect.arrayContaining([expect.stringContaining("/api/v1/ask")]));
    expect(urls.every((url) => new URL(url).pathname.endsWith("/api/v1/search") || /\/api\/v1\/topics\/\d+$/.test(new URL(url).pathname))).toBe(true);
    expect(urls.every((url) => new URL(url).searchParams.get("lang") === "zh-cn")).toBe(true);
    expect(stderr.join("")).toBe("");
  });

  test("returns an explicit unanswerable bundle without falling back to app RAG", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ items: [], requestId: "req-empty" });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync([
      "node", "apexcn", "rag", "retrieve", "社区里不存在的问题",
      "--top-k", "3",
      "--json"
    ]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "rag-evidence-bundle",
      evidence: [],
      answerability: {
        status: "unanswerable",
        reasons: ["NO_COMMUNITY_EVIDENCE"]
      }
    }));
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/api/v1/ask")])
    );
  });

  test("does not invent a visual page when topic detail has no absolute App URL", async () => {
    const { program, stdout } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ items: [{ id: 77, title: "Missing link" }], requestId: "req-search" });
      }
      if (url.endsWith("/api/v1/topics/77")) {
        return Response.json({
          topic: { id: 77, title: "Missing link", content: "Evidence without an App URL." },
          replies: [],
          requestId: "req-topic"
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync([
      "node", "apexcn", "rag", "retrieve", "Missing link",
      "--query", "Missing link",
      "--json"
    ]);

    const output = JSON.parse(stdout.join(""));
    expect(output.evidence).toEqual([]);
    expect(output.answerability.status).toBe("unanswerable");
    expect(stdout.join("")).not.toContain("/visual");
    expect(stdout.join("")).not.toContain("/t/77");
  });

  test("falls back to the original question only when explicit queries return no topics", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/search?lang=zh-cn&keyword=watermark&pageSize=5")) {
        return Response.json({ items: [], requestId: "req-empty" });
      }
      if (url.includes("/api/v1/search?lang=zh-cn&keyword=") && url.includes("%E5%85%A8%E5%B1%80%E6%B0%B4%E5%8D%B0")) {
        return Response.json({
          items: [{ id: 51, title: "APEX 全局水印" }],
          requestId: "req-fallback"
        });
      }
      if (url.endsWith("/api/v1/topics/51?lang=zh-cn")) {
        return Response.json({
          topic: {
            id: 51,
            title: "APEX 全局水印",
            content: "在页面模板中统一加载水印。",
            threadUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:51&cs=topic-51-checksum"
          },
          replies: [],
          requestId: "req-topic"
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync([
      "node", "apexcn", "rag", "retrieve", "如何在 APEX 中设置全局水印？",
      "--query", "watermark",
      "--json"
    ]);

    const output = JSON.parse(stdout.join(""));
    expect(output.queries).toEqual(["watermark", "如何在 APEX 中设置全局水印？"]);
    expect(output.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ topicId: 51 })
    ]));
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/api/v1/ask")])
    );
  });

  test("retries the explicit query once when both explicit and question searches are empty", async () => {
    let explicitCalls = 0;
    const { program, stdout, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/search?lang=zh-cn&keyword=watermark&pageSize=5")) {
        explicitCalls += 1;
        return Response.json({
          items: explicitCalls === 2 ? [{ id: 52, title: "APEX 水印" }] : [],
          requestId: `req-explicit-${explicitCalls}`
        });
      }
      if (url.includes("/api/v1/search?lang=zh-cn&keyword=")) {
        return Response.json({ items: [], requestId: "req-question-empty" });
      }
      if (url.endsWith("/api/v1/topics/52?lang=zh-cn")) {
        return Response.json({
          topic: {
            id: 52,
            title: "APEX 水印",
            content: "水印实现。",
            threadUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:52&cs=topic-52-checksum"
          },
          replies: [],
          requestId: "req-topic"
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync([
      "node", "apexcn", "rag", "retrieve", "如何设置 APEX 全局水印？",
      "--query", "watermark",
      "--json"
    ]);

    const output = JSON.parse(stdout.join(""));
    expect(explicitCalls).toBe(2);
    expect(output.searchAttempts).toHaveLength(3);
    expect(output.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ topicId: 52 })
    ]));
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/api/v1/ask")])
    );
  });

  test("keeps the existing ask command on the App 100 RAG endpoint", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/ask") && init?.method === "POST") {
        return Response.json({
          answer: "Existing App 100 answer",
          references: [{
            topicId: 42,
            threadUrl: "https://oracleapex.cn/ords/f?p=102:14:::::P14_THREAD_ID:42&cs=topic-42-checksum"
          }],
          requestId: "req-existing-ask"
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync(["node", "apexcn", "ask", "保留现有问答", "--json"]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://oracleapex.cn/ords/test/api/v1/ask");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "ask-response",
      answer: "Existing App 100 answer",
      requestId: "req-existing-ask"
    }));
  });

  test("does not leak explicit queries into a later retrieval on the same program", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ items: [], requestId: `req-${fetch.mock.calls.length}` });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    });

    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "First", "--query", "ORDS", "--json"]);
    stdout.length = 0;
    fetch.mockClear();
    await program.parseAsync(["node", "apexcn", "rag", "retrieve", "Second APEX question", "--json"]);

    expect(JSON.parse(stdout.join("")).queries[0]).toBe("Second APEX question");
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("keyword=ORDS")])
    );
  });
});
