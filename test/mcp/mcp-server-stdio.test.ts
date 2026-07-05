import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";

describe("MCP server stdio integration", () => {
  test("node dist/index.js mcp serve --readonly answers initialize and tools/list", async () => {
    const messages = await runMcpStdio(["mcp", "serve", "--readonly"], [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vitest", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
    ]);

    expect(messages[0]).toEqual(expect.objectContaining({
      result: expect.objectContaining({ serverInfo: expect.objectContaining({ name: "apexcn-cli" }) })
    }));
    expect(messages[1]).toEqual(expect.objectContaining({
      result: expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: "apexcn_search" })]) })
    }));
    expect(JSON.stringify(messages)).not.toContain("apexcn_topic_create_preview");
    expect(JSON.stringify(messages)).not.toContain("apexcn_secret_token_123456");
  }, 10000);

  test("node dist/index.js mcp serve --allow-preview-write exposes preview-only tools without execution", async () => {
    const messages = await runMcpStdio(["mcp", "serve", "--allow-preview-write"], [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vitest", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "apexcn_reply_create_preview",
          arguments: { topicId: 123, content: "preview only" }
        }
      }
    ]);

    expect(JSON.stringify(messages[1])).toContain("apexcn_reply_create_preview");
    const callResult = messages[2] as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
    expect(callResult.result?.isError).toBe(false);
    const payload = JSON.parse(String(callResult.result?.content?.[0]?.text ?? "{}"));
    expect(payload).toEqual(expect.objectContaining({
      ok: true,
      mode: "preview",
      willExecute: false,
      effect: "api-write-preview"
    }));
    expect(payload.request).toEqual(expect.objectContaining({
      method: "POST",
      path: "/api/v1/topics/123/replies"
    }));
  }, 10000);
});

async function runMcpStdio(args: string[], requests: unknown[]): Promise<unknown[]> {
  const child = spawn(process.execPath, ["dist/index.js", ...args], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, APEXCN_API_KEY: "apexcn_secret_token_123456" }
    });
    const output: string[] = [];
    const errors: string[] = [];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
  for (const request of requests) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  child.stdin.end();

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`mcp exited ${String(code)}: ${errors.join("")}`)));
  });

  return output.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
