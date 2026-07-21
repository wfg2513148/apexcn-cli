import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../../src/index.js";
import { mcpReadonlyDescriptors } from "../../src/core/command-registry.js";
import { callMcpTool } from "../../src/mcp/tools.js";
import { handleMcpRequest } from "../../src/mcp/server.js";
import { assertMcpCommandRegistryCoverage, mcpPolicy, mcpToolManifest } from "../../src/mcp/tool-registry.js";

describe("MCP tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  test("readonly policy exposes only readonly tools", () => {
    const manifest = mcpToolManifest(mcpPolicy(false));
    const tools = manifest.tools as Array<{ commandId: string; exposure: string }>;
    const expectedCommandIds = mcpReadonlyDescriptors().map((descriptor) => descriptor.id).sort();

    expect(assertMcpCommandRegistryCoverage()).toBe(true);
    expect(manifest).toEqual(expect.objectContaining({ kind: "mcp-tools" }));
    expect(tools.every((tool) => tool.exposure === "readonly")).toBe(true);
    expect(tools.map((tool) => tool.commandId).sort()).toEqual(expectedCommandIds);
    expect(tools).toHaveLength(10);
    expect(tools.map((tool) => tool.commandId)).toEqual(expect.arrayContaining(["admin.list", "topic.list"]));
  });

  test("readonly policy rejects preview-only write tools", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await callMcpTool("apexcn_topic_create_preview", { title: "x" }, mcpPolicy(false));

    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "MCP_READONLY_BLOCKED" }) }));
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("tool input schemas reject wrong types and unknown arguments", async () => {
    await expect(callMcpTool("apexcn_topic_view", { topicId: "1" }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR", message: "topicId must be a finite number" })
    }));
    await expect(callMcpTool("apexcn_admin_list", { execute: true }, mcpPolicy(false))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR", message: "Unknown argument: execute" })
    }));
  });

  test("preview-only write tools produce non-executing plans without network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await callMcpTool("apexcn_topic_create_preview", { title: "Title", content: "Body", categoryId: 4, tags: "APEX,ORDS" }, mcpPolicy(true));

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      mode: "preview",
      willExecute: false,
      request: expect.objectContaining({ method: "POST", path: "/api/v1/topics", body: expect.objectContaining({ tags: "APEX,ORDS" }) })
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("reply create preview preserves the selected parent reply", async () => {
    const result = await callMcpTool(
      "apexcn_reply_create_preview",
      { topicId: 42, parentPostId: 100, content: "Nested reply" },
      mcpPolicy(true)
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      willExecute: false,
      request: {
        method: "POST",
        path: "/api/v1/topics/42/replies",
        body: { content: "Nested reply", parentPostId: 100 }
      }
    }));
  });

  test("workflow plan preserves nested reply and topic tag inputs", async () => {
    const replyPlan = await callMcpTool(
      "apexcn_workflow_plan",
      { goal: "reply", topicId: 42, parentPostId: 100, answer: "Nested reply" },
      mcpPolicy(false)
    ) as { steps: Array<{ command: string }> };
    const topicPlan = await callMcpTool(
      "apexcn_workflow_plan",
      { goal: "topic-create", categoryId: 4, title: "Tagged topic", contentFile: "topic.md", tags: "APEX,ORDS" },
      mcpPolicy(false)
    ) as { steps: Array<{ command: string }> };

    expect(replyPlan.steps.map((step) => step.command).join("\n")).toContain("--parent-post-id 100");
    expect(topicPlan.steps.map((step) => step.command).join("\n")).toContain('--tags "APEX,ORDS"');
  });

  test("update previews use the verified ORDS POST contract without network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(callMcpTool(
      "apexcn_topic_update_preview",
      { topicId: 42, title: "Updated" },
      mcpPolicy(true)
    )).resolves.toEqual(expect.objectContaining({
      ok: true,
      willExecute: false,
      request: { method: "POST", path: "/api/v1/topics/42", body: { title: "Updated" } }
    }));
    await expect(callMcpTool(
      "apexcn_reply_update_preview",
      { replyId: 100, content: "Updated reply" },
      mcpPolicy(true)
    )).resolves.toEqual(expect.objectContaining({
      ok: true,
      willExecute: false,
      request: { method: "POST", path: "/api/v1/replies/100", body: { content: "Updated reply" } }
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("delete preview requires strong confirmation", async () => {
    await expect(callMcpTool("apexcn_topic_delete_preview", { topicId: 1 }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR" })
    }));
    await expect(callMcpTool("apexcn_reply_delete_preview", { replyId: 2, confirmId: 3 }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR", message: "confirmId must match replyId" })
    }));
  });

  test("preview-only write tools reject incomplete requests", async () => {
    await expect(callMcpTool("apexcn_topic_create_preview", { title: "Title" }, mcpPolicy(true))).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "MCP_VALIDATION_ERROR" })
    }));
  });

  test("mcp serve rejects conflicting readonly and preview-write flags", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const program = createProgram({
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    });

    await program.parseAsync(["node", "apexcn", "mcp", "serve", "--readonly", "--allow-preview-write"]);

    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("--readonly cannot be combined with --allow-preview-write");
    expect(process.exitCode).toBe(1);
  });

  test("JSON-RPC tools/list returns MCP tools", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, mcpPolicy(false));

    expect(response).toEqual(expect.objectContaining({
      jsonrpc: "2.0",
      id: 1,
      result: expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: "apexcn_search" })]) })
    }));
  });
});
