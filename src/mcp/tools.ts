import { loadApiClient, isApexcnError } from "../core/api-client.js";
import { errorBodyFrom } from "../core/errors.js";
import { previewPlan, readonlyBlocked } from "../core/safety-policy.js";
import { redactSecrets } from "../core/secret-redaction.js";
import { askCommunity, listCategories, recentTopics, researchTopics, searchTopics, viewTopic } from "../core/services.js";
import { CLI_VERSION } from "../version.js";
import { mcpToolByName, type McpPolicy } from "./tool-registry.js";

export type McpCallOptions = {
  configPath?: string;
};

export async function callMcpTool(name: string, args: unknown = {}, policy: McpPolicy, options: McpCallOptions = {}): Promise<unknown> {
  const tool = mcpToolByName(name);
  if (!tool) {
    return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: `Unknown MCP tool: ${name}` } };
  }
  if (tool.exposure === "preview-only") {
    if (!policy.allowPreviewWrite) {
      return readonlyBlocked(name);
    }
    try {
      return previewWriteTool(name, input(args));
    } catch (error) {
      return validationError(error);
    }
  }

  try {
    if (name === "apexcn_doctor_snapshot") {
      return doctorSnapshot();
    }
    if (name === "apexcn_workflow_plan") {
      return workflowPlan(input(args));
    }
    const client = await loadApiClient(options.configPath);
    if (isApexcnError(client)) {
      return client;
    }
    const value = input(args);
    if (name === "apexcn_search") {
      return await searchTopics(client, requiredString(value, "query"), queryFilters(value));
    }
    if (name === "apexcn_topic_view") {
      return await viewTopic(client, requiredNumber(value, "topicId"));
    }
    if (name === "apexcn_topic_recent") {
      return await recentTopics(client, {
        pageSize: optionalNumber(value, "pageSize"),
        categoryId: optionalNumber(value, "categoryId")
      });
    }
    if (name === "apexcn_category_list") {
      return await listCategories(client);
    }
    if (name === "apexcn_ask") {
      return await askCommunity(client, {
        question: requiredString(value, "question"),
        topK: optionalNumber(value, "topK"),
        categoryId: optionalNumber(value, "categoryId"),
        tag: optionalString(value, "tag")
      });
    }
    if (name === "apexcn_research") {
      return await researchTopics(client, {
        query: requiredString(value, "query"),
        limit: optionalNumber(value, "limit"),
        categoryId: optionalNumber(value, "categoryId")
      });
    }
    return { ok: false, error: { code: "MCP_TOOL_NOT_IMPLEMENTED", message: `Tool is not implemented: ${name}` } };
  } catch (error) {
    return errorBodyFrom(error);
  }
}

function previewWriteTool(name: string, args: Record<string, unknown>): unknown {
  if (name === "apexcn_topic_create_preview") {
    return previewPlan({ method: "POST", path: "/api/v1/topics", body: { title: requiredString(args, "title"), content: requiredString(args, "content"), categoryId: requiredNumber(args, "categoryId") } });
  }
  if (name === "apexcn_topic_update_preview") {
    const body = compact({ title: optionalString(args, "title"), content: optionalString(args, "content"), categoryId: optionalNumber(args, "categoryId") });
    if (Object.keys(body).length === 0) {
      throw new Error("At least one of title, content, or categoryId is required");
    }
    return previewPlan({ method: "PATCH", path: `/api/v1/topics/${requiredNumber(args, "topicId")}`, body });
  }
  if (name === "apexcn_topic_delete_preview") {
    return previewPlan({ method: "DELETE", path: `/api/v1/topics/${requiredNumber(args, "topicId")}`, body: { confirmTitle: requiredString(args, "confirmTitle") } });
  }
  if (name === "apexcn_reply_create_preview") {
    return previewPlan({ method: "POST", path: `/api/v1/topics/${requiredNumber(args, "topicId")}/replies`, body: { content: requiredString(args, "content") } });
  }
  if (name === "apexcn_reply_update_preview") {
    return previewPlan({ method: "PATCH", path: `/api/v1/replies/${requiredNumber(args, "replyId")}`, body: { content: requiredString(args, "content") } });
  }
  if (name === "apexcn_reply_delete_preview") {
    return previewPlan({ method: "DELETE", path: `/api/v1/replies/${requiredNumber(args, "replyId")}` });
  }
  if (name === "apexcn_favorite_add_preview") {
    return previewPlan({ method: "POST", path: `/api/v1/topics/${requiredNumber(args, "topicId")}/favorite` });
  }
  if (name === "apexcn_favorite_remove_preview") {
    return previewPlan({ method: "DELETE", path: `/api/v1/topics/${requiredNumber(args, "topicId")}/favorite` });
  }
  if (name === "apexcn_subscription_add_preview") {
    return previewPlan({ method: "POST", path: `/api/v1/topics/${requiredNumber(args, "topicId")}/subscription` });
  }
  if (name === "apexcn_subscription_remove_preview") {
    return previewPlan({ method: "DELETE", path: `/api/v1/topics/${requiredNumber(args, "topicId")}/subscription` });
  }
  return { ok: false, error: { code: "MCP_TOOL_NOT_IMPLEMENTED", message: `Tool is not implemented: ${name}` } };
}

function doctorSnapshot(): Record<string, unknown> {
  return redactSecrets({
    kind: "doctor-snapshot",
    schemaVersion: 1,
    ok: true,
    diagnostics: {
      cliVersion: CLI_VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    },
    environment: {
      APEXCN_CONFIG_PATH: process.env.APEXCN_CONFIG_PATH,
      APEXCN_API_KEY: process.env.APEXCN_API_KEY
    }
  }) as Record<string, unknown>;
}

function workflowPlan(args: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "workflow-plan",
    schemaVersion: 1,
    mode: "preview",
    willExecute: false,
    intent: optionalString(args, "intent") ?? "agent-assisted-workflow",
    inputs: redactSecrets(args),
    nextSteps: ["review plan", "run apexcn workflow plan/run from CLI", "approve before execute"]
  };
}

function queryFilters(args: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  return {
    pageSize: optionalNumber(args, "pageSize"),
    categoryId: optionalNumber(args, "categoryId"),
    tag: optionalString(args, "tag"),
    author: optionalString(args, "author"),
    fromDate: optionalString(args, "from"),
    toDate: optionalString(args, "to")
  };
}

function input(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = optionalNumber(args, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function validationError(error: unknown): Record<string, unknown> {
  return {
    ok: false,
    error: {
      code: "MCP_VALIDATION_ERROR",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}
