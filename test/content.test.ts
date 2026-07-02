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
