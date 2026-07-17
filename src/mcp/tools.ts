import { loadApiClient, isApexcnError } from "../core/api-client.js";
import { createDoctorSnapshot } from "../core/doctor-snapshot.js";
import { errorBodyFrom } from "../core/errors.js";
import { previewPlan, readonlyBlocked } from "../core/safety-policy.js";
import { askCommunity, listAdmins, listCategories, listTopics, recentTopics, researchTopics, searchTopics, viewTopic } from "../core/services.js";
import { createWorkflowPlan, type WorkflowGoal } from "../core/workflow-plan.js";
import { mcpToolByName, type McpPolicy } from "./tool-registry.js";

export type McpCallOptions = {
  configPath?: string;
};

export async function callMcpTool(name: string, args: unknown = {}, policy: McpPolicy, options: McpCallOptions = {}): Promise<unknown> {
  const tool = mcpToolByName(name);
  if (!tool) {
    return { ok: false, error: { code: "MCP_TOOL_NOT_FOUND", message: `Unknown MCP tool: ${name}` } };
  }
  if (tool.exposure === "preview-only" && !policy.allowPreviewWrite) {
    return readonlyBlocked(name);
  }
  const value = input(args);
  const inputIssue = validateInput(tool.inputSchema, value);
  if (inputIssue) {
    return validationError(new Error(inputIssue));
  }
  if (tool.exposure === "preview-only") {
    try {
      return previewWriteTool(name, value);
    } catch (error) {
      return validationError(error);
    }
  }

  try {
    if (name === "apexcn_doctor_snapshot") {
      return await createDoctorSnapshot(options.configPath);
    }
    if (name === "apexcn_workflow_plan") {
      return createWorkflowPlan({
        goal: workflowGoal(value.goal),
        keyword: optionalString(value, "keyword"),
        topicId: optionalNumber(value, "topicId"),
        replyId: optionalNumber(value, "replyId"),
        categoryId: optionalNumber(value, "categoryId"),
        title: optionalString(value, "title"),
        problem: optionalString(value, "problem"),
        answer: optionalString(value, "answer"),
        contentFile: optionalString(value, "contentFile"),
        ifVersion: optionalNumber(value, "ifVersion"),
        confirmTitle: optionalString(value, "confirmTitle"),
        confirmId: optionalNumber(value, "confirmId"),
        outputDir: optionalString(value, "outputDir"),
        includeExecute: false
      });
    }
    const client = await loadApiClient(options.configPath);
    if (isApexcnError(client)) {
      return client;
    }
    if (name === "apexcn_admin_list") {
      return await listAdmins(client);
    }
    if (name === "apexcn_search") {
      return await searchTopics(client, requiredString(value, "query"), queryFilters(value));
    }
    if (name === "apexcn_topic_view") {
      return await viewTopic(client, requiredNumber(value, "topicId"));
    }
    if (name === "apexcn_topic_recent") {
      return await recentTopics(client, {
        pageSize: optionalNumber(value, "pageSize"),
        categoryId: optionalNumber(value, "categoryId"),
        cursor: optionalString(value, "cursor"),
        fromDate: optionalString(value, "from"),
        toDate: optionalString(value, "to")
      });
    }
    if (name === "apexcn_topic_list") {
      return await listTopics(client, queryFilters(value));
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
    return previewPlan({ method: "POST", path: `/api/v1/topics/${requiredNumber(args, "topicId")}`, body });
  }
  if (name === "apexcn_topic_delete_preview") {
    return previewPlan({ method: "DELETE", path: `/api/v1/topics/${requiredNumber(args, "topicId")}`, body: { confirmTitle: requiredString(args, "confirmTitle") } });
  }
  if (name === "apexcn_reply_create_preview") {
    return previewPlan({ method: "POST", path: `/api/v1/topics/${requiredNumber(args, "topicId")}/replies`, body: { content: requiredString(args, "content") } });
  }
  if (name === "apexcn_reply_update_preview") {
    return previewPlan({ method: "POST", path: `/api/v1/replies/${requiredNumber(args, "replyId")}`, body: { content: requiredString(args, "content") } });
  }
  if (name === "apexcn_reply_delete_preview") {
    const replyId = requiredNumber(args, "replyId");
    const confirmId = requiredNumber(args, "confirmId");
    if (confirmId !== replyId) {
      throw new Error("confirmId must match replyId");
    }
    return previewPlan({ method: "DELETE", path: `/api/v1/replies/${replyId}`, body: { confirmId } });
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

function queryFilters(args: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  return {
    pageSize: optionalNumber(args, "pageSize"),
    categoryId: optionalNumber(args, "categoryId"),
    tag: optionalString(args, "tag"),
    author: optionalString(args, "author"),
    authorId: optionalNumber(args, "authorId"),
    cursor: optionalString(args, "cursor"),
    offset: optionalNumber(args, "offset"),
    fromDate: optionalString(args, "from"),
    toDate: optionalString(args, "to"),
    tags: optionalString(args, "tags"),
    sourceDomain: optionalString(args, "sourceDomain"),
    originalUrl: optionalString(args, "originalUrl"),
    contentType: optionalString(args, "contentType"),
    sourceType: optionalString(args, "sourceType"),
    status: optionalString(args, "status"),
    view: optionalString(args, "view"),
    sort: optionalString(args, "sort"),
    featured: optionalBoolean(args, "featured"),
    pinned: optionalBoolean(args, "pinned"),
    locked: optionalBoolean(args, "locked"),
    unanswered: optionalBoolean(args, "unanswered"),
    hasUsefulReply: optionalBoolean(args, "hasUsefulReply")
  };
}

function input(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function workflowGoal(value: unknown): WorkflowGoal {
  if (
    value === "ask-question"
    || value === "reply"
    || value === "research-only"
    || value === "publish-topic"
    || value === "topic-create"
    || value === "topic-update"
    || value === "topic-delete"
    || value === "reply-create"
    || value === "reply-update"
    || value === "reply-delete"
  ) {
    return value;
  }
  throw new Error("goal must be ask-question, reply, research-only, publish-topic, topic-create/update/delete, or reply-create/update/delete");
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

function validateInput(schema: Record<string, unknown>, value: Record<string, unknown>): string | undefined {
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
  for (const key of required) {
    if (!(key in value)) {
      return `${key} is required`;
    }
  }
  const properties = typeof schema.properties === "object" && schema.properties !== null
    ? schema.properties as Record<string, unknown>
    : {};
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(value).find((key) => !(key in properties));
    if (unknown) {
      return `Unknown argument: ${unknown}`;
    }
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    const property = properties[key];
    if (typeof property !== "object" || property === null) {
      continue;
    }
    const rule = property as { type?: unknown; enum?: unknown };
    if (Array.isArray(rule.enum) && !rule.enum.includes(nestedValue)) {
      return `${key} must be one of: ${rule.enum.join(", ")}`;
    }
    if (rule.type === "string" && typeof nestedValue !== "string") {
      return `${key} must be a string`;
    }
    if (rule.type === "number" && (typeof nestedValue !== "number" || !Number.isFinite(nestedValue))) {
      return `${key} must be a finite number`;
    }
    if (rule.type === "boolean" && typeof nestedValue !== "boolean") {
      return `${key} must be a boolean`;
    }
  }
  return undefined;
}
