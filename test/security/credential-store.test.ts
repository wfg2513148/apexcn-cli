import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { envCredentialStore, fileCredentialStore } from "../../src/core/credential-store.js";

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
});
