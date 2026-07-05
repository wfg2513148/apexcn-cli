import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-me-"));
  return join(dir, ".apexcn", "config.json");
}

describe("me command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    delete process.env.APEXCN_HTTP_TIMEOUT_MS;
    delete process.env.APEXCN_ERROR_FORMAT;
  });

  test("prints the authenticated user JSON", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: 11, email: "test@example.test", nickname: "Tester", roleLevel: 10, isMuted: false },
          requestId: "req-ok"
        })
      )
    );
    const program = createProgram({
      configPath,
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
    await program.parseAsync(["node", "apexcn", "me", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      user: { id: 11, email: "test@example.test", nickname: "Tester", roleLevel: 10, isMuted: false },
      requestId: "req-ok"
    });
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("supports text format while preserving verbose diagnostics", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: 11, email: "test@example.test", nickname: "Test\ter", roleLevel: 10, isMuted: false },
          requestId: "req-ok"
        })
      )
    );
    const program = createProgram({
      configPath,
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
    await program.parseAsync(["node", "apexcn", "me", "--format", "text", "--verbose"]);

    expect(stdout.join("")).toBe([
      "id: 11",
      "name: Test er",
      "email: test@example.test",
      "roleLevel: 10",
      "isMuted: false",
      "requestId: req-ok",
      ""
    ].join("\n"));
    expect(stderr.join("")).toBe("GET https://oracleapex.cn/ords/test/api/v1/me\n");
  });

  test("prints current user aggregate stats", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          kind: "me-stats",
          user: { id: 11, nickname: "Tester" },
          authoredTopicCount: 3,
          authoredFeaturedTopicCount: 1,
          authoredReplyCount: 5,
          favoriteCount: 2,
          subscriptionCount: 4,
          requestId: "req-stats"
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "stats", "--format", "text"]);

    expect(fetch).toHaveBeenLastCalledWith("https://oracleapex.cn/ords/test/api/v1/me/stats", expect.any(Object));
    expect(stdout.join("")).toContain("authoredTopicCount: 3\n");
    expect(stdout.join("")).toContain("subscriptionCount: 4\n");
    expect(stderr.join("")).toBe("");
  });

  test("prints current user activity lists with offset pagination", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const responses: Record<string, unknown> = {
      "/api/v1/me/topics?pageSize=2&offset=4": { kind: "me-topics", items: [{ id: 42, title: "Topic", createdDate: "2026-07-01", updatedDate: "2026-07-02", url: "https://oracleapex.cn/t/42" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } },
      "/api/v1/me/replies?pageSize=2&offset=4": { kind: "me-replies", items: [{ id: 90, topicId: 42, topic: { title: "Topic" }, createdDate: "2026-07-02", updatedDate: "2026-07-03", url: "https://oracleapex.cn/t/42#90" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } },
      "/api/v1/me/favorites?pageSize=2&offset=4": { kind: "me-favorites", items: [{ topicId: 43, title: "Favorite", relationCreatedDate: "2026-07-04", updatedDate: "2026-07-05", url: "https://oracleapex.cn/t/43" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } },
      "/api/v1/me/subscriptions?pageSize=2&offset=4": { kind: "me-subscriptions", items: [{ topicId: 44, title: "Subscription", relationCreatedDate: "2026-07-04", updatedDate: "2026-07-05", url: "https://oracleapex.cn/t/44" }], page: { pageSize: 2, offset: 4, count: 1, hasMore: false } }
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const key = String(url).replace("https://oracleapex.cn/ords/test", "");
      return Response.json(responses[key] ?? { error: { message: `unexpected ${key}` } }, { status: responses[key] ? 200 : 500 });
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
    for (const command of ["topics", "replies", "favorites", "subscriptions"]) {
      stdout.length = 0;
      await program.parseAsync(["node", "apexcn", "me", command, "--page-size", "2", "--offset", "4", "--format", "text"]);
      expect(stdout.join("")).toContain("https://oracleapex.cn/t/");
    }

    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/topics?pageSize=2&offset=4", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/replies?pageSize=2&offset=4", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/favorites?pageSize=2&offset=4", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://oracleapex.cn/ords/test/api/v1/me/subscriptions?pageSize=2&offset=4", expect.any(Object));
    expect(stderr.join("")).toBe("");
  });

  test("favorite and subscription lists tolerate unavailable targets", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({
        kind: "me-favorites",
        items: [{ targetId: 404, unavailableReason: "TOPIC_NOT_FOUND", relationCreatedDate: "2026-07-04" }],
        page: { pageSize: 10, offset: 0, count: 1, hasMore: false }
      })
    ));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me", "favorites", "--format", "text"]);

    expect(stdout.join("")).toBe("404\t\t2026-07-04\t\tTOPIC_NOT_FOUND\t\n");
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  test("rejects ambiguous format options before making API requests", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me", "--json", "--format", "text"]);

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

  test("can print format validation errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn());
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me", "--json", "--format", "text"]);

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

  test("prints requestId on API errors and exits non-zero", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "INVALID_TOKEN", message: "Invalid API token", requestId: "req-bad" } },
          { status: 401 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "bad-token"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("HTTP 401: Invalid API token requestId=req-bad\n");
    expect(process.exitCode).toBe(1);
  });

  test("redacts the active token from API error messages", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-token" } },
          { status: 403 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("HTTP 403: token [redacted] is not allowed requestId=req-token\n");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("can print API errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "token abcdefghijklmnopqrstuvwxyz is not allowed", requestId: "req-token" } },
          { status: 403 }
        )
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "http",
        message: "token [redacted] is not allowed",
        status: 403,
        requestId: "req-token"
      }
    });
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("reports timeout failures from the default HTTP timeout", async () => {
    process.env.APEXCN_HTTP_TIMEOUT_MS = "5";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw timeout;
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Request timed out after 5ms: https://oracleapex.cn/ords/api/api/v1/me\n");
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("can print timeout errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    process.env.APEXCN_HTTP_TIMEOUT_MS = "5";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw timeout;
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "timeout",
        message: "Request timed out after 5ms: https://oracleapex.cn/ords/api/api/v1/me"
      }
    });
    expect(stderr.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(process.exitCode).toBe(1);
  });

  test("prints clean errors for non-JSON API failures", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>outage</html>", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "x-request-id": "req-html" }
        })
      )
    );
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("HTTP 503: Service Unavailable requestId=req-html\n");
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(stderr.join("")).not.toContain("<html>");
    expect(process.exitCode).toBe(1);
  });

  test("prints clean errors for network failures", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Network error: failed to reach https://oracleapex.cn/ords/api/api/v1/me\n");
    expect(stderr.join("")).not.toContain("TypeError");
    expect(stderr.join("")).not.toContain("fetch failed");
    expect(stderr.join("")).not.toContain("src/");
    expect(process.exitCode).toBe(1);
  });

  test("can print network errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    stdout.length = 0;
    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "network",
        message: "Network error: failed to reach https://oracleapex.cn/ords/api/api/v1/me"
      }
    });
    expect(stderr.join("")).not.toContain("TypeError");
    expect(stderr.join("")).not.toContain("fetch failed");
    expect(process.exitCode).toBe(1);
  });

  test("exits non-zero when no profile is configured", async () => {
    const stderr: string[] = [];
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(stderr.join("")).toBe("No active profile\n");
    expect(process.exitCode).toBe(1);
  });

  test("reports invalid config without making API requests", async () => {
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

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(`Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.\n`);
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(process.exitCode).toBe(1);
  });

  test("can print config errors as JSON", async () => {
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

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("");
    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "config",
        message: `Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.`
      }
    });
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(process.exitCode).toBe(1);
  });

  test("can print auth errors as JSON", async () => {
    process.env.APEXCN_ERROR_FORMAT = "json";
    const stderr: string[] = [];
    const program = createProgram({
      configPath: await tempConfigPath(),
      stdout: () => undefined,
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "me"]);

    expect(JSON.parse(stderr.join(""))).toEqual({
      ok: false,
      error: {
        type: "no-profile",
        message: "No active profile"
      }
    });
    expect(process.exitCode).toBe(1);
  });
});
