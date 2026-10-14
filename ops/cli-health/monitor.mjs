#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKS = ["profile", "me", "categories", "search"];
const HISTORY_LIMIT = 288;

export function parseDoctor(stdout, exitCode, secret = "") {
  let value;
  try { value = JSON.parse(stdout); } catch { return failure("INVALID_DOCTOR_OUTPUT"); }
  const profileFailure = value?.ok === false && value.checks?.length === 1
    && value.checks[0]?.name === "profile" && value.checks[0]?.ok === false;
  if (typeof value?.ok !== "boolean" || !Array.isArray(value.checks)
    || (!profileFailure && (value.checks.length !== CHECKS.length
    || !CHECKS.every(name => value.checks.filter(check => check?.name === name && typeof check.ok === "boolean").length === 1)
    || value.ok !== value.checks.every(check => check.ok)))) return failure("INVALID_DOCTOR_OUTPUT");
  const version = value.diagnostics?.cliVersion;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)
    || (secret && version.includes(secret))) return failure("INVALID_DOCTOR_OUTPUT");
  const checks = value.checks.map(check => {
    const status = Number.isInteger(check.status) && check.status >= 100 && check.status <= 599 ? check.status : undefined;
    const requestId = typeof check.requestId === "string" && /^req_[a-zA-Z0-9_-]{1,120}$/.test(check.requestId)
      && !(secret && check.requestId.includes(secret)) ? check.requestId : undefined;
    const code = check.ok ? "OK" : status === 401 || status === 403 ? "AUTH"
      : status === 429 ? "RATE_LIMITED" : status >= 500 ? "HTTP_5XX"
      : status >= 400 ? "HTTP_4XX" : check.name === "profile" ? "CREDENTIALS" : "API_UNAVAILABLE";
    return { name: check.name, ok: check.ok, code, ...(status ? { httpStatus: status } : {}), ...(requestId ? { requestId } : {}) };
  });
  return { ok: exitCode === 0 && value.ok, version, checks, code: exitCode === 0 && value.ok ? "OK" : value.ok ? "CLI_EXIT" : "DOCTOR_FAILED" };
}

function failure(code) { return { ok: false, code, checks: [] }; }

export function runProcess(executable, args, { env, cwd, timeoutMs, input } = {}) {
  return new Promise(resolve => {
    let child, stdout = "", stderr = "", bytes = 0, reason, finished = false, deadline, forceKill;
    const signalGroup = signal => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The child may already have exited. */ }
    };
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(forceKill);
      resolve({ code, signal, stdout, stderr, reason });
    };
    const stop = why => {
      if (reason || finished) return;
      reason = why;
      signalGroup("SIGTERM");
      // Descendants can retain inherited pipes after the immediate child exits.
      forceKill = setTimeout(() => {
        signalGroup("SIGKILL");
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(child.exitCode, child.signalCode);
      }, 1000);
    };
    try { child = spawn(executable, args, { env, cwd, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] }); }
    catch { reason = "CLI_START_FAILED"; finish(null, null); return; }
    child.once("error", () => { reason = "CLI_START_FAILED"; finish(null, null); });
    child.once("close", finish);
    for (const [stream, channel] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
      stream.setEncoding("utf8").on("data", text => {
        bytes += Buffer.byteLength(text);
        if (bytes > 262144) { stop("OUTPUT_LIMIT"); return; }
        if (channel === "stdout") stdout += text; else stderr += text;
      });
    }
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
    deadline = setTimeout(() => stop("PROCESS_TIMEOUT"), timeoutMs);
  });
}

export async function probeDoctor(config, secret) {
  try { if (!(await stat(config.cliPath)).isFile()) return failure("CLI_MISSING"); }
  catch { return failure("CLI_MISSING"); }
  const started = performance.now();
  const result = await runProcess(process.execPath, [config.cliPath, "--config", config.profileFile,
    "doctor", "--timeout-ms", String(config.timeoutMs), "--json"], {
    env: { PATH: process.env.PATH, HOME: config.stateDir, LANG: "C.UTF-8", APEXCN_API_KEY: secret, APEXCN_ERROR_FORMAT: "json" },
    cwd: config.stateDir, timeoutMs: config.processTimeoutMs
  });
  const probe = result.reason ? failure(result.reason) : parseDoctor(result.stdout, result.code, secret);
  return { ...probe, durationMs: Math.round(performance.now() - started) };
}

export function advance(previous, probe, config, now = new Date().toISOString()) {
  const failures = probe.ok ? 0 : Math.min((previous?.consecutiveFailures ?? 0) + 1, 1000000);
  const status = probe.ok ? "HEALTHY" : failures >= config.failureThreshold ? "DOWN" : "SUSPECT";
  let eventType = status === previous?.status ? null : status === "DOWN" ? "FAILURE"
    : status === "HEALTHY" && previous?.status === "DOWN" ? "RECOVERY"
    : status === "HEALTHY" ? "HEALTHY" : "SUSPECT";
  const summary = { checkedAt: now, status, consecutiveFailures: failures, probe };
  const events = previous?.events ?? [];
  if (!eventType && status === "DOWN" && config.notifyFeishu && !previous?.notificationsEnabled) eventType = "FAILURE";
  const pending = config.notifyFeishu ? [...(previous?.pendingNotifications ?? [])] : [];
  let event;
  if (eventType) {
    event = { eventId: `cli-prod:${randomUUID()}`, kind: eventType, createdAt: now, code: probe.code };
    if (config.notifyFeishu && ["FAILURE", "RECOVERY"].includes(eventType)) {
      pending.push({ ...event, text: `[APEXCN CLI健康] ${eventType}\n环境：prod；位置：OCI\n状态：${status}\n时间：${now}\n错误：${probe.code}\n检查：${probe.checks.map(check => `${check.name}:${check.code}`).join(", ")}\n事件：${event.eventId}` });
    }
  }
  return {
    schemaVersion: 1, kind: "apexcn-cli-health", ...summary,
    lastHealthyAt: probe.ok ? now : previous?.lastHealthyAt ?? null,
    events: [...events, ...(event ? [event] : [])].slice(-144),
    history: [...(previous?.history ?? []), summary].slice(-HISTORY_LIMIT),
    notificationsEnabled: config.notifyFeishu,
    pendingNotifications: pending.slice(-64)
  };
}

async function privateCredentials(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077)) throw new Error("PRIVATE_CREDENTIALS_REQUIRED");
  const value = JSON.parse(await readFile(path, "utf8"));
  if (typeof value.api_key !== "string" || !/^[\x21-\x7e]+$/.test(value.api_key)) throw new Error("API_CREDENTIAL_MISSING");
  return value.api_key;
}

export async function saveState(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function readState(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.schemaVersion !== 1 || !["HEALTHY", "SUSPECT", "DOWN"].includes(value.status)
      || !Number.isInteger(value.consecutiveFailures) || value.consecutiveFailures < 0
      || !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.history)
      || !Array.isArray(value.events) || !Array.isArray(value.pendingNotifications)) throw new Error("INVALID_STATE");
    return value;
  } catch (error) { if (error.code === "ENOENT") return null; throw new Error("INVALID_STATE"); }
}

async function notify(config, event) {
  const bridge = fileURLToPath(new URL("./notify.py", import.meta.url));
  const result = await runProcess("/usr/bin/python3.11", [bridge, config.credentialsFile], {
    env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }, timeoutMs: 12000, input: JSON.stringify(event)
  });
  return result.code === 0 && !result.reason;
}

export async function runOnce(config, { probe = probeDoctor, deliver = notify } = {}) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const statePath = join(config.stateDir, "state.json");
  const previous = await readState(statePath);
  let result, secret;
  try { secret = await privateCredentials(config.credentialsFile); }
  catch { result = failure("CREDENTIALS_UNAVAILABLE"); }
  if (!result) {
    try { result = await probe(config, secret); }
    catch { result = failure("PROBE_ERROR"); }
  }
  const state = advance(previous, result, config);
  // Persist pending events before delivery, retaining their IDs across retries.
  await saveState(statePath, state);
  if (config.notifyFeishu) {
    let sent = 0;
    for (const event of state.pendingNotifications.slice(0, 2)) {
      if (!await deliver(config, event)) break;
      sent++;
    }
    if (sent) {
      state.pendingNotifications.splice(0, sent);
      await saveState(statePath, state);
    }
  }
  return { ok: result.ok && state.pendingNotifications.length === 0, status: state.status,
    checkedAt: state.checkedAt, lastHealthyAt: state.lastHealthyAt, consecutiveFailures: state.consecutiveFailures,
    probe: state.probe, pendingNotifications: state.pendingNotifications.length,
    event: state.events.at(-1)?.createdAt === state.checkedAt ? state.events.at(-1).kind : null };
}

export function validateConfig(value) {
  for (const key of ["cliPath", "profileFile", "credentialsFile", "stateDir"]) {
    if (typeof value?.[key] !== "string" || !isAbsolute(value[key])) throw new Error("INVALID_CONFIG");
  }
  const config = { timeoutMs: 15000, processTimeoutMs: 60000, failureThreshold: 2, staleAfterSeconds: 3660, notifyFeishu: false, ...value };
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30000
    || !Number.isInteger(config.processTimeoutMs) || config.processTimeoutMs < config.timeoutMs * 3 + 2000 || config.processTimeoutMs > 60000
    || !Number.isInteger(config.failureThreshold) || config.failureThreshold < 1 || config.failureThreshold > 10
    || !Number.isInteger(config.staleAfterSeconds) || config.staleAfterSeconds < 300 || config.staleAfterSeconds > 3660
    || typeof config.notifyFeishu !== "boolean") throw new Error("INVALID_CONFIG");
  return config;
}

export function isFresh(state, staleAfterSeconds, now = Date.now()) {
  const age = state ? now - Date.parse(state.checkedAt) : NaN;
  return Number.isFinite(age) && age >= -60000 && age <= staleAfterSeconds * 1000;
}

async function main() {
  const [mode, flag, path, ...extra] = process.argv.slice(2);
  if (!["run", "status"].includes(mode) || flag !== "--config" || !path || extra.length) throw new Error("USAGE");
  const config = validateConfig(JSON.parse(await readFile(path, "utf8")));
  if (mode === "status") {
    const state = await readState(join(config.stateDir, "state.json"));
    const stale = !isFresh(state, config.staleAfterSeconds);
    const output = { ok: !!state && !stale && state.status === "HEALTHY" && !state.pendingNotifications.length,
      status: stale ? "STALE" : state.status, checkedAt: state?.checkedAt ?? null,
      lastHealthyAt: state?.lastHealthyAt ?? null, consecutiveFailures: state?.consecutiveFailures ?? 0,
      probe: state?.probe ?? null, pendingNotifications: state?.pendingNotifications.length ?? 0 };
    console.log(JSON.stringify(output));
    if (!output.ok) process.exitCode = 1;
  } else {
    const output = await runOnce(config);
    (output.ok ? console.log : console.error)(JSON.stringify(output));
    if (!output.ok) process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch(() => { console.error(JSON.stringify({ ok: false, status: "MONITOR_ERROR", code: "CONFIG_OR_STATE_ERROR" })); process.exitCode = 1; });
}
