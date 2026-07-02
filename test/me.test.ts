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
