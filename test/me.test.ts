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
    expect(stderr.join("")).toBe("--json can only be combined with --format pretty\n");
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
});
