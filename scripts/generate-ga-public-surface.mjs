#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutput = join(repoRoot, "qualification/ga/public-surface-v2.json");

export async function buildGaPublicSurface() {
  const manifest = JSON.parse(execFileSync(process.execPath, [join(repoRoot, "dist/index.js"), "commands", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
  const schemas = await import(pathToFileURL(join(repoRoot, "dist/schemas/registry.js")).href);
  const workflows = await import(pathToFileURL(join(repoRoot, "dist/core/workflow-plan.js")).href);

  return {
    kind: "apexcn-ga-public-surface",
    schemaVersion: 1,
    frozenForVersion: "1.0.10",
    baselineVersion: "1.0.9",
    compatibilityPolicy: {
      releaseLine: "1.x",
      backwardCompatibleChanges: [
        "add optional JSON properties",
        "add documentation",
        "fix behavior without changing documented inputs or outputs"
      ],
      breakingChanges: [
        "remove or rename a public command, alias, or option",
        "remove a JSON property or change its type without a schema version change",
        "add a required JSON property without a schema version change",
        "weaken preview, approval, confirmation, ownership, or version binding",
        "change an existing API path, HTTP method, or identity meaning"
      ],
      milestoneNonGoals: [
        "new public command families",
        "unqualified storage or transport layers",
        "MCP",
        "changes to App 100 page 100 or its existing RAG implementation"
      ]
    },
    commandManifest: {
      schemaVersion: manifest.schemaVersion,
      manifestVersion: manifest.manifestVersion,
      product: manifest.product,
      commands: manifest.commands
    },
    jsonSchemas: schemas.publicSchemaBundle(),
    workflowGoals: [...workflows.WORKFLOW_GOALS],
    api: {
      basePath: "/api/v1",
      observedRouteTemplates: observedApiRoutes(),
      supportedOperations: SUPPORTED_API_OPERATIONS
    }
  };
}

export const SUPPORTED_API_OPERATIONS = [
  operation("GET", "/api/v1/admin-list", "admin.list"),
  operation("POST", "/api/v1/ask", "ask"),
  operation("GET", "/api/v1/capabilities", "me.capabilities"),
  operation("GET", "/api/v1/categories", "category.list"),
  operation("GET", "/api/v1/category-stats", "stats.category"),
  operation("GET", "/api/v1/community/rules", "me.rules"),
  operation("GET", "/api/v1/inbox", "me.inbox"),
  operation("GET", "/api/v1/me", "me"),
  operation("GET", "/api/v1/me/favorites", "me.favorites"),
  operation("GET", "/api/v1/me/favorites/export", "collection.favorites"),
  operation("GET", "/api/v1/me/replies", "me.replies"),
  operation("GET", "/api/v1/me/search", "me.search"),
  operation("GET", "/api/v1/me/stats", "me.stats"),
  operation("GET", "/api/v1/me/subscriptions", "me.subscriptions"),
  operation("GET", "/api/v1/me/topics", "me.topics"),
  operation("GET", "/api/v1/notifications", "me.notifications"),
  operation("GET", "/api/v1/privacy-policy", "me.privacy"),
  operation("GET", "/api/v1/search", "search"),
  operation("GET", "/api/v1/tag-stats", "stats.tag"),
  operation("GET", "/api/v1/topic-stats", "stats.topic"),
  operation("GET", "/api/v1/topics", "topic.list"),
  operation("POST", "/api/v1/topics", "topic.create"),
  operation("GET", "/api/v1/topics/{topicId}", "topic.view"),
  operation("POST", "/api/v1/topics/{topicId}", "topic.update"),
  operation("DELETE", "/api/v1/topics/{topicId}", "topic.delete"),
  operation("POST", "/api/v1/topics/{topicId}/replies", "reply.create"),
  operation("GET", "/api/v1/topics/{topicId}/visual", "topic.view"),
  operation("POST", "/api/v1/replies/{replyId}", "reply.update"),
  operation("DELETE", "/api/v1/replies/{replyId}", "reply.delete"),
  operation("POST", "/api/v1/topics/{topicId}/replies/{replyId}/correct-answer", "reply.mark-answer"),
  operation("DELETE", "/api/v1/topics/{topicId}/replies/{replyId}/correct-answer", "reply.unmark-answer"),
  operation("POST", "/api/v1/replies/{replyId}/favorite", "favorite.add"),
  operation("DELETE", "/api/v1/replies/{replyId}/favorite", "favorite.remove"),
  operation("POST", "/api/v1/topics/{topicId}/favorite", "favorite.add"),
  operation("DELETE", "/api/v1/topics/{topicId}/favorite", "favorite.remove"),
  operation("POST", "/api/v1/topics/{topicId}/subscription", "subscription.add"),
  operation("DELETE", "/api/v1/topics/{topicId}/subscription", "subscription.remove")
];

function operation(method, path, commandId) {
  return { method, path, commandId };
}

function observedApiRoutes() {
  const files = sourceFiles(join(repoRoot, "src"));
  const routes = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\/api\/v1(?:[A-Za-z0-9._~:/?{}-]|\$\{[^}]+\})+/g)) {
      routes.add(normalizeRoute(match[0]));
    }
  }
  return [...routes].sort();
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function normalizeRoute(value) {
  const withoutQuery = value.split("?")[0];
  const segments = withoutQuery.split("/");
  return segments.map((segment, index) => {
    if (!segment.startsWith("${")) return segment;
    const previous = segments[index - 1];
    if (previous === "topics") return "{topicId}";
    if (previous === "replies") return "{replyId}";
    if (segment.includes("name")) return "{relation}";
    return "{id}";
  }).join("/");
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? resolve(args[outputIndex + 1]) : defaultOutput;
  if (outputIndex >= 0 && !args[outputIndex + 1]) {
    throw new Error("Missing --output value");
  }
  if (args.length !== 0 && !(args.length === 2 && outputIndex === 0)) {
    throw new Error("Usage: node scripts/generate-ga-public-surface.mjs [--output <path>]");
  }
  const surface = await buildGaPublicSurface();
  writeFileSync(output, `${JSON.stringify(surface, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  process.stdout.write(`${JSON.stringify({
    kind: surface.kind,
    schemaVersion: surface.schemaVersion,
    output: relative(repoRoot, output),
    commandCount: surface.commandManifest.commands.length,
    schemaCount: Object.keys(surface.jsonSchemas).length,
    workflowGoalCount: surface.workflowGoals.length,
    apiOperationCount: surface.api.supportedOperations.length
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
