import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Command } from "commander";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-doctor-"));
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

describe("doctor command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    delete process.env.APEXCN_API_KEY;
    delete process.env.APEXCN_CONFIG_PATH;
    delete process.env.APEXCN_HTTP_TIMEOUT_MS;
  });

  test("checks profile, account, categories, and search without exposing token", async () => {
    const responses = [
      { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
    ];
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json(responses.shift()));

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    expect(fetch).toHaveBeenNthCalledWith(1, "https://oracleapex.cn/ords/test/api/v1/me", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, "https://oracleapex.cn/ords/test/api/v1/categories", expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(3, "https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=1", expect.any(Object));
    expect(fetch).toHaveBeenCalledTimes(3);
    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(true);
    expect(data.diagnostics).toEqual(expect.objectContaining({
      cliVersion: "0.50.0",
      userAgent: "apexcn-cli/0.50.0",
      configPath: expect.stringContaining("config.json"),
      nodeVersion: expect.stringMatching(/^v\d+/),
      platform: process.platform,
      arch: process.arch
    }));
    expect(data.profile).toEqual({ name: "test@oci", baseUrl: "https://oracleapex.cn/ords/test" });
    expect(data.checks.map((check: { name: string; ok: boolean }) => [check.name, check.ok])).toEqual([
      ["profile", true],
      ["me", true],
      ["categories", true],
      ["search", true]
    ]);
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("rejects blank ask checks before loading a profile", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--check-ask", "   ", "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("--check-ask must not be blank\n");
    expect(process.exitCode).toBe(1);
  });

  test("rejects invalid timeout values before loading a profile", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });
    exitOverrideTree(program);

    await expect(program.parseAsync(["node", "apexcn", "doctor", "--timeout-ms", "0", "--json"])).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("Expected a positive integer timeout");
  });

  test("redacts the active token from doctor check failures", async () => {
    const responses = [
      { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" },
      Response.json(
        { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-ask-bad" } },
        { status: 403 }
      )
    ];
    const { program, stdout, stderr } = await configuredProgram(async () => {
      const next = responses.shift();
      return next instanceof Response ? next : Response.json(next);
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--check-ask", "How?", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "ask",
        ok: false,
        status: 403,
        requestId: "req-ask-bad",
        message: "token [redacted] is not allowed"
      })
    ]));
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("preserves rate-limit retry metadata in doctor failures", async () => {
    const responses = [
      Response.json({ error: { message: "Too many requests", requestId: "req-rate", retryAfterSeconds: 12, windowSeconds: 60 } }, { status: 429 }),
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
    ];
    const { program, stdout, stderr } = await configuredProgram(async () => {
      const next = responses.shift();
      return next instanceof Response ? next : Response.json(next);
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "me",
        ok: false,
        status: 429,
        requestId: "req-rate",
        retryAfterSeconds: 12,
        windowSeconds: 60
      })
    ]));
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("suggests bounded search fallback when ask check times out", async () => {
    const responses: Array<unknown> = [
      { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
    ];
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { program, stdout, stderr } = await configuredProgram(async () => {
      const next = responses.shift();
      if (next) {
        return Response.json(next);
      }
      throw timeout;
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--check-ask", "mail notification", "--timeout-ms", "5", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "ask",
        ok: false,
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/ask",
        suggestions: expect.arrayContaining([
          "Use apexcn search <keywords> --json or apexcn research <keywords> --json as a bounded fallback."
        ])
      })
    ]));
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("checks ask only when explicitly requested", async () => {
    const responses = [
      { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" },
      { answer: "APEX answer", requestId: "req-ask" }
    ];
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => Response.json(responses.shift()));

    await program.parseAsync(["node", "apexcn", "doctor", "--check-ask", "How to use APEX?", "--json"]);

    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "https://oracleapex.cn/ords/test/api/v1/ask",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ question: "How to use APEX?", topK: 1 }),
        headers: expect.objectContaining({
          Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
          "X-APEXCN-API-Key": "abcdefghijklmnopqrstuvwxyz"
        })
      })
    );
    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(true);
    expect(data.checks.map((check: { name: string; ok: boolean }) => [check.name, check.ok])).toEqual([
      ["profile", true],
      ["me", true],
      ["categories", true],
      ["search", true],
      ["ask", true]
    ]);
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("supports explicit output formats", async () => {
    const responses = [
      { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
    ];
    const { program, stdout } = await configuredProgram(async () => Response.json(responses.shift()));

    await program.parseAsync(["node", "apexcn", "doctor", "--format", "text"]);

    expect(stdout.join("")).toContain("apexcn doctor: ok\n");
    expect(stdout.join("")).toContain("CLI Version: 0.50.0\n");
    expect(stdout.join("")).toContain("User Agent: apexcn-cli/0.50.0\n");
    expect(stdout.join("")).toContain("Config Path: ");
    expect(stdout.join("")).toContain("OK search requestId=req-search\n");
  });

  test("default and explicit text formats use human-readable output", async () => {
    const cases = [
      ["node", "apexcn", "doctor"],
      ["node", "apexcn", "doctor", "--format", "text"]
    ];

    for (const argv of cases) {
      const responses = [
        { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
        { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
        { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
      ];
      const { program, stdout } = await configuredProgram(async () => Response.json(responses.shift()));

      await program.parseAsync(argv);

      expect(stdout.join("")).toContain("apexcn doctor: ok\n");
      expect(stdout.join("")).toContain("CLI Version: 0.50.0\n");
      expect(() => JSON.parse(stdout.join(""))).toThrow();
      vi.unstubAllGlobals();
    }
  });

  test("doctor json formats are compact or pretty as requested", async () => {
    const cases = [
      { argv: ["node", "apexcn", "doctor", "--format", "json"], pretty: false },
      { argv: ["node", "apexcn", "doctor", "--format", "pretty"], pretty: true },
      { argv: ["node", "apexcn", "doctor", "--json"], pretty: true },
      { argv: ["node", "apexcn", "doctor", "--json", "--format", "pretty"], pretty: true }
    ];

    for (const item of cases) {
      const responses = [
        { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
        { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
        { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
      ];
      const { program, stdout } = await configuredProgram(async () => Response.json(responses.shift()));

      await program.parseAsync(item.argv);

      expect(JSON.parse(stdout.join("")).ok).toBe(true);
      expect(stdout.join("").includes("\n  \"")).toBe(item.pretty);
      vi.unstubAllGlobals();
    }
  });

  test("rejects ambiguous or invalid format before loading profile", async () => {
    const cases = [
      ["node", "apexcn", "doctor", "--format", "xml"],
      ["node", "apexcn", "doctor", "--json", "--format", "text"],
      ["node", "apexcn", "doctor", "--json", "--format", "json"]
    ];

    for (const argv of cases) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      vi.stubGlobal("fetch", vi.fn());
      const program = createProgram({
        configPath: await tempConfigPath(),
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      });
      program.exitOverride((error) => {
        throw error;
      });

      if (argv.includes("xml")) {
        await expect(program.parseAsync(argv)).rejects.toThrow();
        expect(stderr.join("")).toContain("Expected output format json, pretty, or text");
      } else {
        await program.parseAsync(argv);
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
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(stdout.join("")).toBe("");
      vi.unstubAllGlobals();
    }
  });

  test("reports failing API checks and exits non-zero", async () => {
    const { program, stdout } = await configuredProgram(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/me")) {
        return Response.json({ user: { id: 1 }, requestId: "req-me" });
      }
      return Response.json({ error: { message: "Invalid API token", requestId: "req-bad" } }, { status: 401 });
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "categories", ok: false, status: 401, requestId: "req-bad" }),
        expect.objectContaining({ name: "search", ok: false, status: 401, requestId: "req-bad" })
      ])
    );
    expect(process.exitCode).toBe(1);
  });

  test("reports non-JSON API failures as failed checks", async () => {
    const responses = [
      new Response("<html>outage</html>", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "x-request-id": "req-html" }
      }),
      Response.json({ items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" }),
      Response.json({ items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" })
    ];
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => responses.shift() ?? Response.json({ ok: true }));

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "me", ok: false, message: "Service Unavailable", status: 503, requestId: "req-html" })
      ])
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stdout.join("")).not.toContain("SyntaxError");
    expect(stdout.join("")).not.toContain("<html>");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("reports network failures as failed checks without HTTP status", async () => {
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw new TypeError("fetch failed");
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual([
      { name: "profile", ok: true },
      { name: "me", ok: false, message: "Network error: failed to reach https://oracleapex.cn/ords/test/api/v1/me" },
      { name: "categories", ok: false, message: "Network error: failed to reach https://oracleapex.cn/ords/test/api/v1/categories" },
      { name: "search", ok: false, message: "Network error: failed to reach https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=1" }
    ]);
    expect(data.checks).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: 0 })]));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stdout.join("")).not.toContain("TypeError");
    expect(stdout.join("")).not.toContain("fetch failed");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("reports timeout failures as failed checks", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw timeout;
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--timeout-ms", "5", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual([
      { name: "profile", ok: true },
      expect.objectContaining({
        name: "me",
        ok: false,
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/me",
        suggestions: expect.arrayContaining(["Retry with a larger --timeout-ms value when the network or ORDS endpoint is slow."])
      }),
      expect.objectContaining({
        name: "categories",
        ok: false,
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/categories",
        suggestions: expect.arrayContaining(["Retry with a larger --timeout-ms value when the network or ORDS endpoint is slow."])
      }),
      expect.objectContaining({
        name: "search",
        ok: false,
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=1",
        suggestions: expect.arrayContaining(["Retry with a larger --timeout-ms value when the network or ORDS endpoint is slow."])
      })
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("uses the default HTTP timeout from the environment", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "7";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { program, stdout, stderr, fetch } = await configuredProgram(async () => {
      throw timeout;
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual([
      { name: "profile", ok: true },
      expect.objectContaining({ name: "me", ok: false, message: "Request timed out after 7ms: https://oracleapex.cn/ords/test/api/v1/me" }),
      expect.objectContaining({ name: "categories", ok: false, message: "Request timed out after 7ms: https://oracleapex.cn/ords/test/api/v1/categories" }),
      expect.objectContaining({ name: "search", ok: false, message: "Request timed out after 7ms: https://oracleapex.cn/ords/test/api/v1/search?keyword=APEX&pageSize=1" })
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("doctor snapshot reports local support state without calling the API or leaking secrets", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      current: "prod",
      profiles: {
        prod: {
          baseUrl: "https://oracleapex.cn/ords/api",
          token: "abcdefghijklmnopqrstuvwxyz"
        }
      }
    }));
    process.env.APEXCN_API_KEY = "env-api-key-secret";
    process.env.APEXCN_CONFIG_PATH = configPath;
    process.env.APEXCN_HTTP_TIMEOUT_MS = "1000";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "snapshot", "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const data = JSON.parse(stdout.join(""));
    expect(data).toEqual(expect.objectContaining({
      kind: "doctor-snapshot",
      schemaVersion: 1,
      ok: true
    }));
    expect(data.config).toEqual(expect.objectContaining({
      path: configPath,
      exists: true,
      readable: true,
      validJson: true,
      profileCount: 1,
      currentProfile: "prod",
      currentProfileExists: true,
      activeProfile: {
        baseUrl: "https://oracleapex.cn/ords/api",
        baseUrlValid: true,
        tokenPresent: true,
        tokenRedactedLength: 11
      }
    }));
    expect(data.environment.apexcnApiKey).toEqual({ present: true });
    expect(data.environment.apexcnHttpTimeoutMs).toEqual({ present: true, valid: true });
    expect(data.agentSkill.repoSkillPath).toContain("agent-skill");
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stdout.join("")).not.toContain("env-api-key-secret");
    expect(process.exitCode).toBeUndefined();
  });

  test("doctor snapshot reports broken config JSON with stable issue codes", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{broken");
    process.env.APEXCN_API_KEY = "env-api-key-secret";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "snapshot", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.config).toEqual(expect.objectContaining({ exists: true, readable: true, validJson: false }));
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "config-invalid-json", severity: "issue", ok: false })
    ]));
    expect(process.exitCode).toBe(1);
  });

  test("doctor snapshot reports invalid environment timeout without printing the value", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://oracleapex.cn/ords/api", token: "abcdefghijklmnopqrstuvwxyz" }
      }
    }));
    process.env.APEXCN_HTTP_TIMEOUT_MS = "not-a-number-secret";
    process.env.APEXCN_API_KEY = "env-api-key-secret";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "snapshot", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.environment.apexcnHttpTimeoutMs).toEqual({ present: true, valid: false });
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-timeout-env", severity: "issue", ok: false })
    ]));
    expect(stdout.join("")).not.toContain("not-a-number-secret");
    expect(stdout.join("")).not.toContain("env-api-key-secret");
    expect(process.exitCode).toBe(1);
  });

  test("doctor snapshot reports missing current profiles and missing tokens", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      current: "missing",
      profiles: {
        prod: { baseUrl: "https://oracleapex.cn/ords/api", token: "" }
      }
    }));
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "snapshot", "--format", "json"]);

    const data = JSON.parse(stdout.join(""));
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-current-profile", severity: "issue" }),
      expect.objectContaining({ code: "api-key-env-missing", severity: "warning" })
    ]));
    expect(stdout.join("").includes("\n  \"")).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test("doctor snapshot supports text output", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "snapshot", "--format", "text"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain("apexcn doctor snapshot: failed\n");
    expect(stdout.join("")).toContain("ISSUE config-unreadable:");
    expect(() => JSON.parse(stdout.join(""))).toThrow();
    expect(process.exitCode).toBe(1);
  });

  test("explicit doctor timeout overrides the default HTTP timeout", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "2500";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const { program, stdout, stderr } = await configuredProgram(async () => {
      throw timeout;
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--timeout-ms", "5", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "me", ok: false, message: "Request timed out after 5ms: https://oracleapex.cn/ords/test/api/v1/me" })
    ]));
    expect(stdout.join("")).not.toContain("2500ms");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("reports missing profile without making API requests", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual([expect.objectContaining({ name: "profile", ok: false, message: "No active profile" })]);
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });

  test("reports invalid config as a failed profile check", async () => {
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

    await program.parseAsync(["node", "apexcn", "doctor", "--json"]);

    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(false);
    expect(data.checks).toEqual([
      {
        name: "profile",
        ok: false,
        message: `Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.`
      }
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBe(1);
  });
});
