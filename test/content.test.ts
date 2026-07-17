import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Command } from "commander";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-content-"));
  return join(dir, ".apexcn", "config.json");
}

async function configuredProgram(fetchImpl: typeof fetch, inputOptions: { readStdin?: () => Promise<string>; isStdinTTY?: () => boolean } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const program = createProgram({
    configPath: await tempConfigPath(),
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    ...inputOptions
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

function exitOverrideTree(command: Command): void {
  command.exitOverride((error) => {
    throw error;
  });
  for (const child of command.commands) {
    exitOverrideTree(child);
  }
}

function leafCommandPaths(command: Command, prefix: string[] = [], includeCurrent = false): string[] {
  const aliases = command.aliases();
  const names = [command.name(), ...aliases];
  const nextPrefixes = includeCurrent ? names.map((name) => [...prefix, name]) : [prefix];
  const current = hasActionHandler(command) ? nextPrefixes.map((parts) => parts.join(" ")).filter(Boolean) : [];
  if (command.commands.length === 0) {
    return current.length > 0 ? current : nextPrefixes.map((parts) => parts.join(" ")).filter(Boolean);
  }
  return [
    ...current,
    ...nextPrefixes.flatMap((parts) => command.commands.flatMap((child) => leafCommandPaths(child, parts, true)))
  ];
}

function hasActionHandler(command: Command): boolean {
  return Boolean((command as unknown as { _actionHandler?: unknown })._actionHandler);
}

function leafCommand(program: Command, path: string): Command {
  let current = program;
  for (const part of path.split(" ")) {
    const next = current.commands.find((command) => command.name() === part || command.aliases().includes(part));
    if (!next) {
      throw new Error(`Command not found: ${path}`);
    }
    current = next;
  }
  return current;
}

const apiDryRunCommands = [
  "topic create",
  "topic update",
  "topic edit",
  "topic delete",
  "thread create",
  "thread update",
  "thread edit",
  "thread delete",
  "reply create",
  "reply update",
  "reply edit",
  "reply delete",
  "post create",
  "post update",
  "post edit",
  "post delete",
  "favorite add",
  "favorite remove",
  "subscription add",
  "subscription remove"
].sort();

const neverApiDryRunCommands = [
  "auth set-token",
  "auth list",
  "auth use",
  "auth remove",
  "auth show",
  "auth logout",
  "auth audit",
  "admin list",
  "collection build",
  "collection index",
  "collection query",
  "collection stats",
  "collection verify",
  "commands",
  "doctor",
  "doctor snapshot",
  "draft reply",
  "draft question",
  "me",
  "me favorites",
  "me replies",
  "me stats",
  "me subscriptions",
  "me topics",
  "mcp inspect",
  "mcp serve",
  "mcp tools",
  "category list",
  "research",
  "review reply",
  "review topic",
  "search",
  "stats category",
  "stats tag",
  "stats topic",
  "topic list",
  "topic recent",
  "topic view",
  "thread list",
  "thread recent",
  "thread view",
  "ask",
  "workflow approve",
  "workflow audit-log",
  "workflow diff",
  "workflow export",
  "workflow policy init",
  "workflow plan",
  "workflow run",
  "workflow verify",
  "workflow verify-bundle"
].sort();

describe("content commands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.exitCode = undefined;
    delete process.env.APEXCN_HTTP_TIMEOUT_MS;
    delete process.env.APEXCN_ERROR_FORMAT;
  });

  test("category list prints categories as JSON", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({ items: [{ id: 2, name: "APEX 进阶技巧", canCreateTopic: true }], requestId: "req-cat" })
    );

    await program.parseAsync(["node", "apexcn", "category", "list", "--json"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/categories",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer abcdefghijklmnopqrstuvwxyz" }) })
    );
    expect(JSON.parse(stdout.join(""))).toEqual({
      items: [{ id: 2, name: "APEX 进阶技巧", canCreateTopic: true }],
      requestId: "req-cat"
    });
  });

  test("category list supports explicit output formats", async () => {
    const categoryPayload = { items: [{ id: 2, name: "APEX 进阶技巧", canCreateTopic: true }], requestId: "req-cat" };
    const cases = [
      { argv: ["node", "apexcn", "category", "list", "--format", "json"], expected: `${JSON.stringify(categoryPayload)}\n` },
      { argv: ["node", "apexcn", "category", "list", "--format", "pretty"], expected: `${JSON.stringify(categoryPayload, null, 2)}\n` },
      { argv: ["node", "apexcn", "category", "list", "--format", "text"], expected: "2\tAPEX 进阶技巧\n" },
      { argv: ["node", "apexcn", "category", "list", "--json", "--format", "pretty"], expected: `${JSON.stringify(categoryPayload, null, 2)}\n` }
    ];

    for (const item of cases) {
      const { program, stdout } = await configuredProgram(async () => Response.json(categoryPayload));

      await program.parseAsync(item.argv);

      expect(stdout.join("")).toBe(item.expected);
      vi.unstubAllGlobals();
    }
  });

  test("category list text output is empty for empty lists and sanitizes fields", async () => {
    const cases = [
      { payload: { items: [] }, expected: "" },
      { payload: { items: [{ id: 2, name: "APEX\t进阶\n技巧" }] }, expected: "2\tAPEX 进阶 技巧\n" }
    ];

    for (const item of cases) {
      const { program, stdout } = await configuredProgram(async () => Response.json(item.payload));

      await program.parseAsync(["node", "apexcn", "category", "list", "--format", "text"]);

      expect(stdout.join("")).toBe(item.expected);
      vi.unstubAllGlobals();
    }
  });

  test("stats commands call aggregate API endpoints", async () => {
    const responses: Record<string, unknown> = {
      "/api/v1/category-stats": { kind: "category-stats", items: [{ id: 4, name: "APEX", topicCount: 2, replyCount: 3, featuredCount: 1 }], requestId: "req-cat-stats" },
      "/api/v1/topic-stats": { kind: "topic-stats", topicCount: 10, featuredTopicCount: 2, tagCounts: [{ tag: "ORDS", topicCount: 3 }], requestId: "req-topic-stats" },
      "/api/v1/topic-stats?tag=ORDS&fromDate=2026-07-01&top=10": { kind: "topic-stats", tag: "ORDS", topicCount: 3, featuredTopicCount: 1, requestId: "req-topic-tag" },
      "/api/v1/tag-stats?fromDate=2026-07-01&toDate=2026-07-05&top=20": { kind: "tag-stats", items: [{ tag: "ORDS", topicCount: 3, matchMode: "exact" }], requestId: "req-tag-stats" }
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      const key = href.replace("https://oracleapex.cn/ords/test", "");
      return Response.json(responses[key] ?? { error: { message: `unexpected ${key}` } }, { status: responses[key] ? 200 : 500 });
    });

    const category = await configuredProgram(fetchImpl as typeof fetch);
    await category.program.parseAsync(["node", "apexcn", "stats", "category", "--format", "text"]);
    expect(category.stdout.join("")).toBe("4\tAPEX\t2\t3\t1\n");

    const topic = await configuredProgram(fetchImpl as typeof fetch);
    await topic.program.parseAsync(["node", "apexcn", "stats", "topic", "--json"]);
    expect(JSON.parse(topic.stdout.join("")).topicCount).toBe(10);

    const topicTag = await configuredProgram(fetchImpl as typeof fetch);
    await topicTag.program.parseAsync(["node", "apexcn", "stats", "topic", "--tag", "ORDS", "--from", "2026-07-01", "--top", "10", "--json"]);
    expect(JSON.parse(topicTag.stdout.join("")).tag).toBe("ORDS");

    const tag = await configuredProgram(fetchImpl as typeof fetch);
    await tag.program.parseAsync(["node", "apexcn", "stats", "tag", "--from-date", "2026-07-01", "--to-date", "2026-07-05", "--top", "20", "--format", "text"]);
    expect(tag.stdout.join("")).toBe("ORDS\t3\texact\n");

    expect(fetchImpl).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/category-stats", expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/topic-stats", expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/topic-stats?tag=ORDS&fromDate=2026-07-01&top=10", expect.any(Object));
    expect(fetchImpl).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/tag-stats?fromDate=2026-07-01&toDate=2026-07-05&top=20", expect.any(Object));
  });

  test("admin list calls public admin directory endpoint", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({ kind: "admin-list", items: [{ id: 1, nickname: "Admin", roleName: "Administrator", roleLevel: 10, publicContacts: [{ type: "site", value: "https://example.com" }] }], requestId: "req-admin" })
    );

    await program.parseAsync(["node", "apexcn", "admin", "list", "--format", "text"]);

    expect(fetch).toHaveBeenLastCalledWith("https://oracleapex.cn/ords/test/api/v1/admin-list", expect.any(Object));
    expect(stdout.join("")).toBe("1\tAdmin\tAdministrator\t10\tsite:https://example.com\n");
  });

  test("category list prints clean errors for non-JSON API failures", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () =>
      new Response("<html>outage</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "x-request-id": "req-html" }
      })
    );

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("HTTP 502: Bad Gateway requestId=req-html\n");
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(stderr.join("")).not.toContain("<html>");
    expect(process.exitCode).toBe(1);
  });

  test("category list redacts the active token from API error messages", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () =>
      Response.json(
        { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-token" } },
        { status: 403 }
      )
    );

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("HTTP 403: token [redacted] is not allowed requestId=req-token\n");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("rate-limit errors include retry timing in text and JSON stderr", async () => {
    const textCase = await configuredProgram(async () =>
      Response.json({ error: { message: "Too many requests", requestId: "req-rate", retryAfterSeconds: 12, windowSeconds: 60 } }, { status: 429 })
    );

    await textCase.program.parseAsync(["node", "apexcn", "search", "APEX"]);

    expect(textCase.stdout.join("")).toBe("");
    expect(textCase.stderr.join("")).toBe("HTTP 429: Too many requests requestId=req-rate retryAfterSeconds=12 windowSeconds=60 Retry after 12s.\n");
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    vi.unstubAllGlobals();

    const jsonCase = await configuredProgram(async () =>
      Response.json({ error: { message: "Too many requests", requestId: "req-rate", retryAfterSeconds: "9", windowSeconds: "30" } }, { status: 429 })
    );

    await jsonCase.program.parseAsync(["node", "apexcn", "search", "APEX", "--json"]);

    expect(JSON.parse(jsonCase.stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "http",
        message: "Too many requests",
        status: 429,
        requestId: "req-rate",
        retryAfterSeconds: 9,
        windowSeconds: 30,
        exitCode: 1
      }
    });
  });

  test("category list can print API errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const { program, stdout, stderr, fetch } = await configuredProgram(async () =>
      Response.json(
        { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-token" } },
        { status: 403 }
      )
    );

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "http",
        message: "token [redacted] is not allowed",
        status: 403,
        requestId: "req-token",
        exitCode: 1
      }
    });
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("category list can print missing profile errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "no-profile",
        message: "No active profile",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("category list can print config errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not-json", "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "config",
        message: `Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.`,
        exitCode: 1
      }
    });
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(process.exitCode).toBe(1);
  });

  test("category list prints clean errors for network failures", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw new TypeError("fetch failed");
    });

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Network error: failed to reach https://oracleapex.cn/ords/test/api/v1/categories\n");
    expect(stderr.join("")).not.toContain("TypeError");
    expect(stderr.join("")).not.toContain("fetch failed");
    expect(stderr.join("")).not.toContain("src/");
    expect(process.exitCode).toBe(1);
  });

  test("category list can print network errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw new TypeError("fetch failed");
    });

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "network",
        message: "Network error: failed to reach https://oracleapex.cn/ords/test/api/v1/categories",
        exitCode: 1
      }
    });
    expect(stderr.join("")).not.toContain("TypeError");
    expect(stderr.join("")).not.toContain("fetch failed");
    expect(process.exitCode).toBe(1);
  });

  test("category list reports timeout failures from the default HTTP timeout", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "5";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw timeout;
    });

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/categories\n");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("category list can print timeout errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    process.env.APEXCN_HTTP_TIMEOUT_MS = "5";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw timeout;
    });

    await program.parseAsync(["node", "apexcn", "category", "list"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "timeout",
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/categories",
        exitCode: 1
      }
    });
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("search calls the keyword API with pageSize and date filters", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({ items: [{ id: 42, title: "APEX topic" }], page: { limit: 2 }, requestId: "req-search" })
    );

    await program.parseAsync(["node", "apexcn", "search", "APEX", "--page-size", "2", "--from-date", "2026-01-01", "--to-date", "2026-12-31", "--json"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=2&fromDate=2026-01-01&toDate=2026-12-31",
      expect.any(Object)
    );
    expect(JSON.parse(stdout.join("")).items[0].id).toBe(42);
  });

  test("search normalizes common ApexLang keyword variants", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({ items: [{ id: 42, title: "ApexLang topic" }], requestId: "req-search" })
    );

    await program.parseAsync(["node", "apexcn", "search", "APEX Lang", "--json"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=ApexLang",
      expect.any(Object)
    );
    expect(JSON.parse(stdout.join("")).query).toEqual({
      keyword: "APEX Lang",
      normalizedKeyword: "ApexLang"
    });
  });

  test("search supports explicit output formats", async () => {
    const payload = {
      items: [
        { id: 42, title: "APEX topic", url: "https://oracleapex.cn/t/42" },
        { id: 43, title: "ORDS topic" }
      ],
      page: { limit: 2 },
      requestId: "req-search"
    };
    const cases = [
      { argv: ["node", "apexcn", "search", "APEX", "--format", "json"], expected: `${JSON.stringify(payload)}\n` },
      { argv: ["node", "apexcn", "search", "APEX", "--format", "pretty"], expected: `${JSON.stringify(payload, null, 2)}\n` },
      {
        argv: ["node", "apexcn", "search", "APEX", "--format", "text"],
        expected: [
          ["42", "APEX topic", "", "", "", "", "", "", "", "", "", "https://oracleapex.cn/t/42"].join("\t"),
          ["43", "ORDS topic", "", "", "", "", "", "", "", "", "", ""].join("\t"),
          ""
        ].join("\n")
      },
      { argv: ["node", "apexcn", "search", "APEX", "--json", "--format", "pretty"], expected: `${JSON.stringify(payload, null, 2)}\n` }
    ];

    for (const item of cases) {
      const { program, stdout } = await configuredProgram(async () => Response.json(payload));

      await program.parseAsync(item.argv);

      expect(stdout.join("")).toBe(item.expected);
      vi.unstubAllGlobals();
    }
  });

  test("search text output suggests fallbacks for empty lists and sanitizes fields", async () => {
    const cases = [
      {
        payload: { items: [], requestId: "req-empty" },
        expected: [
          "No results for \"APEX\".",
          "Try:",
          "- Try fewer or broader keywords.",
          "- Try related Chinese and English terms.",
          "- Remove category, tag, author, or date filters if you used them.",
          "Related commands:",
          "- apexcn search \"APEX\" --page-size 10 --json",
          "- apexcn research \"APEX\" --limit 5 --json",
          "- apexcn topic recent --page-size 10 --json",
          "requestId: req-empty",
          ""
        ].join("\n")
      },
      {
        payload: { items: [{ id: 42, title: "APEX\ttopic\none", url: "https://oracleapex.cn/t/42\nref" }] },
        expected: `${["42", "APEX topic one", "", "", "", "", "", "", "", "", "", "https://oracleapex.cn/t/42 ref"].join("\t")}\n`
      }
    ];

    for (const item of cases) {
      const { program, stdout } = await configuredProgram(async () => Response.json(item.payload));

      await program.parseAsync(["node", "apexcn", "search", "APEX", "--format", "text"]);

      expect(stdout.join("")).toBe(item.expected);
      vi.unstubAllGlobals();
    }
  });

  test("search JSON includes empty result guidance", async () => {
    const { program, stdout } = await configuredProgram(async () => Response.json({ items: [], requestId: "req-empty-json" }));

    await program.parseAsync(["node", "apexcn", "search", "APEX", "--json"]);

    const output = JSON.parse(stdout.join(""));
    expect(output).toEqual(expect.objectContaining({
      items: [],
      requestId: "req-empty-json",
      query: { keyword: "APEX" },
      emptyResult: expect.objectContaining({
        message: "No results for \"APEX\".",
        suggestions: expect.arrayContaining(["Try fewer or broader keywords."]),
        commands: expect.arrayContaining([
          "apexcn research \"APEX\" --limit 5 --json"
        ])
      })
    }));
  });

  test("search accepts the maximum page size", async () => {
    const { program, fetch } = await configuredProgram(async () =>
      Response.json({ items: [], page: { limit: 50 }, requestId: "req-search" })
    );

    await program.parseAsync(["node", "apexcn", "search", "APEX", "--page-size", "50"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=50",
      expect.any(Object)
    );
  });

  test("search allows single-sided date filters", async () => {
    const cases = [
      {
        argv: ["node", "apexcn", "search", "APEX", "--from-date", "2026-01-01"],
        url: "https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&fromDate=2026-01-01"
      },
      {
        argv: ["node", "apexcn", "search", "APEX", "--to-date", "2026-12-31"],
        url: "https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&toDate=2026-12-31"
      }
    ];

    for (const item of cases) {
      const { program, fetch } = await configuredProgram(async () =>
        Response.json({ items: [], page: { limit: 2 }, requestId: "req-search" })
      );

      await program.parseAsync(item.argv);

      expect(fetch).toHaveBeenLastCalledWith(item.url, expect.any(Object));
      vi.unstubAllGlobals();
    }
  });

  test("topic recent uses the topics list API when available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T08:27:20Z"));
    const { program, stdout, fetch } = await configuredProgram(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/v1/topics")) {
        return Response.json({
          items: [
            { id: 42, title: "Recent topic", createdDate: "2026-07-03T00:00:00", updatedDate: "2026-07-04T08:00:00", originalUrl: "https://example.com/original", url: "https://oracleapex.cn/t/42" },
            { id: 43, title: "Old topic", createdDate: "2026-07-01T00:00:00", updatedDate: "2026-07-01T08:00:00", url: "https://oracleapex.cn/t/43" }
          ],
          page: { limit: 5, count: 2, hasMore: true, nextCursor: "cursor-2" },
          requestId: "req-topics"
        });
      }
      return Response.json({ error: { message: `unexpected url ${href}` } }, { status: 500 });
    });

    await program.parseAsync(["node", "apexcn", "topic", "recent", "--page-size", "5", "--json"]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/topics?pageSize=5&fromDate=2026-07-02",
      expect.any(Object)
    );
    expect(fetch).toHaveBeenCalledOnce();
    const data = JSON.parse(stdout.join(""));
    expect(data).toEqual(expect.objectContaining({
      kind: "topic-recent",
      source: "topics",
      query: expect.objectContaining({
        pageSize: 5,
        sinceHours: 48,
        fromDate: "2026-07-02"
      }),
      page: { limit: 5, count: 2, hasMore: true, nextCursor: "cursor-2" },
      requestIds: { topics: ["req-topics"] },
      errors: []
    }));
    expect(data.items).toEqual([
      expect.objectContaining({
        id: 42,
        title: "Recent topic",
        createdDate: "2026-07-03T00:00:00",
        updatedDate: "2026-07-04T08:00:00",
        originalUrl: "https://example.com/original"
      })
    ]);
  });

  test("topic recent falls back to search and detail fetches on old servers", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/v1/topics?")) {
        return Response.json({ error: { message: "method not allowed" } }, { status: 405 });
      }
      if (href.includes("/api/v1/search")) {
        return Response.json({
          items: [{ id: 42, title: "Recent topic", updatedDate: "2026-07-03T08:00:00", url: "https://oracleapex.cn/t/42" }],
          requestId: "req-search"
        });
      }
      return Response.json({
        topic: {
          id: 42,
          title: "Recent topic",
          createdDate: "2026-07-03T00:00:00",
          updatedDate: "2026-07-03T08:00:00",
          url: "https://oracleapex.cn/t/42"
        },
        requestId: "req-topic"
      });
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "recent",
      "--category-id",
      "4",
      "--cursor",
      "cursor-1",
      "--from-date",
      "2026-07-01",
      "--to-date",
      "2026-07-04",
      "--format",
      "text"
    ]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/topics?pageSize=20&categoryId=4&cursor=cursor-1&fromDate=2026-07-01&toDate=2026-07-04",
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=%25&pageSize=20&categoryId=4&cursor=cursor-1&fromDate=2026-07-01&toDate=2026-07-04",
      expect.any(Object)
    );
    expect(stdout.join("")).toBe(`${["42", "Recent topic", "", "", "2026-07-03T08:00:00", "", "", "", "", "", "", "https://oracleapex.cn/t/42"].join("\t")}\n`);
  });

  test("research searches and fetches topic details as a bundle", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/v1/search")) {
        return Response.json({
          items: [
            { id: 42, title: "REST API", url: "https://oracleapex.cn/t/42", updatedDate: "2026-06-02" },
            { topicId: 43, title: "ORDS", threadUrl: "https://oracleapex.cn/t/43", createdDate: "2026-06-03" },
            { id: 44, title: "Ignored" }
          ],
          requestId: "req-search"
        });
      }
      if (href.endsWith("/api/v1/topics/42")) {
        return Response.json({
          topic: {
            id: 42,
            title: "REST API",
            url: "https://oracleapex.cn/t/42",
            originalUrl: "https://oracleapex.cn/original/42",
            createdDate: "2026-06-01",
            content: "Use REST Source modules."
          },
          requestId: "req-topic-42"
        });
      }
      if (href.endsWith("/api/v1/topics/43")) {
        return Response.json({
          topic: {
            id: 43,
            title: "ORDS",
            threadUrl: "https://oracleapex.cn/t/43",
            body: "Configure ORDS credentials."
          },
          requestId: "req-topic-43"
        });
      }
      return Response.json({ error: { message: "unexpected url" } }, { status: 500 });
    });
    const { program, stdout, fetch } = await configuredProgram(fetchImpl as typeof fetch);

    await program.parseAsync([
      "node",
      "apexcn",
      "research",
      "REST API",
      "--limit",
      "2",
      "--category-id",
      "4",
      "--from-date",
      "2026-01-01",
      "--to-date",
      "2026-12-31",
      "--json"
    ]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=REST+API&pageSize=2&categoryId=4&fromDate=2026-01-01&toDate=2026-12-31",
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(2, "https://oracleapex.cn/ords/test/api/v1/topics/42", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(3, "https://oracleapex.cn/ords/test/api/v1/topics/43", expect.any(Object));
    const data = JSON.parse(stdout.join(""));
    expect(data.query).toEqual({
      keyword: "REST API",
      limit: 2,
      categoryId: 4,
      fromDate: "2026-01-01",
      toDate: "2026-12-31"
    });
    expect(data.items).toHaveLength(2);
    expect(data.topics.map((topic: { id: number }) => topic.id)).toEqual([42, 43]);
    expect(data.links).toHaveLength(2);
    expect(data.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 42,
        url: "https://oracleapex.cn/t/42",
        originalUrl: "https://oracleapex.cn/original/42",
        createdDate: "2026-06-01",
        updatedDate: "2026-06-02"
      }),
      expect.objectContaining({ id: 43, url: "https://oracleapex.cn/t/43", createdDate: "2026-06-03" })
    ]));
    expect(data.requestIds).toEqual({ search: "req-search", topics: ["req-topic-42", "req-topic-43"] });
  });

  test("research supports text output and empty results", async () => {
    const textProgram = await configuredProgram(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/v1/search")) {
        return Response.json({ items: [{ id: 42, title: "REST API" }] });
      }
      return Response.json({ topic: { id: 42, title: "REST API", url: "https://oracleapex.cn/t/42", content: "Line 1\nLine 2" } });
    });

    await textProgram.program.parseAsync(["node", "apexcn", "research", "REST", "--format", "text"]);

    expect(textProgram.stdout.join("")).toContain("Research: REST");
    expect(textProgram.stdout.join("")).toContain("Topics: 1");
    expect(textProgram.stdout.join("")).toContain("URL: https://oracleapex.cn/t/42");
    expect(textProgram.stdout.join("")).toContain("Excerpt:\nLine 1\nLine 2");

    const emptyProgram = await configuredProgram(async () => Response.json({ items: [], requestId: "req-empty" }));

    await emptyProgram.program.parseAsync(["node", "apexcn", "research", "REST", "--format", "text"]);

    expect(emptyProgram.stdout.join("")).toBe("Research: REST\nTopics: 0\n");
  });

  test("research accepts --top-k as a --limit alias", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/v1/search")) {
        return Response.json({ items: [{ id: 42, title: "REST API" }], requestId: "req-search" });
      }
      return Response.json({ topic: { id: 42, title: "REST API", content: "ok" }, requestId: "req-topic-42" });
    });

    await program.parseAsync(["node", "apexcn", "research", "REST", "--top-k", "1", "--json"]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=REST&pageSize=1",
      expect.any(Object)
    );
    const data = JSON.parse(stdout.join(""));
    expect(data.query).toEqual({ keyword: "REST", limit: 1 });
    expect(data.topics).toHaveLength(1);
  });

  test("research keeps partial bundles when one topic fetch fails", async () => {
    const { program, stdout, fetch } = await configuredProgram(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/api/v1/search")) {
        return Response.json({
          items: [
            { id: 42, title: "REST API" },
            { id: 43, title: "Missing topic" }
          ],
          requestId: "req-search"
        });
      }
      if (href.endsWith("/api/v1/topics/42")) {
        return Response.json({ topic: { id: 42, title: "REST API", content: "ok" }, requestId: "req-topic-42" });
      }
      return Response.json({ error: { message: "not found", requestId: "req-topic-43" } }, { status: 404 });
    });

    await program.parseAsync(["node", "apexcn", "research", "REST", "--limit", "2", "--format", "json"]);

    expect(fetch).toHaveBeenCalledTimes(3);
    const data = JSON.parse(stdout.join(""));
    expect(data.items).toHaveLength(2);
    expect(data.topics).toEqual([
      expect.objectContaining({ id: 42, title: "REST API", sourceItemIndex: 0, requestId: "req-topic-42" })
    ]);
    expect(data.errors).toEqual([
      expect.objectContaining({ id: 43, sourceItemIndex: 1, type: "http", status: 404, requestId: "req-topic-43" })
    ]);
    expect(process.exitCode).toBe(1);
  });

  test("research rejects invalid limits before making API requests", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));
    exitOverrideTree(program);

    await expect(program.parseAsync(["node", "apexcn", "research", "APEX", "--limit", "11"])).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Expected --limit to be between 1 and 10");
  });

  test("search rejects invalid date filters before making API requests", async () => {
    const cases = [
      ["node", "apexcn", "search", "APEX", "--from-date", "20260101"],
      ["node", "apexcn", "search", "APEX", "--from-date", "2026-02-30"],
      ["node", "apexcn", "search", "APEX", "--to-date", "2026-13-01"],
      ["node", "apexcn", "search", "APEX", "--to-date", "2026-1-1"]
    ];

    for (const argv of cases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));
      exitOverrideTree(program);

      await expect(program.parseAsync(argv)).rejects.toMatchObject({
        code: "commander.invalidArgument"
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toContain("Expected YYYY-MM-DD date");
      expect(stderr.join("")).not.toContain("src/commands/content");
      vi.unstubAllGlobals();
    }
  });

  test("search rejects reversed date ranges before making API requests", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));

    await program.parseAsync([
      "node",
      "apexcn",
      "search",
      "APEX",
      "--from-date",
      "2026-12-31",
      "--to-date",
      "2026-01-01"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("--from-date must be earlier than or equal to --to-date\n");
    expect(process.exitCode).toBe(1);
  });

  test("search rejects reversed date ranges before loading a profile", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "search",
      "APEX",
      "--from-date",
      "2026-12-31",
      "--to-date",
      "2026-01-01"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("--from-date must be earlier than or equal to --to-date\n");
    expect(stderr.join("")).not.toContain("No active profile");
    expect(process.exitCode).toBe(1);
  });

  test("search can print reversed date range errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "search",
      "APEX",
      "--from-date",
      "2026-12-31",
      "--to-date",
      "2026-01-01"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: "--from-date must be earlier than or equal to --to-date",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("search passes cursor and offset pagination parameters", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () =>
      Response.json({ items: [{ id: 42, title: "Paged topic" }], page: { limit: 5, count: 1, hasMore: false }, requestId: "req-search" })
    );

    await program.parseAsync(["node", "apexcn", "search", "APEX", "--page-size", "5", "--cursor", "cursor-1", "--offset", "5", "--json"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=5&cursor=cursor-1&offset=5",
      expect.any(Object)
    );
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join("")).items[0].id).toBe(42);
    expect(process.exitCode).toBeUndefined();
  });

  test("search passes v0.4 server-side filters without renaming", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () =>
      Response.json({
        items: [{
          id: 42,
          title: "Filtered topic",
          categoryName: "APEX",
          createdByName: "Author",
          updatedDate: "2026-07-05",
          sourceDomain: "example.com",
          tags: "APEX,ORDS",
          replyCount: 3,
          usefulReplyCount: 1,
          viewCount: 99,
          isFeatured: true,
          isPinned: true,
          isLocked: true,
          canonicalUrl: "https://oracleapex.cn/t/42"
        }],
        requestId: "req-search"
      })
    );

    await program.parseAsync([
      "node",
      "apexcn",
      "search",
      "ORDS",
      "--tag",
      "APEX",
      "--tags",
      "APEX,ORDS",
      "--author",
      "Wang",
      "--author-id",
      "1",
      "--source-domain",
      "example.com",
      "--original-url",
      "docs",
      "--content-type",
      "article",
      "--source-type",
      "external",
      "--status",
      "useful",
      "--view",
      "popular",
      "--sort",
      "viewCount",
      "--featured",
      "--pinned",
      "--locked",
      "--unanswered",
      "--has-useful-reply",
      "--from",
      "2026-07-01",
      "--to",
      "2026-07-05",
      "--page-size",
      "20",
      "--cursor",
      "cursor-1",
      "--format",
      "text"
    ]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/search?keyword=ORDS&pageSize=20&cursor=cursor-1&fromDate=2026-07-01&toDate=2026-07-05&tag=APEX&tags=APEX%2CORDS&author=Wang&authorId=1&sourceDomain=example.com&originalUrl=docs&contentType=article&sourceType=external&status=useful&view=popular&sort=viewCount&featured=true&pinned=true&locked=true&unanswered=true&hasUsefulReply=true",
      expect.any(Object)
    );
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("42\tFiltered topic\tAPEX\tAuthor\t2026-07-05\texample.com\tAPEX,ORDS\t3\t1\t99\tfeatured,pinned,locked\thttps://oracleapex.cn/t/42\n");
  });

  test("topic list calls topics endpoint with v0.4 filters", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({
        items: [{ id: 51, title: "Unanswered", threadUrl: "https://oracleapex.cn/t/51" }],
        page: { hasMore: true, nextCursor: "next-1" },
        requestId: "req-topics"
      })
    );

    await program.parseAsync(["node", "apexcn", "thread", "list", "--view", "unanswered", "--source-domain", "example.com", "--sort", "updated", "--page-size", "20", "--json"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/topics?pageSize=20&sourceDomain=example.com&view=unanswered&sort=updated",
      expect.any(Object)
    );
    expect(JSON.parse(stdout.join("")).page.nextCursor).toBe("next-1");
  });

  test("search rejects empty cursors before making API requests", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));
    exitOverrideTree(program);

    await expect(program.parseAsync(["node", "apexcn", "search", "APEX", "--cursor", " "])).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Expected a non-empty cursor");
  });

  test("search help exposes pagination and describes json as pretty-print", () => {
    const program = createProgram();
    const search = program.commands.find((command) => command.name() === "search");

    expect(search).toBeDefined();
    expect(search?.helpInformation()).toContain("--cursor");
    expect(search?.helpInformation()).toContain("--offset");
    expect(search?.helpInformation()).toContain("--json");
    expect(search?.helpInformation()).toContain("--format");
    expect(search?.helpInformation()).toContain("page size, 1-50");
    expect(search?.helpInformation()).toContain("pretty-print JSON");
  });

  test("format option is exposed only on read commands with text output", () => {
    const program = createProgram();
    const formatCommands = ["doctor", "doctor snapshot", "draft reply", "draft question", "review reply", "review topic", "workflow audit-log", "workflow plan", "admin list", "me", "me favorites", "me replies", "me stats", "me subscriptions", "me topics", "category list", "search", "stats category", "stats tag", "stats topic", "research", "topic list", "topic recent", "topic view", "thread list", "thread recent", "thread view", "ask"];

    for (const path of leafCommandPaths(program)) {
      if (formatCommands.includes(path)) {
        expect(leafCommand(program, path).helpInformation()).toContain("--format");
      } else {
        expect(leafCommand(program, path).helpInformation()).not.toContain("--format");
      }
    }
  });

  test("format options reject ambiguous or invalid output selections", async () => {
    const invalidCases = [
      ["node", "apexcn", "category", "list", "--format", "xml"],
      ["node", "apexcn", "search", "APEX", "--format", "yaml"],
      ["node", "apexcn", "topic", "list", "--format", "yaml"],
      ["node", "apexcn", "topic", "recent", "--format", "yaml"],
      ["node", "apexcn", "topic", "view", "42", "--format", "xml"],
      ["node", "apexcn", "me", "--format", "yaml"],
      ["node", "apexcn", "me", "stats", "--format", "yaml"],
      ["node", "apexcn", "stats", "topic", "--format", "yaml"],
      ["node", "apexcn", "admin", "list", "--format", "yaml"],
      ["node", "apexcn", "ask", "Q", "--format", "yaml"]
    ];

    for (const argv of invalidCases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));
      exitOverrideTree(program);

      await expect(program.parseAsync(argv)).rejects.toMatchObject({
        code: "commander.invalidArgument"
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).not.toContain("src/commands/content");
      vi.unstubAllGlobals();
    }

    const ambiguousCases = [
      ["node", "apexcn", "category", "list", "--json", "--format", "text"],
      ["node", "apexcn", "search", "APEX", "--json", "--format", "json"],
      ["node", "apexcn", "topic", "list", "--json", "--format", "text"],
      ["node", "apexcn", "topic", "view", "42", "--json", "--format", "text"],
      ["node", "apexcn", "me", "--json", "--format", "json"],
      ["node", "apexcn", "me", "topics", "--json", "--format", "json"],
      ["node", "apexcn", "stats", "category", "--json", "--format", "text"],
      ["node", "apexcn", "ask", "Q", "--json", "--format", "json"]
    ];

    for (const argv of ambiguousCases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));

      await program.parseAsync(argv);

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(JSON.parse(stderr.join(""))).toEqual({
        ok: false,
        error: {
          type: "validation",
          message: "--json can only be combined with --format pretty",
          exitCode: 1
        }
      });
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
  });

  test("format ambiguity can print validation errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "category", "list", "--json", "--format", "text"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "validation",
        message: "--json can only be combined with --format pretty",
        exitCode: 1
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("all leaf commands have an API dry-run classification", () => {
    const program = createProgram();
    const actual = leafCommandPaths(program).sort();
    const classified = [...apiDryRunCommands, ...neverApiDryRunCommands].sort();

    expect(classified).toEqual(actual);
  });

  test("API dry-run is exposed only for community API write commands", () => {
    const program = createProgram();

    for (const path of apiDryRunCommands) {
      expect(leafCommand(program, path).helpInformation()).toContain("--dry-run");
      expect(leafCommand(program, path).helpInformation()).toContain("--preview");
    }
    for (const path of neverApiDryRunCommands) {
      expect(leafCommand(program, path).helpInformation()).not.toContain("--dry-run");
      expect(leafCommand(program, path).helpInformation()).not.toContain("--preview");
    }
  });

  test("commands that never support API dry-run remain excluded", () => {
    const program = createProgram();

    for (const path of neverApiDryRunCommands) {
      expect(leafCommand(program, path).helpInformation()).not.toContain("--dry-run");
      expect(leafCommand(program, path).helpInformation()).not.toContain("--preview");
    }
  });

  test("numeric options print a CLI error instead of a stack trace", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });
    exitOverrideTree(program);

    await expect(program.parseAsync(["node", "apexcn", "search", "APEX", "--page-size", "nope"])).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Invalid number: nope");
    expect(stderr.join("")).not.toContain("src/commands/content");
  });

  test("numeric options reject zero or negative values where they do not make sense", async () => {
    const cases = [
      {
        argv: ["node", "apexcn", "search", "APEX", "--page-size", "0"],
        message: "Expected a positive integer"
      },
      {
        argv: ["node", "apexcn", "search", "APEX", "--category-id", "-1"],
        message: "Expected a positive integer"
      },
      {
        argv: ["node", "apexcn", "topic", "create", "--category-id", "0", "--title", "CLI title", "--content", "CLI body"],
        message: "Expected a positive integer"
      },
      {
        argv: ["node", "apexcn", "reply", "create", "42", "--parent-post-id", "0", "--content", "CLI body"],
        message: "Expected a positive integer"
      },
      {
        argv: ["node", "apexcn", "ask", "Q", "--top-k", "0"],
        message: "Expected a positive integer"
      },
      {
        argv: ["node", "apexcn", "search", "APEX", "--page-size", "51"],
        message: "Expected --page-size to be between 1 and 50"
      }
    ];

    for (const item of cases) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const program = createProgram({
        configPath: await tempConfigPath(),
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      });
      exitOverrideTree(program);

      await expect(program.parseAsync(item.argv)).rejects.toMatchObject({
        code: "commander.invalidArgument"
      });

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toContain(item.message);
    }
  });

  test("id arguments reject non-positive or non-numeric values", async () => {
    const cases = [
      ["node", "apexcn", "topic", "view", "abc"],
      ["node", "apexcn", "thread", "view", "0"],
      ["node", "apexcn", "topic", "update", "0", "--content", "CLI body"],
      ["node", "apexcn", "topic", "delete", "abc"],
      ["node", "apexcn", "reply", "create", "0", "--content", "CLI body"],
      ["node", "apexcn", "reply", "update", "abc", "--content", "CLI body"],
      ["node", "apexcn", "reply", "delete", "0"],
      ["node", "apexcn", "favorite", "add", "abc"],
      ["node", "apexcn", "subscription", "remove", "0"]
    ];

    for (const argv of cases) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const program = createProgram({
        configPath: await tempConfigPath(),
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      });
      exitOverrideTree(program);

      await expect(program.parseAsync(argv)).rejects.toMatchObject({
        code: "commander.invalidArgument"
      });

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toMatch(/Invalid number|Expected a positive integer/);
    }
  });

  test("topic create, update, and delete call the expected API paths", async () => {
    const responses = [
      { ok: true, id: 42, requestId: "req-create" },
      { ok: true, id: 42, requestId: "req-update" },
      { topic: { id: 42, title: "CLI updated" }, requestId: "req-view" },
      { ok: true, id: 42, requestId: "req-delete" }
    ];
    const { program, fetch } = await configuredProgram(async () => Response.json(responses.shift()));

    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "create",
      "--category-id",
      "2",
      "--title",
      "CLI title",
      "--content",
      "CLI body",
      "--tags",
      "cli,e2e",
      "--json"
    ]);
    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "update",
      "42",
      "--title",
      "CLI updated",
      "--content",
      "Updated body",
      "--json"
    ]);
    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "delete",
      "42",
      "--yes",
      "--force",
      "--confirm-title",
      "CLI updated",
      "--json"
    ]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/topics",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ categoryId: 2, title: "CLI title", content: "CLI body", tags: "cli,e2e" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://oracleapex.cn/ords/test/api/v1/topics/42",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "CLI updated", content: "Updated body" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://oracleapex.cn/ords/test/api/v1/topics/42",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "https://oracleapex.cn/ords/test/api/v1/topics/42",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("topic view supports text format", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({
        topic: {
          id: 42,
          title: "APEX\tTopic",
          createdByName: "王方钢",
          categoryName: "APEX\n进阶",
          threadUrl: "https://oracleapex.cn/t/42",
          content: "第一行\n第二行"
        },
        requestId: "req-topic"
      })
    );

    await program.parseAsync(["node", "apexcn", "thread", "view", "42", "--format", "text"]);

    expect(fetch).toHaveBeenLastCalledWith("https://oracleapex.cn/ords/test/api/v1/topics/42", expect.any(Object));
    expect(stdout.join("")).toBe([
      "id: 42",
      "Title: APEX Topic",
      "Author: 王方钢",
      "Category: APEX 进阶",
      "URL: https://oracleapex.cn/t/42",
      "Thread URL: https://oracleapex.cn/t/42",
      "Content:",
      "第一行",
      "第二行",
      "requestId: req-topic",
      ""
    ].join("\n"));
  });

  test("topic write commands can print dry-run plans without calling the API", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync([
      "node",
      "apexcn",
      "thread",
      "create",
      "--category-id",
      "2",
      "--title",
      "CLI title",
      "--content",
      "CLI body",
      "--tags",
      "cli,e2e",
      "--dry-run"
    ]);
    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "edit",
      "42",
      "--title",
      "CLI updated",
      "--content",
      "Updated body",
      "--dry-run"
    ]);
    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "delete",
      "42",
      "--yes",
      "--force",
      "--confirm-title",
      "CLI updated",
      "--dry-run"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stdout.join("")).not.toContain("Bearer");
    expect(stdout.join("")).not.toContain("Authorization");
    expect(stdout.join("")).not.toContain("X-APEXCN-API-Key");
    const plans = stdout.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(plans).toEqual([
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics",
        body: { categoryId: 2, title: "CLI title", content: "CLI body", tags: "cli,e2e" }
      },
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42",
        body: { title: "CLI updated", content: "Updated body" }
      },
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "DELETE",
        path: "/api/v1/topics/42"
      }
    ]);
  });

  test("write commands can print preview plans without calling the API", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync([
      "node",
      "apexcn",
      "reply",
      "create",
      "42",
      "--content",
      "Preview body",
      "--preview"
    ]);
    await program.parseAsync(["node", "apexcn", "favorite", "add", "42", "--preview"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    const plans = stdout.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(plans).toEqual([
      {
        dryRun: true,
        preview: true,
        mode: "preview",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42/replies",
        body: { content: "Preview body" }
      },
      {
        dryRun: true,
        preview: true,
        mode: "preview",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42/favorite"
      }
    ]);
  });

  test("delete commands require explicit confirmation", async () => {
    const { program, stderr } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "topic", "delete", "42"]);

    expect(stderr.join("")).toBe("Refusing to delete topic without --yes --force --confirm-title\n");
    expect(process.exitCode).toBe(1);
  });

  test("topic create fails without category id in non-interactive mode", async () => {
    const { program, stderr } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "topic", "create", "--title", "CLI title", "--content", "CLI body"]);

    expect(stderr.join("")).toBe("Missing --category-id in non-interactive mode\n");
    expect(process.exitCode).toBe(1);
  });

  test("topic dry-run and preview create still require category id without loading categories", async () => {
    const cases = [
      {
        argv: ["node", "apexcn", "topic", "create", "--title", "CLI title", "--content", "CLI body", "--dry-run"],
        message: "Missing --category-id in dry-run mode\n"
      },
      {
        argv: ["node", "apexcn", "topic", "create", "--title", "CLI title", "--content", "CLI body", "--preview"],
        message: "Missing --category-id in preview mode\n"
      }
    ];

    for (const item of cases) {
    const { program, stdout, stderr, fetch } = await configuredProgram(
      async () => Response.json({ ok: true }),
      { isStdinTTY: () => true }
    );

      await program.parseAsync(item.argv);

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe(item.message);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
  });

  test("topic create fails without content", async () => {
    const { program, stderr } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content", ""]);

    expect(stderr.join("")).toBe("content is required\n");
    expect(process.exitCode).toBe(1);
  });

  test("content-file submits file content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apexcn-content-file-"));
    const file = join(dir, "body.md");
    await writeFile(file, "file body", "utf8");
    const { program, fetch } = await configuredProgram(async () => Response.json({ ok: true, id: 42 }));

    await program.parseAsync([
      "node",
      "apexcn",
      "topic",
      "create",
      "--category-id",
      "2",
      "--title",
      "CLI title",
      "--content-file",
      file
    ]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/topics",
      expect.objectContaining({
        body: JSON.stringify({ categoryId: 2, title: "CLI title", content: "file body" })
      })
    );
  });

  test("content-file dash reads explicit stdin for write commands", async () => {
    const responses = [
      { ok: true, id: 42 },
      { ok: true, id: 100 },
      { ok: true, id: 42 },
      { ok: true, id: 100 }
    ];
    const readStdin = vi.fn()
      .mockResolvedValueOnce("topic stdin body")
      .mockResolvedValueOnce("reply stdin body")
      .mockResolvedValueOnce("topic update stdin body")
      .mockResolvedValueOnce("reply update stdin body");
    const { program, fetch } = await configuredProgram(
      async () => Response.json(responses.shift()),
      { readStdin, isStdinTTY: () => true }
    );

    await program.parseAsync(["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content-file", "-"]);
    await program.parseAsync(["node", "apexcn", "reply", "create", "42", "--content-file", "-"]);
    await program.parseAsync(["node", "apexcn", "topic", "update", "42", "--content-file", "-"]);
    await program.parseAsync(["node", "apexcn", "post", "edit", "100", "--content-file", "-"]);

    expect(readStdin).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/topics",
      expect.objectContaining({ body: JSON.stringify({ categoryId: 2, title: "CLI title", content: "topic stdin body" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://oracleapex.cn/ords/test/api/v1/topics/42/replies",
      expect.objectContaining({ body: JSON.stringify({ content: "reply stdin body" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://oracleapex.cn/ords/test/api/v1/topics/42",
      expect.objectContaining({ body: JSON.stringify({ content: "topic update stdin body" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "https://oracleapex.cn/ords/test/api/v1/replies/100",
      expect.objectContaining({ body: JSON.stringify({ content: "reply update stdin body" }) })
    );
  });

  test("required content-file dash rejects zero-length stdin without calling the API", async () => {
    const cases = [
      ["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content-file", "-"],
      ["node", "apexcn", "reply", "create", "42", "--content-file", "-"],
      ["node", "apexcn", "reply", "update", "100", "--content-file", "-"]
    ];

    for (const argv of cases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(
        async () => Response.json({ ok: true }),
        { readStdin: async () => "", isStdinTTY: () => true }
      );

      await program.parseAsync(argv);

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe("content is required\n");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
  });

  test("topic update content-file dash can send zero-length content", async () => {
    const { program, fetch } = await configuredProgram(
      async () => Response.json({ ok: true }),
      { readStdin: async () => "", isStdinTTY: () => true }
    );

    await program.parseAsync(["node", "apexcn", "topic", "update", "42", "--content-file", "-"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/topics/42",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "" }) })
    );
  });

  test("topic update preview without content does not read implicit stdin", async () => {
    const readStdin = vi.fn(async () => {
      throw new Error("unexpected stdin read");
    });
    const { program, stdout, fetch } = await configuredProgram(
      async () => Response.json({ ok: true }),
      { readStdin, isStdinTTY: () => false }
    );

    await program.parseAsync(["node", "apexcn", "thread", "edit", "42", "--title", "Updated title", "--preview", "--json"]);

    expect(readStdin).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      dryRun: true,
      preview: true,
      mode: "preview",
      path: "/api/v1/topics/42",
      body: { title: "Updated title" }
    }));
  });

  test("content-file can still read a literal dash filename via relative path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apexcn-dash-content-file-"));
    const file = join(dir, "-");
    await writeFile(file, "dash file body", "utf8");
    const readStdin = vi.fn(async () => "stdin body");
    const { program, fetch } = await configuredProgram(
      async () => Response.json({ ok: true, id: 42 }),
      { readStdin, isStdinTTY: () => true }
    );

    await program.parseAsync(["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content-file", file]);

    expect(readStdin).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/topics",
      expect.objectContaining({ body: JSON.stringify({ categoryId: 2, title: "CLI title", content: "dash file body" }) })
    );
  });

  test("write commands reject both content and content-file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apexcn-content-conflict-"));
    const file = join(dir, "body.md");
    await writeFile(file, "file body", "utf8");
    const cases = [
      ["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content", "inline", "--content-file", file],
      ["node", "apexcn", "topic", "update", "42", "--content", "inline", "--content-file", file],
      ["node", "apexcn", "reply", "create", "42", "--content", "inline", "--content-file", file],
      ["node", "apexcn", "reply", "update", "100", "--content", "inline", "--content-file", file]
    ];

    for (const argv of cases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ ok: true }));
      exitOverrideTree(program);

      await expect(program.parseAsync(argv)).rejects.toMatchObject({
        code: "commander.conflictingOption"
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toContain("error: option '--content <text>' cannot be used with option '--content-file <path>'");
      vi.unstubAllGlobals();
    }
  });

  test("missing content-file reports a CLI error instead of a stack trace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apexcn-missing-content-"));
    const topicFile = join(dir, "topic.md");
    const replyFile = join(dir, "reply.md");
    const cases = [
      { argv: ["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content-file", topicFile], path: topicFile },
      { argv: ["node", "apexcn", "reply", "create", "42", "--content-file", replyFile], path: replyFile }
    ];

    for (const item of cases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ ok: true }));

      await program.parseAsync(item.argv);

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe(`Content file not found: ${item.path}\n`);
      expect(stderr.join("")).not.toContain("ENOENT");
      expect(stderr.join("")).not.toContain("src/commands/content");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
  });

  test("reply, favorite, subscription, and ask commands call their endpoints", async () => {
    const responses = [
      { ok: true, id: 100, requestId: "req-reply" },
      { ok: true, id: 100, requestId: "req-reply-update" },
      { ok: true, id: 42, changed: true, requestId: "req-fav" },
      { ok: true, id: 42, changed: true, requestId: "req-sub" },
      { answer: "APEX answer", requestId: "req-ask" }
    ];
    const { program, fetch } = await configuredProgram(async () => Response.json(responses.shift()));

    await program.parseAsync(["node", "apexcn", "reply", "create", "42", "--content", "Reply body", "--json"]);
    await program.parseAsync(["node", "apexcn", "post", "edit", "100", "--content", "Reply updated", "--json"]);
    await program.parseAsync(["node", "apexcn", "favorite", "add", "42", "--json"]);
    await program.parseAsync(["node", "apexcn", "subscription", "add", "42", "--json"]);
    await program.parseAsync(["node", "apexcn", "ask", "How to use APEX?", "--top-k", "3", "--json"]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://oracleapex.cn/ords/test/api/v1/topics/42/replies",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "Reply body" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://oracleapex.cn/ords/test/api/v1/replies/100",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "Reply updated" }) })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://oracleapex.cn/ords/test/api/v1/topics/42/favorite",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "https://oracleapex.cn/ords/test/api/v1/topics/42/subscription",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      "https://oracleapex.cn/ords/test/api/v1/ask",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ question: "How to use APEX?", topK: 3 }) })
    );
  });

  test("ask supports text format with sources", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({
        answer: "APEX 可以用 REST Data Source。",
        sources: [
          { title: "REST\tData", url: "https://oracleapex.cn/t/42", score: 0.88, snippet: "第一行\n第二行" },
          { topicId: 43 }
        ],
        requestId: "req-ask"
      })
    );

    await program.parseAsync(["node", "apexcn", "ask", "How?", "--top-k", "2", "--format", "text"]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/ask",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ question: "How?", topK: 2 }) })
    );
    expect(stdout.join("")).toBe([
      "Answer:",
      "APEX 可以用 REST Data Source。",
      "Sources:",
      "1. REST Data - https://oracleapex.cn/t/42 | score 0.88 | 第一行 第二行",
      "2. 43 - https://oracleapex.cn/t/43",
      "requestId: req-ask",
      ""
    ].join("\n"));
  });

  test("ask sends scoped filters and renders filtered reference metadata", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () =>
      Response.json({
        answer: "找到 2 条范围内参考。",
        confidence: "medium",
        limitations: ["filtered ask returns scoped references"],
        filters: { categoryId: 4, fromDate: "2026-07-01", toDate: "2026-07-05", tag: "ORDS" },
        references: [{ title: "ORDS update", topicId: 42, confidence: 0.7 }],
        requestId: "req-filtered-ask"
      })
    );

    await program.parseAsync([
      "node",
      "apexcn",
      "ask",
      "最近 ORDS API 有哪些更新?",
      "--top-k",
      "5",
      "--category-id",
      "4",
      "--from",
      "2026-07-01",
      "--to",
      "2026-07-05",
      "--tag",
      "ORDS",
      "--format",
      "text"
    ]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          question: "最近 ORDS API 有哪些更新?",
          topK: 5,
          categoryId: 4,
          fromDate: "2026-07-01",
          toDate: "2026-07-05",
          tag: "ORDS"
        })
      })
    );
    expect(stdout.join("")).toContain("Scoped Answer:\n找到 2 条范围内参考。\n");
    expect(stdout.join("")).toContain("confidence: medium\n");
    expect(stdout.join("")).toContain("limitations:\nfiltered ask returns scoped references\n");
    expect(stdout.join("")).toContain("filters: categoryId=4 fromDate=2026-07-01 toDate=2026-07-05 tag=ORDS\n");
  });

  test("ask enriches backend references with stable topic URLs", async () => {
    const { program, stdout } = await configuredProgram(async () =>
      Response.json({
        answer: "APEXLang supports single page imports.",
        sources: [
          {
            card_title: "APEXLang import",
            card_link: "f?p=100:14:::::P14_THREAD_ID:29667",
            source_url: "https://oracleapex.cn/ords/r/apex-cn/website/thread?session=abc"
          }
        ],
        requestId: "req-ask"
      })
    );

    await program.parseAsync(["node", "apexcn", "ask", "APEXLang supports single page imports?", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      answer: "APEXLang supports single page imports.",
      sources: [
        {
          card_title: "APEXLang import",
          card_link: "f?p=100:14:::::P14_THREAD_ID:29667",
          source_url: "https://oracleapex.cn/ords/r/apex-cn/website/thread?session=abc",
          url: "https://oracleapex.cn/t/29667",
          threadUrl: "https://oracleapex.cn/t/29667",
          originalUrl: "https://oracleapex.cn/ords/r/apex-cn/website/thread?session=abc"
        }
      ],
      requestId: "req-ask"
    });
  });

  test("ask normalizes wrapped backend data responses", async () => {
    const { program, stdout } = await configuredProgram(async () =>
      Response.json({
        status: "OK",
        message: "LIMITED_TRUSTED_REFERENCES",
        data: {
          request_id: "req-wrapped",
          request_url: "f?p=:120:::::P20_REQUEST_ID:req-wrapped",
          answer: "401 通常先检查 token 和授权。",
          references: [
            {
              card_title: "ORDS OAuth",
              card_link: "f?p=:14:::::P14_THREAD_ID:23722",
              source_url: "https://oracleapex.cn/ords/r/apex-cn/website/thread"
            }
          ]
        }
      })
    );

    await program.parseAsync(["node", "apexcn", "ask", "APEX 调 ORDS REST API 返回 401，新手应该怎么排查？", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      status: "OK",
      message: "LIMITED_TRUSTED_REFERENCES",
      answer: "401 通常先检查 token 和授权。",
      requestId: "req-wrapped",
      requestUrl: "f?p=:120:::::P20_REQUEST_ID:req-wrapped",
      references: [
        expect.objectContaining({
          card_title: "ORDS OAuth",
          url: "https://oracleapex.cn/t/23722",
          threadUrl: "https://oracleapex.cn/t/23722"
        })
      ]
    }));
  });

  test("ask returns a context-needed fallback for short follow-up questions", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ answer: "unexpected" }));

    await program.parseAsync(["node", "apexcn", "ask", "那第一步怎么确认？", "--top-k", "3", "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdout.join(""))).toEqual({
      answerable: false,
      needsContext: true,
      fallback: {
        reason: "needs-context",
        message: "这个追问缺少上一轮问题或引用上下文。请把完整背景写进问题，或使用 --context 提供上一轮主题后再问。",
        suggestedQueries: ["那第一步怎么确认"],
        suggestedCommands: [
          "apexcn search \"那第一步怎么确认\" --json",
          "apexcn research \"那第一步怎么确认\" --json"
        ]
      }
    });
  });

  test("ask sends explicit context with short follow-up questions", async () => {
    const { program, fetch } = await configuredProgram(async () =>
      Response.json({ answer: "先确认 token URL。", references: [{ topicId: 23722 }], requestId: "req-context" })
    );

    await program.parseAsync([
      "node",
      "apexcn",
      "ask",
      "那第一步怎么确认？",
      "--context",
      "APEX 调 ORDS REST API 返回 401",
      "--top-k",
      "3",
      "--json"
    ]);

    expect(fetch).toHaveBeenLastCalledWith(
      "https://oracleapex.cn/ords/test/api/v1/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          question: "上下文：APEX 调 ORDS REST API 返回 401\n追问：那第一步怎么确认？",
          topK: 3
        })
      })
    );
  });

  test("ask marks no-reference answers as not answerable in JSON", async () => {
    const { program, stdout } = await configuredProgram(async () =>
      Response.json({
        answer: "这是一段没有引用支撑的回答。",
        references: [],
        requestId: "req-no-ref"
      })
    );

    await program.parseAsync(["node", "apexcn", "ask", "APEX 邮件发送失败怎么办？", "--json"]);

    const output = JSON.parse(stdout.join(""));
    expect(output).toEqual(expect.objectContaining({
      answer: "这是一段没有引用支撑的回答。",
      answerable: false,
      noTrustedReferences: true,
      requestId: "req-no-ref",
      fallback: expect.objectContaining({
        reason: "no-trusted-references",
        message: expect.stringContaining("没有找到可引用的社区资料"),
        suggestedQueries: ["APEX 邮件发送失败怎么办"],
        suggestedCommands: [
          "apexcn search \"APEX 邮件发送失败怎么办\" --json",
          "apexcn research \"APEX 邮件发送失败怎么办\" --json"
        ]
      })
    }));
    expect(stdout.join("")).not.toContain("�");
  });

  test("ask text output falls back when references are absent or confidence is low", async () => {
    const { program, stdout } = await configuredProgram(async () =>
      Response.json({
        answer: "不要把这段当成可信结论。",
        confidence: "low",
        sources: [{ topicId: 42 }],
        requestId: "req-low-confidence"
      })
    );

    await program.parseAsync(["node", "apexcn", "ask", "ORDS 401 如何排查？", "--format", "text"]);

    const text = stdout.join("");
    expect(text).toContain("Answerable: false\n");
    expect(text).toContain("回答置信度过低");
    expect(text).toContain("apexcn search \"ORDS 401 如何排查\" --json");
    expect(text).toContain("apexcn research \"ORDS 401 如何排查\" --json");
    expect(text).toContain("requestId: req-low-confidence");
    expect(text).not.toContain("Answer:\n不要把这段当成可信结论。");
  });

  test("ask maps no-reference server errors to a stable fallback", async () => {
    const { program, stdout } = await configuredProgram(async () =>
      Response.json({
        ok: false,
        error: { code: "NO_TRUSTED_REFERENCES", message: "没有可引用资料" },
        requestId: "req-no-trusted"
      })
    );

    await program.parseAsync(["node", "apexcn", "ask", "不存在的 APEX 主题", "--json"]);

    const output = JSON.parse(stdout.join(""));
    expect(output.answerable).toBe(false);
    expect(output.fallback.reason).toBe("no-trusted-references");
    expect(output.fallback.message).toContain("没有找到可引用的社区资料");
    expect(output.requestId).toBe("req-no-trusted");
  });

  test("ask returns an answerable false JSON fallback when rate limited", async () => {
    const { program, stdout, stderr } = await configuredProgram(async () =>
      Response.json({
        error: {
          message: "Rate limit exceeded",
          requestId: "req-rate",
          retryAfterSeconds: 60,
          windowSeconds: 60
        }
      }, { status: 429 })
    );

    await program.parseAsync(["node", "apexcn", "ask", "Interactive Grid 怎么入门？", "--top-k", "3", "--json"]);

    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      answerable: false,
      rateLimited: true,
      retryAfterSeconds: 60,
      windowSeconds: 60,
      requestId: "req-rate",
      error: {
        type: "http",
        status: 429,
        message: "Rate limit exceeded"
      },
      fallback: expect.objectContaining({
        reason: "rate-limited",
        message: expect.stringContaining("请等待 60 秒后重试"),
        suggestedQueries: ["Interactive Grid 怎么入门"],
        suggestedCommands: [
          "apexcn search \"Interactive Grid 怎么入门\" --json",
          "apexcn research \"Interactive Grid 怎么入门\" --json"
        ]
      })
    }));
  });

  test("reply and relation write commands can print dry-run plans without calling the API", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "reply", "create", "42", "--content", "Reply body", "--dry-run"]);
    await program.parseAsync(["node", "apexcn", "post", "edit", "100", "--content", "Reply updated", "--dry-run"]);
    await program.parseAsync(["node", "apexcn", "reply", "delete", "100", "--yes", "--force", "--dry-run"]);
    await program.parseAsync(["node", "apexcn", "favorite", "add", "42", "--dry-run"]);
    await program.parseAsync(["node", "apexcn", "subscription", "remove", "42", "--dry-run"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stdout.join("")).not.toContain("Bearer");
    expect(stdout.join("")).not.toContain("Authorization");
    expect(stdout.join("")).not.toContain("X-APEXCN-API-Key");
    const plans = stdout.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(plans).toEqual([
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42/replies",
        body: { content: "Reply body" }
      },
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/replies/100",
        body: { content: "Reply updated" }
      },
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "DELETE",
        path: "/api/v1/replies/100"
      },
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42/favorite"
      },
      {
        dryRun: true,
        preview: false,
        mode: "dry-run",
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "DELETE",
        path: "/api/v1/topics/42/subscription"
      }
    ]);
  });

  test("dry-run output is pretty printed when json is requested", async () => {
    const { program, stdout, fetch } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "favorite", "add", "42", "--dry-run", "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe([
      "{",
      "  \"dryRun\": true,",
      "  \"preview\": false,",
      "  \"mode\": \"dry-run\",",
      "  \"profile\": \"test@oci\",",
      "  \"baseUrl\": \"https://oracleapex.cn/ords/test\",",
      "  \"method\": \"POST\",",
      "  \"path\": \"/api/v1/topics/42/favorite\"",
      "}",
      ""
    ].join("\n"));
  });
});
