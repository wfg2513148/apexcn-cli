import readline from "node:readline";
import { redactSecrets, redactSecretText } from "../core/secret-redaction.js";
import { CLI_VERSION } from "../version.js";
import { callMcpTool } from "./tools.js";
import { mcpPolicy, mcpToolManifest, type McpPolicy } from "./tool-registry.js";

export type McpServerOptions = {
  configPath?: string;
  allowPreviewWrite?: boolean;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

export async function serveMcp(options: McpServerOptions = {}): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const policy = mcpPolicy(options.allowPreviewWrite === true);
  const lines = readline.createInterface({ input: stdin });
  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const response = await handleMcpRequest(parseRequest(line), policy, options.configPath);
    if (response !== undefined) {
      stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

export async function handleMcpRequest(request: JsonRpcRequest | { parseError: string }, policy: McpPolicy, configPath?: string): Promise<unknown> {
  if ("parseError" in request) {
    return rpcError(null, -32700, request.parseError);
  }
  const id = request.id ?? null;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return request.id === undefined ? undefined : rpcError(id, -32600, "Invalid JSON-RPC request.");
  }
  if (request.method === "initialize") {
    const params = paramsRecord(request.params);
    const requestedVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05";
    return rpcResult(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion) ? requestedVersion : "2025-06-18",
      serverInfo: { name: "apexcn-cli", version: CLI_VERSION },
      capabilities: { tools: {} }
    });
  }
  if (request.method === "ping") {
    return rpcResult(id, {});
  }
  if (request.method === "tools/list") {
    const manifest = mcpToolManifest(policy);
    return rpcResult(id, { tools: manifest.tools });
  }
  if (request.method === "tools/call") {
    const params = paramsRecord(request.params);
    const name = typeof params.name === "string" ? params.name : "";
    const args = paramsRecord(params.arguments);
    const result = await callMcpTool(name, args, policy, { configPath });
    const safeResult = redactSecrets(result);
    return rpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(safeResult) }],
      isError: isErrorResult(safeResult)
    });
  }
  if (request.id === undefined) {
    return undefined;
  }
  return rpcError(id, -32601, `Unsupported MCP method: ${request.method ?? ""}`);
}

function parseRequest(line: string): JsonRpcRequest | { parseError: string } {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as JsonRpcRequest : { parseError: "JSON-RPC request must be an object." };
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

function paramsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function rpcResult(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message: redactSecretText(message) } };
}

function isErrorResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}
