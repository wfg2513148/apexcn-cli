import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";

describe("MCP server stdio integration", () => {
  test("node dist/index.js mcp serve --readonly answers initialize and tools/list", async () => {
    const child = spawn(process.execPath, ["dist/index.js", "mcp", "serve", "--readonly"], {
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
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vitest", version: "0" } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    child.stdin.end();

    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`mcp exited ${String(code)}: ${errors.join("")}`)));
    });

    const messages = output.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(messages[0]).toEqual(expect.objectContaining({
      result: expect.objectContaining({ serverInfo: expect.objectContaining({ name: "apexcn-cli" }) })
    }));
    expect(messages[1]).toEqual(expect.objectContaining({
      result: expect.objectContaining({ tools: expect.arrayContaining([expect.objectContaining({ name: "apexcn_search" })]) })
    }));
    expect(JSON.stringify(messages)).not.toContain("apexcn_topic_create_preview");
    expect(JSON.stringify(messages)).not.toContain("apexcn_secret_token_123456");
  }, 10000);
});
