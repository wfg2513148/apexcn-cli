import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-auth-"));
  return join(dir, ".apexcn", "config.json");
}

describe("auth command", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test("auth show redacts the token", async () => {
    const configPath = await tempConfigPath();
    const output: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => output.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--profile", "prod"]);
    await program.parseAsync(["node", "apexcn", "auth", "show"]);

    const text = output.join("");
    expect(text).toContain("Profile: prod");
    expect(text).toContain("Base URL: https://oracleapex.cn/ords/api");
    expect(text).toContain("Token: abcd...wxyz");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  test("auth show reports invalid config without a stack trace", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not-json", "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "show"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(`Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.\n`);
    expect(stderr.join("")).not.toContain("SyntaxError");
    expect(stderr.join("")).not.toContain("src/config");
    expect(process.exitCode).toBe(1);
  });

  test("auth set-token overwrites invalid config so the suggested recovery command works", async () => {
    const configPath = await tempConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "{not-json", "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
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
      "--profile",
      "prod"
    ]);
    await program.parseAsync(["node", "apexcn", "auth", "show", "--json"]);

    expect(stderr.join("")).toBe("");
    expect(stdout[0]).toBe("Saved profile prod\n");
    expect(JSON.parse(stdout[1])).toEqual({
      profile: "prod",
      baseUrl: "https://oracleapex.cn/ords/api",
      token: "abcd...wxyz"
    });
    expect(process.exitCode).toBeUndefined();
  });

  test("auth set-token rejects blank tokens without writing config", async () => {
    const cases = ["", "   "];

    for (const token of cases) {
      const configPath = await tempConfigPath();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const program = createProgram({
        configPath,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      });

      await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", token, "--profile", "prod"]);
      await program.parseAsync(["node", "apexcn", "auth", "show"]);

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe("Token must not be blank\nNo active profile\n");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    }
  });

  test("auth set-token stores non-blank tokens exactly as provided", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "  abcdefghijklmnopqrstuvwxyz  ", "--profile", "prod"]);
    await program.parseAsync(["node", "apexcn", "auth", "show", "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout[1])).toEqual({
      profile: "prod",
      baseUrl: "https://oracleapex.cn/ords/api",
      token: "  ab...yz  "
    });
    expect(process.exitCode).toBeUndefined();
  });
});
