import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Command } from "commander";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-content-"));
  return join(dir, ".apexcn", "config.json");
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

function exitOverrideTree(command: Command): void {
  command.exitOverride((error) => {
    throw error;
  });
  for (const child of command.commands) {
    exitOverrideTree(child);
  }
}

describe("content commands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
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

  test("search rejects offset because the current API ignores it", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () =>
      Response.json({ items: [], page: { limit: 5, offset: 0, count: 0, hasMore: false } })
    );
    exitOverrideTree(program);

    await expect(program.parseAsync(["node", "apexcn", "search", "APEX", "--offset", "5"])).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Current search API does not support offset pagination");
  });

  test("search help hides unsupported offset and describes json as pretty-print", () => {
    const program = createProgram();
    const search = program.commands.find((command) => command.name() === "search");

    expect(search).toBeDefined();
    expect(search?.helpInformation()).not.toContain("--offset");
    expect(search?.helpInformation()).toContain("--json");
    expect(search?.helpInformation()).toContain("pretty-print JSON");
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

  test("topic create fails without content", async () => {
    const { program, stderr } = await configuredProgram(async () => Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "topic", "create", "--category-id", "2", "--title", "CLI title", "--content", ""]);

    expect(stderr.join("")).toBe("content is required\n");
    expect(process.exitCode).toBe(1);
  });

  test("content-file wins over inline content", async () => {
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
      "--content",
      "inline body",
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
});
