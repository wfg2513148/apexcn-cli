import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

describe("business write confirmation", () => {
  test("reply preview returns an operation id and confirmation executes the exact request once", async () => {
    const context = await testContext([Response.json({
      id: 90,
      replyId: 90,
      topicId: 42,
      url: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual#post_90",
      replyUrl: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual#post_90",
      requestId: "req-write"
    })]);
    await context.program.parseAsync(["node", "apexcn", "reply", "create", "42", "--parent-post-id", "90", "--content", "Nested reply", "--json"]);

    expect(context.fetch).not.toHaveBeenCalled();
    const preview = JSON.parse(context.stdout.join(""));
    expect(preview).toEqual(expect.objectContaining({
      kind: "write-preview",
      action: "reply.create",
      operationId: expect.stringMatching(/^op_[a-f0-9]{16}$/),
      willExecute: false,
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics/42/replies",
        body: expect.objectContaining({ content: "Nested reply", parentPostId: 90, operationKey: expect.any(String), payloadHash: expect.any(String) })
      })
    }));
    expect(preview.confirmation.command).toBe(`apexcn confirm ${preview.operationId} --yes`);

    context.stdout.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);
    expect(context.fetch).toHaveBeenCalledTimes(1);
    const init = context.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual(preview.request.body);
    expect(JSON.parse(context.stdout.join(""))).toEqual(expect.objectContaining({
      kind: "write-result",
      operationId: preview.operationId,
      status: "completed",
      requestId: "req-write",
      result: expect.objectContaining({
        url: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual#post_90",
        replyUrl: "https://oracleapex.cn/ords/test/api/v1/topics/42/visual#post_90"
      })
    }));

    context.stdout.length = 0;
    context.stderr.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);
    expect(context.fetch).toHaveBeenCalledTimes(1);
    expect(context.stderr.join("")).toContain("already completed");
  });

  test("tampering is rejected before any network request", async () => {
    const context = await testContext();
    await context.program.parseAsync(["node", "apexcn", "topic", "create", "--category-id", "4", "--title", "Title", "--content", "Original", "--json"]);
    const preview = JSON.parse(context.stdout.join(""));
    const operationPath = join(dirname(context.configPath), "operations", `${preview.operationId}.json`);
    const operation = JSON.parse(await readFile(operationPath, "utf8"));
    operation.request.body.content = "Tampered";
    await writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`, "utf8");

    context.stdout.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.stderr.join("")).toContain("hash mismatch");
  });

  test("copying operation state to another config scope is rejected", async () => {
    const context = await testContext();
    await context.program.parseAsync(["node", "apexcn", "reply", "create", "42", "--content", "Reply", "--json"]);
    const preview = JSON.parse(context.stdout.join(""));

    const copiedRoot = await mkdtemp(join(tmpdir(), "apexcn-operation-copy-"));
    const copiedConfig = join(copiedRoot, ".apexcn", "config.json");
    await cp(dirname(context.configPath), dirname(copiedConfig), { recursive: true });
    const copied = programFor(copiedConfig, context.fetch);
    await copied.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);

    expect(context.fetch).not.toHaveBeenCalled();
    expect(copied.stderr.join("")).toContain("different local configuration");
  });

  test("switching accounts in the same profile and community is rejected before network", async () => {
    const context = await testContext();
    await context.program.parseAsync(["node", "apexcn", "reply", "create", "42", "--content", "Reply", "--json"]);
    const preview = JSON.parse(context.stdout.join(""));
    await writeFile(context.configPath, JSON.stringify({
      current: "test",
      profiles: { test: { baseUrl: "https://example.test/ords/api", token: "different-account-token" } }
    }), { encoding: "utf8", mode: 0o600 });

    context.stdout.length = 0;
    context.stderr.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);

    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.stderr.join("")).toContain("active account and community");
  });

  test("an uncertain server failure preserves the same approved request for retry", async () => {
    const context = await testContext([
      Response.json({ error: { message: "temporary", requestId: "req-500" } }, { status: 500 }),
      Response.json({ ok: true, requestId: "req-retry" })
    ]);
    await context.program.parseAsync(["node", "apexcn", "reply", "create", "42", "--content", "Retry safely", "--json"]);
    const preview = JSON.parse(context.stdout.join(""));

    context.stdout.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    context.stdout.length = 0;
    context.stderr.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);

    expect(context.fetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((context.fetch.mock.calls[0]?.[1] as RequestInit).body));
    const secondBody = JSON.parse(String((context.fetch.mock.calls[1]?.[1] as RequestInit).body));
    expect(secondBody).toEqual(firstBody);
    expect(JSON.parse(context.stdout.join(""))).toEqual(expect.objectContaining({ requestId: "req-retry", status: "completed" }));
  });
});

async function testContext(responses: Response[] = [Response.json({ ok: true, requestId: "req-write" })]) {
  const root = await mkdtemp(join(tmpdir(), "apexcn-operation-"));
  const configPath = join(root, ".apexcn", "config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ current: "test", profiles: { test: { baseUrl: "https://example.test/ords/api", token: "test-token" } } }), { encoding: "utf8", mode: 0o600 });
  const fetch = vi.fn(async () => responses.shift() ?? Response.json({ ok: true, requestId: "req-write" }));
  const io = programFor(configPath, fetch);
  return { ...io, configPath, fetch };
}

function programFor(configPath: string, fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetch);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({ configPath, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
  return { program, stdout, stderr };
}
