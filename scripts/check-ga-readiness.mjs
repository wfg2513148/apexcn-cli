#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGaPublicSurface } from "./generate-ga-public-surface.mjs";
import { buildGaQualificationTasks } from "./generate-ga-qualification-dataset.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const problems = [];
const evidence = [];

const roadmap = readJson("roadmap.json");
const issues = readJson("issues.json");
const frozenSurface = readJson("qualification/ga/public-surface-v1.json");
const supportMatrix = readJson("qualification/ga/support-matrix-v1.json");
const qualificationContract = readJson("qualification/ga/qualification-contract-v1.json");
const frozenTasks = readJsonLines("eval/qualification/tasks.v1.jsonl");

const generatedSurface = await buildGaPublicSurface();
if (canonical(frozenSurface) !== canonical(generatedSurface)) {
  problems.push("public surface drifted; regenerate only after an explicit compatibility decision");
}
validateSurface(frozenSurface);
validateSupportMatrix(supportMatrix);
await validateQualification(frozenSurface, qualificationContract, frozenTasks);
validateRoadmapState(roadmap, issues);
validateMcpRemoval();
validateRagIsolation();

if (args.online) {
  validatePublishedSourcesOnline(supportMatrix);
}
if (args.supplyChainDir) {
  validateSupplyChain(args.supplyChainDir);
}

const report = {
  kind: "apexcn-ga-activation-readiness-audit",
  schemaVersion: 1,
  ok: problems.length === 0,
  auditedAt: new Date().toISOString(),
  targetVersion: "1.0.9",
  repository: {
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    dirty: git(["status", "--porcelain=v1", "--untracked-files=all"]).length > 0
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch
  },
  counts: {
    publicCommands: frozenSurface.commandManifest.commands.length,
    publicJsonSchemas: Object.keys(frozenSurface.jsonSchemas).length,
    workflowGoals: frozenSurface.workflowGoals.length,
    apiOperations: frozenSurface.api.supportedOperations.length,
    supportedSourceVersions: supportMatrix.supportedSources.length,
    platformCells: supportMatrix.supportedSources.length * supportMatrix.platforms.length,
    qualificationTasks: frozenTasks.length
  },
  inputs: {
    publicSurfaceSha256: sha256("qualification/ga/public-surface-v1.json"),
    supportMatrixSha256: sha256("qualification/ga/support-matrix-v1.json"),
    qualificationContractSha256: sha256("qualification/ga/qualification-contract-v1.json"),
    qualificationDatasetSha256: sha256("eval/qualification/tasks.v1.jsonl")
  },
  checks: {
    onlineReleaseBaseline: args.online,
    supplyChainSmoke: Boolean(args.supplyChainDir)
  },
  evidence,
  problems
};

const text = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) writeFileSync(resolve(args.output), text, { encoding: "utf8", mode: 0o600 });
process.stdout.write(text);
if (problems.length > 0) process.exitCode = 1;

function validateSurface(surface) {
  const problemCountBefore = problems.length;
  if (surface.kind !== "apexcn-ga-public-surface"
    || surface.frozenForVersion !== "1.0.9"
    || surface.baselineVersion !== "1.0.8") {
    problems.push("public surface identity or target version is invalid");
  }
  const commands = surface.commandManifest?.commands ?? [];
  const commandIds = new Set(commands.map((command) => command.id));
  if (commandIds.size !== commands.length) problems.push("public surface has duplicate command ids");
  if (commands.length === 0 || Object.keys(surface.jsonSchemas ?? {}).length === 0) {
    problems.push("public command or JSON Schema denominator is empty");
  }
  const observedRoutes = new Set(surface.api?.observedRouteTemplates ?? []);
  for (const operation of surface.api?.supportedOperations ?? []) {
    if (!["GET", "POST", "DELETE"].includes(operation.method)) {
      problems.push(`unsupported HTTP method in public API inventory: ${operation.method}`);
    }
    if (!commandIds.has(operation.commandId)) {
      problems.push(`API operation references unknown command ${operation.commandId}`);
    }
    const normalized = operation.path.replace(/\/(favorite|subscription)$/, "/{relation}");
    if (!observedRoutes.has(operation.path) && !observedRoutes.has(normalized)) {
      problems.push(`API operation is not observed in source: ${operation.method} ${operation.path}`);
    }
  }
  const operationRoutes = new Set((surface.api?.supportedOperations ?? []).flatMap((operation) => [
    operation.path,
    operation.path.replace(/\/(favorite|subscription)$/, "/{relation}")
  ]));
  for (const route of observedRoutes) {
    if (!operationRoutes.has(route)) problems.push(`observed API route is absent from the supported inventory: ${route}`);
  }
  evidence.push({
    id: "M090-ACT-FREEZE",
    kind: "generated-contract-comparison",
    result: problems.length === problemCountBefore ? "pass" : "fail"
  });
}

function validateSupportMatrix(matrix) {
  if (matrix.targetVersion !== "1.0.9") problems.push("support matrix target must be 1.0.9");
  const versions = matrix.supportedSources?.map((source) => source.version) ?? [];
  const expected = ["1.0.0", "1.0.2", "1.0.3", "1.0.4", "1.0.5", "1.0.6", "1.0.7", "1.0.8"];
  if (canonical(versions) !== canonical(expected)) problems.push("supported stable 1.x source list drifted");
  const cells = versions.length * (matrix.platforms?.length ?? 0);
  if (cells !== matrix.expectedMatrixCells) problems.push(`support matrix expected ${matrix.expectedMatrixCells} cells but defines ${cells}`);
  if ((matrix.requiredStages ?? []).length !== 5) problems.push("support matrix must define the five lifecycle stages");
  if (matrix.environmentContract?.realUserHomeMutationAllowed !== false || matrix.environmentContract?.productionWriteAllowed !== false) {
    problems.push("support matrix isolation boundary is unsafe");
  }
  for (const source of matrix.supportedSources ?? []) {
    if (!/^[0-9a-f]{40}$/.test(source.commit) || !/^[0-9a-f]{64}$/.test(source.packageSha256)) {
      problems.push(`support source ${source.version} has invalid commit or package digest`);
    }
  }
}

async function validateQualification(surface, contract, tasks) {
  const problemCountBefore = problems.length;
  if (contract.targetVersion !== "1.0.9") problems.push("qualification contract target must be 1.0.9");
  if (contract.activationSmokeBaseline?.version !== "1.0.8"
    || contract.activationSmokeBaseline?.packageSha256 !== "524a818cc44ec520274cc5700d4caca80a8373d7cea0248f90b42f8c5a2726fa") {
    problems.push("qualification activation smoke baseline must bind public v1.0.8");
  }
  if (tasks.length < contract.naturalLanguageQualification.minimumTasks) {
    problems.push("qualification dataset has fewer than 200 tasks");
  }
  const taskIds = new Set();
  const prompts = new Set();
  const coveredCommands = new Set();
  const roleCounts = new Map();
  for (const task of tasks) {
    if (taskIds.has(task.taskId)) problems.push(`duplicate qualification task ${task.taskId}`);
    taskIds.add(task.taskId);
    if (prompts.has(task.prompt)) problems.push(`duplicate qualification prompt ${task.taskId}`);
    prompts.add(task.prompt);
    if (task.datasetVersion !== contract.naturalLanguageQualification.datasetVersion) {
      problems.push(`qualification dataset version mismatch in ${task.taskId}`);
    }
    roleCounts.set(task.role, (roleCounts.get(task.role) ?? 0) + 1);
    for (const commandId of task.expectedPublicCommandIds ?? []) coveredCommands.add(commandId);
  }
  for (const role of contract.naturalLanguageQualification.requiredRoles) {
    if (!roleCounts.has(role)) problems.push(`qualification role is missing: ${role}`);
  }
  for (const command of surface.commandManifest.commands) {
    if (!coveredCommands.has(command.id)) problems.push(`qualification dataset does not cover public command ${command.id}`);
  }
  const generatedTasks = await buildGaQualificationTasks();
  if (canonical(generatedTasks) !== canonical(tasks)) {
    problems.push("qualification dataset drifted from its deterministic generator");
  }
  if (contract.isolatedWrite?.productionWriteAllowed !== false || contract.isolatedWrite?.inAppBrowserAllowed !== false) {
    problems.push("isolated write contract must forbid production writes and the in-app browser");
  }
  if (contract.securityReview?.independentTaskRequired !== true || contract.securityReview?.completionGate?.waiverAllowed !== false) {
    problems.push("security review independence or no-waiver gate is missing");
  }
  evidence.push({
    id: "M090-ACT-QUALIFICATION-CONTRACT",
    kind: "dataset-and-scorer-contract",
    tasks: tasks.length,
    roles: Object.fromEntries([...roleCounts.entries()].sort()),
    result: problems.length === problemCountBefore ? "pass" : "fail"
  });
}

function validateRoadmapState(currentRoadmap, currentIssues) {
  const milestone = currentRoadmap.milestones.find((item) => item.id === "0.9");
  const risks = currentRoadmap.readinessRisks.filter((risk) => risk.milestoneId === "0.9" && risk.blockingAt === "activation");
  const dependency = currentRoadmap.dependencyRegistry.find((item) => item.id === "external:qualification-infrastructure");
  if (milestone?.status === "planned") {
    if (milestone.activationGate?.status !== "waiting") problems.push("planned 0.9 must remain waiting");
  } else if (milestone?.status === "in_progress" || milestone?.status === "completed") {
    if (milestone.activationGate?.status !== "approved") problems.push("active 0.9 must have an approved activation gate");
    if (risks.some((risk) => risk.status !== "mitigated")) problems.push("active 0.9 has unmitigated activation risks");
    if (dependency?.status !== "ready") problems.push("active 0.9 has an unready qualification infrastructure dependency");
  } else {
    problems.push(`unexpected 0.9 status ${String(milestone?.status)}`);
  }
  if ((currentIssues.issues ?? []).length !== 0 || (currentIssues.enhancementRequests ?? []).length !== 0) {
    problems.push("readiness baseline expected empty issues and enhancement requests");
  }
}

function validateMcpRemoval() {
  const mcpPath = join(repoRoot, "src/mcp");
  if (existsSync(mcpPath) && readdirSync(mcpPath).length > 0) problems.push("src/mcp contains files");
  const packageJson = readJson("package.json");
  if (Object.keys(packageJson.dependencies ?? {}).some((name) => name.toLowerCase().includes("mcp"))) {
    problems.push("package dependencies include MCP");
  }
}

function validateRagIsolation() {
  const source = readFileSync(join(repoRoot, "src/commands/content.ts"), "utf8");
  const test = readFileSync(join(repoRoot, "test/rag.test.ts"), "utf8");
  if (!source.includes('endpoints: ["/api/v1/search", "/api/v1/topics/{topicId}"]')) {
    problems.push("rag retrieve endpoint isolation declaration drifted");
  }
  if (!test.includes("/api/v1/ask")) problems.push("rag endpoint isolation test no longer references the forbidden ask endpoint");
}

function validatePublishedSourcesOnline(matrix) {
  const problemCountBefore = problems.length;
  for (const source of matrix.supportedSources) {
    const release = JSON.parse(execFileSync("gh", ["release", "view", source.tag, "--json", "assets,isDraft,isPrerelease,url"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }));
    const asset = release.assets.find((item) => item.name === "apexcn-cli.tgz");
    const digest = typeof asset?.digest === "string" ? asset.digest.replace(/^sha256:/, "") : undefined;
    if (release.isDraft || release.isPrerelease) problems.push(`${source.tag} is not a stable Release`);
    if (digest !== source.packageSha256) problems.push(`${source.tag} package digest drifted`);
    const tagCommit = git(["rev-list", "-n", "1", source.tag]);
    if (tagCommit !== source.commit) problems.push(`${source.tag} commit drifted`);
  }
  evidence.push({
    id: "M090-ACT-RELEASE-BASELINE",
    kind: "live-github-release-audit",
    releases: matrix.supportedSources.length,
    result: problems.length === problemCountBefore ? "pass" : "fail"
  });
}

function validateSupplyChain(dir) {
  try {
    const output = execFileSync(process.execPath, ["scripts/verify-release-supply-chain.mjs", resolve(dir)], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const result = JSON.parse(output);
    evidence.push({
      id: "M090-ACT-SUPPLY-SMOKE",
      kind: result.kind,
      sourceCommit: result.sourceCommit,
      sourceTreeDirty: result.sourceTreeDirty,
      verifiedChecksumAssets: result.verifiedChecksumAssets,
      verifiedProvenanceSubjects: result.verifiedProvenanceSubjects,
      result: "pass"
    });
  } catch (error) {
    problems.push(`supply-chain smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs(values) {
  const parsed = { online: false };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--online") parsed.online = true;
    else if (values[index] === "--supply-chain-dir") parsed.supplyChainDir = values[++index];
    else if (values[index] === "--output") parsed.output = values[++index];
    else throw new Error(`Unknown option: ${values[index]}`);
  }
  return parsed;
}

function git(values) {
  return execFileSync("git", values, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(join(repoRoot, path))).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function readJsonLines(path) {
  return readFileSync(join(repoRoot, path), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
