import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempPath(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-workflow-"));
  return join(dir, name);
}

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-workflow-"));
  return join(dir, ".apexcn", "config.json");
}

function workflowProgram(options: { configPath?: string } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({
    configPath: options.configPath ?? "/tmp/apexcn-workflow-missing-config.json",
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  });
  return { program, stdout, stderr };
}

async function configuredWorkflowProgram(fetchImpl: typeof fetch) {
  const configPath = await tempConfigPath();
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const env = workflowProgram({ configPath });
  await env.program.parseAsync([
    "node",
    "apexcn",
    "auth",
    "set-token",
    "--token",
    "abcdefghijklmnopqrstuvwxyz",
    "--base-url",
    "https://oracleapex.cn/ords/test",
    "--profile",
    "test@oci"
  ]);
  env.stdout.length = 0;
  env.stderr.length = 0;
  process.exitCode = undefined;
  return { ...env, configPath, fetch: vi.mocked(fetch) };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function createQuestionPreview(runDir: string) {
  const env = await configuredWorkflowProgram(async (input) => {
    const url = String(input);
    if (url.includes("/api/v1/search")) {
      return Response.json({ requestId: "search-1", items: [{ id: 42, title: "REST 403" }] });
    }
    if (url.endsWith("/api/v1/topics/42")) {
      return Response.json({ requestId: "topic-42", topic: { id: 42, title: "REST 403" } });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  });
  await env.program.parseAsync([
    "node",
    "apexcn",
    "workflow",
    "run",
    "--goal",
    "ask-question",
    "--keyword",
    "REST API",
    "--title",
    "APEX REST API returns 403",
    "--problem",
    "Page process gets 403 when calling REST API.",
    "--category-id",
    "4",
    "--output-dir",
    runDir,
    "--json"
  ]);
  return env;
}

async function createCompletedBundle(runDir: string, bundlePath: string): Promise<Record<string, unknown>> {
  await createQuestionPreview(runDir);
  const approver = workflowProgram();
  await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);
  const executor = await configuredWorkflowProgram(async () => Response.json({ requestId: "created-1", id: 1001 }));
  await executor.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);
  const exporter = workflowProgram();
  await exporter.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", bundlePath, "--json"]);
  return readJson(bundlePath);
}

describe("workflow commands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("workflow plan builds an ask-question plan without execute by default", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = workflowProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "plan",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      "work",
      "--json"
    ]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    const plan = JSON.parse(stdout.join(""));
    expect(plan).toEqual(expect.objectContaining({
      kind: "workflow-plan",
      schemaVersion: 1,
      goal: "ask-question",
      files: expect.objectContaining({
        research: "work/research.json",
        question: "work/question.md"
      }),
      checkpoints: {
        missingInputs: [],
        confirmations: []
      },
      safetySummary: {
        localSteps: 2,
        apiReadSteps: 1,
        apiWritePreviewSteps: 1,
        apiWriteExecuteSteps: 0,
        requiresConfirmation: false
      }
    }));
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual([
      "research",
      "draft-question",
      "review-topic",
      "preview-topic-create"
    ]);
    expect(plan.steps.map((step: { command: string }) => step.command).join("\n")).not.toContain("--content ");
  });

  test("workflow plan marks execute steps as requiring confirmation only when requested", async () => {
    const { program, stdout } = workflowProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "plan",
      "--goal",
      "reply",
      "--topic-id",
      "30549",
      "--parent-post-id",
      "201480",
      "--answer",
      "Check the Web Credential first.",
      "--include-execute"
    ]);

    const plan = JSON.parse(stdout.join(""));
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual([
      "topic-view",
      "draft-reply",
      "review-reply",
      "preview-reply-create",
      "approve-reply-create",
      "execute-reply-create"
    ]);
    expect(plan.steps.at(-1)).toEqual(expect.objectContaining({
      mode: "api-write-execute",
      requiresConfirmation: true
    }));
    expect(plan.steps.find((step: { id: string }) => step.id === "draft-reply").command).toContain("--parent-post-id 201480");
    expect(plan.steps.find((step: { id: string }) => step.id === "review-reply").command).toContain("--parent-post-id 201480");
    expect(plan.steps.find((step: { id: string }) => step.id === "preview-reply-create").command).toContain("--parent-post-id 201480");
    expect(plan.checkpoints.confirmations).toEqual(["approve-reply-create", "execute-reply-create"]);
    expect(plan.safetySummary.requiresConfirmation).toBe(true);
  });

  test("workflow plan covers audited CRUD goals without enabling MCP execution", async () => {
    const { program, stdout, stderr } = workflowProgram();

    await program.parseAsync([
      "node", "apexcn", "workflow", "plan",
      "--goal", "topic-delete",
      "--topic-id", "42",
      "--if-version", "3",
      "--confirm-title", "Exact title",
      "--output-dir", "delete-run",
      "--include-execute",
      "--json"
    ]);

    expect(stderr.join("")).toBe("");
    const plan = JSON.parse(stdout.join(""));
    expect(plan.checkpoints.missingInputs).toEqual([]);
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual([
      "preview-topic-delete",
      "approve-topic-delete",
      "execute-topic-delete"
    ]);
    expect(plan.steps[0].command).toContain("apexcn workflow run --goal topic-delete");
    expect(plan.steps[0].command).toContain("--confirm-title \"Exact title\"");
    expect(plan.steps[1].command).toBe("apexcn workflow approve --run-dir delete-run --json");
    expect(plan.steps[2].command).toBe("apexcn workflow run --resume delete-run --execute --yes --json");
    expect(plan.safetySummary).toEqual(expect.objectContaining({
      apiWritePreviewSteps: 1,
      apiWriteExecuteSteps: 1,
      requiresConfirmation: true
    }));
  });

  test("workflow plan records missing inputs without failing", async () => {
    const { program, stdout, stderr } = workflowProgram();

    await program.parseAsync(["node", "apexcn", "workflow", "plan", "--goal", "publish-topic"]);

    const plan = JSON.parse(stdout.join(""));
    expect(stderr.join("")).toBe("");
    expect(process.exitCode).toBeUndefined();
    expect(plan.checkpoints.missingInputs).toEqual(["--category-id", "--title", "--content-file"]);
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual(["review-topic", "preview-topic-create"]);
  });

  test("workflow plan supports research-only text output", async () => {
    const { program, stdout, stderr } = workflowProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "plan",
      "--goal",
      "research-only",
      "--keyword",
      "ORDS",
      "--format",
      "text"
    ]);

    expect(stderr.join("")).toBe("");
    const text = stdout.join("");
    expect(text).toContain("Workflow: research-only");
    expect(text).toContain("Missing inputs: none");
    expect(text).toContain("apexcn research ORDS --limit 3 --json > ./research.json");
  });

  test("workflow plan uses content-file paths for publish-topic and never inlines content", async () => {
    const { program, stdout } = workflowProgram();

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "plan",
      "--goal",
      "publish-topic",
      "--title",
      "Safe title",
      "--category-id",
      "4",
      "--content-file",
      "question.md",
      "--include-execute"
    ]);

    const plan = JSON.parse(stdout.join(""));
    const commands = plan.steps.map((step: { command: string }) => step.command).join("\n");
    expect(commands).toContain("--content-file question.md");
    expect(commands).not.toContain("--content ");
    expect(plan.steps.at(-1)).toEqual(expect.objectContaining({ id: "execute-topic-create", requiresConfirmation: true }));
  });

  test("workflow plan works with a broken config file because it is local only", async () => {
    const configPath = await tempPath("config.json");
    await writeFile(configPath, "{broken");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { program, stdout, stderr } = workflowProgram({ configPath });

    await program.parseAsync(["node", "apexcn", "workflow", "plan", "--goal", "reply", "--topic-id", "42"]);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join("")).kind).toBe("workflow-plan");
  });

  test("workflow plan reports ask-question and reply missing inputs consistently", async () => {
    const ask = workflowProgram();
    await ask.program.parseAsync(["node", "apexcn", "workflow", "plan", "--goal", "ask-question"]);
    expect(JSON.parse(ask.stdout.join("")).checkpoints.missingInputs).toEqual(["--keyword", "--category-id", "--title", "--problem"]);

    const reply = workflowProgram();
    await reply.program.parseAsync(["node", "apexcn", "workflow", "plan", "--goal", "reply"]);
    expect(JSON.parse(reply.stdout.join("")).checkpoints.missingInputs).toEqual(["--topic-id", "--answer"]);
  });

  test("workflow run ask-question creates stateful preview artifacts without posting", async () => {
    const runDir = await tempPath("run");
    const { program, stdout, stderr, fetch } = await configuredWorkflowProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search-1", items: [{ id: 42, title: "REST 403", url: "https://example.test/t/42" }] });
      }
      if (url.endsWith("/api/v1/topics/42")) {
        return Response.json({ requestId: "topic-42", topic: { id: 42, title: "REST 403", url: "https://example.test/t/42" } });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      runDir,
      "--json"
    ]);

    expect(stderr.join("")).toBe("");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? "GET")).toEqual(["GET", "GET"]);
    const state = JSON.parse(stdout.join(""));
    expect(state).toEqual(expect.objectContaining({
      kind: "workflow-run",
      schemaVersion: 1,
      goal: "ask-question",
      status: "preview-ready",
      inputs: expect.objectContaining({ keyword: "REST API", categoryId: 4 })
    }));
    expect((await readJson(join(runDir, "research.json"))).kind).toBe("workflow-research");
    expect((await readJson(join(runDir, "review.json"))).kind).toBe("workflow-review");
    expect(await readFile(join(runDir, "question.md"), "utf8")).toContain("# APEX REST API returns 403");
    expect(await readJson(join(runDir, "preview.json"))).toEqual(expect.objectContaining({
      kind: "workflow-preview",
      request: expect.objectContaining({ method: "POST", path: "/api/v1/topics" }),
      result: null
    }));
  });

  test("workflow run reply creates a local preview without posting", async () => {
    const runDir = await tempPath("reply-run");
    const { program, fetch } = await configuredWorkflowProgram(async () =>
      Response.json({ requestId: "topic-30549", topic: { id: 30549, title: "Wallet setup", url: "https://example.test/t/30549" } })
    );

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "reply",
      "--topic-id",
      "30549",
      "--parent-post-id",
      "201480",
      "--answer",
      "Check the Web Credential first.",
      "--output-dir",
      runDir,
      "--json"
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0][1] as RequestInit | undefined)?.method).toBeUndefined();
    expect(await readJson(join(runDir, "topic.json"))).toEqual(expect.objectContaining({ kind: "workflow-topic" }));
    expect(await readJson(join(runDir, "run.json"))).toEqual(expect.objectContaining({
      inputs: expect.objectContaining({ parentPostId: 201480 })
    }));
    expect(await readJson(join(runDir, "preview.json"))).toEqual(expect.objectContaining({
      kind: "workflow-preview",
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics/30549/replies",
        body: expect.objectContaining({ parentPostId: 201480 })
      })
    }));
  });

  test("workflow run ask-question empty research does not emit placeholder content", async () => {
    const runDir = await tempPath("empty-research");
    const { program } = await configuredWorkflowProgram(async () =>
      Response.json({ requestId: "search-empty", items: [] })
    );

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "NO_MATCH",
      "--title",
      "No matching REST result",
      "--problem",
      "Search did not find a matching thread.",
      "--category-id",
      "4",
      "--output-dir",
      runDir
    ]);

    const question = await readFile(join(runDir, "question.md"), "utf8");
    expect(question).toContain("本次搜索没有返回可引用链接。");
    expect(question).not.toContain("待补充");
  });

  test("workflow run execute requires a reviewed resume and explicit yes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const direct = workflowProgram({ configPath: await tempConfigPath() });
    await direct.program.parseAsync(["node", "apexcn", "workflow", "run", "--goal", "reply", "--topic-id", "1", "--answer", "ok", "--execute", "--yes"]);
    expect(direct.stderr.join("")).toContain("Use --resume <run-dir> --execute --yes");
    expect(fetch).not.toHaveBeenCalled();

    process.exitCode = undefined;
    const runDir = await tempPath("resume-run");
    await mkdir(dirname(join(runDir, "run.json")), { recursive: true });
    await writeFile(join(runDir, "run.json"), JSON.stringify({
      kind: "workflow-run",
      schemaVersion: 1,
      runId: "run-test",
      goal: "reply",
      inputs: { topicId: 1, answer: "ok" },
      status: "preview-ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      artifacts: {
        state: join(runDir, "run.json"),
        topic: join(runDir, "topic.json"),
        reply: join(runDir, "reply.md"),
        preview: join(runDir, "preview.json"),
        execute: join(runDir, "execute.json")
      },
      nextAction: "review"
    }), "utf8");

    const unsafe = workflowProgram({ configPath: await tempConfigPath() });
    await unsafe.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute"]);
    expect(unsafe.stderr.join("")).toContain("Refusing to execute workflow without --yes");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("workflow run resume skips completed reads and posts only the final request", async () => {
    const runDir = await tempPath("resume-execute");
    const first = await configuredWorkflowProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search-1", items: [{ id: 42, title: "REST 403" }] });
      }
      if (url.endsWith("/api/v1/topics/42")) {
        return Response.json({ requestId: "topic-42", topic: { id: 42, title: "REST 403" } });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    await first.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      runDir,
      "--json"
    ]);
    expect(first.fetch).toHaveBeenCalledTimes(2);
    expect((await readJson(join(runDir, "run.json"))).nextAction).toContain("workflow approve");
    await writeFile(join(runDir, "question.md"), "MUTATED AFTER PREVIEW", "utf8");

    const blockedFetch = vi.fn();
    vi.stubGlobal("fetch", blockedFetch);
    const blocked = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await blocked.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);
    expect(blocked.stderr.join("")).toContain("Workflow approval not found");
    expect(blockedFetch).not.toHaveBeenCalled();
    process.exitCode = undefined;

    const approveFetch = vi.fn();
    vi.stubGlobal("fetch", approveFetch);
    const approvalCommand = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await approvalCommand.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--approved-by", "reviewer", "--note", "looks good", "--json"]);
    expect(approveFetch).not.toHaveBeenCalled();
    const approval = JSON.parse(approvalCommand.stdout.join(""));
    expect(approval).toEqual(expect.objectContaining({
      kind: "workflow-approval",
      schemaVersion: 1,
      approvedBy: "reviewer",
      note: "looks good",
      request: expect.objectContaining({ method: "POST", path: "/api/v1/topics" })
    }));
    expect(approval.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await readJson(join(runDir, "run.json"))).nextAction).toContain("--execute --yes");

    const second = await configuredWorkflowProgram(async (input, init) => {
      expect(String(input)).toBe("https://oracleapex.cn/ords/test/api/v1/topics");
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("Page process gets 403");
      expect(String(init?.body)).not.toContain("MUTATED AFTER PREVIEW");
      return Response.json({ requestId: "created-1", id: 1001 });
    });
    await second.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);

    expect(second.fetch).toHaveBeenCalledTimes(1);
    const execute = await readJson(join(runDir, "execute.json"));
    expect(execute).toEqual(expect.objectContaining({
      kind: "workflow-execute",
      requestId: "created-1",
      request: expect.objectContaining({ method: "POST", path: "/api/v1/topics" })
    }));
    expect((await readJson(join(runDir, "run.json"))).status).toBe("completed");
  });

  test("workflow approval hash mismatch blocks execution before config or network", async () => {
    const runDir = await tempPath("approval-mismatch");
    const env = await configuredWorkflowProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search-1", items: [] });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    await env.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      runDir
    ]);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);

    const preview = await readJson(join(runDir, "preview.json"));
    if (typeof preview.request === "object" && preview.request !== null && "body" in preview.request) {
      (preview.request as { body: { title?: string } }).body.title = "Changed after approval";
    }
    await writeFile(join(runDir, "preview.json"), `${JSON.stringify(preview, null, 2)}\n`, "utf8");

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const execute = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await execute.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);

    expect(execute.stderr.join("")).toContain("hash mismatch");
    expect(fetch).not.toHaveBeenCalled();
    expect((await readJson(join(runDir, "run.json"))).nextAction).toContain("workflow approve");
  });

  test("workflow resume binds copied runs to artifacts inside the requested directory", async () => {
    const runDir = await tempPath("artifact-binding-original");
    const contentFile = join(dirname(runDir), "reply.md");
    await writeFile(contentFile, "Original approved reply", "utf8");
    const preview = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await preview.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "reply-create",
      "--topic-id", "42",
      "--content-file", contentFile,
      "--output-dir", runDir,
      "--json"
    ]);
    expect(preview.fetch).not.toHaveBeenCalled();

    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);

    const copiedRunDir = join(dirname(runDir), "artifact-binding-copy");
    await cp(runDir, copiedRunDir, { recursive: true });
    const copiedPreviewPath = join(copiedRunDir, "preview.json");
    const copiedPreview = await readJson(copiedPreviewPath);
    ((copiedPreview.request as { body: { content: string } }).body).content = "Tampered copied reply";
    await writeFile(copiedPreviewPath, `${JSON.stringify(copiedPreview, null, 2)}\n`, "utf8");

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const execute = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await execute.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", copiedRunDir, "--execute", "--yes"]);

    expect(execute.stderr.join("")).toContain("hash mismatch");
    expect(fetch).not.toHaveBeenCalled();
    expect((await readJson(join(runDir, "run.json"))).status).toBe("preview-ready");
    expect((await readJson(join(copiedRunDir, "run.json"))).status).toBe("preview-ready");
  });

  test("workflow verify reports local evidence and writes report after approval", async () => {
    const runDir = await tempPath("verify-preview");
    await createQuestionPreview(runDir);

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const previewVerify = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await previewVerify.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--json"]);
    expect(fetch).not.toHaveBeenCalled();
    const previewReport = JSON.parse(previewVerify.stdout.join(""));
    expect(previewReport).toEqual(expect.objectContaining({
      kind: "workflow-verification",
      schemaVersion: 1,
      status: "preview-ready",
      ok: true,
      previewHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(previewReport.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "approval-missing" })]));
    await expect(readFile(join(runDir, "verification.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);
    const approvedVerify = workflowProgram();
    await approvedVerify.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--write-report", "--json"]);
    const approvedReport = JSON.parse(approvedVerify.stdout.join(""));
    expect(approvedReport.ok).toBe(true);
    expect(approvedReport.reportPath).toBe(join(runDir, "verification.json"));
    expect(approvedReport.artifacts.preview.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(approvedReport.artifacts.verification).toBeUndefined();
    expect((await readJson(join(runDir, "verification.json"))).kind).toBe("workflow-verification");
  });

  test("workflow verify missing run is a local validation error", async () => {
    const runDir = await tempPath("missing-verify");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const verifier = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });

    await verifier.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--write-report", "--json"]);

    expect(verifier.stderr.join("")).toContain("Workflow run not found or invalid");
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(runDir, "verification.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("workflow verify validates completed execute evidence and detects tampering", async () => {
    const runDir = await tempPath("verify-completed");
    await createQuestionPreview(runDir);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);
    const executor = await configuredWorkflowProgram(async () => Response.json({ requestId: "created-1", id: 1001 }));
    await executor.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);

    const completed = workflowProgram();
    await completed.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--json"]);
    const completedReport = JSON.parse(completed.stdout.join(""));
    expect(completedReport).toEqual(expect.objectContaining({
      status: "completed",
      ok: true,
      execute: expect.objectContaining({ requestId: "created-1" })
    }));

    const execute = await readJson(join(runDir, "execute.json"));
    if (typeof execute.request === "object" && execute.request !== null && "body" in execute.request) {
      (execute.request as { body: { title?: string } }).body.title = "Tampered execute";
    }
    await writeFile(join(runDir, "execute.json"), `${JSON.stringify(execute, null, 2)}\n`, "utf8");
    const tamperedExecute = workflowProgram();
    await tamperedExecute.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--json"]);
    const tamperedExecuteReport = JSON.parse(tamperedExecute.stdout.join(""));
    expect(tamperedExecuteReport.ok).toBe(false);
    expect(tamperedExecuteReport.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "execute-request-mismatch" })]));
    process.exitCode = undefined;

    const approval = await readJson(join(runDir, "approval.json"));
    approval.previewHash = "0".repeat(64);
    await writeFile(join(runDir, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`, "utf8");
    const tamperedApproval = workflowProgram();
    await tamperedApproval.program.parseAsync(["node", "apexcn", "workflow", "verify", "--run-dir", runDir, "--json"]);
    const tamperedApprovalReport = JSON.parse(tamperedApproval.stdout.join(""));
    expect(tamperedApprovalReport.ok).toBe(false);
    expect(tamperedApprovalReport.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "approval-hash-mismatch" }),
      expect.objectContaining({ code: "approval-request-mismatch" })
    ]));
  });

  test("workflow export writes a portable bundle for a valid completed run", async () => {
    const runDir = await tempPath("export-valid");
    await createQuestionPreview(runDir);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);
    const executor = await configuredWorkflowProgram(async () => Response.json({ requestId: "created-1", id: 1001 }));
    await executor.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);

    const output = join(runDir, "nested", "bundle.json");
    const exporter = workflowProgram();
    await exporter.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", output, "--json"]);

    const summary = JSON.parse(exporter.stdout.join(""));
    expect(summary).toEqual(expect.objectContaining({
      kind: "workflow-export",
      outputPath: output,
      ok: true
    }));
    const bundle = await readJson(output);
    expect(bundle).toEqual(expect.objectContaining({
      kind: "workflow-bundle",
      schemaVersion: 1,
      runId: summary.runId,
      verification: expect.objectContaining({ ok: true })
    }));
    const artifacts = bundle.artifacts as Array<Record<string, unknown>>;
    const execute = artifacts.find((artifact) => artifact.key === "execute");
    expect(execute).toEqual(expect.objectContaining({
      exists: true,
      encoding: "utf8",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(execute?.sha256).toBe(createHash("sha256").update(String(execute?.content), "utf8").digest("hex"));
    expect(artifacts.some((artifact) => artifact.key === "verification")).toBe(false);
  });

  test("workflow export can print the bundle to stdout only", async () => {
    const runDir = await tempPath("export-stdout");
    await createQuestionPreview(runDir);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);

    const exporter = workflowProgram();
    await exporter.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", "-", "--json"]);

    const bundle = JSON.parse(exporter.stdout.join(""));
    expect(bundle.kind).toBe("workflow-bundle");
    expect(bundle.verification.ok).toBe(true);
    await expect(readFile(join(runDir, "-"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("workflow export refuses invalid runs unless explicitly allowed", async () => {
    const runDir = await tempPath("export-invalid");
    await createQuestionPreview(runDir);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--json"]);
    const approval = await readJson(join(runDir, "approval.json"));
    approval.previewHash = "0".repeat(64);
    await writeFile(join(runDir, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`, "utf8");

    const output = join(runDir, "bundle.json");
    const refused = workflowProgram();
    await refused.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", output, "--json"]);
    expect(refused.stderr.join("")).toContain("Workflow verification failed");
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    process.exitCode = undefined;
    const allowed = workflowProgram();
    await allowed.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", output, "--allow-invalid", "--json"]);
    const bundle = await readJson(output);
    expect(bundle.verification).toEqual(expect.objectContaining({ ok: false }));
    expect((bundle.verification as { issues: Array<Record<string, unknown>> }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "approval-hash-mismatch" })
    ]));
  });

  test("workflow export missing run is local validation and writes no output", async () => {
    const runDir = await tempPath("export-missing");
    const output = join(runDir, "out", "bundle.json");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const exporter = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });

    await exporter.program.parseAsync(["node", "apexcn", "workflow", "export", "--run-dir", runDir, "--output", output, "--json"]);

    expect(exporter.stderr.join("")).toContain("Workflow run not found or invalid");
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("workflow verify-bundle accepts a valid exported bundle", async () => {
    const runDir = await tempPath("bundle-valid");
    const bundlePath = join(runDir, "bundle.json");
    await createCompletedBundle(runDir, bundlePath);

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const verifier = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await verifier.program.parseAsync(["node", "apexcn", "workflow", "verify-bundle", "--bundle", bundlePath, "--json"]);

    expect(fetch).not.toHaveBeenCalled();
    const report = JSON.parse(verifier.stdout.join(""));
    expect(report).toEqual(expect.objectContaining({
      kind: "workflow-bundle-verification",
      schemaVersion: 1,
      ok: true,
      status: "completed"
    }));
    expect(report.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "execute" })]));
  });

  test("workflow verify-bundle detects artifact metadata tampering", async () => {
    const runDir = await tempPath("bundle-metadata");
    const bundlePath = join(runDir, "bundle.json");
    const bundle = await createCompletedBundle(runDir, bundlePath);
    const artifacts = bundle.artifacts as Array<Record<string, unknown>>;
    const preview = artifacts.find((artifact) => artifact.key === "preview");
    if (!preview) {
      throw new Error("preview artifact missing");
    }
    preview.content = `${String(preview.content)}\n`;
    preview.size = 1;
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

    const verifier = workflowProgram();
    await verifier.program.parseAsync(["node", "apexcn", "workflow", "verify-bundle", "--bundle", bundlePath, "--json"]);

    const report = JSON.parse(verifier.stdout.join(""));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "bundle-artifact-hash-mismatch" }),
      expect.objectContaining({ code: "bundle-artifact-size-mismatch" })
    ]));
  });

  test("workflow verify-bundle detects internally consistent approval and execute tampering", async () => {
    const runDir = await tempPath("bundle-chain");
    const bundlePath = join(runDir, "bundle.json");
    const bundle = await createCompletedBundle(runDir, bundlePath);
    const artifacts = bundle.artifacts as Array<Record<string, unknown>>;
    const verificationArtifacts = ((bundle.verification as Record<string, unknown>).artifacts ?? {}) as Record<string, Record<string, unknown>>;
    const preview = artifacts.find((artifact) => artifact.key === "preview");
    if (!preview || typeof preview.content !== "string") {
      throw new Error("preview artifact missing");
    }
    const previewContent = JSON.parse(preview.content) as { request: { body: { title: string } } };
    previewContent.request.body.title = "Tampered preview";
    preview.content = `${JSON.stringify(previewContent, null, 2)}\n`;
    preview.size = Buffer.byteLength(preview.content, "utf8");
    preview.sha256 = createHash("sha256").update(preview.content, "utf8").digest("hex");
    verificationArtifacts.preview.size = preview.size;
    verificationArtifacts.preview.sha256 = preview.sha256;
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

    const previewVerifier = workflowProgram();
    await previewVerifier.program.parseAsync(["node", "apexcn", "workflow", "verify-bundle", "--bundle", bundlePath, "--json"]);
    const previewReport = JSON.parse(previewVerifier.stdout.join(""));
    expect(previewReport.ok).toBe(false);
    expect(previewReport.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "approval-hash-mismatch" })]));
    process.exitCode = undefined;

    const freshBundle = await createCompletedBundle(await tempPath("bundle-chain-execute"), bundlePath);
    const freshArtifacts = freshBundle.artifacts as Array<Record<string, unknown>>;
    const freshVerificationArtifacts = ((freshBundle.verification as Record<string, unknown>).artifacts ?? {}) as Record<string, Record<string, unknown>>;
    const execute = freshArtifacts.find((artifact) => artifact.key === "execute");
    if (!execute || typeof execute.content !== "string") {
      throw new Error("execute artifact missing");
    }
    const executeContent = JSON.parse(execute.content) as { request: { body: { title: string } } };
    executeContent.request.body.title = "Tampered execute";
    execute.content = `${JSON.stringify(executeContent, null, 2)}\n`;
    execute.size = Buffer.byteLength(execute.content, "utf8");
    execute.sha256 = createHash("sha256").update(execute.content, "utf8").digest("hex");
    freshVerificationArtifacts.execute.size = execute.size;
    freshVerificationArtifacts.execute.sha256 = execute.sha256;
    await writeFile(bundlePath, `${JSON.stringify(freshBundle, null, 2)}\n`, "utf8");

    const executeVerifier = workflowProgram();
    await executeVerifier.program.parseAsync(["node", "apexcn", "workflow", "verify-bundle", "--bundle", bundlePath, "--json"]);
    const executeReport = JSON.parse(executeVerifier.stdout.join(""));
    expect(executeReport.ok).toBe(false);
    expect(executeReport.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "execute-request-mismatch" })]));
  });

  test("workflow verify-bundle requires artifacts recorded by embedded verification", async () => {
    const runDir = await tempPath("bundle-missing-artifact");
    const bundlePath = join(runDir, "bundle.json");
    const bundle = await createCompletedBundle(runDir, bundlePath);
    bundle.artifacts = (bundle.artifacts as Array<Record<string, unknown>>).filter((artifact) => artifact.key !== "question");
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

    const verifier = workflowProgram();
    await verifier.program.parseAsync(["node", "apexcn", "workflow", "verify-bundle", "--bundle", bundlePath, "--json"]);

    const report = JSON.parse(verifier.stdout.join(""));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-bundle-artifact" })]));
  });

  test("workflow verify-bundle missing bundle is local validation", async () => {
    const bundlePath = join(await tempPath("missing-bundle"), "bundle.json");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const verifier = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });

    await verifier.program.parseAsync(["node", "apexcn", "workflow", "verify-bundle", "--bundle", bundlePath, "--json"]);

    expect(verifier.stderr.join("")).toContain("Invalid workflow bundle");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("workflow approval runId mismatch blocks execution", async () => {
    const runDir = await tempPath("approval-runid");
    const env = await configuredWorkflowProgram(async () =>
      Response.json({ requestId: "search-1", items: [] })
    );
    await env.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      runDir
    ]);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir]);
    const approval = await readJson(join(runDir, "approval.json"));
    approval.runId = "other-run";
    await writeFile(join(runDir, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`, "utf8");

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const execute = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await execute.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);

    expect(execute.stderr.join("")).toContain("runId");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("workflow approve rejects non-preview-ready and missing preview runs locally", async () => {
    const runDir = await tempPath("approval-invalid");
    await mkdir(runDir, { recursive: true });
    const state = {
      kind: "workflow-run",
      schemaVersion: 1,
      runId: "run-invalid",
      goal: "reply",
      inputs: { topicId: 1, answer: "ok" },
      status: "failed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      artifacts: {
        state: join(runDir, "run.json"),
        topic: join(runDir, "topic.json"),
        reply: join(runDir, "reply.md"),
        preview: join(runDir, "preview.json"),
        approval: join(runDir, "approval.json"),
        execute: join(runDir, "execute.json")
      },
      nextAction: "failed"
    };
    await writeFile(join(runDir, "run.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const failed = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await failed.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir]);
    expect(failed.stderr.join("")).toContain("preview-ready");
    expect(fetch).not.toHaveBeenCalled();

    process.exitCode = undefined;
    state.status = "preview-ready";
    await writeFile(join(runDir, "run.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    const missingPreview = workflowProgram({ configPath: "/tmp/apexcn-workflow-missing-config.json" });
    await missingPreview.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir]);
    expect(missingPreview.stderr.join("")).toContain("Invalid workflow preview artifact");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("workflow run resume reruns a completed step when its artifact is missing", async () => {
    const runDir = await tempPath("rerun-missing");
    const env = await configuredWorkflowProgram(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/search")) {
        return Response.json({ requestId: "search", items: [{ id: 42, title: "REST 403" }] });
      }
      if (url.endsWith("/api/v1/topics/42")) {
        return Response.json({ requestId: "topic", topic: { id: 42, title: "REST 403" } });
      }
      return Response.json({ error: "unexpected" }, { status: 500 });
    });

    await env.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      runDir
    ]);
    await rm(join(runDir, "research.json"));
    const resumed = workflowProgram({ configPath: env.configPath });
    await resumed.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir]);

    expect(env.fetch).toHaveBeenCalledTimes(4);
    expect((await readJson(join(runDir, "research.json"))).kind).toBe("workflow-research");
  });

  test("workflow topic update binds preview, approval, and execute to the replay-safe server contract", async () => {
    const runDir = await tempPath("topic-update-contract");
    const contentFile = join(dirname(runDir), "updated-topic.md");
    await writeFile(contentFile, "Updated topic body with auditable workflow evidence.", "utf8");
    const env = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));

    await env.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "topic-update",
      "--topic-id",
      "42",
      "--content-file",
      contentFile,
      "--tags",
      "APEX,REST",
      "--if-version",
      "3",
      "--output-dir",
      runDir,
      "--json"
    ]);

    expect(env.fetch).not.toHaveBeenCalled();
    const preview = await readJson(join(runDir, "preview.json"));
    expect(preview).toEqual(expect.objectContaining({
      kind: "workflow-preview",
      profile: "test@oci",
      baseUrl: "https://oracleapex.cn/ords/test",
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics/42",
        body: expect.objectContaining({
          content: "Updated topic body with auditable workflow evidence.",
          tags: "APEX,REST",
          ifVersion: 3,
          operationKey: expect.stringMatching(/^[A-Za-z0-9._:-]{16,128}$/),
          payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      })
    }));
    const previewBody = (preview.request as { body: Record<string, unknown> }).body;
    expect(previewBody.payloadHash).toBe(createHash("sha256")
      .update(JSON.stringify({ content: "Updated topic body with auditable workflow evidence.", tags: "APEX,REST" }), "utf8")
      .digest("hex"));

    const approver = workflowProgram();
    await approver.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "approve",
      "--run-dir",
      runDir,
      "--approved-by",
      "reviewer",
      "--expires-in-minutes",
      "30",
      "--json"
    ]);
    const approval = await readJson(join(runDir, "approval.json"));
    expect(approval).toEqual(expect.objectContaining({
      previewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: expect.any(String),
      target: {
        profile: "test@oci",
        baseUrl: "https://oracleapex.cn/ords/test"
      }
    }));

    const executeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.operationKey).toBe(previewBody.operationKey);
      expect(body.payloadHash).toBe(previewBody.payloadHash);
      expect(body.ifVersion).toBe(3);
      expect(body.tags).toBe("APEX,REST");
      return Response.json({ ok: true, requestId: "req_update", id: 42, version: 4, changed: true });
    });
    vi.stubGlobal("fetch", executeFetch);
    const executor = workflowProgram({ configPath: env.configPath });
    await executor.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);

    expect(executeFetch).toHaveBeenCalledTimes(1);
    const execute = await readJson(join(runDir, "execute.json"));
    expect(execute).toEqual(expect.objectContaining({
      kind: "workflow-execute",
      requestHash: approval.previewHash,
      request: preview.request
    }));
    expect((await readJson(join(runDir, "run.json"))).status).toBe("completed");
  });

  test("workflow topic update supports title-only changes without reading a content file", async () => {
    const runDir = await tempPath("topic-title-update");
    const env = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));

    await env.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "topic-update",
      "--topic-id", "42",
      "--title", "Updated title only",
      "--if-version", "3",
      "--output-dir", runDir
    ]);

    expect(env.fetch).not.toHaveBeenCalled();
    expect(await readJson(join(runDir, "preview.json"))).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics/42",
        body: expect.objectContaining({
          title: "Updated title only",
          ifVersion: 3
        })
      })
    }));
    const state = await readJson(join(runDir, "run.json"));
    expect(state.status).toBe("preview-ready");
    expect(state.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "capture-content", status: "skipped" }),
      expect.objectContaining({ id: "review-content", status: "skipped" })
    ]));
  });

  test("workflow topic update supports tags-only changes without a content artifact", async () => {
    const runDir = await tempPath("topic-tags-update");
    const env = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));

    await env.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "topic-update",
      "--topic-id", "42",
      "--tags", "APEX,ORDS",
      "--if-version", "3",
      "--output-dir", runDir
    ]);

    expect(await readJson(join(runDir, "preview.json"))).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        body: expect.objectContaining({ tags: "APEX,ORDS", ifVersion: 3 })
      })
    }));
    const state = await readJson(join(runDir, "run.json"));
    expect(state.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "capture-content", status: "skipped" }),
      expect.objectContaining({ id: "review-content", status: "skipped" })
    ]));
  });

  test("workflow supports generic topic and reply creation from reviewed content files", async () => {
    const topicDir = await tempPath("topic-create");
    const topicFile = join(dirname(topicDir), "topic-create.md");
    await writeFile(topicFile, "A reviewed topic body for the isolated write workflow.", "utf8");
    const topic = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await topic.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "topic-create",
      "--category-id", "8",
      "--title", "Auditable topic",
      "--tags", "APEX,ORDS",
      "--content-file", topicFile,
      "--output-dir", topicDir
    ]);
    expect(topic.fetch).not.toHaveBeenCalled();
    expect(await readJson(join(topicDir, "preview.json"))).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics",
        body: expect.objectContaining({
          categoryId: 8,
          title: "Auditable topic",
          tags: "APEX,ORDS",
          content: "A reviewed topic body for the isolated write workflow.",
          operationKey: expect.any(String),
          payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      })
    }));

    vi.unstubAllGlobals();
    const replyDir = await tempPath("reply-create");
    const replyFile = join(dirname(replyDir), "reply-create.md");
    await writeFile(replyFile, "A reviewed reply body for the isolated write workflow.", "utf8");
    const reply = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await reply.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "reply-create",
      "--topic-id", "42",
      "--parent-post-id", "100",
      "--content-file", replyFile,
      "--output-dir", replyDir
    ]);
    expect(reply.fetch).not.toHaveBeenCalled();
    expect(await readJson(join(replyDir, "preview.json"))).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        method: "POST",
        path: "/api/v1/topics/42/replies",
        body: expect.objectContaining({
          content: "A reviewed reply body for the isolated write workflow.",
          parentPostId: 100,
          operationKey: expect.any(String),
          payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      })
    }));
  });

  test("workflow review blocks topic and reply secrets before any write preview", async () => {
    const cases = [
      {
        goal: "ask-question",
        args: [
          "--keyword", "REST API",
          "--title", "Safe title",
          "--problem", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
          "--category-id", "4"
        ],
        fetchImpl: async () => Response.json({ requestId: "search", items: [] })
      },
      {
        goal: "reply",
        args: [
          "--topic-id", "42",
          "--answer", "Use token=abcdefghijklmnopqrstuvwxyz for this request"
        ],
        fetchImpl: async () => Response.json({ requestId: "topic", topic: { id: 42, title: "Safe topic" } })
      }
    ];

    for (const item of cases) {
      const runDir = await tempPath(`secret-${item.goal}`);
      const env = await configuredWorkflowProgram(item.fetchImpl);

      await env.program.parseAsync([
        "node", "apexcn", "workflow", "run",
        "--goal", item.goal,
        ...item.args,
        "--output-dir", runDir
      ]);

      expect((await readJson(join(runDir, "run.json"))).status).toBe("failed");
      expect(await readJson(join(runDir, "review.json"))).toEqual(expect.objectContaining({
        result: expect.objectContaining({
          ok: false,
          issues: expect.arrayContaining([expect.objectContaining({ code: "possible-secret" })])
        })
      }));
      await expect(readFile(join(runDir, "preview.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.stringify(await readJson(join(runDir, "run.json")))).not.toContain("abcdefghijklmnopqrstuvwxyz");
      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }
  });

  test("delete workflows bind exact confirmations and reject missing or mismatched values before network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const missing = workflowProgram();
    await missing.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "topic-delete",
      "--topic-id", "42",
      "--if-version", "3"
    ]);
    expect(missing.stderr.join("")).toContain("--confirm-title");
    expect(fetch).not.toHaveBeenCalled();

    process.exitCode = undefined;
    const mismatch = workflowProgram();
    await mismatch.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "reply-delete",
      "--reply-id", "100",
      "--confirm-id", "101",
      "--if-version", "2"
    ]);
    expect(mismatch.stderr.join("")).toContain("--confirm-id must match --reply-id");
    expect(fetch).not.toHaveBeenCalled();

    process.exitCode = undefined;
    vi.unstubAllGlobals();
    const topicDir = await tempPath("topic-delete");
    const topic = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await topic.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "topic-delete",
      "--topic-id", "42",
      "--confirm-title", "Exact title",
      "--if-version", "3",
      "--output-dir", topicDir
    ]);
    const topicPreview = await readJson(join(topicDir, "preview.json"));
    expect(topicPreview).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/topics/42",
        body: expect.objectContaining({ confirmTitle: "Exact title", ifVersion: 3 })
      })
    }));
    expect(topic.fetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const replyDir = await tempPath("reply-delete");
    const reply = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await reply.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "reply-delete",
      "--reply-id", "100",
      "--confirm-id", "100",
      "--if-version", "2",
      "--output-dir", replyDir
    ]);
    expect(await readJson(join(replyDir, "preview.json"))).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        method: "DELETE",
        path: "/api/v1/replies/100",
        body: expect.objectContaining({ confirmId: 100, ifVersion: 2 })
      })
    }));
    expect(reply.fetch).not.toHaveBeenCalled();
  });

  test("workflow rejects expired approvals and approval request tampering before network", async () => {
    const runDir = await tempPath("approval-governance");
    const contentFile = join(dirname(runDir), "reply-update.md");
    await writeFile(contentFile, "Updated reply content with enough detail for review.", "utf8");
    const env = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await env.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "reply-update",
      "--reply-id",
      "51",
      "--content-file",
      contentFile,
      "--if-version",
      "2",
      "--output-dir",
      runDir
    ]);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--approved-by", "reviewer", "--json"]);

    const approval = await readJson(join(runDir, "approval.json"));
    approval.expiresAt = "2000-01-01T00:00:00.000Z";
    await writeFile(join(runDir, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`, "utf8");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const expired = workflowProgram({ configPath: env.configPath });
    await expired.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
    expect(expired.stderr.join("")).toContain("expired");
    expect(fetch).not.toHaveBeenCalled();

    process.exitCode = undefined;
    approval.expiresAt = "2999-01-01T00:00:00.000Z";
    ((approval.request as { body: Record<string, unknown> }).body).content = "tampered after approval";
    await writeFile(join(runDir, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`, "utf8");
    const tampered = workflowProgram({ configPath: env.configPath });
    await tampered.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
    expect(tampered.stderr.join("")).toContain("approval request");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("workflow retries uncertain execution with the identical operation and rejects duplicate completion", async () => {
    const runDir = await tempPath("uncertain-retry");
    const contentFile = join(dirname(runDir), "retry-topic.md");
    await writeFile(contentFile, "Retry-safe topic update content.", "utf8");
    const env = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await env.program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "topic-update",
      "--topic-id",
      "42",
      "--content-file",
      contentFile,
      "--if-version",
      "3",
      "--output-dir",
      runDir
    ]);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir, "--approved-by", "reviewer"]);

    const firstFetch = vi.fn(async () => Response.json({ error: { code: "INTERNAL_ERROR", message: "temporary" } }, { status: 500 }));
    vi.stubGlobal("fetch", firstFetch);
    const first = workflowProgram({ configPath: env.configPath });
    await first.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
    expect((await readJson(join(runDir, "run.json"))).status).toBe("execution-uncertain");
    const firstBody = String(firstFetch.mock.calls[0]?.[1]?.body);

    process.exitCode = undefined;
    const secondFetch = vi.fn(async () => Response.json({
      ok: true,
      requestId: "req_replay",
      originalRequestId: "req_original",
      idempotentReplay: true,
      id: 42,
      version: 4,
      changed: true
    }));
    vi.stubGlobal("fetch", secondFetch);
    const second = workflowProgram({ configPath: env.configPath });
    await second.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes", "--json"]);
    expect(String(secondFetch.mock.calls[0]?.[1]?.body)).toBe(firstBody);
    expect((await readJson(join(runDir, "run.json"))).status).toBe("completed");

    const duplicateFetch = vi.fn();
    vi.stubGlobal("fetch", duplicateFetch);
    const duplicate = workflowProgram({ configPath: env.configPath });
    await duplicate.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
    expect(duplicate.stderr.join("")).toContain("already completed");
    expect(duplicateFetch).not.toHaveBeenCalled();
  });

  test("workflow recovery preserves operation identity for 401 and 429 but requires a new workflow after 409", async () => {
    for (const item of [
      { status: 401, nextAction: "Refresh the active profile credential" },
      { status: 429, nextAction: "Wait at least 30 seconds" }
    ]) {
      const runDir = await tempPath(`recover-${item.status}`);
      const contentFile = join(dirname(runDir), `recover-${item.status}.md`);
      await writeFile(contentFile, `Recovery content for ${item.status}.`, "utf8");
      const preview = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
      await preview.program.parseAsync([
        "node", "apexcn", "workflow", "run",
        "--goal", "topic-update",
        "--topic-id", "42",
        "--content-file", contentFile,
        "--if-version", "3",
        "--output-dir", runDir
      ]);
      const approver = workflowProgram();
      await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir]);

      const failedFetch = vi.fn(async () => Response.json({
        error: {
          code: item.status === 401 ? "AUTH_REQUIRED" : "RATE_LIMITED",
          message: "injected failure",
          retryAfterSeconds: item.status === 429 ? 30 : undefined
        }
      }, { status: item.status }));
      vi.stubGlobal("fetch", failedFetch);
      const failed = workflowProgram({ configPath: preview.configPath });
      await failed.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
      const failedState = await readJson(join(runDir, "run.json"));
      expect(failedState.status).toBe("failed");
      expect(failedState.nextAction).toContain(item.nextAction);
      const firstBody = String(failedFetch.mock.calls[0]?.[1]?.body);

      process.exitCode = undefined;
      const retryFetch = vi.fn(async () => Response.json({
        ok: true,
        requestId: `req_${item.status}`,
        id: 42,
        version: 4,
        changed: true
      }));
      vi.stubGlobal("fetch", retryFetch);
      const retry = workflowProgram({ configPath: preview.configPath });
      await retry.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
      expect(String(retryFetch.mock.calls[0]?.[1]?.body)).toBe(firstBody);
      expect((await readJson(join(runDir, "run.json"))).status).toBe("completed");

      process.exitCode = undefined;
      vi.unstubAllGlobals();
    }

    const runDir = await tempPath("recover-409");
    const contentFile = join(dirname(runDir), "recover-409.md");
    await writeFile(contentFile, "Stale update content.", "utf8");
    const preview = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
    await preview.program.parseAsync([
      "node", "apexcn", "workflow", "run",
      "--goal", "topic-update",
      "--topic-id", "42",
      "--content-file", contentFile,
      "--if-version", "3",
      "--output-dir", runDir
    ]);
    const approver = workflowProgram();
    await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "VERSION_CONFLICT", message: "stale version" }
    }, { status: 409 })));
    const conflict = workflowProgram({ configPath: preview.configPath });
    await conflict.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
    const conflictState = await readJson(join(runDir, "run.json"));
    expect(conflictState.status).toBe("failed");
    expect(conflictState.nextAction).toContain("create and approve a new workflow");
    expect(conflictState.nextAction).toContain("Do not retry the stale approval");
  });

  test("workflow timeout recovery reuses the identical operation key", async () => {
    const priorTimeout = process.env.APEXCN_HTTP_TIMEOUT_MS;
    process.env.APEXCN_HTTP_TIMEOUT_MS = "1";
    try {
      const runDir = await tempPath("recover-timeout");
      const contentFile = join(dirname(runDir), "recover-timeout.md");
      await writeFile(contentFile, "Timeout recovery content.", "utf8");
      const preview = await configuredWorkflowProgram(async () => Response.json({ error: "unexpected" }, { status: 500 }));
      await preview.program.parseAsync([
        "node", "apexcn", "workflow", "run",
        "--goal", "topic-update",
        "--topic-id", "42",
        "--content-file", contentFile,
        "--if-version", "3",
        "--output-dir", runDir
      ]);
      const approver = workflowProgram();
      await approver.program.parseAsync(["node", "apexcn", "workflow", "approve", "--run-dir", runDir]);

      const timeoutFetch = vi.fn(async () => {
        throw new DOMException("timed out", "AbortError");
      });
      vi.stubGlobal("fetch", timeoutFetch);
      const timedOut = workflowProgram({ configPath: preview.configPath });
      await timedOut.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
      expect((await readJson(join(runDir, "run.json"))).status).toBe("execution-uncertain");
      const firstBody = String(timeoutFetch.mock.calls[0]?.[1]?.body);

      process.exitCode = undefined;
      const retryFetch = vi.fn(async () => Response.json({
        ok: true,
        requestId: "req_timeout_replay",
        id: 42,
        version: 4,
        changed: true,
        idempotentReplay: true
      }));
      vi.stubGlobal("fetch", retryFetch);
      const retry = workflowProgram({ configPath: preview.configPath });
      await retry.program.parseAsync(["node", "apexcn", "workflow", "run", "--resume", runDir, "--execute", "--yes"]);
      expect(String(retryFetch.mock.calls[0]?.[1]?.body)).toBe(firstBody);
      expect((await readJson(join(runDir, "run.json"))).status).toBe("completed");
    } finally {
      if (priorTimeout === undefined) {
        delete process.env.APEXCN_HTTP_TIMEOUT_MS;
      } else {
        process.env.APEXCN_HTTP_TIMEOUT_MS = priorTimeout;
      }
    }
  });

  test("workflow run failure records failed state with redacted secrets", async () => {
    const runDir = await tempPath("failed-run");
    const { program, stderr } = await configuredWorkflowProgram(async () =>
      Response.json({ error: { message: "Bearer abcdefghijklmnopqrstuvwxyz rejected" } }, { status: 403 })
    );

    await program.parseAsync([
      "node",
      "apexcn",
      "workflow",
      "run",
      "--goal",
      "ask-question",
      "--keyword",
      "REST API",
      "--title",
      "APEX REST API returns 403",
      "--problem",
      "Page process gets 403 when calling REST API.",
      "--category-id",
      "4",
      "--output-dir",
      runDir
    ]);

    expect(stderr.join("")).toContain("HTTP 403");
    const state = await readJson(join(runDir, "run.json"));
    expect(state.status).toBe("failed");
    expect(JSON.stringify(state)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
