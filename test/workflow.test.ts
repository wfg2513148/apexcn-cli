import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../src/index.js";

async function tempPath(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "apexcn-workflow-"));
  return join(dir, name);
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
      "--answer",
      "Check the Web Credential first.",
      "--include-execute"
    ]);

    const plan = JSON.parse(stdout.join(""));
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual([
      "topic-view",
      "draft-reply",
      "preview-reply-create",
      "execute-reply-create"
    ]);
    expect(plan.steps.at(-1)).toEqual(expect.objectContaining({
      mode: "api-write-execute",
      requiresConfirmation: true
    }));
    expect(plan.checkpoints.confirmations).toEqual(["execute-reply-create"]);
    expect(plan.safetySummary.requiresConfirmation).toBe(true);
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
});
