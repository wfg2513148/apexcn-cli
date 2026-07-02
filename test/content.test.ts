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
  if (command.commands.length === 0) {
    return nextPrefixes.map((parts) => parts.join(" ")).filter(Boolean);
  }
  return nextPrefixes.flatMap((parts) => command.commands.flatMap((child) => leafCommandPaths(child, parts, true)));
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
  "doctor",
  "me",
  "category list",
  "search",
  "topic view",
  "thread view",
  "ask"
].sort();

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
      { argv: ["node", "apexcn", "search", "APEX", "--format", "text"], expected: "42\tAPEX topic\thttps://oracleapex.cn/t/42\n43\tORDS topic\t\n" },
      { argv: ["node", "apexcn", "search", "APEX", "--json", "--format", "pretty"], expected: `${JSON.stringify(payload, null, 2)}\n` }
    ];

    for (const item of cases) {
      const { program, stdout } = await configuredProgram(async () => Response.json(payload));

      await program.parseAsync(item.argv);

      expect(stdout.join("")).toBe(item.expected);
      vi.unstubAllGlobals();
    }
  });

  test("search text output is empty for empty lists and sanitizes fields", async () => {
    const cases = [
      { payload: { items: [] }, expected: "" },
      {
        payload: { items: [{ id: 42, title: "APEX\ttopic\none", url: "https://oracleapex.cn/t/42\nref" }] },
        expected: "42\tAPEX topic one\thttps://oracleapex.cn/t/42 ref\n"
      }
    ];

    for (const item of cases) {
      const { program, stdout } = await configuredProgram(async () => Response.json(item.payload));

      await program.parseAsync(["node", "apexcn", "search", "APEX", "--format", "text"]);

      expect(stdout.join("")).toBe(item.expected);
      vi.unstubAllGlobals();
    }
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
    expect(search?.helpInformation()).toContain("--format");
    expect(search?.helpInformation()).toContain("page size, 1-50");
    expect(search?.helpInformation()).toContain("pretty-print JSON");
  });

  test("format option is exposed only on read commands with text output", () => {
    const program = createProgram();
    const formatCommands = ["me", "category list", "search", "topic view", "thread view", "ask"];

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
      ["node", "apexcn", "topic", "view", "42", "--format", "xml"],
      ["node", "apexcn", "me", "--format", "yaml"],
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
      ["node", "apexcn", "topic", "view", "42", "--json", "--format", "text"],
      ["node", "apexcn", "me", "--json", "--format", "json"],
      ["node", "apexcn", "ask", "Q", "--json", "--format", "json"]
    ];

    for (const argv of ambiguousCases) {
      const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json({ items: [] }));

      await program.parseAsync(argv);

      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe("--json can only be combined with --format pretty\n");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
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
    }
    for (const path of neverApiDryRunCommands) {
      expect(leafCommand(program, path).helpInformation()).not.toContain("--dry-run");
    }
  });

  test("commands that never support API dry-run remain excluded", () => {
    const program = createProgram();

    for (const path of neverApiDryRunCommands) {
      expect(leafCommand(program, path).helpInformation()).not.toContain("--dry-run");
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
      "Title: APEX Topic",
      "Author: 王方钢",
      "Category: APEX 进阶",
      "URL: https://oracleapex.cn/t/42",
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
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics",
        body: { categoryId: 2, title: "CLI title", content: "CLI body", tags: "cli,e2e" }
      },
      {
        dryRun: true,
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42",
        body: { title: "CLI updated", content: "Updated body" }
      },
      {
        dryRun: true,
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "DELETE",
        path: "/api/v1/topics/42"
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

  test("topic dry-run create still requires category id without loading categories", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(
      async () => Response.json({ ok: true }),
      { isStdinTTY: () => true }
    );

    await program.parseAsync(["node", "apexcn", "topic", "create", "--title", "CLI title", "--content", "CLI body", "--dry-run"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Missing --category-id in dry-run mode\n");
    expect(process.exitCode).toBe(1);
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
      "2. 43",
      "requestId: req-ask",
      ""
    ].join("\n"));
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
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42/replies",
        body: { content: "Reply body" }
      },
      {
        dryRun: true,
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/replies/100",
        body: { content: "Reply updated" }
      },
      {
        dryRun: true,
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "DELETE",
        path: "/api/v1/replies/100"
      },
      {
        dryRun: true,
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test",
        method: "POST",
        path: "/api/v1/topics/42/favorite"
      },
      {
        dryRun: true,
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
      "  \"profile\": \"test@oci\",",
      "  \"baseUrl\": \"https://oracleapex.cn/ords/test\",",
      "  \"method\": \"POST\",",
      "  \"path\": \"/api/v1/topics/42/favorite\"",
      "}",
      ""
    ].join("\n"));
  });
});
