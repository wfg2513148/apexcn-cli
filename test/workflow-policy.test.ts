import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "apexcn-workflow-policy-"));
}

function localProgram() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({
    configPath: "/tmp/apexcn-workflow-policy-missing.json",
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  });
  return { program, stdout, stderr };
}

async function prepareApprovedRun(runDir: string): Promise<void> {
  const configPath = join(await tempDir(), "config.json");
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("/api/v1/search")) {
      return Response.json({ requestId: "search-1", items: [{ id: 42, title: "REST 403" }] });
    }
    if (url.endsWith("/api/v1/topics/42")) {
      return Response.json({ requestId: "topic-42", topic: { id: 42, title: "REST 403" } });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  }));
  const program = createProgram({ configPath, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
  await program.parseAsync(["node", "apexcn", "auth", "set-token", "--token", "abcdefghijklmnopqrstuvwxyz", "--base-url", "https://oracleapex.cn/ords/test", "--profile", "test@oci"]);
  await program.parseAsync(["node", "apexcn", "workflow", "run", "--goal", "ask-question", "--keyword", "REST API", "--title", "APEX REST API returns 403", "--problem", "Page process gets 403.", "--category-id", "4", "--output-dir", runDir, "--json"]);
  const approver = localProgram();
  await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--approved-by", "tester", "--json"]);
}

describe("workflow policy, diff, and audit-log", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("policy init generates JSON with MCP execute disabled", async () => {
    const dir = await tempDir();
    const { program, stdout, stderr } = localProgram();

    await program.parseAsync(["node", "apexcn", "workflow", "policy", "init", "--output", join(dir, "policy.json"), "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ kind: "workflow-policy-init" }));
    expect(JSON.parse(await readFile(join(dir, "policy.json"), "utf8"))).toEqual(expect.objectContaining({ schemaVersion: 1, mcp: { allowExecute: false } }));
  });

  test("policy init supports default output for JSON smoke usage", async () => {
    const dir = await tempDir();
    const { program, stdout } = localProgram();
    const previous = process.cwd();
    process.chdir(dir);
    try {
      await program.parseAsync(["node", "apexcn", "workflow", "policy", "init", "--json"]);
    } finally {
      process.chdir(previous);
    }

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ output: "apexcn-policy.json" }));
    expect(JSON.parse(await readFile(join(dir, "apexcn-policy.json"), "utf8"))).toEqual(expect.objectContaining({ mcp: { allowExecute: false } }));
  });

  test("verify --policy attaches policy result", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    const policyPath = join(dir, "policy.json");
    await prepareApprovedRun(runDir);
    const init = localProgram();
    await init.program.parseAsync(["node", "apexcn", "workflow", "policy", "init", "--output", policyPath, "--json"]);
    const { program, stdout, stderr } = localProgram();

    await program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);

    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "workflow-verification",
      policy: expect.objectContaining({ ok: true, command: "topic.create" })
    }));
  });

  test("policy decisions allow explicit commands and deny blocked or unconfigured commands", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    const policyPath = join(dir, "policy.json");
    await prepareApprovedRun(runDir);
    const init = localProgram();
    await init.program.parseAsync(["node", "apexcn", "workflow", "policy", "init", "--output", policyPath, "--json"]);

    const allowed = localProgram();
    await allowed.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
    expect(JSON.parse(allowed.stdout.join("")).policy).toEqual(expect.objectContaining({ ok: true }));

    const policy = JSON.parse(await readFile(policyPath, "utf8")) as { commands: Record<string, Record<string, unknown>> };
    policy.commands["topic.create"].allowed = false;
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const blocked = localProgram();
    await blocked.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
    expect(JSON.parse(blocked.stdout.join("")).policy.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "policy-command-blocked" })
    ]));
    const requestCount = vi.mocked(fetch).mock.calls.length;
    const blockedExecution = localProgram();
    await blockedExecution.program.parseAsync([
      "node", "apexcn", "workflow", "run", "--resume", runDir,
      "--execute", "--yes", "--policy", policyPath, "--json"
    ]);
    expect(blockedExecution.stderr.join("")).toContain("Workflow policy refused execution");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(requestCount);
    process.exitCode = undefined;

    delete policy.commands["topic.create"];
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const unconfigured = localProgram();
    await unconfigured.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
    expect(JSON.parse(unconfigured.stdout.join("")).policy.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "policy-command-unconfigured" })
    ]));
  });

  test("policy allow, deny, and unconfigured matrix is exact for every content command", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    const policyPath = join(dir, "policy.json");
    await prepareApprovedRun(runDir);
    const init = localProgram();
    await init.program.parseAsync(["node", "apexcn", "workflow", "policy", "init", "--output", policyPath, "--json"]);
    const basePolicy = JSON.parse(await readFile(policyPath, "utf8")) as {
      commands: Record<string, Record<string, unknown>>;
    };
    const runPath = join(runDir, "run.json");
    const baseRun = JSON.parse(await readFile(runPath, "utf8")) as Record<string, unknown>;
    const matrix = [
      ["topic-create", "topic.create"],
      ["topic-update", "topic.update"],
      ["topic-delete", "topic.delete"],
      ["reply-create", "reply.create"],
      ["reply-update", "reply.update"],
      ["reply-delete", "reply.delete"]
    ] as const;

    for (const [goal, commandId] of matrix) {
      await writeFile(runPath, `${JSON.stringify({ ...baseRun, goal }, null, 2)}\n`);
      const allowedPolicy = structuredClone(basePolicy);
      allowedPolicy.commands[commandId].allowed = true;
      allowedPolicy.commands[commandId].minimumApprovers = 1;
      await writeFile(policyPath, `${JSON.stringify(allowedPolicy, null, 2)}\n`);
      const allowed = localProgram();
      await allowed.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
      expect(JSON.parse(allowed.stdout.join("")).policy).toEqual(expect.objectContaining({ ok: true, command: commandId }));
      process.exitCode = undefined;

      allowedPolicy.commands[commandId].allowed = false;
      await writeFile(policyPath, `${JSON.stringify(allowedPolicy, null, 2)}\n`);
      const blocked = localProgram();
      await blocked.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
      expect(JSON.parse(blocked.stdout.join("")).policy.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "policy-command-blocked" })
      ]));
      process.exitCode = undefined;

      delete allowedPolicy.commands[commandId];
      await writeFile(policyPath, `${JSON.stringify(allowedPolicy, null, 2)}\n`);
      const unconfigured = localProgram();
      await unconfigured.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
      expect(JSON.parse(unconfigured.stdout.join("")).policy.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "policy-command-unconfigured" })
      ]));
      process.exitCode = undefined;
    }
  });

  test("policy enforces distinct approval levels and audit retention", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    const policyPath = join(dir, "policy.json");
    await prepareApprovedRun(runDir);
    const init = localProgram();
    await init.program.parseAsync(["node", "apexcn", "workflow", "policy", "init", "--output", policyPath, "--json"]);
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as {
      defaults: { auditRetentionDays: number };
      commands: Record<string, Record<string, unknown>>;
    };
    policy.commands["topic.create"].minimumApprovers = 2;
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

    const oneApprover = localProgram();
    await oneApprover.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
    expect(JSON.parse(oneApprover.stdout.join("")).policy.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "policy-approval-level-not-met" })
    ]));

    const approver = localProgram();
    await approver.program.parseAsync([
      "node", "apexcn", "workflow", "approve", "--run-dir", runDir,
      "--approved-by", "reviewer-one", "--second-approver", "reviewer-two", "--json"
    ]);
    const twoApprovers = localProgram();
    await twoApprovers.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
    expect(JSON.parse(twoApprovers.stdout.join("")).policy).toEqual(expect.objectContaining({ ok: true }));

    const runPath = join(runDir, "run.json");
    const run = JSON.parse(await readFile(runPath, "utf8")) as Record<string, unknown>;
    run.createdAt = "2020-01-01T00:00:00.000Z";
    await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
    policy.defaults.auditRetentionDays = 1;
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const expired = localProgram();
    await expired.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--policy", policyPath, "--json"]);
    expect(JSON.parse(expired.stdout.join("")).policy.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "policy-audit-retention-expired" })
    ]));
  });

  test("diff detects approval hash mismatch", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    await prepareApprovedRun(runDir);
    const approvalPath = join(runDir, "approval.json");
    const approval = JSON.parse(await readFile(approvalPath, "utf8")) as Record<string, unknown>;
    approval.previewHash = "tampered";
    await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
    const { program, stdout } = localProgram();

    await program.parseAsync(["node", "apexcn", "workflow", "diff", "--run-dir", runDir, "--json"]);

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({
      kind: "workflow-diff",
      ok: false,
      hashMatches: false,
      executionAllowed: false,
      changes: expect.any(Array)
    }));
    expect(process.exitCode).toBe(1);
  });

  test("audit-log emits parseable NDJSON without secrets", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    await prepareApprovedRun(runDir);
    const { program, stdout, stderr } = localProgram();

    await program.parseAsync(["node", "apexcn", "workflow", "audit-log", "--run-dir", runDir, "--format", "ndjson"]);

    expect(stderr.join("")).toBe("");
    const lines = stdout.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ schemaVersion: 1, event: "verify" })]));
    expect(lines.every((event) => typeof event.previousHash === "string" && typeof event.eventHash === "string")).toBe(true);
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  test("audit-log verification detects missing and tampered events", async () => {
    const dir = await tempDir();
    const runDir = join(dir, "run");
    const auditPath = join(dir, "audit.ndjson");
    await prepareApprovedRun(runDir);
    const generated = localProgram();
    await generated.program.parseAsync(["node", "apexcn", "workflow", "audit-log", "--run-dir", runDir, "--format", "ndjson"]);
    await writeFile(auditPath, generated.stdout.join(""));

    const verified = localProgram();
    await verified.program.parseAsync(["node", "apexcn", "workflow", "audit-log", "--run-dir", runDir, "--verify-file", auditPath]);
    expect(JSON.parse(verified.stdout.join(""))).toEqual(expect.objectContaining({ ok: true, actualEventCount: 4 }));

    const events = generated.stdout.join("").trim().split("\n").map((line) => JSON.parse(line));
    events[1].reason = "tampered";
    await writeFile(auditPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const tampered = localProgram();
    await tampered.program.parseAsync(["node", "apexcn", "workflow", "audit-log", "--run-dir", runDir, "--verify-file", auditPath]);
    expect(JSON.parse(tampered.stdout.join("")).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "audit-chain-mismatch" })
    ]));

    await writeFile(auditPath, `${events.slice(1).map((event) => JSON.stringify(event)).join("\n")}\n`);
    const incomplete = localProgram();
    await incomplete.program.parseAsync(["node", "apexcn", "workflow", "audit-log", "--run-dir", runDir, "--verify-file", auditPath]);
    expect(JSON.parse(incomplete.stdout.join("")).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "audit-event-count-mismatch" }),
      expect.objectContaining({ code: "audit-event-coverage-mismatch" })
    ]));
  });
});
