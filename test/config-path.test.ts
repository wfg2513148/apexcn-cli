import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempRoot(prefix = "apexcn-config-path-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function configPath(root: string, name: string) {
  return join(root, name, ".apexcn", "config.json");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeConfig(path: string, baseUrl: string, token: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      current: "prod",
      profiles: {
        prod: { baseUrl, token }
      }
    }, null, 2)}\n`
  );
}

describe("global config path", () => {
  const previousEnv = process.env.APEXCN_CONFIG_PATH;
  const previousHome = process.env.HOME;

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.APEXCN_CONFIG_PATH;
    } else {
      process.env.APEXCN_CONFIG_PATH = previousEnv;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("--config beats APEXCN_CONFIG_PATH", async () => {
    const root = await tempRoot();
    const envPath = await configPath(root, "env");
    const cliPath = await configPath(root, "cli");
    process.env.APEXCN_CONFIG_PATH = envPath;
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "--config",
      cliPath,
      "auth",
      "set-token",
      "--token",
      "abcdefghijklmnopqrstuvwxyz"
    ]);

    expect(stdout.join("")).toBe("Saved profile prod\n");
    expect(await fileExists(cliPath)).toBe(true);
    expect(await fileExists(envPath)).toBe(false);
  });

  test("APEXCN_CONFIG_PATH beats injected configPath when no CLI config is supplied", async () => {
    const root = await tempRoot();
    const envPath = await configPath(root, "env");
    const injectedPath = await configPath(root, "injected");
    process.env.APEXCN_CONFIG_PATH = envPath;
    const program = createProgram({
      configPath: injectedPath,
      stdout: () => undefined,
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);

    expect(await fileExists(envPath)).toBe(true);
    expect(await fileExists(injectedPath)).toBe(false);
  });

  test("reusing a program does not keep a previous CLI config path", async () => {
    const root = await tempRoot();
    const cliPath = await configPath(root, "cli");
    const envPath = await configPath(root, "env");
    const program = createProgram({
      stdout: () => undefined,
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "--config", cliPath, "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);
    process.env.APEXCN_CONFIG_PATH = envPath;
    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "zyxwvutsrqponmlkjihgfedcba"]);

    const cliConfig = JSON.parse(await readFile(cliPath, "utf8"));
    const envConfig = JSON.parse(await readFile(envPath, "utf8"));
    expect(cliConfig.profiles.prod.token).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(envConfig.profiles.prod.token).toBe("zyxwvutsrqponmlkjihgfedcba");
  });

  test("blank APEXCN_CONFIG_PATH is ignored in favor of injected configPath", async () => {
    const root = await tempRoot();
    const injectedPath = await configPath(root, "injected");
    process.env.APEXCN_CONFIG_PATH = "   ";
    const program = createProgram({
      configPath: injectedPath,
      stdout: () => undefined,
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);

    expect(await fileExists(injectedPath)).toBe(true);
  });

  test("createProgram configPath still works when no CLI config or env is supplied", async () => {
    const root = await tempRoot();
    const injectedPath = await configPath(root, "injected");
    delete process.env.APEXCN_CONFIG_PATH;
    const program = createProgram({
      configPath: injectedPath,
      stdout: () => undefined,
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"]);

    expect(await fileExists(injectedPath)).toBe(true);
  });

  test("--config works when parsing user arguments", async () => {
    const root = await tempRoot();
    const cliPath = await configPath(root, "cli");
    const program = createProgram({
      stdout: () => undefined,
      stderr: () => undefined
    });

    await program.parseAsync(["--config", cliPath, "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz"], { from: "user" });

    expect(await fileExists(cliPath)).toBe(true);
  });

  test("--config works after an alias subcommand name", async () => {
    const root = await tempRoot();
    const cliPath = await configPath(root, "cli");
    await writeConfig(cliPath, "https://oracleapex.cn/ords/config-path", "token-from-cli-config");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ topic: { id: 123, title: "Configured" } })));
    const program = createProgram({
      stdout: () => undefined,
      stderr: () => undefined
    });

    await program.parseAsync(["node", "apexcn", "thread", "view", "123", "--config", cliPath]);

    expect(fetch).toHaveBeenCalledWith(
      "https://oracleapex.cn/ords/config-path/api/v1/topics/123",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-from-cli-config" }) })
    );
  });

  test("write commands use --config without touching the default HOME config", async () => {
    const root = await tempRoot();
    const home = join(root, "home");
    process.env.HOME = home;
    const cliPath = await configPath(root, "cli");
    await writeConfig(cliPath, "https://oracleapex.cn/ords/write-config", "token-from-write-config");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, id: 42 })));
    const stdout: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text),
      stderr: () => undefined
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "--config",
      cliPath,
      "topic",
      "create",
      "--category-id",
      "2",
      "--title",
      "Config path topic",
      "--content",
      "Config path body",
      "--preview"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      profile: "prod",
      baseUrl: "https://oracleapex.cn/ords/write-config",
      method: "POST",
      path: "/api/v1/topics"
    }));
    expect(stdout.join("")).not.toContain("token-from-write-config");
    expect(await fileExists(join(home, ".apexcn", "config.json"))).toBe(false);
  });

  test("root help lists --config", () => {
    const program = createProgram();

    expect(program.helpInformation()).toContain("--config <path>");
  });

  test("blank --config is rejected", async () => {
    const program = createProgram({
      stdout: () => undefined,
      stderr: () => undefined
    });
    program.exitOverride((error) => {
      throw error;
    });

    await expect(program.parseAsync(["node", "apexcn", "--config", "", "auth", "show"])).rejects.toMatchObject({
      code: "commander.invalidArgument"
    });
  });
});
