#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeDoctor, runOnce, runProcess, validateConfig } from "./monitor.mjs";

// Synthetic fixtures only: no community requests and no actual notifications.
const root = await mkdtemp(join(tmpdir(), "apexcn-cli-health-acceptance-"));
const evidence = [];
try {
  const secret = "synthetic-health-acceptance-not-a-real-key";
  const cliPath = join(root, "cli.mjs");
  const credentialsFile = join(root, "credentials.json");
  const profileFile = join(root, "profile.json");
  const modeFile = join(root, "mode.json");
  const doctor = { ok: true, diagnostics: { cliVersion: "1.2.1" }, checks: ["profile", "me", "categories", "search"].map(name => ({ name, ok: true })) };
  await writeFile(credentialsFile, JSON.stringify({ api_key: secret }), { mode: 0o600 });
  await writeFile(profileFile, "{}");
  await writeFile(cliPath, `import { readFileSync } from "node:fs";
    if (process.argv.includes(${JSON.stringify(secret)}) || process.env.APEXCN_API_KEY !== ${JSON.stringify(secret)}) process.exit(10);
    console.error(${JSON.stringify(secret)});
    const value = JSON.parse(readFileSync(${JSON.stringify(modeFile)}, "utf8"));
    console.log(JSON.stringify(value)); process.exitCode = value.ok ? 0 : 1;`);
  const config = validateConfig({ cliPath, credentialsFile, profileFile, stateDir: root, notifyFeishu: true });
  const deliveries = [];
  const deliver = async (_config, event) => { deliveries.push(event.kind); return true; };
  await writeFile(modeFile, JSON.stringify(doctor));
  const initial = await runOnce(config, { deliver });
  assert.equal(initial.status, "HEALTHY");
  assert.equal(deliveries.length, 0);
  const broken = structuredClone(doctor);
  broken.ok = false; broken.checks[1] = { name: "me", ok: false, status: 503, message: secret };
  await writeFile(modeFile, JSON.stringify(broken));
  const first = await runOnce(config, { deliver });
  const second = await runOnce(config, { deliver });
  await runOnce(config, { deliver });
  assert.deepEqual([first.status, second.status], ["SUSPECT", "DOWN"]);
  assert.equal(second.probe.checks[1].code, "HTTP_5XX");
  assert.deepEqual(deliveries, ["FAILURE"]);
  await writeFile(modeFile, JSON.stringify(doctor));
  assert.equal((await runOnce(config, { deliver })).status, "HEALTHY");
  assert.deepEqual(deliveries, ["FAILURE", "RECOVERY"]);
  evidence.push({ scenario: "healthy-failure-confirmation-deduplication-recovery", ok: true,
    firstFailure: { status: first.status, code: first.probe.checks[1].code }, deliveries });
  assert.equal((await stat(join(root, "state.json"))).mode & 0o777, 0o600);
  assert.equal((await readFile(join(root, "state.json"), "utf8")).includes(secret), false);
  evidence.push({ scenario: "private-state-and-output-redaction", ok: true });
  await chmod(credentialsFile, 0o644);
  assert.equal((await runOnce({ ...config, notifyFeishu: false })).probe.code, "CREDENTIALS_UNAVAILABLE");
  await chmod(credentialsFile, 0o600);
  evidence.push({ scenario: "public-credential-file-refused", ok: true });
  assert.equal((await probeDoctor({ ...config, cliPath: join(root, "missing") }, secret)).code, "CLI_MISSING");
  await writeFile(cliPath, "console.log('not JSON')");
  assert.equal((await probeDoctor(config, secret)).code, "INVALID_DOCTOR_OUTPUT");
  await writeFile(cliPath, "setInterval(() => {}, 1000)");
  assert.equal((await probeDoctor({ ...config, processTimeoutMs: 100 }, secret)).code, "PROCESS_TIMEOUT");
  const descendant = await runProcess(process.execPath, ["-e", `require('node:child_process').spawn(process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ['ignore', 1, 2] })`], { timeoutMs: 250 });
  assert.equal(descendant.reason, "PROCESS_TIMEOUT");
  evidence.push({ scenario: "missing-cli-malformed-output-timeout-descendant-pipes", ok: true });
  console.log(JSON.stringify({ ok: true, kind: "isolated-cli-health-acceptance", checkedAt: new Date().toISOString(), evidence }));
} finally { await rm(root, { recursive: true, force: true }); }
