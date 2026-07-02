import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createProgram } from "../src/index.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-auth-"));
  return join(dir, ".apexcn", "config.json");
}

describe("auth command", () => {
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
});
