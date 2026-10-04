import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";
import { publicSchemaForId } from "../src/schemas/registry.js";

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

describe("business write confirmation", () => {
  describe("topic favorite and subscription modes", () => {
    const cases = [
      { name: "favorite", action: "add", method: "POST", path: "/api/v1/topics/42/favorite" },
      { name: "favorite", action: "remove", method: "DELETE", path: "/api/v1/topics/42/favorite" },
      { name: "subscription", action: "add", method: "POST", path: "/api/v1/topics/42/subscription" },
      { name: "subscription", action: "remove", method: "DELETE", path: "/api/v1/topics/42/subscription" }
    ];
    const roots = new Set<string>();

    afterEach(async () => {
      await Promise.all([...roots].map(root => rm(root, { recursive: true, force: true })));
      roots.clear();
    });

    test.each(cases)("$name.$action preview persists an exact confirmable request and writes once", async ({ name, action, method, path }) => {
      const context = await testContext();
      roots.add(dirname(dirname(context.configPath)));
      await context.program.parseAsync(["node", "apexcn", name, action, "42", "--preview", "--json"]);

      expect(context.fetch).not.toHaveBeenCalled();
      expect(context.stderr).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      const preview = JSON.parse(context.stdout.join(""));
      expect(preview).toEqual(expect.objectContaining({
        kind: "write-preview",
        operationId: expect.stringMatching(/^op_[a-f0-9]{16}$/),
        action: `${name}.${action}`,
        willExecute: false,
        request: {
          method,
          path,
          body: {
            operationKey: expect.stringMatching(/^op:[a-f0-9]{48}$/),
            payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/)
          }
        }
      }));
      expect(preview.body).toEqual(preview.request.body);
      expect(preview.confirmation.command).toBe(`apexcn confirm ${preview.operationId} --yes`);
      const operationPath = join(dirname(context.configPath), "operations", `${preview.operationId}.json`);
      expect(JSON.parse(await readFile(operationPath, "utf8"))).toEqual(expect.objectContaining({
        operationId: preview.operationId,
        status: "pending",
        action: `${name}.${action}`,
        request: preview.request
      }));

      // Check the actual public manifest and validate the emitted preview, not a synthetic fixture.
      const manifestIo = programFor(context.configPath, context.fetch);
      await manifestIo.program.parseAsync(["node", "apexcn", "commands", "--json"]);
      const descriptor = JSON.parse(manifestIo.stdout.join("")).commands.find((command: { id: string }) => command.id === `${name}.${action}`);
      expect(descriptor).toEqual(expect.objectContaining({
        supportsPreview: true,
        supportsDryRun: true,
        options: expect.arrayContaining(["--preview", "--dry-run"]),
        safety: expect.objectContaining({ preview: "available" })
      }));
      const validate = new Ajv({ allErrors: true, strict: false }).compile(publicSchemaForId(descriptor.jsonContract.successSchemaId)!);
      expect(validate(preview), JSON.stringify(validate.errors)).toBe(true);
      expect(context.fetch).not.toHaveBeenCalled();

      // A fresh program must consume the saved id; no preview state is shared in memory.
      const confirmation = programFor(context.configPath, context.fetch);
      await confirmation.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);
      expect(context.fetch).toHaveBeenCalledOnce();
      const [url, init] = context.fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`https://example.test/ords/api${path}`);
      expect(init.method).toBe(method);
      expect(JSON.parse(String(init.body))).toEqual(preview.request.body);
      expect(confirmation.stderr).toEqual([]);
      expect(JSON.parse(confirmation.stdout.join(""))).toEqual(expect.objectContaining({
        kind: "write-result", operationId: preview.operationId, action: `${name}.${action}`, status: "completed"
      }));
      expect(JSON.parse(await readFile(operationPath, "utf8")).status).toBe("completed");

      const repeat = programFor(context.configPath, context.fetch);
      await repeat.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);
      expect(context.fetch).toHaveBeenCalledOnce();
      expect(repeat.stdout).toEqual([]);
      expect(repeat.stderr.join("")).toContain("already completed");
      expect(process.exitCode).toBe(1);
    });

    test.each(cases)("$name.$action dry-run takes precedence over preview and saves no operation", async ({ name, action, method, path }) => {
      const context = await testContext();
      roots.add(dirname(dirname(context.configPath)));
      for (const flags of [["--dry-run"], ["--dry-run", "--preview"]]) {
        const io = programFor(context.configPath, context.fetch);
        await io.program.parseAsync(["node", "apexcn", name, action, "42", ...flags, "--json"]);
        expect(context.fetch).not.toHaveBeenCalled();
        expect(io.stderr).toEqual([]);
        expect(process.exitCode).toBeUndefined();
        const output = JSON.parse(io.stdout.join(""));
        expect(output).toEqual(expect.objectContaining({ dryRun: true, preview: false, mode: "dry-run", method, path }));
        expect(output.operationId).toBeUndefined();
        expect(output.confirmation).toBeUndefined();
        await expect(readdir(join(dirname(context.configPath), "operations"))).rejects.toMatchObject({ code: "ENOENT" });
      }
    });

    test.each(cases)("$name.$action without preview preserves direct execution", async ({ name, action, method, path }) => {
      const response = { ok: true, requestId: "req-direct-relation" };
      const context = await testContext([Response.json(response)]);
      roots.add(dirname(dirname(context.configPath)));
      await context.program.parseAsync(["node", "apexcn", name, action, "42", "--json"]);
      expect(context.fetch).toHaveBeenCalledOnce();
      const [url, init] = context.fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`https://example.test/ords/api${path}`);
      expect(init.method).toBe(method);
      expect(init.body).toBeUndefined();
      expect(context.stderr).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(context.stdout.join(""))).toEqual(response);
      await expect(readdir(join(dirname(context.configPath), "operations"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  test("correct-answer preview confirms only after the server advertises the exact capability endpoint", async () => {
    const context = await testContext([
      Response.json(replyActionCapabilities()),
      Response.json({
        id: 90,
        replyId: 90,
        topicId: 42,
        isUseful: true,
        changed: true,
        version: 3,
        requestId: "req-answer"
      })
    ]);

    await context.program.parseAsync([
      "node",
      "apexcn",
      "reply",
      "mark-answer",
      "42",
      "90",
      "--if-version",
      "2",
      "--json"
    ]);

    expect(context.fetch).not.toHaveBeenCalled();
    const preview = JSON.parse(context.stdout.join(""));
    expect(preview).toEqual(expect.objectContaining({
      action: "reply.mark-answer",
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics/42/replies/90/correct-answer",
        body: expect.objectContaining({
          ifVersion: 2,
          operationKey: expect.any(String),
          payloadHash: expect.any(String)
        })
      })
    }));

    context.stdout.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);

    expect(context.fetch).toHaveBeenCalledTimes(2);
    expect(String(context.fetch.mock.calls[0]?.[0])).toBe("https://example.test/ords/api/api/v1/capabilities");
    expect(String(context.fetch.mock.calls[1]?.[0])).toBe("https://example.test/ords/api/api/v1/topics/42/replies/90/correct-answer");
    expect((context.fetch.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((context.fetch.mock.calls[1]?.[1] as RequestInit).body))).toEqual(preview.request.body);
    expect(JSON.parse(context.stdout.join(""))).toEqual(expect.objectContaining({
      status: "completed",
      requestId: "req-answer"
    }));
  });

  test("reply favorite preview confirms through the reply endpoint and preserves topic favorite behavior", async () => {
    const context = await testContext([
      Response.json(replyActionCapabilities()),
      Response.json({
        targetType: "POST",
        targetId: 90,
        replyId: 90,
        topicId: 42,
        isFavorited: true,
        changed: true,
        requestId: "req-reply-favorite"
      })
    ]);

    await context.program.parseAsync([
      "node",
      "apexcn",
      "favorite",
      "add",
      "90",
      "--target",
      "reply",
      "--json"
    ]);

    expect(context.fetch).not.toHaveBeenCalled();
    const preview = JSON.parse(context.stdout.join(""));
    expect(preview).toEqual(expect.objectContaining({
      action: "favorite.reply.add",
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/replies/90/favorite",
        body: expect.objectContaining({
          operationKey: expect.any(String),
          payloadHash: expect.any(String)
        })
      })
    }));

    context.stdout.length = 0;
    await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);

    expect(context.fetch).toHaveBeenCalledTimes(2);
    expect(String(context.fetch.mock.calls[1]?.[0])).toBe("https://example.test/ords/api/api/v1/replies/90/favorite");
    expect((context.fetch.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(context.stdout.join(""))).toEqual(expect.objectContaining({
      status: "completed",
      requestId: "req-reply-favorite"
    }));
  });

  test("new reply actions fail closed before the write when capability or endpoint evidence is missing", async () => {
    for (const capabilities of [
      {
        ...replyActionCapabilities(),
        capabilities: []
      },
      {
        ...replyActionCapabilities(),
        capabilities: [{
          id: "thread-detail-reply-actions",
          available: true,
          endpoints: ["/replies/{replyId}/favorite"]
        }]
      }
    ]) {
      const context = await testContext([Response.json(capabilities)]);
      await context.program.parseAsync([
        "node",
        "apexcn",
        "reply",
        "mark-answer",
        "42",
        "90",
        "--if-version",
        "2",
        "--json"
      ]);
      const preview = JSON.parse(context.stdout.join(""));

      context.stdout.length = 0;
      await context.program.parseAsync(["node", "apexcn", "confirm", preview.operationId, "--yes", "--json"]);

      expect(context.fetch).toHaveBeenCalledOnce();
      expect(context.stderr.join("")).toContain("thread-detail-reply-actions");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
  });

  test("reply preview returns an operation id and confirmation executes the exact request once", async () => {
    const context = await testContext([Response.json({
      id: 90,
      replyId: 90,
      topicId: 42,
      url: "https://oracleapex.cn/ords/f?p=100:14:::::P14_THREAD_ID:42&cs=checksum-42#post_90",
      replyUrl: "https://oracleapex.cn/ords/f?p=100:14:::::P14_THREAD_ID:42&cs=checksum-42#post_90",
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
        url: "https://oracleapex.cn/ords/f?p=100:14:::::P14_THREAD_ID:42&cs=checksum-42#post_90",
        replyUrl: "https://oracleapex.cn/ords/f?p=100:14:::::P14_THREAD_ID:42&cs=checksum-42#post_90"
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

function replyActionCapabilities() {
  return {
    kind: "capabilities",
    contractVersion: "0.8.3-candidate",
    supportedContractVersions: [
      "0.8.3-candidate",
      "0.8.0-candidate",
      "0.7.0-candidate",
      "0.6.0-candidate"
    ],
    capabilities: [{
      id: "thread-detail-reply-actions",
      available: true,
      endpoints: [
        "/topics/{topicId}/replies/{replyId}/correct-answer",
        "/replies/{replyId}/favorite"
      ]
    }],
    requestId: "req-capabilities"
  };
}
