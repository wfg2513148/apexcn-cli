import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  access,
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_MODULE = process.env.M060_PLAYWRIGHT_MODULE
  ?? "/Users/kwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(PLAYWRIGHT_MODULE);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ASSIGNMENT = "M060-R28";
const BASELINE_IDS = [
  "B001-INSTALL-TARBALL",
  "B002-VERSION-0600",
  "B003-COMMAND-MANIFEST",
  "B004-WORKFLOW-HELP",
  "B005-MCP-MANIFEST-READONLY",
  "B006-MCP-MANIFEST-PREVIEW",
  "B007-DIRECT-TOPIC-WRITES-BLOCKED",
  "B008-DIRECT-REPLY-WRITES-BLOCKED",
  "B009-DIRECT-PREVIEWS-ZERO-WRITE",
  "B010-TOPIC-CREATE-PLAN",
  "B011-TOPIC-UPDATE-PLAN",
  "B012-TOPIC-DELETE-PLAN",
  "B013-REPLY-CREATE-PLAN",
  "B014-REPLY-UPDATE-PLAN",
  "B015-REPLY-DELETE-PLAN",
  "B016-TOPIC-CREATE-PREVIEW-HASH",
  "B017-TOPIC-UPDATE-TITLE-ONLY",
  "B018-REPLY-CREATE-PREVIEW-HASH",
  "B019-DELETE-CONFIRMATION-BINDING",
  "B020-APPROVAL-EXPIRY",
  "B021-APPROVAL-REQUEST-TAMPER",
  "B022-APPROVAL-TARGET-MISMATCH",
  "B023-DUPLICATE-COMPLETION-BLOCK",
  "B024-SECRET-BLOCK-BEFORE-PREVIEW",
  "B025-MCP-UPDATE-POST-ZERO-WRITE",
  "B026-MCP-DELETE-CONFIRMATION",
  "B027-RECOVERY-401",
  "B028-RECOVERY-409",
  "B029-RECOVERY-429",
  "B030-RECOVERY-TIMEOUT-OR-5XX"
];
const LIVE_GROUPS = [
  ["LIVE-G1", ["topic-create", "topic-update", "reply-create", "reply-update", "reply-delete", "topic-delete"]],
  ["LIVE-G2", ["topic-create", "topic-update", "reply-create", "reply-update", "reply-delete", "topic-delete"]],
  ["LIVE-G3", ["topic-create", "topic-update", "reply-create", "reply-update", "reply-delete", "topic-delete"]],
  ["LIVE-G4", ["topic-create", "topic-delete"]]
];
const MCP_PREVIEW_CALLS = [
  ["apexcn_topic_create_preview", { categoryId: 8, title: "M060 MCP topic", content: "Preview-only topic content." }],
  ["apexcn_topic_update_preview", { topicId: 42, title: "M060 MCP topic updated" }],
  ["apexcn_topic_delete_preview", { topicId: 42, confirmTitle: "M060 MCP topic" }],
  ["apexcn_reply_create_preview", { topicId: 42, content: "Preview-only reply content." }],
  ["apexcn_reply_update_preview", { replyId: 99, content: "Preview-only reply updated." }],
  ["apexcn_reply_delete_preview", { replyId: 99, confirmId: 99 }]
];

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument pair near ${String(key)}`);
    }
    values.set(key.slice(2), value);
  }
  const mode = values.get("mode") ?? "synthetic";
  if (!["synthetic", "baseline", "full"].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}`);
  }
  const roundRoot = resolve(values.get("round-root") ?? "");
  if (!roundRoot || roundRoot === resolve(".")) {
    throw new Error("--round-root is required");
  }
  return {
    mode,
    roundRoot,
    candidate: values.get("candidate") ? resolve(values.get("candidate")) : null,
    candidatePackage: values.get("candidate-package") ? resolve(values.get("candidate-package")) : null,
    config: values.get("config") ? resolve(values.get("config")) : null
  };
}

const options = parseArgs(process.argv.slice(2));
const ROOT = options.roundRoot;
const EVIDENCE = join(ROOT, "evidence");
const COMMAND_LOG = join(EVIDENCE, "first-attempt.jsonl");
const PACING_LOG = join(EVIDENCE, "backend", "pacing.jsonl");
const state = {
  candidateInvocationAttempts: 0,
  candidateProcesses: 0,
  realDevWrites: 0,
  loopbackWrites: 0,
  unsafeWrites: 0
};

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function previewHash(preview) {
  return sha256(canonicalJson({
    target: { profile: preview.profile, baseUrl: preview.baseUrl },
    request: preview.request
  }));
}

function redact(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/("(?:token|apiKey|password)"\s*:\s*")[^"]+"/gi, "$1[REDACTED]\"")
    .replace(/((?:token|api[_-]?key|password)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function safeJson(text) {
  if (!String(text ?? "").trim()) {
    return { ok: false, error: "empty-json", value: null };
  }
  try {
    return { ok: true, error: null, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: String(error.message), value: null };
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function writeJson(path, value) {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendJsonl(path, value) {
  await ensureDir(dirname(path));
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function pathInside(root, path) {
  const delta = relative(root, path);
  return delta === "" || (!delta.startsWith("..") && !delta.startsWith("/"));
}

async function assertRegularFile(path, label) {
  const info = await stat(path);
  invariant(info.isFile(), `${label} is not a regular file`);
}

async function runProcess(executable, argv, {
  scenario,
  cwd = ROOT,
  env = {},
  evidence = true
} = {}) {
  state.candidateInvocationAttempts += executable === options.candidate ? 1 : 0;
  return await new Promise((resolvePromise, rejectPromise) => {
    const startedAt = new Date().toISOString();
    const child = spawn(executable, argv, {
      cwd,
      env: { ...process.env, APEXCN_ERROR_FORMAT: "json", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (executable === options.candidate) {
      state.candidateProcesses += 1;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", async (exitCode, signal) => {
      const record = {
        scenario,
        executable: basename(executable),
        argv: argv.map(redact),
        startedAt,
        exitCode,
        signal,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stdout: redact(stdout),
        stderr: redact(stderr),
        spawned: true
      };
      if (evidence) {
        await appendJsonl(COMMAND_LOG, record);
      }
      resolvePromise({ ...record, rawStdout: stdout, rawStderr: stderr });
    });
  });
}

function cliArgs(args, config = options.config) {
  return config ? ["--config", config, ...args] : args;
}

async function candidate(args, scenario, settings = {}) {
  invariant(options.candidate, "candidate executable is required");
  return await runProcess(options.candidate, args, { scenario, ...settings });
}

async function writeFixture(path, content) {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
  return path;
}

async function createFixtures(root) {
  return {
    topic: await writeFixture(join(root, "topic.md"),
      "# M060 isolated validation\n\nThis topic exists only on the isolated development write surface and contains non-sensitive validation text.\n"),
    topicUpdated: await writeFixture(join(root, "topic-updated.md"),
      "# M060 isolated validation updated\n\nThis updated topic content remains isolated, non-sensitive, and easy to recognize in browser evidence.\n"),
    reply: await writeFixture(join(root, "reply.md"),
      "M060 isolated reply content for API and rendered-browser validation.\n"),
    replyUpdated: await writeFixture(join(root, "reply-updated.md"),
      "M060 isolated reply content updated for API and rendered-browser validation.\n"),
    secret: await writeFixture(join(root, "secret.md"),
      "# Synthetic safety check\n\nThis is not a real credential.\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\n")
  };
}

function baselineRow(id, pass, details = {}) {
  return { id, pass: pass === true, ...details };
}

function parsedStdout(result) {
  return safeJson(result.rawStdout);
}

async function createLoopbackConfig(root, baseUrl) {
  const path = join(root, "config.json");
  await writeJson(path, {
    current: "synthetic",
    profiles: {
      synthetic: {
        baseUrl,
        token: "synthetic-token"
      }
    }
  });
  await chmod(path, 0o600);
  return path;
}

async function withJsonServer(responder, callback) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    const entry = {
      method: request.method,
      path: request.url,
      body,
      headers: {
        authorizationPresent: Boolean(request.headers.authorization),
        contentType: request.headers["content-type"] ?? null
      }
    };
    requests.push(entry);
    if (request.method !== "GET" && request.method !== "HEAD") {
      state.loopbackWrites += 1;
    }
    const reply = await responder(entry, requests.length);
    const payload = JSON.stringify(reply.body);
    response.writeHead(reply.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      Connection: "close",
      ...(reply.headers ?? {})
    });
    response.end(payload);
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  invariant(address && typeof address === "object", "loopback server address missing");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback({ baseUrl, requests });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function successResponse(id = 42, version = 4, extra = {}) {
  return {
    status: 200,
    body: {
      ok: true,
      requestId: `req_${id}_${version}`,
      id,
      version,
      changed: true,
      url: `http://127.0.0.1/objects/${id}`,
      ...extra
    }
  };
}

async function createPreview({
  id,
  goal,
  args,
  runDir,
  config
}) {
  await ensureDir(runDir);
  const result = await candidate(cliArgs([
    "workflow", "run", "--goal", goal, ...args,
    "--output-dir", runDir, "--json"
  ], config), `${id}:preview`);
  const previewPath = join(runDir, "preview.json");
  const preview = await readJson(previewPath);
  invariant(result.exitCode === 0, `${id} preview exited ${result.exitCode}`);
  invariant(typeof preview.request?.body?.operationKey === "string", `${id} operationKey missing`);
  invariant(typeof preview.request?.body?.payloadHash === "string", `${id} payloadHash missing`);
  return { result, preview, previewPath };
}

async function approve({ id, runDir, config }) {
  const result = await candidate(cliArgs([
    "workflow", "approve", "--run-dir", runDir,
    "--approved-by", "m060-r28-validator",
    "--note", "isolated independent validation",
    "--json"
  ], config), `${id}:approve`);
  invariant(result.exitCode === 0, `${id} approval exited ${result.exitCode}`);
  const approvalPath = join(runDir, "approval.json");
  const approval = await readJson(approvalPath);
  return { result, approval, approvalPath };
}

async function execute({ id, runDir, config, env = {} }) {
  return await candidate(cliArgs([
    "workflow", "run", "--resume", runDir,
    "--execute", "--yes", "--json"
  ], config), `${id}:execute`, { env });
}

function approvalBindingPass(preview, approval) {
  return approval.previewHash === previewHash(preview)
    && canonicalJson(approval.target) === canonicalJson({
      profile: preview.profile,
      baseUrl: preview.baseUrl
    })
    && canonicalJson(approval.request) === canonicalJson(preview.request);
}

async function runLocalMutationScenario({
  id,
  mutation,
  expectedPattern,
  fixture,
  loopRoot
}) {
  return await withJsonServer(
    async () => ({ status: 500, body: { error: { code: "UNEXPECTED_NETWORK", message: "must stay local" } } }),
    async ({ baseUrl, requests }) => {
      const scenarioRoot = join(loopRoot, id);
      const config = await createLoopbackConfig(scenarioRoot, baseUrl);
      const runDir = join(scenarioRoot, "run");
      const previewResult = await createPreview({
        id,
        goal: "topic-update",
        args: ["--topic-id", "42", "--if-version", "3", "--content-file", fixture],
        runDir,
        config
      });
      const approvalResult = await approve({ id, runDir, config });
      const approval = structuredClone(approvalResult.approval);
      mutation(approval);
      await writeJson(approvalResult.approvalPath, approval);
      const result = await execute({ id, runDir, config });
      const output = `${result.rawStdout}\n${result.rawStderr}`;
      return baselineRow(id,
        result.exitCode !== 0 && expectedPattern.test(output) && requests.length === 0,
        {
          stages: ["preview", "approval", "mutation", "execute", "local-rejection", "zero-network"],
          exitCode: result.exitCode,
          networkRequests: requests.length,
          previewOperationKey: previewResult.preview.request.body.operationKey
        });
    }
  );
}

async function runDuplicateScenario({ id, fixture, loopRoot }) {
  return await withJsonServer(
    async (_request, index) => successResponse(42, 4, { requestId: `req_duplicate_${index}` }),
    async ({ baseUrl, requests }) => {
      const scenarioRoot = join(loopRoot, id);
      const config = await createLoopbackConfig(scenarioRoot, baseUrl);
      const runDir = join(scenarioRoot, "run");
      await createPreview({
        id,
        goal: "topic-update",
        args: ["--topic-id", "42", "--if-version", "3", "--content-file", fixture],
        runDir,
        config
      });
      await approve({ id, runDir, config });
      const first = await execute({ id: `${id}:first`, runDir, config });
      const duplicate = await execute({ id: `${id}:duplicate`, runDir, config });
      return baselineRow(id,
        first.exitCode === 0
          && duplicate.exitCode !== 0
          && /already completed/i.test(`${duplicate.rawStdout}\n${duplicate.rawStderr}`)
          && requests.length === 1,
        {
          stages: ["preview", "approval", "first-execute", "duplicate-execute", "single-network-write"],
          firstExitCode: first.exitCode,
          duplicateExitCode: duplicate.exitCode,
          networkRequests: requests.length
        });
    }
  );
}

async function runRecoveryScenario({
  id,
  firstStatus,
  firstCode,
  retry,
  fixture,
  loopRoot
}) {
  return await withJsonServer(
    async (_request, index) => {
      if (index === 1) {
        return {
          status: firstStatus,
          body: { error: { code: firstCode, message: `injected ${firstStatus}`, retryAfterSeconds: firstStatus === 429 ? 1 : undefined } }
        };
      }
      return successResponse(42, 4, { idempotentReplay: true });
    },
    async ({ baseUrl, requests }) => {
      const scenarioRoot = join(loopRoot, id);
      const config = await createLoopbackConfig(scenarioRoot, baseUrl);
      const runDir = join(scenarioRoot, "run");
      const { preview } = await createPreview({
        id,
        goal: "topic-update",
        args: ["--topic-id", "42", "--if-version", "3", "--content-file", fixture],
        runDir,
        config
      });
      await approve({ id, runDir, config });
      const first = await execute({ id: `${id}:first`, runDir, config });
      const firstState = await readJson(join(runDir, "run.json"));
      let second = null;
      if (retry) {
        second = await execute({ id: `${id}:recovery`, runDir, config });
      }
      const bodiesEqual = retry ? requests.length === 2 && requests[0].body === requests[1].body : requests.length === 1;
      const operationKey = preview.request.body.operationKey;
      const bodyOperationKeys = requests.map((request) => safeJson(request.body).value?.operationKey);
      const keysEqual = bodyOperationKeys.every((key) => key === operationKey);
      const firstStatePass = firstStatus === 500
        ? firstState.status === "execution-uncertain"
        : firstState.status === "failed";
      const conflictPass = firstStatus !== 409
        || (/new workflow/i.test(firstState.nextAction ?? "") && /stale approval/i.test(firstState.nextAction ?? ""));
      return baselineRow(id,
        first.exitCode !== 0
          && firstStatePass
          && conflictPass
          && bodiesEqual
          && keysEqual
          && (!retry || second?.exitCode === 0),
        {
          stages: retry
            ? ["preview", "approval", "fault-execute", "state-check", "recovery-execute", "identity-check"]
            : ["preview", "approval", "fault-execute", "state-check", "no-stale-retry"],
          firstStatus,
          firstExitCode: first.exitCode,
          recoveryExitCode: second?.exitCode ?? null,
          requestCount: requests.length,
          bodiesEqual,
          operationKeysEqual: keysEqual,
          firstState: firstState.status,
          nextAction: redact(firstState.nextAction)
        });
    }
  );
}

async function runMcpStdio(calls, idPrefix) {
  invariant(options.candidate, "candidate executable is required");
  state.candidateInvocationAttempts += 1;
  state.candidateProcesses += 1;
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(options.candidate, ["mcp", "serve", "--allow-preview-write"], {
      cwd: ROOT,
      env: { ...process.env, APEXCN_API_KEY: "synthetic-mcp-token" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "m060-r28-validator", version: "1" }
        }
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      ...calls.map(([name, args], index) => ({
        jsonrpc: "2.0",
        id: index + 2,
        method: "tools/call",
        params: { name, arguments: args }
      }))
    ];
    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
    child.once("error", rejectPromise);
    child.once("close", async (exitCode) => {
      const messages = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const record = {
        scenario: idPrefix,
        executable: basename(options.candidate),
        argv: ["mcp", "serve", "--allow-preview-write"],
        exitCode,
        signal: null,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        stdout: redact(stdout),
        stderr: redact(stderr),
        spawned: true
      };
      await appendJsonl(COMMAND_LOG, record);
      resolvePromise({ exitCode, messages });
    });
  });
}

async function runBaseline() {
  invariant(options.candidate && options.candidatePackage && options.config, "baseline mode requires candidate, candidate-package, and config");
  await assertRegularFile(options.candidate, "candidate");
  await assertRegularFile(options.candidatePackage, "candidate package");
  const fixtures = await createFixtures(join(ROOT, "fixtures"));
  const baselineRoot = join(ROOT, "product-baseline-runs");
  const loopRoot = join(ROOT, "loopback-baseline");
  const rows = [];

  const packageJson = await readJson(options.candidatePackage);
  rows.push(baselineRow("B001-INSTALL-TARBALL", packageJson.name === "apexcn-cli" && packageJson.version === "0.60.0", {
    executor: "package-metadata",
    networkRequests: 0
  }));

  const simpleScenarios = [
    ["B002-VERSION-0600", ["--version"], (result) => result.exitCode === 0 && /\b0\.60\.0\b/.test(result.rawStdout)],
    ["B003-COMMAND-MANIFEST", ["commands", "--json"], (result) => {
      const parsed = parsedStdout(result);
      return result.exitCode === 0 && parsed.ok && Array.isArray(parsed.value.commands) && parsed.value.commands.length > 0;
    }],
    ["B004-WORKFLOW-HELP", ["workflow", "--help"], (result) =>
      result.exitCode === 0
      && /Usage:\s*apexcn workflow/i.test(result.rawStdout)
      && /Commands:/i.test(result.rawStdout)
      && /plan/i.test(result.rawStdout)
      && /run/i.test(result.rawStdout)
      && /approve/i.test(result.rawStdout)
      && /policy/i.test(result.rawStdout)],
    ["B005-MCP-MANIFEST-READONLY", cliArgs(["mcp", "tools", "--json"]), (result) => {
      const parsed = parsedStdout(result);
      return result.exitCode === 0
        && parsed.ok
        && parsed.value.policy?.allowPreviewWrite === false
        && parsed.value.policy?.allowExecuteWrite === false
        && !parsed.value.tools?.some((tool) => tool.exposure === "preview-only");
    }],
    ["B006-MCP-MANIFEST-PREVIEW", cliArgs(["mcp", "tools", "--allow-preview-write", "--json"]), (result) => {
      const parsed = parsedStdout(result);
      const previewTools = parsed.value?.tools?.filter((tool) => tool.exposure === "preview-only") ?? [];
      return result.exitCode === 0
        && parsed.ok
        && parsed.value.policy?.allowPreviewWrite === true
        && parsed.value.policy?.allowExecuteWrite === false
        && previewTools.length >= 6;
    }],
    ["B007-DIRECT-TOPIC-WRITES-BLOCKED", cliArgs([
      "topic", "create", "--category-id", "8", "--title", "M060 blocked topic",
      "--content-file", fixtures.topic, "--json"
    ]), (result) => result.exitCode !== 0 && /workflow/i.test(`${result.rawStdout}\n${result.rawStderr}`)],
    ["B008-DIRECT-REPLY-WRITES-BLOCKED", cliArgs([
      "reply", "create", "42", "--content-file", fixtures.reply, "--json"
    ]), (result) => result.exitCode !== 0 && /workflow/i.test(`${result.rawStdout}\n${result.rawStderr}`)],
    ["B009-DIRECT-PREVIEWS-ZERO-WRITE", cliArgs([
      "topic", "create", "--category-id", "8", "--title", "M060 preview topic",
      "--content-file", fixtures.topic, "--preview", "--json"
    ]), (result) => {
      const parsed = parsedStdout(result);
      return result.exitCode === 0
        && parsed.ok
        && parsed.value.dryRun === true
        && parsed.value.preview === true
        && parsed.value.mode === "preview"
        && typeof parsed.value.method === "string"
        && typeof parsed.value.path === "string"
        && parsed.value.body !== null
        && typeof parsed.value.body === "object";
    }]
  ];
  for (const [id, argv, predicate] of simpleScenarios) {
    const result = await candidate(argv, id);
    rows.push(baselineRow(id, predicate(result), {
      executor: "public-cli",
      exitCode: result.exitCode,
      networkRequests: 0
    }));
  }

  const planScenarios = [
    ["B010-TOPIC-CREATE-PLAN", "topic-create", ["--category-id", "8", "--title", "M060 plan topic", "--content-file", fixtures.topic]],
    ["B011-TOPIC-UPDATE-PLAN", "topic-update", ["--topic-id", "42", "--if-version", "3", "--title", "M060 plan topic updated"]],
    ["B012-TOPIC-DELETE-PLAN", "topic-delete", ["--topic-id", "42", "--if-version", "3", "--confirm-title", "M060 plan topic"]],
    ["B013-REPLY-CREATE-PLAN", "reply-create", ["--topic-id", "42", "--content-file", fixtures.reply]],
    ["B014-REPLY-UPDATE-PLAN", "reply-update", ["--reply-id", "99", "--if-version", "2", "--content-file", fixtures.replyUpdated]],
    ["B015-REPLY-DELETE-PLAN", "reply-delete", ["--reply-id", "99", "--if-version", "2", "--confirm-id", "99"]]
  ];
  for (const [id, goal, args] of planScenarios) {
    const outputDir = join(baselineRoot, id);
    const result = await candidate(cliArgs([
      "workflow", "plan", "--goal", goal, ...args,
      "--output-dir", outputDir, "--json"
    ]), id);
    const parsed = parsedStdout(result);
    rows.push(baselineRow(id, result.exitCode === 0 && parsed.ok, {
      executor: "workflow-plan",
      exitCode: result.exitCode,
      networkRequests: 0
    }));
  }

  const previewScenarios = [
    ["B016-TOPIC-CREATE-PREVIEW-HASH", "topic-create", ["--category-id", "8", "--title", "M060 preview hash", "--content-file", fixtures.topic],
      (preview) => preview.request.body.categoryId === 8 && typeof preview.request.body.title === "string" && typeof preview.request.body.content === "string"],
    ["B017-TOPIC-UPDATE-TITLE-ONLY", "topic-update", ["--topic-id", "42", "--if-version", "3", "--title", "M060 title only"],
      (preview) => preview.request.body.ifVersion === 3 && preview.request.body.title === "M060 title only" && preview.request.body.content === undefined],
    ["B018-REPLY-CREATE-PREVIEW-HASH", "reply-create", ["--topic-id", "42", "--content-file", fixtures.reply],
      (preview) => typeof preview.request.body.content === "string"],
    ["B019-DELETE-CONFIRMATION-BINDING", "topic-delete", ["--topic-id", "42", "--if-version", "3", "--confirm-title", "M060 exact title"],
      (preview) => preview.request.body.confirmTitle === "M060 exact title" && preview.request.body.ifVersion === 3]
  ];
  for (const [id, goal, args, predicate] of previewScenarios) {
    const runDir = join(baselineRoot, id);
    const { result, preview } = await createPreview({ id, goal, args, runDir, config: options.config });
    rows.push(baselineRow(id,
      result.exitCode === 0
        && typeof preview.request.body.operationKey === "string"
        && typeof preview.request.body.payloadHash === "string"
        && predicate(preview),
      {
        executor: "workflow-preview",
        stages: ["preview", "artifact-read", "nested-binding-check"],
        exitCode: result.exitCode,
        networkRequests: 0
      }));
  }

  rows.push(await runLocalMutationScenario({
    id: "B020-APPROVAL-EXPIRY",
    mutation: (approval) => { approval.expiresAt = "2000-01-01T00:00:00.000Z"; },
    expectedPattern: /expired/i,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));
  rows.push(await runLocalMutationScenario({
    id: "B021-APPROVAL-REQUEST-TAMPER",
    mutation: (approval) => { approval.request.body.content = "tampered after approval"; },
    expectedPattern: /approval request|hash mismatch|does not match/i,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));
  rows.push(await runLocalMutationScenario({
    id: "B022-APPROVAL-TARGET-MISMATCH",
    mutation: (approval) => { approval.target.profile = "m060-mismatched-profile"; },
    expectedPattern: /target|profile|does not match/i,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));
  rows.push(await runDuplicateScenario({
    id: "B023-DUPLICATE-COMPLETION-BLOCK",
    fixture: fixtures.topicUpdated,
    loopRoot
  }));

  const b024 = await withJsonServer(
    async () => ({ status: 500, body: { error: { code: "UNEXPECTED_NETWORK", message: "review must stay local" } } }),
    async ({ baseUrl, requests }) => {
      const config = await createLoopbackConfig(join(loopRoot, "B024-SECRET-BLOCK-BEFORE-PREVIEW"), baseUrl);
      const result = await candidate(cliArgs([
        "review", "topic", "--category-id", "8", "--title", "M060 safety",
        "--content-file", fixtures.secret, "--json"
      ], config), "B024-SECRET-BLOCK-BEFORE-PREVIEW");
      const parsed = parsedStdout(result);
      const issueCodes = parsed.value?.issues?.map((issue) => issue.code) ?? [];
      const output = `${result.rawStdout}\n${result.rawStderr}`;
      return baselineRow("B024-SECRET-BLOCK-BEFORE-PREVIEW",
        result.exitCode !== 0
          && parsed.ok
          && parsed.value.kind === "topic-review"
          && parsed.value.ok === false
          && issueCodes.includes("possible-secret")
          && !output.includes("abcdefghijklmnopqrstuvwxyz")
          && requests.length === 0,
        {
          executor: "local-review",
          stages: ["dedicated-secret-fixture", "review", "possible-secret", "redaction", "zero-network"],
          exitCode: result.exitCode,
          issueCodes,
          networkRequests: requests.length
        });
    }
  );
  rows.push(b024);

  const mcp = await runMcpStdio(MCP_PREVIEW_CALLS, "B025-B026-MCP-PREVIEW-CALLS");
  const mcpPayloads = mcp.messages
    .filter((message) => Number.isInteger(message.id) && message.id >= 2)
    .map((message) => safeJson(message.result?.content?.[0]?.text ?? "").value);
  const mcpAllSafe = mcp.exitCode === 0
    && mcpPayloads.length === MCP_PREVIEW_CALLS.length
    && mcpPayloads.every((payload) =>
      payload?.ok === true
      && payload.mode === "preview"
      && payload.willExecute === false
      && payload.effect === "api-write-preview");
  rows.push(baselineRow("B025-MCP-UPDATE-POST-ZERO-WRITE", mcpAllSafe
    && mcpPayloads[1]?.request?.method === "POST"
    && mcpPayloads[4]?.request?.method === "POST", {
    executor: "mcp-stdio",
    tools: [MCP_PREVIEW_CALLS[1][0], MCP_PREVIEW_CALLS[4][0]],
    writeRequests: 0
  }));
  rows.push(baselineRow("B026-MCP-DELETE-CONFIRMATION", mcpAllSafe
    && mcpPayloads[2]?.request?.body?.confirmTitle === "M060 MCP topic"
    && mcpPayloads[5]?.request?.body?.confirmId === 99, {
    executor: "mcp-stdio",
    tools: [MCP_PREVIEW_CALLS[2][0], MCP_PREVIEW_CALLS[5][0]],
    writeRequests: 0
  }));

  rows.push(await runRecoveryScenario({
    id: "B027-RECOVERY-401",
    firstStatus: 401,
    firstCode: "AUTH_REQUIRED",
    retry: true,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));
  rows.push(await runRecoveryScenario({
    id: "B028-RECOVERY-409",
    firstStatus: 409,
    firstCode: "VERSION_CONFLICT",
    retry: false,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));
  rows.push(await runRecoveryScenario({
    id: "B029-RECOVERY-429",
    firstStatus: 429,
    firstCode: "RATE_LIMITED",
    retry: true,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));
  rows.push(await runRecoveryScenario({
    id: "B030-RECOVERY-TIMEOUT-OR-5XX",
    firstStatus: 500,
    firstCode: "INTERNAL_ERROR",
    retry: true,
    fixture: fixtures.topicUpdated,
    loopRoot
  }));

  invariant(rows.length === 30, `baseline emitted ${rows.length} rows`);
  invariant(new Set(rows.map((row) => row.id)).size === 30, "baseline ids are not unique");
  invariant(BASELINE_IDS.every((id) => rows.some((row) => row.id === id)), "baseline id missing");
  await writeJson(join(ROOT, "results-baseline.json"), rows);
  await writeJson(join(EVIDENCE, "baseline-stage-ledger.json"), rows.map((row) => ({
    id: row.id,
    pass: row.pass,
    executor: row.executor,
    stages: row.stages ?? []
  })));
  return rows;
}

class WritePacer {
  constructor() {
    this.buckets = new Map();
  }

  canonicalBucket(operation) {
    return operation.startsWith("topic-")
      ? "/api/v1/topics|WRITE"
      : "/api/v1/replies|WRITE";
  }

  async reserve(operation, reference) {
    const bucket = this.canonicalBucket(operation);
    let rechecks = 0;
    let waitedMs = 0;
    while (true) {
      const now = Date.now();
      const recent = (this.buckets.get(bucket) ?? []).filter((time) => now - time < 60_000);
      if (recent.length < 9) {
        recent.push(now);
        this.buckets.set(bucket, recent);
        await appendJsonl(PACING_LOG, {
          reference,
          bucket,
          observedCountBeforeReservation: recent.length - 1,
          waitedMs,
          rechecks,
          reservationTimestamp: now
        });
        return;
      }
      const delay = Math.max(1, recent[0] + 61_000 - now);
      waitedMs += delay;
      rechecks += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    }
  }
}

function workflowPreviewArgs(operation, current, files, runDir) {
  const common = ["workflow", "run", "--goal", operation, "--output-dir", runDir, "--json"];
  if (operation === "topic-create") {
    return [...common, "--category-id", "8", "--title", current.title, "--content-file", files.topic];
  }
  if (operation === "topic-update") {
    return [...common, "--topic-id", String(current.topicId), "--if-version", String(current.topicVersion),
      "--title", current.updatedTitle, "--content-file", files.topicUpdated];
  }
  if (operation === "topic-delete") {
    return [...common, "--topic-id", String(current.topicId), "--if-version", String(current.topicVersion),
      "--confirm-title", current.title];
  }
  if (operation === "reply-create") {
    return [...common, "--topic-id", String(current.topicId), "--content-file", files.reply];
  }
  if (operation === "reply-update") {
    return [...common, "--reply-id", String(current.replyId), "--if-version", String(current.replyVersion),
      "--content-file", files.replyUpdated];
  }
  if (operation === "reply-delete") {
    return [...common, "--reply-id", String(current.replyId), "--if-version", String(current.replyVersion),
      "--confirm-id", String(current.replyId)];
  }
  throw new Error(`Unknown operation: ${operation}`);
}

async function topicView(topicId, reference) {
  const result = await candidate(cliArgs(["topic", "view", String(topicId), "--json"]), `${reference}:topic-view`);
  const parsed = parsedStdout(result);
  return { result, parsed };
}

async function openLiveBrowser() {
  const parent = await mkdtemp(join(EVIDENCE, "browser-parent-"));
  const userDataDir = join(parent, "profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    executablePath: CHROME
  });
  return { context, parent, userDataDir };
}

async function closeLiveBrowser(browser) {
  await browser.context.close();
  await rm(browser.parent, { recursive: true, force: true });
  try {
    await access(browser.userDataDir);
    throw new Error("live browser user-data-dir was not removed");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function browserEvidence(browser, {
  reference,
  url,
  expectedStatus,
  requiredText = [],
  forbiddenText = []
}) {
  const page = await browser.context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const status = response?.status() ?? null;
    const title = await page.title();
    const bodyText = await page.locator("body").innerText();
    const html = await page.content();
    const screenshotPath = join(EVIDENCE, "browser", `${reference}.png`);
    await ensureDir(dirname(screenshotPath));
    const screenshot = await page.screenshot({ path: screenshotPath, type: "png", fullPage: true });
    const observation = {
      reference,
      url,
      finalUrl: page.url(),
      status,
      title,
      bodyText: redact(bodyText),
      domByteLength: Buffer.byteLength(html),
      screenshotByteLength: screenshot.length,
      requiredText,
      forbiddenText,
      pass: status === expectedStatus
        && Buffer.byteLength(html) > 0
        && screenshot.length > 0
        && requiredText.every((text) => bodyText.includes(text))
        && forbiddenText.every((text) => !bodyText.includes(text))
    };
    await writeJson(join(EVIDENCE, "browser", `${reference}.json`), observation);
    return observation;
  } finally {
    await page.close();
  }
}

async function runLiveLifecycle({
  groupId,
  operation,
  index,
  current,
  files,
  pacer,
  browser,
  ledger
}) {
  const reference = `${groupId}-${String(index + 1).padStart(2, "0")}-${operation}`;
  const runDir = join(ROOT, "product-live-runs", reference);
  if (operation === "topic-delete") {
    const view = await topicView(current.topicId, `${reference}:refresh`);
    invariant(view.result.exitCode === 0 && view.parsed.ok, `${reference} pre-delete topic view failed`);
    invariant(Number.isInteger(view.parsed.value.topic?.version), `${reference} pre-delete version missing`);
    invariant(typeof view.parsed.value.topic?.title === "string", `${reference} pre-delete title missing`);
    current.topicVersion = view.parsed.value.topic.version;
    current.title = view.parsed.value.topic.title;
    current.visualUrl = view.parsed.value.topic.visualUrl;
  }
  const previewResult = await candidate(cliArgs(workflowPreviewArgs(operation, current, files, runDir)), `${reference}:preview`);
  invariant(previewResult.exitCode === 0, `${reference} preview failed`);
  const preview = await readJson(join(runDir, "preview.json"));
  invariant(typeof preview.request?.body?.operationKey === "string", `${reference} operationKey missing`);
  invariant(typeof preview.request?.body?.payloadHash === "string", `${reference} payloadHash missing`);
  const approvalResult = await approve({ id: reference, runDir, config: options.config });
  invariant(approvalBindingPass(preview, approvalResult.approval), `${reference} approval binding failed`);
  await pacer.reserve(operation, reference);
  const executed = await execute({ id: reference, runDir, config: options.config });
  state.realDevWrites += 1;
  invariant(executed.exitCode === 0, `${reference} execute failed`);
  const executeArtifact = await readJson(join(runDir, "execute.json"));
  const result = executeArtifact.result;
  invariant(Number.isInteger(result?.id) && result.id > 0, `${reference} execute id invalid`);
  invariant(Number.isInteger(result?.version) && result.version > 0, `${reference} execute version invalid`);
  invariant(executeArtifact.request?.body?.operationKey === preview.request.body.operationKey, `${reference} execute operationKey mismatch`);
  invariant(executeArtifact.request?.body?.payloadHash === preview.request.body.payloadHash, `${reference} execute payloadHash mismatch`);

  if (operation === "topic-create") {
    current.topicId = result.id;
    current.topicVersion = result.version;
    current.visualUrl = result.visualUrl ?? result.url;
    ledger.push({
      groupId,
      type: "topic",
      id: result.id,
      version: result.version,
      title: current.title,
      active: true,
      createRunDir: runDir
    });
  } else if (operation === "topic-update") {
    current.topicVersion = result.version;
    current.title = current.updatedTitle;
    const topic = ledger.find((entry) => entry.groupId === groupId && entry.type === "topic");
    topic.version = result.version;
    topic.title = current.title;
  } else if (operation === "reply-create") {
    current.replyId = result.id;
    current.replyVersion = result.version;
    ledger.push({
      groupId,
      type: "reply",
      id: result.id,
      version: result.version,
      topicId: current.topicId,
      active: true,
      createRunDir: runDir
    });
  } else if (operation === "reply-update") {
    current.replyVersion = result.version;
    const reply = ledger.find((entry) => entry.groupId === groupId && entry.type === "reply");
    reply.version = result.version;
  } else if (operation === "reply-delete") {
    const reply = ledger.find((entry) => entry.groupId === groupId && entry.type === "reply");
    reply.active = false;
    reply.deleteRunDir = runDir;
  } else if (operation === "topic-delete") {
    const topic = ledger.find((entry) => entry.groupId === groupId && entry.type === "topic");
    topic.active = false;
    topic.deleteRunDir = runDir;
  }

  let backend;
  let visual;
  if (operation === "topic-delete") {
    backend = await topicView(current.topicId, `${reference}:backend-deleted`);
    const backendPass = backend.result.exitCode !== 0
      && /NOT_FOUND|404|not found/i.test(`${backend.result.rawStdout}\n${backend.result.rawStderr}`);
    visual = await browserEvidence(browser, {
      reference,
      url: current.visualUrl,
      expectedStatus: 404,
      requiredText: [],
      forbiddenText: [current.title]
    });
    invariant(backendPass && visual.pass, `${reference} deleted-state evidence failed`);
  } else {
    backend = await topicView(current.topicId, `${reference}:backend`);
    invariant(backend.result.exitCode === 0 && backend.parsed.ok, `${reference} backend view failed`);
    const detail = backend.parsed.value;
    invariant(detail.topic?.id === current.topicId, `${reference} backend topic id mismatch`);
    invariant(detail.topic?.title === current.title, `${reference} backend title mismatch`);
    if (operation === "reply-create") {
      invariant(detail.replies?.some((reply) => reply.id === current.replyId && reply.content.includes("isolated reply content")), `${reference} backend reply missing`);
    }
    if (operation === "reply-update") {
      invariant(detail.replies?.some((reply) => reply.id === current.replyId && reply.content.includes("reply content updated")), `${reference} backend updated reply missing`);
    }
    if (operation === "reply-delete") {
      invariant(!detail.replies?.some((reply) => reply.id === current.replyId), `${reference} backend reply not deleted`);
    }
    current.visualUrl = detail.topic.visualUrl;
    visual = await browserEvidence(browser, {
      reference,
      url: current.visualUrl,
      expectedStatus: 200,
      requiredText: [
        current.title,
        operation === "reply-create" ? "M060 isolated reply content" : "",
        operation === "reply-update" ? "M060 isolated reply content updated" : ""
      ].filter(Boolean),
      forbiddenText: operation === "reply-delete" ? ["M060 isolated reply content updated"] : []
    });
    invariant(visual.pass, `${reference} rendered evidence failed`);
  }

  const row = {
    reference,
    groupId,
    operation,
    firstAttempt: true,
    pass: true,
    operationKey: preview.request.body.operationKey,
    payloadHash: preview.request.body.payloadHash,
    approvalHash: approvalResult.approval.previewHash,
    runDir,
    result: { id: result.id, version: result.version, url: result.url },
    backend: {
      exitCode: backend.result.exitCode,
      artifact: join(EVIDENCE, "first-attempt.jsonl")
    },
    browser: {
      pass: visual.pass,
      status: visual.status,
      json: join(EVIDENCE, "browser", `${reference}.json`),
      screenshot: join(EVIDENCE, "browser", `${reference}.png`)
    }
  };
  await appendJsonl(join(EVIDENCE, "live-first-attempts.jsonl"), row);
  return row;
}

async function cleanupActiveResources({ ledger, pacer, browser, files }) {
  const cleanupRows = [];
  for (const entry of [...ledger].reverse()) {
    if (!entry.active) {
      continue;
    }
    if (entry.type === "reply") {
      const reference = `cleanup-${entry.groupId}-reply-${entry.id}`;
      const runDir = join(ROOT, "cleanup-runs", reference);
      const current = { replyId: entry.id, replyVersion: entry.version };
      const previewResult = await candidate(cliArgs(workflowPreviewArgs("reply-delete", current, files, runDir)), `${reference}:preview`);
      invariant(previewResult.exitCode === 0, `${reference} preview failed`);
      const preview = await readJson(join(runDir, "preview.json"));
      const approvalResult = await approve({ id: reference, runDir, config: options.config });
      invariant(approvalBindingPass(preview, approvalResult.approval), `${reference} approval binding failed`);
      await pacer.reserve("reply-delete", reference);
      const result = await execute({ id: reference, runDir, config: options.config });
      state.realDevWrites += 1;
      invariant(result.exitCode === 0, `${reference} execute failed`);
      entry.active = false;
      entry.deleteRunDir = runDir;
      cleanupRows.push({ reference, type: "reply", id: entry.id, pass: true });
    }
  }
  for (const entry of [...ledger].reverse()) {
    if (!entry.active || entry.type !== "topic") {
      continue;
    }
    const reference = `cleanup-${entry.groupId}-topic-${entry.id}`;
    const view = await topicView(entry.id, `${reference}:refresh`);
    invariant(view.result.exitCode === 0 && view.parsed.ok, `${reference} refresh failed`);
    const current = {
      topicId: entry.id,
      topicVersion: view.parsed.value.topic.version,
      title: view.parsed.value.topic.title,
      visualUrl: view.parsed.value.topic.visualUrl
    };
    const runDir = join(ROOT, "cleanup-runs", reference);
    const previewResult = await candidate(cliArgs(workflowPreviewArgs("topic-delete", current, files, runDir)), `${reference}:preview`);
    invariant(previewResult.exitCode === 0, `${reference} preview failed`);
    const preview = await readJson(join(runDir, "preview.json"));
    const approvalResult = await approve({ id: reference, runDir, config: options.config });
    invariant(approvalBindingPass(preview, approvalResult.approval), `${reference} approval binding failed`);
    await pacer.reserve("topic-delete", reference);
    const result = await execute({ id: reference, runDir, config: options.config });
    state.realDevWrites += 1;
    invariant(result.exitCode === 0, `${reference} execute failed`);
    entry.active = false;
    entry.deleteRunDir = runDir;
    const backend = await topicView(entry.id, `${reference}:verify`);
    const visual = await browserEvidence(browser, {
      reference,
      url: current.visualUrl,
      expectedStatus: 404,
      forbiddenText: [current.title]
    });
    invariant(backend.result.exitCode !== 0 && visual.pass, `${reference} residual evidence failed`);
    cleanupRows.push({ reference, type: "topic", id: entry.id, pass: true });
  }
  return cleanupRows;
}

async function runLive() {
  const files = await createFixtures(join(ROOT, "live-fixtures"));
  const pacer = new WritePacer();
  const browser = await openLiveBrowser();
  const ledger = [];
  const rows = [];
  const cleanupRows = [];
  let error = null;
  try {
    for (const [groupId, operations] of LIVE_GROUPS) {
      const current = {
        title: `M060 R28 ${groupId}`,
        updatedTitle: `M060 R28 ${groupId} updated`,
        topicId: null,
        topicVersion: null,
        replyId: null,
        replyVersion: null,
        visualUrl: null
      };
      for (let index = 0; index < operations.length; index += 1) {
        const row = await runLiveLifecycle({
          groupId,
          operation: operations[index],
          index,
          current,
          files,
          pacer,
          browser,
          ledger
        });
        rows.push(row);
      }
    }
  } catch (caught) {
    error = caught;
  } finally {
    try {
      cleanupRows.push(...await cleanupActiveResources({ ledger, pacer, browser, files }));
    } catch (cleanupError) {
      error ??= cleanupError;
      await appendJsonl(join(EVIDENCE, "cleanup-errors.jsonl"), {
        error: redact(cleanupError.message)
      });
    }
    await closeLiveBrowser(browser);
    await writeJson(join(ROOT, "cleanup.json"), {
      status: ledger.every((entry) => !entry.active) ? "complete" : "incomplete",
      ledger,
      cleanupRows,
      activeTopics: ledger.filter((entry) => entry.type === "topic" && entry.active).map((entry) => entry.id),
      activeReplies: ledger.filter((entry) => entry.type === "reply" && entry.active).map((entry) => entry.id),
      residualWriteTestResources: ledger.filter((entry) => entry.active).length
    });
  }
  if (error) {
    throw error;
  }
  invariant(rows.length === 20, `live first-attempt count ${rows.length}`);
  invariant(ledger.length === 7, `live created resource count ${ledger.length}`);
  invariant(ledger.every((entry) => !entry.active), "live resources remain active");
  return { rows, ledger, cleanupRows };
}

async function browserLoopbackSelfCheck(root) {
  const html = "<!doctype html><html><head><title>M060 synthetic 404</title></head><body>synthetic not found</body></html>";
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/404") {
      requests += 1;
    }
    response.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
      Connection: "close"
    });
    response.end(html);
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  const parent = await mkdtemp(join(root, "browser-parent-"));
  const profile = join(parent, "profile");
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: CHROME });
    const page = context.pages()[0] ?? await context.newPage();
    const response = await page.goto(`http://127.0.0.1:${address.port}/404`, {
      waitUntil: "domcontentloaded",
      timeout: 10_000
    });
    const body = await page.locator("body").innerText();
    const screenshot = await page.screenshot({ type: "png" });
    invariant(response.status() === 404, "browser self-check status");
    invariant((await page.title()) === "M060 synthetic 404", "browser self-check title");
    invariant(body.includes("synthetic not found"), "browser self-check body");
    invariant(screenshot.length > 0, "browser self-check screenshot");
    await page.close();
  } finally {
    await context?.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
    await rm(parent, { recursive: true, force: true });
  }
  invariant(requests === 1, `browser self-check document requests ${requests}`);
  return { pass: true, status: 404, title: "M060 synthetic 404", documentRequests: requests };
}

async function syntheticPacerSelfCheck() {
  const buckets = new Map();
  let now = 0;
  const waits = [];
  const reserve = (bucket) => {
    while (true) {
      const recent = (buckets.get(bucket) ?? []).filter((time) => now - time < 60_000);
      if (recent.length < 9) {
        recent.push(now);
        buckets.set(bucket, recent);
        return;
      }
      const delay = recent[0] + 61_000 - now;
      waits.push(delay);
      now += delay;
    }
  };
  for (let index = 0; index < 9; index += 1) {
    reserve("/api/v1/topics|WRITE");
    if (index < 8) {
      now += 2_000;
    }
  }
  reserve("/api/v1/topics|WRITE");
  invariant(now === 61_000, "pacer tenth write did not wait");
  reserve("/api/v1/topics|WRITE");
  invariant(now === 63_000, "pacer eleventh write did not recheck and wait");
  reserve("/api/v1/replies|WRITE");
  invariant((buckets.get("/api/v1/replies|WRITE") ?? []).length === 1, "pacer reply bucket not independent");
  return { pass: true, waits, topicReservations: 11, replyReservations: 1 };
}

async function reportArtifacts({
  decision,
  baseline,
  dynamic,
  issues,
  cleanup,
  selfCheck,
  error = null
}) {
  await writeJson(join(ROOT, "results-baseline.json"), baseline);
  await writeJson(join(ROOT, "results-dynamic.json"), dynamic);
  const baselineScore = {
    required: 30,
    observed: baseline.length,
    passed: baseline.filter((row) => row.pass).length,
    coveragePercent: baseline.length === 30 ? 100 : Math.floor((baseline.length / 30) * 100),
    passPercent: baseline.length === 30 ? (baseline.filter((row) => row.pass).length / 30) * 100 : 0,
    pass: baseline.length === 30 && baseline.every((row) => row.pass)
  };
  const dynamicScore = {
    required: 6,
    observed: dynamic.length,
    passed: dynamic.filter((row) => row.pass).length,
    passPercent: dynamic.length === 6 ? (dynamic.filter((row) => row.pass).length / 6) * 100 : 0,
    pass: dynamic.length === 6 && dynamic.every((row) => row.pass)
  };
  await writeJson(join(ROOT, "score.json"), { baseline: baselineScore, dynamic: dynamicScore, decision });
  await writeJson(join(ROOT, "issues.json"), issues);
  await writeJson(join(ROOT, "cleanup.json"), cleanup);
  const report = {
    decision,
    assignmentRef: ASSIGNMENT,
    baselineScore,
    dynamicScore,
    productIssueCount: issues.length,
    candidate: {
      version: "0.60.0",
      invocationAttempts: state.candidateInvocationAttempts,
      processes: state.candidateProcesses,
      realDevWrites: state.realDevWrites,
      loopbackWrites: state.loopbackWrites
    },
    residualCounts: {
      topics: cleanup.activeTopics?.length ?? 0,
      replies: cleanup.activeReplies?.length ?? 0,
      total: cleanup.residualWriteTestResources ?? 0
    },
    selfCheck,
    error: error ? redact(error.message ?? error) : null,
    reportDirectory: ROOT
  };
  await writeJson(join(ROOT, "report.json"), report);
  await writeFile(join(ROOT, "report.md"),
    `# ${ASSIGNMENT}\n\nDecision: **${decision}**\n\nBaseline: ${baselineScore.passed}/${baselineScore.required}. Dynamic: ${dynamicScore.passed}/${dynamicScore.required}. Product issues: ${issues.length}. Residual resources: ${report.residualCounts.total}.\n`,
    "utf8");
  const required = [
    "results-baseline.json",
    "results-dynamic.json",
    "score.json",
    "report.json",
    "report.md",
    "issues.json",
    "cleanup.json",
    "evidence/self-check.json",
    "evidence/first-attempt.jsonl"
  ];
  const sums = [];
  for (const relativePath of required) {
    const absolutePath = join(ROOT, relativePath);
    await assertRegularFile(absolutePath, relativePath);
    sums.push(`${sha256(await readFile(absolutePath))}  ${relativePath}`);
  }
  await writeFile(join(ROOT, "SHA256SUMS"), `${sums.join("\n")}\n`, "utf8");
  return report;
}

async function runSyntheticSelfCheck() {
  const syntheticRoot = join(ROOT, "self-check");
  await ensureDir(syntheticRoot);
  const preview = {
    kind: "workflow-preview",
    schemaVersion: 1,
    profile: "synthetic",
    baseUrl: "http://127.0.0.1:1",
    request: {
      method: "POST",
      path: "/api/v1/topics",
      body: { title: "T", content: "C", categoryId: 8, operationKey: "op", payloadHash: "hash" }
    },
    result: null
  };
  const approval = {
    previewHash: previewHash(preview),
    target: { profile: preview.profile, baseUrl: preview.baseUrl },
    request: structuredClone(preview.request)
  };
  invariant(approvalBindingPass(preview, approval), "approval hash self-check failed");
  const reordered = {
    ...preview,
    request: {
      ...preview.request,
      body: { payloadHash: "hash", operationKey: "op", categoryId: 8, content: "C", title: "T" }
    }
  };
  invariant(previewHash(reordered) === approval.previewHash, "approval key-order invariance failed");
  const tampered = structuredClone(approval);
  tampered.request.body.title = "changed";
  invariant(!approvalBindingPass(preview, tampered), "approval tamper self-check failed");
  invariant(sha256(JSON.stringify(preview)) !== approval.previewHash, "whole-preview hash unexpectedly matched");
  invariant(BASELINE_IDS.length === 30 && new Set(BASELINE_IDS).size === 30, "baseline contract cardinality failed");
  invariant(LIVE_GROUPS.flatMap(([, operations]) => operations).length === 20, "live contract cardinality failed");
  invariant(LIVE_GROUPS.filter(([, operations]) => operations.includes("reply-create")).length === 3, "live reply groups failed");
  const pacing = await syntheticPacerSelfCheck();
  const browser = await browserLoopbackSelfCheck(syntheticRoot);
  const selfCheck = {
    pass: true,
    assignment: ASSIGNMENT,
    candidateInvocationAttempts: 0,
    candidateProcesses: 0,
    realDevNetworkRequests: 0,
    approvalHash: true,
    baselineIds: BASELINE_IDS.length,
    liveOperations: 20,
    pacing,
    browser
  };
  await writeJson(join(EVIDENCE, "self-check.json"), selfCheck);
  await appendJsonl(COMMAND_LOG, {
    scenario: "SELF-CHECK",
    candidateInvocationAttempts: 0,
    candidateProcesses: 0,
    realDevNetworkRequests: 0,
    pass: true
  });
  return selfCheck;
}

function unexecutedDynamic(status) {
  return [
    "D001-LIVE-WRITE-WORKFLOWS-20-FIRST-ATTEMPTS",
    "D002-LIVE-DUAL-EVIDENCE-20-OF-20",
    "D003-LIVE-CLEANUP-ZERO-RESIDUAL",
    "D004-ADVERSE-STALE-MISMATCH-DUPLICATE",
    "D005-ADVERSE-401-409-429-TIMEOUT",
    "D006-AGENT-PREVIEW-ZERO-WRITE"
  ].map((id) => ({ id, pass: false, status }));
}

async function main() {
  invariant(pathInside(ROOT, EVIDENCE), "evidence path escaped round root");
  await ensureDir(EVIDENCE);
  const selfCheck = await runSyntheticSelfCheck();
  if (options.mode === "synthetic") {
    const cleanup = {
      status: "not-applicable",
      activeTopics: [],
      activeReplies: [],
      residualWriteTestResources: 0
    };
    const report = await reportArtifacts({
      decision: "SELF_CHECK_ONLY",
      baseline: [],
      dynamic: unexecutedDynamic("SELF_CHECK_ONLY"),
      issues: [],
      cleanup,
      selfCheck
    });
    console.log(JSON.stringify(report));
    return;
  }

  const baseline = await runBaseline();
  const baselinePass = baseline.length === 30 && baseline.every((row) => row.pass);
  if (options.mode === "baseline" || !baselinePass) {
    const cleanup = {
      status: "not-applicable",
      activeTopics: [],
      activeReplies: [],
      residualWriteTestResources: 0
    };
    const report = await reportArtifacts({
      decision: options.mode === "baseline" && baselinePass ? "BASELINE_PASS" : "INFRASTRUCTURE_INVALIDATED",
      baseline,
      dynamic: unexecutedDynamic(options.mode === "baseline" ? "BUILDER_BASELINE_ONLY" : "BASELINE_GATE_FAILED"),
      issues: [],
      cleanup,
      selfCheck
    });
    console.log(JSON.stringify(report));
    if (!baselinePass) {
      process.exitCode = 1;
    }
    return;
  }

  let live;
  try {
    live = await runLive();
  } catch (error) {
    const cleanup = await readJson(join(ROOT, "cleanup.json")).catch(() => ({
      status: "missing",
      activeTopics: [],
      activeReplies: [],
      residualWriteTestResources: -1
    }));
    const report = await reportArtifacts({
      decision: "INFRASTRUCTURE_INVALIDATED",
      baseline,
      dynamic: unexecutedDynamic("LIVE_INFRASTRUCTURE_FAILED"),
      issues: [],
      cleanup,
      selfCheck,
      error
    });
    console.error(JSON.stringify(report));
    process.exitCode = 1;
    return;
  }

  const mcpRow = baseline.find((row) => row.id === "B025-MCP-UPDATE-POST-ZERO-WRITE");
  const mcpDeleteRow = baseline.find((row) => row.id === "B026-MCP-DELETE-CONFIRMATION");
  const adverseIds = [
    "B020-APPROVAL-EXPIRY",
    "B021-APPROVAL-REQUEST-TAMPER",
    "B022-APPROVAL-TARGET-MISMATCH",
    "B023-DUPLICATE-COMPLETION-BLOCK",
    "B024-SECRET-BLOCK-BEFORE-PREVIEW"
  ];
  const recoveryIds = [
    "B027-RECOVERY-401",
    "B028-RECOVERY-409",
    "B029-RECOVERY-429",
    "B030-RECOVERY-TIMEOUT-OR-5XX"
  ];
  const cleanup = await readJson(join(ROOT, "cleanup.json"));
  const dynamic = [
    {
      id: "D001-LIVE-WRITE-WORKFLOWS-20-FIRST-ATTEMPTS",
      pass: live.rows.length === 20 && live.rows.every((row) => row.pass),
      evidenceCount: live.rows.length
    },
    {
      id: "D002-LIVE-DUAL-EVIDENCE-20-OF-20",
      pass: live.rows.length === 20 && live.rows.every((row) => row.backend && row.browser?.pass),
      evidenceCount: live.rows.filter((row) => row.backend && row.browser?.pass).length
    },
    {
      id: "D003-LIVE-CLEANUP-ZERO-RESIDUAL",
      pass: live.ledger.length === 7 && cleanup.residualWriteTestResources === 0,
      createdResources: live.ledger.length,
      residualResources: cleanup.residualWriteTestResources
    },
    {
      id: "D004-ADVERSE-STALE-MISMATCH-DUPLICATE",
      pass: adverseIds.every((id) => baseline.find((row) => row.id === id)?.pass === true),
      baselineIds: adverseIds
    },
    {
      id: "D005-ADVERSE-401-409-429-TIMEOUT",
      pass: recoveryIds.every((id) => baseline.find((row) => row.id === id)?.pass === true),
      baselineIds: recoveryIds
    },
    {
      id: "D006-AGENT-PREVIEW-ZERO-WRITE",
      pass: mcpRow?.pass === true && mcpDeleteRow?.pass === true,
      tools: MCP_PREVIEW_CALLS.map(([name]) => name),
      willExecute: false,
      writeRequests: 0
    }
  ];
  const decision = dynamic.every((row) => row.pass)
    && baselinePass
    && cleanup.residualWriteTestResources === 0
    ? "PASS"
    : "FAIL";
  const report = await reportArtifacts({
    decision,
    baseline,
    dynamic,
    issues: [],
    cleanup,
    selfCheck
  });
  console.log(JSON.stringify(report));
  if (decision !== "PASS") {
    process.exitCode = 1;
  }
}

await main();
