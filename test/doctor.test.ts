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
