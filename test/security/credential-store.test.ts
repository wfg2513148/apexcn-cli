import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { setCurrentProfile } from "../../src/config.js";
import { envCredentialStore, fallbackCredentialStore, fileCredentialStore } from "../../src/core/credential-store.js";
import { loadRuntimeSession } from "../../src/core/runtime-session.js";

async function tempConfigPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "apexcn-credential-")), ".apexcn", "config.json");
}

describe("credential store abstraction", () => {
  test("file store can set, get, audit, and remove a token", async () => {
    const store = fileCredentialStore(await tempConfigPath());

    await store.set("test", "secret-token", { baseUrl: "https://oracleapex.cn/ords/test" });

    expect(await store.get("test")).toBe("secret-token");
    expect(await store.audit("test")).toEqual(expect.objectContaining({ ok: true, tokenPresent: true, store: "file" }));
    await store.remove("test");
    expect(await store.get("test")).toBeUndefined();
  });

  test("env store is read-only and audits presence without exposing token", async () => {
    const store = envCredentialStore({ APEXCN_API_KEY: "secret-token" });

    expect(await store.get("any")).toBe("secret-token");
    expect(await store.audit("any")).toEqual(expect.objectContaining({ ok: true, tokenPresent: true, store: "env" }));
    await expect(store.set("any", "new-token")).rejects.toThrow("read-only");
  });

  test("fallback store prefers env and falls back to the file store without exposing tokens", async () => {
    const configPath = await tempConfigPath();
    const file = fileCredentialStore(configPath);
    await file.set("test", "file-secret", { baseUrl: "https://oracleapex.cn/ords/test" });

    const fileSelected = fallbackCredentialStore(envCredentialStore({}), file);
    expect(await fileSelected.get("test")).toBe("file-secret");
    const fileAudit = await fileSelected.audit("test");
    expect(fileAudit).toEqual(expect.objectContaining({
      ok: true,
      store: "fallback",
      selectedStore: "file",
      backends: [
        { store: "env", available: false },
        { store: "file", available: true }
      ]
    }));

    const envSelected = fallbackCredentialStore(envCredentialStore({ APEXCN_API_KEY: "env-secret" }), file);
    expect(await envSelected.get("test")).toBe("env-secret");
    const envAudit = await envSelected.audit("test");
    expect(envAudit).toEqual(expect.objectContaining({ ok: true, selectedStore: "env" }));
    expect(JSON.stringify([fileAudit, envAudit])).not.toContain("file-secret");
    expect(JSON.stringify([fileAudit, envAudit])).not.toContain("env-secret");
  });

  test("fallback store fails closed when no backend has a credential", async () => {
    const store = fallbackCredentialStore(
      envCredentialStore({}),
      fileCredentialStore(await tempConfigPath())
    );

    expect(await store.audit("missing")).toEqual(expect.objectContaining({
      ok: false,
      tokenPresent: false,
      selectedStore: undefined,
      issues: [expect.objectContaining({ code: "missing-fallback-token" })]
    }));
  });

  test("runtime profiles select env, fall back to file, and fail closed without either credential", async () => {
    const configPath = await tempConfigPath();
    await setCurrentProfile("test", {
      baseUrl: "https://oracleapex.cn/ords/test",
      token: "file-secret",
      tokenEnv: "APEXCN_TEST_TOKEN"
    }, configPath);

    expect(await loadRuntimeSession(configPath, { APEXCN_TEST_TOKEN: "env-secret" })).toEqual({
      ok: true,
      session: {
        profile: "test",
        baseUrl: "https://oracleapex.cn/ords/test",
        token: "env-secret",
        credentialStore: "env"
      }
    });
    expect(await loadRuntimeSession(configPath, {})).toEqual({
      ok: true,
      session: {
        profile: "test",
        baseUrl: "https://oracleapex.cn/ords/test",
        token: "file-secret",
        credentialStore: "file"
      }
    });

    await setCurrentProfile("test", {
      baseUrl: "https://oracleapex.cn/ords/test",
      token: "",
      tokenEnv: "APEXCN_TEST_TOKEN"
    }, configPath);
    expect(await loadRuntimeSession(configPath, {})).toEqual({
      ok: false,
      reason: "no-credential",
      profile: "test"
    });
  });
});
