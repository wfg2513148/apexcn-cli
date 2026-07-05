import { Command } from "commander";
import { printData, printError } from "../output.js";
import { serveMcp } from "../mcp/server.js";
import { assertMcpCommandRegistryCoverage, MCP_TOOL_MANIFEST_JSON_SCHEMA, mcpPolicy, mcpToolManifest, mcpTools } from "../mcp/tool-registry.js";
import type { CommandIo } from "./auth.js";

type McpCommandOptions = CommandIo & {
  configPath?: string;
};

type McpModeOptions = {
  json?: boolean;
  readonly?: boolean;
  allowPreviewWrite?: boolean;
  allowExecuteWrite?: boolean;
};

export function createMcpCommand(options: McpCommandOptions): Command {
  const mcp = new Command("mcp").description("local MCP adapter for AI agents");

  mcp
    .command("tools")
    .description("print the MCP tool manifest")
    .option("--json", "pretty-print JSON")
    .option("--json-schema", "print the MCP tool manifest JSON Schema")
    .option("--allow-preview-write", "include preview-only write tools")
    .action((commandOptions: McpModeOptions & { jsonSchema?: boolean }) => {
      if (commandOptions.jsonSchema) {
        printData(options, MCP_TOOL_MANIFEST_JSON_SCHEMA, true);
        return;
      }
      const policy = mcpPolicy(commandOptions.allowPreviewWrite === true);
      printData(options, mcpToolManifest(policy), commandOptions.json === true);
    });

  mcp
    .command("inspect")
    .description("inspect local MCP configuration and safety policy")
    .option("--json", "pretty-print JSON")
    .option("--allow-preview-write", "include preview-only write tools")
    .action((commandOptions: McpModeOptions) => {
      const policy = mcpPolicy(commandOptions.allowPreviewWrite === true);
      printData(options, {
        kind: "mcp-inspect",
        schemaVersion: 1,
        policy,
        toolCount: mcpTools(policy).length,
        registryCoverageOk: assertMcpCommandRegistryCoverage()
      }, commandOptions.json === true);
    });

  mcp
    .command("serve")
    .description("serve local stdio MCP tools")
    .option("--readonly", "serve readonly tools only")
    .option("--allow-preview-write", "allow preview-only write tools; never executes writes")
    .option("--allow-execute-write", "disabled; MCP execute-write is not supported")
    .action(async (commandOptions: McpModeOptions) => {
      if (commandOptions.readonly && commandOptions.allowPreviewWrite) {
        printError(options, { type: "mcp-policy", message: "--readonly cannot be combined with --allow-preview-write." });
        process.exitCode = 1;
        return;
      }
      if (commandOptions.allowExecuteWrite) {
        printError(options, { type: "mcp-policy", message: "MCP execute-write is disabled. Use CLI workflow for real write execution." });
        process.exitCode = 1;
        return;
      }
      await serveMcp({
        configPath: options.configPath,
        allowPreviewWrite: commandOptions.allowPreviewWrite === true
      });
    });

  return mcp;
}
