import { mcpPreviewDescriptors, mcpReadonlyDescriptors, type CommandDescriptor } from "../core/command-registry.js";

export type McpToolExposure = "readonly" | "preview-only";

export type McpToolDefinition = {
  name: string;
  description: string;
  exposure: McpToolExposure;
  commandId: string;
  inputSchema: Record<string, unknown>;
};

export type McpPolicy = {
  mode: "readonly" | "preview-write";
  transport: "stdio";
  allowPreviewWrite: boolean;
  allowExecuteWrite: false;
};

export const MCP_TOOL_MANIFEST_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/wfg2513148/apexcn-cli/schemas/mcp-tools.schema.json",
  title: "apexcn-cli MCP tool manifest",
  type: "object",
  required: ["kind", "schemaVersion", "policy", "tools"],
  properties: {
    kind: { const: "mcp-tools" },
    schemaVersion: { const: 1 },
    policy: {
      type: "object",
      required: ["mode", "transport", "allowPreviewWrite", "allowExecuteWrite"],
      properties: {
        mode: { enum: ["readonly", "preview-write"] },
        transport: { const: "stdio" },
        allowPreviewWrite: { type: "boolean" },
        allowExecuteWrite: { const: false }
      },
      additionalProperties: true
    },
    tools: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "description", "exposure", "commandId", "inputSchema"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          exposure: { enum: ["readonly", "preview-only"] },
          commandId: { type: "string" },
          inputSchema: { type: "object" }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
} as const;

const READONLY_TOOLS: McpToolDefinition[] = [
  readonlyTool("apexcn_admin_list", "admin.list", "List public community admins", {
    type: "object",
    properties: {}
  }),
  readonlyTool("apexcn_search", "search", "Search community topics", {
    type: "object",
    properties: {
      query: { type: "string" },
      pageSize: { type: "number" },
      categoryId: { type: "number" },
      tag: { type: "string" },
      author: { type: "string" },
      from: { type: "string" },
      to: { type: "string" }
    },
    required: ["query"]
  }),
  readonlyTool("apexcn_topic_view", "topic.view", "View a community topic", {
    type: "object",
    properties: { topicId: { type: "number" } },
    required: ["topicId"]
  }),
  readonlyTool("apexcn_topic_list", "topic.list", "List community topics", topicListInputSchema()),
  readonlyTool("apexcn_topic_recent", "topic.recent", "List recent community topics", {
    type: "object",
    properties: {
      pageSize: { type: "number" },
      categoryId: { type: "number" },
      cursor: { type: "string" },
      from: { type: "string" },
      to: { type: "string" }
    }
  }),
  readonlyTool("apexcn_category_list", "category.list", "List community categories", { type: "object", properties: {} }),
  readonlyTool("apexcn_ask", "ask", "Answer with community references", {
    type: "object",
    properties: { question: { type: "string" }, topK: { type: "number" }, categoryId: { type: "number" }, tag: { type: "string" } },
    required: ["question"]
  }),
  readonlyTool("apexcn_research", "research", "Build a read-only research bundle", {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" }, categoryId: { type: "number" } },
    required: ["query"]
  }),
  readonlyTool("apexcn_doctor_snapshot", "doctor.snapshot", "Return a redacted local diagnostic snapshot", {
    type: "object",
    properties: { includeNetwork: { type: "boolean" } }
  }),
  readonlyTool("apexcn_workflow_plan", "workflow.plan", "Create a local workflow plan preview", {
    type: "object",
    properties: {
      goal: { enum: ["ask-question", "reply", "research-only", "publish-topic", "topic-create", "topic-update", "topic-delete", "reply-create", "reply-update", "reply-delete"] },
      keyword: { type: "string" },
      topicId: { type: "number" },
      replyId: { type: "number" },
      categoryId: { type: "number" },
      title: { type: "string" },
      problem: { type: "string" },
      answer: { type: "string" },
      contentFile: { type: "string" },
      ifVersion: { type: "number" },
      confirmTitle: { type: "string" },
      confirmId: { type: "number" },
      outputDir: { type: "string" }
    },
    required: ["goal"]
  })
];

const PREVIEW_TOOLS: McpToolDefinition[] = [
  previewTool("apexcn_topic_create_preview", "topic.create", "Preview topic creation", ["title", "content", "categoryId"]),
  previewTool("apexcn_topic_update_preview", "topic.update", "Preview topic update", ["topicId"]),
  previewTool("apexcn_topic_delete_preview", "topic.delete", "Preview topic deletion", ["topicId", "confirmTitle"]),
  previewTool("apexcn_reply_create_preview", "reply.create", "Preview reply creation", ["topicId", "content"]),
  previewTool("apexcn_reply_update_preview", "reply.update", "Preview reply update", ["replyId", "content"]),
  previewTool("apexcn_reply_delete_preview", "reply.delete", "Preview reply deletion", ["replyId", "confirmId"]),
  previewTool("apexcn_favorite_add_preview", "favorite.add", "Preview favorite add", ["topicId"]),
  previewTool("apexcn_favorite_remove_preview", "favorite.remove", "Preview favorite removal", ["topicId"]),
  previewTool("apexcn_subscription_add_preview", "subscription.add", "Preview subscription add", ["topicId"]),
  previewTool("apexcn_subscription_remove_preview", "subscription.remove", "Preview subscription removal", ["topicId"])
];

export function mcpPolicy(allowPreviewWrite = false): McpPolicy {
  return {
    mode: allowPreviewWrite ? "preview-write" : "readonly",
    transport: "stdio",
    allowPreviewWrite,
    allowExecuteWrite: false
  };
}

export function mcpTools(policy: McpPolicy): McpToolDefinition[] {
  return policy.allowPreviewWrite ? [...READONLY_TOOLS, ...PREVIEW_TOOLS] : [...READONLY_TOOLS];
}

export function allMcpTools(): McpToolDefinition[] {
  return [...READONLY_TOOLS, ...PREVIEW_TOOLS];
}

export function mcpToolByName(name: string): McpToolDefinition | undefined {
  return allMcpTools().find((tool) => tool.name === name);
}

export function mcpToolManifest(policy: McpPolicy): Record<string, unknown> {
  return {
    kind: "mcp-tools",
    schemaVersion: 1,
    policy,
    tools: mcpTools(policy).map((tool) => ({
      name: tool.name,
      description: tool.description,
      exposure: tool.exposure,
      commandId: tool.commandId,
      inputSchema: tool.inputSchema
    }))
  };
}

export function assertMcpCommandRegistryCoverage(): boolean {
  return sameIds(READONLY_TOOLS, mcpReadonlyDescriptors())
    && sameIds(PREVIEW_TOOLS, mcpPreviewDescriptors());
}

function sameIds(tools: McpToolDefinition[], descriptors: CommandDescriptor[]): boolean {
  const toolIds = tools.map((tool) => tool.commandId);
  const descriptorIds = descriptors.map((descriptor) => descriptor.id);
  return new Set(toolIds).size === toolIds.length
    && new Set(descriptorIds).size === descriptorIds.length
    && toolIds.length === descriptorIds.length
    && toolIds.every((id) => descriptorIds.includes(id));
}

function topicListInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      pageSize: { type: "number" },
      categoryId: { type: "number" },
      cursor: { type: "string" },
      offset: { type: "number" },
      from: { type: "string" },
      to: { type: "string" },
      tag: { type: "string" },
      tags: { type: "string" },
      author: { type: "string" },
      authorId: { type: "number" },
      sourceDomain: { type: "string" },
      originalUrl: { type: "string" },
      contentType: { type: "string" },
      sourceType: { type: "string" },
      status: { type: "string" },
      view: { type: "string" },
      sort: { type: "string" },
      featured: { type: "boolean" },
      pinned: { type: "boolean" },
      locked: { type: "boolean" },
      unanswered: { type: "boolean" },
      hasUsefulReply: { type: "boolean" }
    }
  };
}

function readonlyTool(name: string, commandId: string, fallbackDescription: string, inputSchema: Record<string, unknown>): McpToolDefinition {
  return tool(name, commandId, fallbackDescription, "readonly", inputSchema);
}

function previewTool(name: string, commandId: string, fallbackDescription: string, required: string[]): McpToolDefinition {
  return tool(name, commandId, fallbackDescription, "preview-only", {
    type: "object",
    properties: {
      topicId: { type: "number" },
      replyId: { type: "number" },
      title: { type: "string" },
      content: { type: "string" },
      categoryId: { type: "number" },
      confirmTitle: { type: "string" },
      confirmId: { type: "number" }
    },
    required
  });
}

function tool(name: string, commandId: string, fallbackDescription: string, exposure: McpToolExposure, inputSchema: Record<string, unknown>): McpToolDefinition {
  const descriptor = descriptorById(commandId);
  return {
    name,
    description: descriptor?.summary ?? fallbackDescription,
    exposure,
    commandId,
    inputSchema: {
      additionalProperties: false,
      ...inputSchema
    }
  };
}

function descriptorById(id: string): CommandDescriptor | undefined {
  return [...mcpReadonlyDescriptors(), ...mcpPreviewDescriptors()].find((descriptor) => descriptor.id === id);
}
