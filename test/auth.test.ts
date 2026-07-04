import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-auth-"));
  return join(dir, ".apexcn", "config.json");
}

async function writeConfig(path: string, config: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

describe("auth command", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

  test("auth audit reports a valid config without leaking tokens or calling the API", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://oracleapex.cn/ords/api", token: "abcdefghijklmnopqrstuvwxyz" }
      }
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "audit", "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const audit = JSON.parse(stdout.join(""));
    expect(audit).toEqual(expect.objectContaining({
      kind: "auth-audit",
      schemaVersion: 1,
      ok: true,
      configPath,
      current: "prod",
      profileCount: 1,
      issues: [],
      warnings: []
    }));
    expect(audit.profiles[0].token).toEqual({ present: true, redacted: "abcd...wxyz", length: 26 });
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  test("auth audit reports config issues and malformed profiles", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "missing",
      profiles: {
        broken: "not-object",
        invalidUrl: { baseUrl: "ftp://example.test", token: "" }
      }
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "audit", "--json"]);

    expect(stderr.join("")).toBe("");
    const audit = JSON.parse(stdout.join(""));
    expect(audit.ok).toBe(false);
    expect(audit.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-current-profile", profile: "missing" }),
      expect.objectContaining({ code: "invalid-profile", profile: "broken" }),
      expect.objectContaining({ code: "invalid-base-url", profile: "invalidUrl" }),
      expect.objectContaining({ code: "missing-token", profile: "invalidUrl" })
    ]));
    expect(process.exitCode).toBe(1);
  });

  test("auth audit treats http and duplicate base URLs as warnings", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "one",
      profiles: {
        one: { baseUrl: "http://127.0.0.1:9", token: "abcdefghijklmnopqrstuvwxyz" },
        two: { baseUrl: "http://127.0.0.1:9", token: "zyxwvutsrqponmlkjihgfedcba" }
      }
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "audit", "--json"]);

    expect(stderr.join("")).toBe("");
    const audit = JSON.parse(stdout.join(""));
    expect(audit.ok).toBe(true);
    expect(audit.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "insecure-base-url", profile: "one" }),
      expect.objectContaining({ code: "insecure-base-url", profile: "two" }),
      expect.objectContaining({ code: "duplicate-base-url", profile: "one" }),
      expect.objectContaining({ code: "duplicate-base-url", profile: "two" })
    ]));
    expect(process.exitCode).toBeUndefined();
  });

  test("auth audit reports missing profile state", async () => {
    const cases = [
      {
        config: { profiles: {} },
        codes: ["no-profiles", "no-active-profile"]
      },
      {
        config: { current: "missing", profiles: {} },
        codes: ["no-profiles", "missing-current-profile"]
      }
    ];

    for (const item of cases) {
      const configPath = await tempConfigPath();
      await writeConfig(configPath, item.config);
      const stdout: string[] = [];
      const program = createProgram({
        configPath,
        stdout: (text) => stdout.push(text),
        stderr: () => undefined
      });

      await program.parseAsync(["node", "apexcn", "auth", "audit", "--json"]);

      const codes = JSON.parse(stdout.join("")).issues.map((issue: { code: string }) => issue.code);
      expect(codes).toEqual(expect.arrayContaining(item.codes));
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    }
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

  test("auth set-token rejects blank profile and base URL without writing config", async () => {
    const cases = [
      {
        argv: ["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--profile", "   "],
        message: "Profile must not be blank\n"
      },
      {
        argv: ["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "   "],
        message: "Base URL must not be blank\n"
      }
    ];

    for (const item of cases) {
      const configPath = await tempConfigPath();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const program = createProgram({
        configPath,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      });

      await program.parseAsync(item.argv);
      await program.parseAsync(["node", "apexcn", "auth", "show"]);

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe(`${item.message}No active profile\n`);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    }
  });

  test("auth set-token stores non-blank profile and base URL exactly as provided", async () => {
    const configPath = await tempConfigPath();
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
      " prod ",
      "--base-url",
      "https://example.test/ords/api"
    ]);
    await program.parseAsync(["node", "apexcn", "auth", "show", "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout[1])).toEqual({
      profile: " prod ",
      baseUrl: "https://example.test/ords/api",
      token: "abcd...wxyz"
    });
    expect(process.exitCode).toBeUndefined();
  });

  test("auth set-token accepts only absolute http or https base URLs", async () => {
    const cases = [
      "not a url",
      "ftp://example.test",
      "file:///tmp/api",
      "//example.test",
      "https://example.test ",
      "https:example.com",
      "http:example.com",
      "http:///path"
    ];

    for (const baseUrl of cases) {
      const configPath = await tempConfigPath();
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
        "--base-url",
        baseUrl
      ]);
      await program.parseAsync(["node", "apexcn", "auth", "show"]);

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe("Base URL must be an absolute http or https URL\nNo active profile\n");
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    }
  });

  test("auth set-token does not overwrite invalid config when base URL is invalid", async () => {
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
      "--base-url",
      "not a url"
    ]);
    await program.parseAsync(["node", "apexcn", "auth", "show"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(
      `Base URL must be an absolute http or https URL\nInvalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.\n`
    );
    expect(process.exitCode).toBe(1);
  });

  test("auth set-token stores accepted base URLs exactly as provided", async () => {
    const cases = [
      { argv: [], baseUrl: "https://oracleapex.cn/ords/api" },
      { argv: ["--base-url", "https://example.test/ords/api"], baseUrl: "https://example.test/ords/api" },
      { argv: ["--base-url", "http://127.0.0.1:9"], baseUrl: "http://127.0.0.1:9" }
    ];

    for (const item of cases) {
      const configPath = await tempConfigPath();
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
        ...item.argv
      ]);
      await program.parseAsync(["node", "apexcn", "auth", "show", "--json"]);

      expect(stderr.join("")).toBe("");
      expect(JSON.parse(stdout[1])).toEqual({
        profile: "prod",
        baseUrl: item.baseUrl,
        token: "abcd...wxyz"
      });
      expect(process.exitCode).toBeUndefined();
    }
  });

  test("auth set-token --no-switch preserves current profile name", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--profile", "prod"]);
    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "zyxwvutsrqponmlkjihgfedcba", "--profile", "staging", "--no-switch"]);
    await program.parseAsync(["node", "apexcn", "auth", "show", "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout[2])).toEqual({
      profile: "prod",
      baseUrl: "https://oracleapex.cn/ords/api",
      token: "abcd...wxyz"
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      current: "prod",
      profiles: {
        staging: { token: "zyxwvutsrqponmlkjihgfedcba" }
      }
    });
  });

  test("auth set-token --no-switch leaves current unset when no current exists", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--profile", "staging", "--no-switch"]);
    await program.parseAsync(["node", "apexcn", "auth", "show"]);

    expect(stdout.join("")).toBe("Saved profile staging\n");
    expect(stderr.join("")).toBe("No active profile\n");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      profiles: {
        staging: {
          baseUrl: "https://oracleapex.cn/ords/api",
          token: "abcdefghijklmnopqrstuvwxyz"
        }
      }
    });
    expect(process.exitCode).toBe(1);
  });

  test("auth set-token --no-switch overwrites current profile content without changing current name", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--profile", "prod"]);
    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "zyxwvutsrqponmlkjihgfedcba", "--profile", "prod", "--no-switch"]);
    await program.parseAsync(["node", "apexcn", "auth", "show", "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout[2])).toMatchObject({
      profile: "prod",
      token: "zyxw...dcba"
    });
  });

  test("auth set-token --no-switch recovers invalid config without selecting current", async () => {
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

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--profile", "staging", "--no-switch"]);
    await program.parseAsync(["node", "apexcn", "auth", "show"]);

    expect(stdout.join("")).toBe("Saved profile staging\n");
    expect(stderr.join("")).toBe("No active profile\n");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      profiles: {
        staging: {
          baseUrl: "https://oracleapex.cn/ords/api",
          token: "abcdefghijklmnopqrstuvwxyz"
        }
      }
    });
  });

  test("auth set-token local validation failure does not overwrite invalid config", async () => {
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

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", " ", "--profile", "staging", "--no-switch"]);
    await program.parseAsync(["node", "apexcn", "auth", "show"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe(`Token must not be blank\nInvalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.\n`);
    expect(await readFile(configPath, "utf8")).toBe("{not-json");
  });

  test("auth list prints sorted redacted profiles with current marker", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "prod",
      profiles: {
        staging: { baseUrl: "https://staging.test", token: "short" },
        prod: { baseUrl: "https://prod.test", token: "abcdefghijklmnopqrstuvwxyz" }
      }
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "list"]);

    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toBe("* prod https://prod.test abcd...wxyz\n  staging https://staging.test ********\n");
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(stdout.join("")).not.toContain("short");
  });

  test("auth list --json reports redacted profiles and ignores stale current", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "missing",
      profiles: {
        prod: { baseUrl: "https://prod.test", token: "abcdefghijklmnopqrstuvwxyz" }
      }
    });
    const stdout: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "list", "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual({
      profiles: [
        {
          name: "prod",
          current: false,
          baseUrl: "https://prod.test",
          token: "abcd...wxyz"
        }
      ]
    });
  });

  test("auth list handles empty configs", async () => {
    const configPath = await tempConfigPath();
    const stdout: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "list"]);
    await program.parseAsync(["node", "apexcn", "auth", "list", "--json"]);

    expect(stdout[0]).toBe("No profiles configured\n");
    expect(JSON.parse(stdout[1])).toEqual({ profiles: [] });
  });

  test("auth use switches existing profiles and rejects missing profiles without writing", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://prod.test", token: "prod-secret" },
        staging: { baseUrl: "https://staging.test", token: "staging-secret" }
      }
    });
    const before = await readFile(configPath, "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "use", "missing"]);
    expect(stderr.join("")).toBe("Profile not found: missing\n");
    expect(await readFile(configPath, "utf8")).toBe(before);
    process.exitCode = undefined;
    stderr.length = 0;

    await program.parseAsync(["node", "apexcn", "auth", "use", "staging"]);
    expect(stdout.join("")).toBe("Using profile staging\n");
    expect(JSON.parse(await readFile(configPath, "utf8")).current).toBe("staging");
  });

  test("auth remove deletes profiles and clears current only when removing current", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://prod.test", token: "prod-secret" },
        staging: { baseUrl: "https://staging.test", token: "staging-secret" }
      }
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "remove", "staging"]);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://prod.test", token: "prod-secret" }
      }
    });
    await program.parseAsync(["node", "apexcn", "auth", "remove", "prod"]);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ profiles: {} });
    expect(stdout.join("")).toBe("Removed profile staging\nRemoved profile prod\n");
    expect(stderr.join("")).toBe("");
  });

  test("auth remove rejects missing profiles without writing", async () => {
    const configPath = await tempConfigPath();
    await writeConfig(configPath, {
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://prod.test", token: "prod-secret" }
      }
    });
    const before = await readFile(configPath, "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      configPath,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "auth", "remove", "missing"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("Profile not found: missing\n");
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(process.exitCode).toBe(1);
  });

  test("auth list, use, and remove report invalid config files", async () => {
    const commands = [
      ["auth", "list"],
      ["auth", "use", "prod"],
      ["auth", "remove", "prod"]
    ];

    for (const command of commands) {
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

      await program.parseAsync(["node", "apexcn", ...command]);

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toBe(`Invalid config file: ${configPath}. Run apexcn auth set-token to reconfigure.\n`);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    }
  });
});
