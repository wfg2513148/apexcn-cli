import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { advance, isFresh, parseDoctor, probeDoctor, readState, runOnce, runProcess, validateConfig } from "../ops/cli-health/monitor.mjs";

const roots: string[] = [];
const secret = "synthetic-monitor-credential-keep-private";
const healthy = () => ({ ok: true, diagnostics: { cliVersion: "1.2.1" }, checks: ["profile", "me", "categories", "search"].map(name => ({ name, ok: true })) });
const success = () => parseDoctor(JSON.stringify(healthy()), 0);
const failed = () => ({ ok: false, code: "CLI_MISSING", checks: [] });

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "apexcn-monitor-"));
  roots.push(root);
  const cliPath = join(root, "cli.mjs");
  const credentialsFile = join(root, "credentials.json");
  const profileFile = join(root, "profile.json");
  writeFileSync(credentialsFile, JSON.stringify({ api_key: secret }), { mode: 0o600 });
  writeFileSync(profileFile, JSON.stringify({ current: "test", profiles: { test: { baseUrl: "https://example.invalid", tokenEnv: "APEXCN_API_KEY" } } }));
  writeFileSync(cliPath, `if (!process.argv.includes("doctor") || process.env.APEXCN_API_KEY !== ${JSON.stringify(secret)} || process.argv.join(" ").includes(${JSON.stringify(secret)})) process.exit(11); console.error(${JSON.stringify(secret)}); console.log(${JSON.stringify(JSON.stringify(healthy()))});`);
  const config = validateConfig({ cliPath, credentialsFile, profileFile, stateDir: root });
  return { root, config };
}

describe("CLI monitor contract and transitions", () => {
  test("requires every doctor check before reporting healthy", () => {
    expect(success().ok).toBe(true);
    const missing = healthy(); missing.checks.pop();
    expect(parseDoctor(JSON.stringify(missing), 0).code).toBe("INVALID_DOCTOR_OUTPUT");
    const duplicate = healthy(); duplicate.checks[3] = duplicate.checks[0];
    expect(parseDoctor(JSON.stringify(duplicate), 0).ok).toBe(false);
    expect(parseDoctor("not JSON", 0).ok).toBe(false);
    expect(parseDoctor(JSON.stringify(healthy()), 1).code).toBe("CLI_EXIT");
  });

  test.each([[401, "AUTH"], [403, "AUTH"], [429, "RATE_LIMITED"], [503, "HTTP_5XX"], [404, "HTTP_4XX"]])("classifies HTTP %s without storing its body", (status, code) => {
    const output = healthy(); output.ok = false;
    output.checks[1] = { name: "me", ok: false, status, message: secret, requestId: `req_${secret}` } as typeof output.checks[1];
    const result = parseDoctor(JSON.stringify(output), 1, secret);
    expect(result.checks[1].code).toBe(code);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.checks[1].requestId).toBeUndefined();
  });

  test("recognizes the doctor's early missing-profile result", () => {
    expect(parseDoctor(JSON.stringify({ ok: false, diagnostics: { cliVersion: "1.2.1" }, checks: [{ name: "profile", ok: false }] }), 1).checks[0].code).toBe("CREDENTIALS");
  });

  test("confirms after two failures and emits recovery once", () => {
    const config = { failureThreshold: 2, notifyFeishu: false };
    const initial = advance(null, success(), config, "2026-10-14T00:00:00Z");
    const suspect = advance(initial, failed(), config, "2026-10-14T00:05:00Z");
    const down = advance(suspect, failed(), config, "2026-10-14T00:10:00Z");
    const repeated = advance(down, failed(), config, "2026-10-14T00:15:00Z");
    const restored = advance(repeated, success(), config, "2026-10-14T00:20:00Z");
    expect([initial.status, suspect.status, down.status, restored.status]).toEqual(["HEALTHY", "SUSPECT", "DOWN", "HEALTHY"]);
    expect(repeated.events).toHaveLength(down.events.length);
    expect(restored.events.at(-1).kind).toBe("RECOVERY");
    expect(restored.consecutiveFailures).toBe(0);
  });

  test("bounds retained samples and clears disabled notifications", () => {
    let state = null;
    for (let i = 0; i < 500; i++) state = advance(state, success(), { failureThreshold: 2, notifyFeishu: false });
    expect(state.history).toHaveLength(288);
    const down = advance(null, failed(), { failureThreshold: 1, notifyFeishu: true });
    expect(down.pendingNotifications).toHaveLength(1);
    const off = advance(down, success(), { failureThreshold: 1, notifyFeishu: false });
    expect(off.pendingNotifications).toHaveLength(0);
    expect(down.pendingNotifications).toHaveLength(1);
  });

  test("rejects invalid path, timing and notification settings", () => {
    const base = { cliPath: "/cli", credentialsFile: "/credentials", profileFile: "/profile", stateDir: "/state" };
    for (const extra of [{ cliPath: "relative" }, { timeoutMs: 0 }, { processTimeoutMs: 100 }, { processTimeoutMs: 90000 }, { failureThreshold: 0 }, { staleAfterSeconds: 0 }, { notifyFeishu: "true" }]) {
      expect(() => validateConfig({ ...base, ...extra })).toThrow("INVALID_CONFIG");
    }
  });

  test("bounds status freshness including backward clock corrections", () => {
    const now = Date.parse("2026-10-14T01:00:00Z");
    const at = (age: number) => ({ checkedAt: new Date(now - age).toISOString() });
    expect(isFresh(null, 3660, now)).toBe(false);
    expect(isFresh(at(3660000), 3660, now)).toBe(true);
    expect(isFresh(at(3660001), 3660, now)).toBe(false);
    expect(isFresh(at(-60000), 3660, now)).toBe(true);
    expect(isFresh(at(-60001), 3660, now)).toBe(false);
  });

  test("keeps thirty-minute scheduling and freshness defaults aligned", () => {
    const base = { cliPath: "/cli", credentialsFile: "/credentials", profileFile: "/profile", stateDir: "/state" };
    expect(readFileSync(resolve("ops/cli-health/apexcn-cli-health.timer"), "utf8")).toContain("OnUnitActiveSec=30min");
    expect(validateConfig(base).staleAfterSeconds).toBe(3660);
    expect(validateConfig({ ...base, staleAfterSeconds: 3660 }).staleAfterSeconds).toBe(3660);
    expect(() => validateConfig({ ...base, staleAfterSeconds: 3661 })).toThrow("INVALID_CONFIG");
  });
});

describe.skipIf(process.platform === "win32")("Linux monitor process and storage", () => {
  test("runs a child with credentials in environment only and never retains stderr", async () => {
    const { config, root } = fixture();
    const result = await runOnce(config);
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "state.json"), "utf8")).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(readdirSync(root).filter(name => name.endsWith(".tmp"))).toHaveLength(0);
  });

  test("starts correctly through the deployed current symlink", () => {
    const { config, root } = fixture();
    const link = join(root, "monitor-current.mjs");
    const configPath = join(root, "monitor.json");
    symlinkSync(resolve("ops/cli-health/monitor.mjs"), link);
    writeFileSync(configPath, JSON.stringify(config));
    const output = execFileSync(process.execPath, [link, "run", "--config", configPath], { encoding: "utf8" });
    expect(JSON.parse(output).ok).toBe(true);
    expect(existsSync(join(root, "state.json"))).toBe(true);
  });

  test("kills a hung CLI and bounds excessive output", async () => {
    const { config } = fixture();
    writeFileSync(config.cliPath, "setInterval(() => {}, 1000);\n");
    expect((await probeDoctor({ ...config, processTimeoutMs: 100 }, secret)).code).toBe("PROCESS_TIMEOUT");
    const flood = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(400000))"], { timeoutMs: 2000 });
    expect(flood.reason).toBe("OUTPUT_LIMIT");
    expect(Buffer.byteLength(flood.stdout + flood.stderr)).toBeLessThanOrEqual(262144);
  });

  test("bounds descendants holding pipes even when they ignore termination", async () => {
    const started = performance.now();
    const result = await runProcess(process.execPath, ["-e", `
      const { spawn } = require('node:child_process');
      spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ['ignore', 1, 2] });
    `], { timeoutMs: 250 });
    expect(result.reason).toBe("PROCESS_TIMEOUT");
    expect(performance.now() - started).toBeLessThan(2500);
  });

  test("reports missing CLI and refuses public credential files", async () => {
    const { config } = fixture();
    expect((await probeDoctor({ ...config, cliPath: join(config.stateDir, "missing") }, secret)).code).toBe("CLI_MISSING");
    chmodSync(config.credentialsFile, 0o644);
    expect((await runOnce(config)).probe.code).toBe("CREDENTIALS_UNAVAILABLE");
  });

  test("preserves corrupt state instead of reporting a fresh healthy monitor", async () => {
    const { config } = fixture();
    const path = join(config.stateDir, "state.json"); writeFileSync(path, "broken state");
    await expect(runOnce(config)).rejects.toThrow("INVALID_STATE");
    expect(readFileSync(path, "utf8")).toBe("broken state");
  });

  test("retains notification IDs across failures and clears confirmed deliveries", async () => {
    const { config } = fixture(); config.notifyFeishu = true; config.failureThreshold = 1;
    await runOnce(config, { probe: async () => failed(), deliver: async () => false });
    const initial = await readState(join(config.stateDir, "state.json"));
    await runOnce(config, { probe: async () => failed(), deliver: async () => false });
    const again = await readState(join(config.stateDir, "state.json"));
    expect(again.pendingNotifications[0].eventId).toBe(initial.pendingNotifications[0].eventId);
    const result = await runOnce(config, { probe: async () => success(), deliver: async () => true });
    expect(result.ok).toBe(true);
    expect(result.pendingNotifications).toBe(0);
  });
});
