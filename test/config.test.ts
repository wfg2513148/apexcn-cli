import { chmod, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  clearCurrentProfile,
  defaultConfigPath,
  loadConfig,
  saveConfig,
  setCurrentProfile
} from "../src/config.js";

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-config-"));
  return join(dir, ".apexcn", "config.json");
}

describe("config", () => {
  test("defaultConfigPath stores config under the home directory", () => {
    expect(defaultConfigPath("/tmp/home")).toBe("/tmp/home/.apexcn/config.json");
  });

  test("loadConfig returns an empty config when the file is missing", async () => {
    await expect(loadConfig(await tempConfigPath())).resolves.toEqual({ profiles: {} });
  });

  test("saveConfig writes config with user-only permissions where supported", async () => {
    const path = await tempConfigPath();

    await saveConfig({ current: "prod", profiles: { prod: { baseUrl: "https://example.test", token: "secret" } } }, path);

    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("setCurrentProfile stores the profile and marks it current", async () => {
    const path = await tempConfigPath();

    await setCurrentProfile("prod", { baseUrl: "https://example.test", token: "secret" }, path);

    await expect(loadConfig(path)).resolves.toEqual({
      current: "prod",
      profiles: {
        prod: { baseUrl: "https://example.test", token: "secret" }
      }
    });
  });

  test("clearCurrentProfile removes only the current pointer", async () => {
    const path = await tempConfigPath();
    await saveConfig({ current: "prod", profiles: { prod: { baseUrl: "https://example.test", token: "secret" } } }, path);
    await chmod(path, 0o600);

    await clearCurrentProfile(path);

    await expect(loadConfig(path)).resolves.toEqual({
      profiles: {
        prod: { baseUrl: "https://example.test", token: "secret" }
      }
    });
  });
});
