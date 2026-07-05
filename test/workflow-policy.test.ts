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

    expect(JSON.parse(stdout.join(""))).toEqual(expect.objectContaining({ kind: "workflow-diff", executionAllowed: false }));
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
    expect(stdout.join("")).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
