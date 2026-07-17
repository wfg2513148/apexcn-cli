export type CommandCapability = "read" | "write" | "local" | "workflow" | "auth" | "diagnostic";
export type CommandApiEffect = "no-network" | "api-read" | "api-write" | "destructive";
export type CommandRiskLevel = "low" | "medium" | "high" | "destructive";
export type McpExposure = "none" | "readonly" | "preview-only" | "blocked";

export type JsonContractDescriptor = {
  successSchemaId: string;
  errorSchemaId: "apexcn-error-v1";
  testFile: string;
};

export type CommandDescriptor = {
  id: string;
  path: string[];
  aliases?: string[];
  summary: string;
  capability: CommandCapability;
  apiEffect: CommandApiEffect;
  riskLevel: CommandRiskLevel;
  authRequired: boolean;
  supportsJson: boolean;
  supportsPreview: boolean;
  supportsDryRun: boolean;
  mcpExposure: McpExposure;
  jsonContract: JsonContractDescriptor | null;
  examples: Array<{
    description: string;
    command: string;
    mode: "text" | "json" | "preview" | "dry-run" | "execute";
  }>;
};

const READONLY_MCP = new Set([
  "ask",
  "category.list",
  "doctor.snapshot",
  "research",
  "search",
  "topic.list",
  "topic.recent",
  "topic.view",
  "workflow.plan"
]);

const PREVIEW_MCP = new Set([
  "favorite.add",
  "favorite.remove",
  "reply.create",
  "reply.delete",
  "reply.update",
  "subscription.add",
  "subscription.remove",
  "topic.create",
  "topic.delete",
  "topic.update"
]);

export const COMMAND_DESCRIPTORS: CommandDescriptor[] = [
  descriptor("admin.list", ["admin", "list"], "List public community admins", "read", "api-read", "low", true, "readonly", "apexcn admin list --json"),
  descriptor("ask", ["ask"], "Ask community RAG or scoped references", "read", "api-read", "medium", true, "readonly", 'apexcn ask "问题" --top-k 3 --json'),
  descriptor("auth.audit", ["auth", "audit"], "Audit local auth profile configuration", "auth", "no-network", "medium", false, "none", "apexcn auth audit --json"),
  descriptor("auth.list", ["auth", "list"], "List local auth profiles", "auth", "no-network", "medium", false, "none", "apexcn auth list --json"),
  descriptor("auth.logout", ["auth", "logout"], "Clear active auth profile", "auth", "no-network", "medium", false, "blocked", "apexcn auth logout", false, false, false),
  descriptor("auth.remove", ["auth", "remove"], "Remove an auth profile", "auth", "no-network", "high", false, "blocked", "apexcn auth remove old-profile", false, false, false),
  descriptor("auth.set-token", ["auth", "set-token"], "Save an API token profile", "auth", "no-network", "high", false, "blocked", "apexcn auth set-token --profile agent-prod --token \"$APEXCN_API_KEY\"", false, false, false),
  descriptor("auth.show", ["auth", "show"], "Show active auth profile with redacted token", "auth", "no-network", "medium", false, "none", "apexcn auth show --json"),
  descriptor("auth.use", ["auth", "use"], "Switch active auth profile", "auth", "no-network", "medium", false, "blocked", "apexcn auth use agent-prod", false, false, false),
  descriptor("category.list", ["category", "list"], "List community categories", "read", "api-read", "low", true, "readonly", "apexcn category list --json"),
  descriptor("collection.build", ["collection", "build"], "Build a local collection", "read", "api-read", "medium", true, "none", 'apexcn collection build --query "REST API" --output-dir ./collection --json'),
  descriptor("collection.index", ["collection", "index"], "Build a local collection search index", "local", "no-network", "low", false, "none", "apexcn collection index --dir ./collection --json"),
  descriptor("collection.query", ["collection", "query"], "Query a local collection index", "local", "no-network", "low", false, "none", 'apexcn collection query --dir ./collection "ORDS 401" --json'),
  descriptor("collection.stats", ["collection", "stats"], "Show local collection index stats", "local", "no-network", "low", false, "none", "apexcn collection stats --dir ./collection --json"),
  descriptor("collection.verify", ["collection", "verify"], "Verify a local collection", "local", "no-network", "low", false, "none", "apexcn collection verify --dir ./collection --json"),
  descriptor("commands", ["commands"], "Print command manifest", "local", "no-network", "low", false, "none", "apexcn commands --json"),
  descriptor("doctor", ["doctor"], "Check installation, auth, and API reachability", "diagnostic", "api-read", "medium", true, "none", "apexcn doctor --json"),
  descriptor("doctor.snapshot", ["doctor", "snapshot"], "Print local support snapshot", "diagnostic", "no-network", "medium", false, "readonly", "apexcn doctor snapshot --json"),
  descriptor("draft.question", ["draft", "question"], "Draft a local question", "local", "no-network", "low", false, "none", "apexcn draft question --title 标题 --problem 问题 --json"),
  descriptor("draft.reply", ["draft", "reply"], "Draft a local reply", "local", "no-network", "low", false, "none", "apexcn draft reply --topic-id 1 --answer 回复 --json"),
  descriptor("favorite.add", ["favorite", "add"], "Preview or add favorite", "write", "api-write", "medium", true, "preview-only", "apexcn favorite add 1 --preview", true, true),
  descriptor("favorite.remove", ["favorite", "remove"], "Preview or remove favorite", "write", "api-write", "medium", true, "preview-only", "apexcn favorite remove 1 --preview", true, true),
  descriptor("guide", ["guide"], "Show a curated novice task guide", "local", "no-network", "low", false, "none", "apexcn guide learning --json"),
  descriptor("me", ["me"], "Show current account", "read", "api-read", "low", true, "none", "apexcn me --json"),
  descriptor("me.favorites", ["me", "favorites"], "List current user's favorites", "read", "api-read", "low", true, "none", "apexcn me favorites --json"),
  descriptor("me.replies", ["me", "replies"], "List current user's replies", "read", "api-read", "low", true, "none", "apexcn me replies --json"),
  descriptor("me.stats", ["me", "stats"], "Show current user's stats", "read", "api-read", "low", true, "none", "apexcn me stats --json"),
  descriptor("me.subscriptions", ["me", "subscriptions"], "List current user's subscriptions", "read", "api-read", "low", true, "none", "apexcn me subscriptions --json"),
  descriptor("me.topics", ["me", "topics"], "List current user's topics", "read", "api-read", "low", true, "none", "apexcn me topics --json"),
  descriptor("mcp.inspect", ["mcp", "inspect"], "Inspect local MCP configuration and safety policy", "local", "no-network", "low", false, "none", "apexcn mcp inspect --json"),
  descriptor("mcp.serve", ["mcp", "serve"], "Serve local stdio MCP tools", "local", "no-network", "medium", false, "none", "apexcn mcp serve --readonly", false, false, false),
  descriptor("mcp.tools", ["mcp", "tools"], "List MCP tool manifest", "local", "no-network", "low", false, "none", "apexcn mcp tools --json"),
  descriptor("reply.create", ["reply", "create"], "Preview or create reply", "write", "api-write", "high", true, "preview-only", "apexcn reply create 1 --content 回复 --preview", true, true),
  descriptor("reply.delete", ["reply", "delete"], "Preview or delete reply", "write", "destructive", "destructive", true, "preview-only", "apexcn reply delete 2 --yes --force --preview", true, true),
  descriptor("reply.update", ["reply", "update"], "Preview or update reply", "write", "api-write", "high", true, "preview-only", "apexcn reply update 2 --content 更新 --preview", true, true),
  descriptor("research", ["research"], "Build a research bundle", "read", "api-read", "medium", true, "readonly", 'apexcn research "REST API" --json'),
  descriptor("review.reply", ["review", "reply"], "Review local reply draft", "local", "no-network", "low", false, "none", "apexcn review reply --topic-id 1 --content-file reply.md --json"),
  descriptor("review.topic", ["review", "topic"], "Review local topic draft", "local", "no-network", "low", false, "none", "apexcn review topic --title 标题 --content-file post.md --json"),
  descriptor("search", ["search"], "Search community topics", "read", "api-read", "low", true, "readonly", 'apexcn search "APEX" --json'),
  descriptor("stats.category", ["stats", "category"], "Read category stats", "read", "api-read", "low", true, "none", "apexcn stats category --json"),
  descriptor("stats.tag", ["stats", "tag"], "Read tag stats", "read", "api-read", "low", true, "none", "apexcn stats tag --json"),
  descriptor("stats.topic", ["stats", "topic"], "Read topic stats", "read", "api-read", "low", true, "none", "apexcn stats topic --json"),
  descriptor("subscription.add", ["subscription", "add"], "Preview or subscribe", "write", "api-write", "medium", true, "preview-only", "apexcn subscription add 1 --preview", true, true),
  descriptor("subscription.remove", ["subscription", "remove"], "Preview or unsubscribe", "write", "api-write", "medium", true, "preview-only", "apexcn subscription remove 1 --preview", true, true),
  descriptor("topic.create", ["topic", "create"], "Preview or create topic", "write", "api-write", "high", true, "preview-only", "apexcn topic create --category-id 1 --title 标题 --content 正文 --preview", true, true),
  descriptor("topic.delete", ["topic", "delete"], "Preview or delete topic", "write", "destructive", "destructive", true, "preview-only", "apexcn topic delete 1 --yes --force --confirm-title 标题 --preview", true, true),
  descriptor("topic.list", ["topic", "list"], "List topics with filters", "read", "api-read", "low", true, "readonly", "apexcn topic list --view unanswered --json"),
  descriptor("topic.recent", ["topic", "recent"], "List recent topics", "read", "api-read", "low", true, "readonly", "apexcn topic recent --json"),
  descriptor("topic.update", ["topic", "update"], "Preview or update topic", "write", "api-write", "high", true, "preview-only", "apexcn topic update 1 --content 正文 --preview", true, true),
  descriptor("topic.view", ["topic", "view"], "View topic detail", "read", "api-read", "low", true, "readonly", "apexcn topic view 1 --json"),
  descriptor("workflow.approve", ["workflow", "approve"], "Approve workflow preview", "workflow", "no-network", "high", false, "blocked", "apexcn workflow approve --run-dir ./run --json"),
  descriptor("workflow.audit-log", ["workflow", "audit-log"], "Print workflow audit log", "workflow", "no-network", "medium", false, "none", "apexcn workflow audit-log --run-dir ./run --format ndjson"),
  descriptor("workflow.diff", ["workflow", "diff"], "Diff workflow preview and approval", "workflow", "no-network", "medium", false, "none", "apexcn workflow diff --run-dir ./run --json"),
  descriptor("workflow.export", ["workflow", "export"], "Export workflow evidence", "workflow", "no-network", "medium", false, "none", "apexcn workflow export --run-dir ./run --output bundle.json --json"),
  descriptor("workflow.policy.init", ["workflow", "policy", "init"], "Create a workflow policy template", "workflow", "no-network", "low", false, "none", "apexcn workflow policy init --output apexcn-policy.json --json"),
  descriptor("workflow.plan", ["workflow", "plan"], "Plan a workflow", "workflow", "no-network", "medium", false, "readonly", "apexcn workflow plan --goal ask-question --json"),
  descriptor("workflow.run", ["workflow", "run"], "Run or execute approved workflow", "workflow", "api-write", "high", true, "blocked", "apexcn workflow run --goal ask-question --json"),
  descriptor("workflow.verify", ["workflow", "verify"], "Verify workflow artifacts", "workflow", "no-network", "medium", false, "none", "apexcn workflow verify --run-dir ./run --json"),
  descriptor("workflow.verify-bundle", ["workflow", "verify-bundle"], "Verify workflow bundle", "workflow", "no-network", "medium", false, "none", "apexcn workflow verify-bundle --bundle bundle.json --json")
];

export function descriptorForPath(path: string): CommandDescriptor | undefined {
  return COMMAND_DESCRIPTORS.find((item) => item.path.join(" ") === path || item.id === path.split(" ").join("."));
}

export function mcpReadonlyDescriptors(): CommandDescriptor[] {
  return COMMAND_DESCRIPTORS.filter((item) => READONLY_MCP.has(item.id));
}

export function mcpPreviewDescriptors(): CommandDescriptor[] {
  return COMMAND_DESCRIPTORS.filter((item) => PREVIEW_MCP.has(item.id));
}

function descriptor(
  id: string,
  path: string[],
  summary: string,
  capability: CommandCapability,
  apiEffect: CommandApiEffect,
  riskLevel: CommandRiskLevel,
  authRequired: boolean,
  mcpExposure: McpExposure,
  command: string,
  supportsPreview = false,
  supportsDryRun = false,
  supportsJson = true
): CommandDescriptor {
  return {
    id,
    path,
    summary,
    capability,
    apiEffect,
    riskLevel,
    authRequired,
    supportsJson,
    supportsPreview,
    supportsDryRun,
    mcpExposure,
    jsonContract: supportsJson ? jsonContractFor(id) : null,
    examples: [{ description: summary, command, mode: supportsPreview ? "preview" : supportsJson ? "json" : "text" }]
  };
}

function jsonContractFor(id: string): JsonContractDescriptor {
  const testFile = contractTestFile(id);
  if (id === "commands") return contract("command-manifest-v2", testFile);
  if (id === "ask") return contract("ask-response-v1", testFile);
  if (id === "research") return contract("research-bundle-v1", testFile);
  if (id === "search") return contract("search-response-v1", testFile);
  if (id === "topic.view") return contract("topic-response-v1", testFile);
  if (id === "doctor.snapshot") return contract("doctor-snapshot-v1", testFile);
  if (id === "guide") return contract("novice-guide-v1", testFile);
  if (id === "mcp.tools") return contract("mcp-tools-v1", testFile);
  if (id === "workflow.plan") return contract("workflow-plan-v1", testFile);
  if (id === "collection.query") return contract("collection-query-v1", testFile);
  return contract("public-json-object-v1", testFile);
}

function contract(successSchemaId: string, testFile: string): JsonContractDescriptor {
  return { successSchemaId, errorSchemaId: "apexcn-error-v1", testFile };
}

function contractTestFile(id: string): string {
  if (id === "commands") return "test/contract/command-manifest.contract.test.ts";
  if (id.startsWith("auth.")) return "test/auth.test.ts";
  if (id.startsWith("collection.")) return "test/collection.test.ts";
  if (id.startsWith("doctor")) return "test/doctor.test.ts";
  if (id.startsWith("draft.")) return "test/draft.test.ts";
  if (id === "guide") return "test/guide.test.ts";
  if (id === "me" || id.startsWith("me.")) return "test/me.test.ts";
  if (id.startsWith("mcp.")) return "test/mcp/mcp-cli.test.ts";
  if (id.startsWith("review.")) return "test/review.test.ts";
  if (id.startsWith("workflow.")) return "test/workflow.test.ts";
  return "test/content.test.ts";
}
