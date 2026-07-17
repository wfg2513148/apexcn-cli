import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "vitest";

const SECRET = "apexcn_sdk_runner_secret_123456789";

describe("official MCP SDK client compatibility", () => {
  test("discovers the exact readonly allowlist and completes a 100-call soak", async () => {
    const { client, transport, stderr } = await connect();
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(10);
      expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "apexcn_admin_list",
        "apexcn_topic_list",
        "apexcn_workflow_plan"
      ]));
      expect(JSON.stringify(listed)).not.toContain("_preview");

      for (let index = 0; index < 100; index += 1) {
        const result = await client.callTool({
          name: "apexcn_workflow_plan",
          arguments: { goal: "research-only", keyword: `ORDS-${index}` }
        });
        expect(result.isError).not.toBe(true);
        const payload = JSON.parse(String(result.content[0]?.type === "text" ? result.content[0].text : "{}")) as {
          safetySummary?: { apiWriteExecuteSteps?: number };
        };
        expect(payload.safetySummary?.apiWriteExecuteSteps).toBe(0);
      }
      expect(stderr.join("")).not.toContain(SECRET);
    } finally {
      await client.close();
      await transport.close();
    }
  }, 30000);

  test("starts below the two-second P95 threshold", async () => {
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      const { client, transport } = await connect();
      samples.push(performance.now() - startedAt);
      await client.close();
      await transport.close();
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(2000);
  }, 30000);
});

async function connect(): Promise<{
  client: Client;
  transport: StdioClientTransport;
  stderr: string[];
}> {
  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js", "mcp", "serve", "--readonly"],
    cwd: process.cwd(),
    env: {
      ...stringEnvironment(),
      APEXCN_API_KEY: SECRET
    },
    stderr: "pipe"
  });
  transport.stderr?.setEncoding("utf8");
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "apexcn-cli-qualification", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, stderr };
}

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
