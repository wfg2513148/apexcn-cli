import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
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

describe("doctor command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
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
    const data = JSON.parse(stdout.join(""));
    expect(data.ok).toBe(true);
    expect(data.diagnostics).toEqual(expect.objectContaining({
      cliVersion: "0.1.6",
      userAgent: "apexcn-cli/0.1.6",
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

  test("supports explicit output formats", async () => {
    const responses = [
      { user: { id: 1, nickname: "Tester" }, requestId: "req-me" },
      { items: [{ id: 4, name: "APEX 进阶技巧" }], requestId: "req-categories" },
      { items: [{ id: 42, title: "APEX REST" }], requestId: "req-search" }
    ];
    const { program, stdout } = await configuredProgram(async () => Response.json(responses.shift()));

    await program.parseAsync(["node", "apexcn", "doctor", "--format", "text"]);

    expect(stdout.join("")).toContain("apexcn doctor: ok\n");
    expect(stdout.join("")).toContain("CLI Version: 0.1.6\n");
    expect(stdout.join("")).toContain("User Agent: apexcn-cli/0.1.6\n");
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
      expect(stdout.join("")).toContain("CLI Version: 0.1.6\n");
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
        expect(stderr.join("")).toBe("--json can only be combined with --format pretty\n");
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
