import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { blockText, fieldText, isRecord, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type WorkflowCommandOptions = CommandIo & {
  configPath?: string;
};

type WorkflowGoal = "ask-question" | "reply" | "research-only" | "publish-topic";
type WorkflowRunGoal = "ask-question" | "reply";
type WorkflowStepMode = "local" | "api-read" | "api-write-preview" | "api-write-execute";

type WorkflowPlanOptions = FormatOption & {
  goal: WorkflowGoal;
  keyword?: string;
  topicId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  contentFile?: string;
  outputDir?: string;
  includeExecute?: boolean;
};

type WorkflowRunOptions = FormatOption & {
  goal?: WorkflowRunGoal;
  resume?: string;
  keyword?: string;
  topicId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  outputDir?: string;
  execute?: boolean;
  yes?: boolean;
};

type WorkflowApproveOptions = {
  runDir: string;
  approvedBy?: string;
  note?: string;
  json?: boolean;
};

type WorkflowVerifyOptions = {
  runDir: string;
  writeReport?: boolean;
  json?: boolean;
};

type WorkflowExportOptions = {
  runDir: string;
  output: string;
  allowInvalid?: boolean;
  json?: boolean;
};

type WorkflowVerifyBundleOptions = {
  bundle: string;
  json?: boolean;
};

type WorkflowStep = {
  id: string;
  label: string;
  command: string;
  mode: WorkflowStepMode;
  inputFiles: string[];
  outputFiles: string[];
  requiresConfirmation: boolean;
};

type WorkflowPlan = {
  kind: "workflow-plan";
  schemaVersion: 1;
  goal: WorkflowGoal;
  steps: WorkflowStep[];
  checkpoints: {
    missingInputs: string[];
    confirmations: string[];
  };
  files: Record<string, string>;
  safetySummary: {
    localSteps: number;
    apiReadSteps: number;
    apiWritePreviewSteps: number;
    apiWriteExecuteSteps: number;
    requiresConfirmation: boolean;
  };
};

type Session = {
  profile: string;
  baseUrl: string;
  token: string;
};

type WorkflowRunStatus = "running" | "preview-ready" | "completed" | "failed";
type WorkflowRunStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

type WorkflowRunStep = {
  id: string;
  status: WorkflowRunStepStatus;
  startedAt?: string;
  endedAt?: string;
  requestId?: string;
  error?: string;
};

type WorkflowRunInputs = {
  keyword?: string;
  topicId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
};

type WorkflowRunState = {
  kind: "workflow-run";
  schemaVersion: 1;
  runId: string;
  goal: WorkflowRunGoal;
  inputs: WorkflowRunInputs;
  status: WorkflowRunStatus;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowRunStep[];
  artifacts: Record<string, string>;
  nextAction: string;
};

type WorkflowApproval = {
  kind: "workflow-approval";
  schemaVersion: 1;
  runId: string;
  approvedAt: string;
  approvedBy: string;
  note?: string;
  previewHash: string;
  request: WorkflowPreviewRequest;
};

type WorkflowPreviewRequest = {
  method: "POST";
  path: string;
  body: unknown;
};

type WorkflowVerificationIssue = {
  code: string;
  message: string;
  path?: string;
};

export function createWorkflowCommand(options: WorkflowCommandOptions): Command {
  const workflow = new Command("workflow");

  workflow
    .command("plan")
    .requiredOption("--goal <goal>", "workflow goal: ask-question, reply, research-only, publish-topic", parseWorkflowGoal)
    .option("--keyword <keyword>", "search or research keyword")
    .option("--topic-id <id>", "topic id", parsePositiveInteger)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--title <title>", "topic title")
    .option("--problem <text>", "question problem text for ask-question")
    .option("--answer <text>", "reply answer text for reply")
    .option("--content-file <path>", "existing Markdown content file for publish-topic")
    .option("--output-dir <path>", "directory for planned local files")
    .option("--include-execute", "include final API execute steps after preview")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action((commandOptions: WorkflowPlanOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const plan = workflowPlan(commandOptions);
      printData(options, plan, outputFormat(commandOptions), formatWorkflowPlanText);
    });

  workflow
    .command("run")
    .option("--goal <goal>", "workflow goal: ask-question, reply", parseWorkflowRunGoal)
    .option("--resume <run-dir>", "resume an existing workflow run directory")
    .option("--keyword <keyword>", "search or research keyword for ask-question")
    .option("--topic-id <id>", "topic id for reply", parsePositiveInteger)
    .option("--category-id <id>", "category id for topic create preview", parsePositiveInteger)
    .option("--title <title>", "topic title for ask-question")
    .option("--problem <text>", "question problem text for ask-question")
    .option("--answer <text>", "reply answer text for reply")
    .option("--output-dir <path>", "directory for run artifacts")
    .option("--execute", "execute the final API write after preview")
    .option("--yes", "confirm --execute")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowRunOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      await runWorkflow(options, commandOptions);
    });

  workflow
    .command("approve")
    .requiredOption("--run-dir <run-dir>", "workflow run directory to approve")
    .option("--approved-by <name>", "name recorded in approval artifact")
    .option("--note <text>", "approval note")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowApproveOptions) => {
      await approveWorkflow(options, commandOptions);
    });

  workflow
    .command("verify")
    .requiredOption("--run-dir <run-dir>", "workflow run directory to verify")
    .option("--write-report", "write verification.json in the run directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowVerifyOptions) => {
      await verifyWorkflow(options, commandOptions);
    });

  workflow
    .command("export")
    .requiredOption("--run-dir <run-dir>", "workflow run directory to export")
    .requiredOption("--output <file>", "bundle output path, or - for stdout")
    .option("--allow-invalid", "export even when workflow verification fails")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowExportOptions) => {
      await exportWorkflow(options, commandOptions);
    });

  workflow
    .command("verify-bundle")
    .requiredOption("--bundle <file>", "workflow bundle file to verify")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowVerifyBundleOptions) => {
      await verifyWorkflowBundle(options, commandOptions);
    });

  return workflow;
}

async function verifyWorkflowBundle(io: CommandIo, options: WorkflowVerifyBundleOptions): Promise<void> {
  let bundle: unknown;
  try {
    bundle = await readJson(options.bundle);
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid workflow bundle: ${errorMessage(error)}` });
    process.exitCode = 1;
    return;
  }
  const report = workflowBundleVerification(options.bundle, bundle);
  if (!report.ok) {
    process.exitCode = 1;
  }
  printData(io, report, options.json === true);
}

async function exportWorkflow(io: CommandIo, options: WorkflowExportOptions): Promise<void> {
  let loaded: { runDir: string; state: WorkflowRunState } | undefined;
  try {
    loaded = await loadWorkflowRun(options.runDir);
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid workflow run: ${errorMessage(error)}` });
    process.exitCode = 1;
    return;
  }
  if (!loaded) {
    printError(io, { type: "validation", message: `Workflow run not found or invalid: ${options.runDir}` });
    process.exitCode = 1;
    return;
  }
  const verification = await workflowVerificationReport(loaded.runDir, loaded.state);
  if (!verification.ok && !options.allowInvalid) {
    printError(io, { type: "validation", message: "Workflow verification failed; rerun with --allow-invalid to export anyway." });
    process.exitCode = 1;
    return;
  }
  const bundle = {
    kind: "workflow-bundle",
    schemaVersion: 1,
    exportedAt: now(),
    runId: loaded.state.runId,
    status: loaded.state.status,
    sourceRunDir: loaded.runDir,
    verification,
    artifacts: await workflowBundleArtifacts(loaded.state)
  };
  if (options.output === "-") {
    printData(io, bundle, options.json === true);
    return;
  }
  await writeJson(options.output, bundle);
  printData(io, {
    kind: "workflow-export",
    schemaVersion: 1,
    outputPath: options.output,
    runId: loaded.state.runId,
    ok: verification.ok,
    artifactCount: bundle.artifacts.filter((artifact) => artifact.exists === true).length
  }, options.json === true);
}

async function verifyWorkflow(io: CommandIo, options: WorkflowVerifyOptions): Promise<void> {
  let loaded: { runDir: string; state: WorkflowRunState } | undefined;
  try {
    loaded = await loadWorkflowRun(options.runDir);
  } catch (error) {
    printError(io, { type: "validation", message: `Invalid workflow run: ${errorMessage(error)}` });
    process.exitCode = 1;
    return;
  }
  if (!loaded) {
    printError(io, { type: "validation", message: `Workflow run not found or invalid: ${options.runDir}` });
    process.exitCode = 1;
    return;
  }

  const report = await workflowVerificationReport(loaded.runDir, loaded.state);
  if (options.writeReport) {
    const reportPath = join(loaded.runDir, "verification.json");
    await writeJson(reportPath, report);
    report.reportPath = reportPath;
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
  printData(io, report, options.json === true);
}

async function approveWorkflow(io: CommandIo, options: WorkflowApproveOptions): Promise<void> {
  const loaded = await loadWorkflowRun(options.runDir);
  if (!loaded) {
    printError(io, { type: "validation", message: `Workflow run not found: ${options.runDir}` });
    process.exitCode = 1;
    return;
  }
  const { state, runDir } = loaded;
  if (state.status !== "preview-ready") {
    printError(io, { type: "validation", message: `Workflow run must be preview-ready before approval; current status is ${state.status}` });
    process.exitCode = 1;
    return;
  }

  let request: WorkflowPreviewRequest;
  try {
    request = await workflowPreviewRequest(state.artifacts.preview);
  } catch (error) {
    printError(io, { type: "validation", message: errorMessage(error) });
    process.exitCode = 1;
    return;
  }

  const approval: WorkflowApproval = compactObject({
    kind: "workflow-approval",
    schemaVersion: 1,
    runId: state.runId,
    approvedAt: now(),
    approvedBy: fieldText(options.approvedBy).trim() || process.env.USER || "unknown",
    note: fieldText(options.note).trim() || undefined,
    previewHash: workflowPreviewHash(request),
    request
  }) as WorkflowApproval;
  await writeJson(state.artifacts.approval, approval);
  state.nextAction = `Run apexcn workflow run --resume ${shellArg(runDir)} --execute --yes --json to publish the approved preview.`;
  await writeRunState(runDir, state);
  printData(io, approval, options.json === true);
}

async function runWorkflow(io: WorkflowCommandOptions, options: WorkflowRunOptions): Promise<void> {
  if (options.resume && options.outputDir) {
    printError(io, { type: "validation", message: "--resume cannot be combined with --output-dir" });
    process.exitCode = 1;
    return;
  }
  if (options.execute && !options.resume) {
    printError(io, { type: "validation", message: "Use --resume <run-dir> --execute --yes to publish a reviewed workflow." });
    process.exitCode = 1;
    return;
  }
  if (options.execute && !options.yes) {
    printError(io, { type: "safety", message: "Refusing to execute workflow without --yes" });
    process.exitCode = 1;
    return;
  }
  const loaded = options.resume ? await loadWorkflowRun(options.resume) : undefined;
  if (options.resume && !loaded) {
    printError(io, { type: "validation", message: `Workflow run not found: ${options.resume}` });
    process.exitCode = 1;
    return;
  }
  const goal = loaded?.state.goal ?? options.goal;
  if (!goal) {
    printError(io, { type: "validation", message: "Missing --goal for workflow run" });
    process.exitCode = 1;
    return;
  }
  const missing = loaded ? [] : missingInputsForRun(options, goal);
  if (missing.length > 0) {
    printError(io, { type: "validation", message: `Missing required workflow run inputs: ${missing.join(", ")}` });
    process.exitCode = 1;
    return;
  }
  if (options.execute && loaded) {
    const approvalError = await workflowApprovalError(loaded.state);
    if (approvalError) {
      loaded.state.nextAction = approvalError.includes("hash mismatch")
        ? `Review ${loaded.state.artifacts.preview} and rerun apexcn workflow approve --run-dir ${shellArg(loaded.runDir)} --json.`
        : `Run apexcn workflow approve --run-dir ${shellArg(loaded.runDir)} --json before executing.`;
      await writeRunState(loaded.runDir, loaded.state);
      printError(io, { type: "validation", message: approvalError });
      process.exitCode = 1;
      return;
    }
  }
  const session = await loadSession(io);
  if (!session) {
    return;
  }
  const runDir = loaded?.runDir ?? (options.outputDir ?? `apexcn-run-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(runDir, { recursive: true });
  const state = loaded?.state ?? initialRunState(goal, runDir, options);
  state.status = "running";
  state.nextAction = "Workflow run is in progress.";
  await writeRunState(runDir, state);
  try {
    await executeRunSteps(state, runDir, session, options);
  } catch (error) {
    state.status = "failed";
    state.nextAction = "Fix the failed step and rerun with --resume.";
    await writeRunState(runDir, state);
    handleRunError(io, error, session);
    return;
  }
  state.status = options.execute ? "completed" : "preview-ready";
  state.nextAction = options.execute ? "Workflow completed." : `Review ${state.artifacts.preview} and approve it with apexcn workflow approve --run-dir ${shellArg(runDir)} --json.`;
  await writeRunState(runDir, state);
  printData(io, state, outputFormat(options), formatWorkflowRunText);
}

function workflowPlan(options: WorkflowPlanOptions): WorkflowPlan {
  const files = workflowFiles(options.outputDir);
  const missingInputs = missingInputsForGoal(options);
  const steps = stepsForGoal(options, files);
  const confirmations = steps.filter((step) => step.requiresConfirmation).map((step) => step.id);
  return {
    kind: "workflow-plan",
    schemaVersion: 1,
    goal: options.goal,
    steps,
    checkpoints: {
      missingInputs,
      confirmations
    },
    files,
    safetySummary: safetySummary(steps)
  };
}

async function workflowVerificationReport(runDir: string, state: WorkflowRunState): Promise<Record<string, unknown> & { ok: boolean; reportPath?: string }> {
  const issues: WorkflowVerificationIssue[] = [];
  const warnings: WorkflowVerificationIssue[] = [];
  const artifacts = await workflowArtifactEvidence(state);
  const preview = await readVerificationJson(state.artifacts.preview, issues, "invalid-preview", state.status === "preview-ready" || state.status === "completed");
  const previewRequest = preview ? verificationPreviewRequest(preview, state.artifacts.preview, issues) : undefined;
  const previewHash = previewRequest ? workflowPreviewHash(previewRequest) : undefined;

  const approval = await readVerificationJson(state.artifacts.approval, issues, "invalid-approval", state.status === "completed");
  if (!approval && state.status === "preview-ready") {
    warnings.push({ code: "approval-missing", message: "Workflow preview has not been approved.", path: state.artifacts.approval });
  }
  const approvalSummary = approval ? verificationApproval(approval, state, previewHash, issues) : undefined;

  const execute = await readVerificationJson(state.artifacts.execute, issues, "invalid-execute", state.status === "completed");
  if (!execute && state.status !== "completed") {
    warnings.push({ code: "execute-missing", message: "Workflow has not executed yet.", path: state.artifacts.execute });
  }
  const executeSummary = execute ? verificationExecute(execute, approvalSummary?.request, issues) : undefined;

  return {
    kind: "workflow-verification",
    schemaVersion: 1,
    runId: state.runId,
    status: state.status,
    ok: issues.length === 0,
    issues,
    warnings,
    artifacts,
    previewHash,
    approval: approvalSummary,
    execute: executeSummary
  };
}

function workflowBundleVerification(bundlePath: string, bundle: unknown): Record<string, unknown> & { ok: boolean } {
  const issues: WorkflowVerificationIssue[] = [];
  const warnings: WorkflowVerificationIssue[] = [];
  const artifactSummaries: Array<Record<string, unknown>> = [];
  if (!isRecord(bundle) || bundle.kind !== "workflow-bundle" || bundle.schemaVersion !== 1 || typeof bundle.runId !== "string" || typeof bundle.status !== "string" || !isRecord(bundle.verification) || !Array.isArray(bundle.artifacts)) {
    issues.push({ code: "invalid-workflow-bundle", message: "Bundle schema is invalid.", path: bundlePath });
    return {
      kind: "workflow-bundle-verification",
      schemaVersion: 1,
      bundlePath,
      ok: false,
      issues,
      warnings,
      artifacts: artifactSummaries
    };
  }

  const artifacts = new Map<string, Record<string, unknown>>();
  for (const artifact of bundle.artifacts) {
    if (!isRecord(artifact) || typeof artifact.key !== "string") {
      issues.push({ code: "invalid-bundle-artifact", message: "Bundle artifact entry is invalid.", path: bundlePath });
      continue;
    }
    if (artifacts.has(artifact.key)) {
      issues.push({ code: "invalid-bundle-artifact", message: `Duplicate bundle artifact key: ${artifact.key}`, path: bundlePath });
      continue;
    }
    artifacts.set(artifact.key, artifact);
    artifactSummaries.push(verifyBundleArtifact(artifact, bundle.verification, issues));
  }

  if (bundle.verification.runId !== bundle.runId) {
    issues.push({ code: "bundle-verification-runid-mismatch", message: "Embedded verification runId does not match bundle runId.", path: bundlePath });
  }
  verifyBundleVerificationCoverage(bundle.verification, artifacts, issues);
  verifyBundleWorkflowChain(bundle.runId, bundle.status, artifacts, issues, warnings);

  return {
    kind: "workflow-bundle-verification",
    schemaVersion: 1,
    bundlePath,
    runId: bundle.runId,
    status: bundle.status,
    ok: issues.length === 0,
    issues,
    warnings,
    artifacts: artifactSummaries,
    verification: {
      ok: bundle.verification.ok,
      issueCount: Array.isArray(bundle.verification.issues) ? bundle.verification.issues.length : undefined,
      warningCount: Array.isArray(bundle.verification.warnings) ? bundle.verification.warnings.length : undefined
    }
  };
}

function verifyBundleVerificationCoverage(verification: Record<string, unknown>, artifacts: Map<string, Record<string, unknown>>, issues: WorkflowVerificationIssue[]): void {
  const verificationArtifacts = isRecord(verification.artifacts) ? verification.artifacts : {};
  for (const [key, value] of Object.entries(verificationArtifacts)) {
    if (!isRecord(value) || value.exists !== true) {
      continue;
    }
    const artifact = artifacts.get(key);
    if (!artifact || artifact.exists !== true) {
      issues.push({ code: "missing-bundle-artifact", message: `Bundle is missing artifact recorded by embedded verification: ${key}` });
      continue;
    }
    if (artifact.sha256 !== value.sha256 || artifact.size !== value.size) {
      issues.push({ code: "bundle-verification-artifact-mismatch", message: `Embedded verification artifact ${key} does not match bundle artifact.` });
    }
  }
}

function verifyBundleArtifact(artifact: Record<string, unknown>, verification: Record<string, unknown>, issues: WorkflowVerificationIssue[]): Record<string, unknown> {
  const key = fieldText(artifact.key);
  const summary: Record<string, unknown> = { key, exists: artifact.exists === true };
  if (artifact.exists !== true) {
    return summary;
  }
  if (artifact.encoding !== "utf8" || typeof artifact.content !== "string" || typeof artifact.sha256 !== "string" || typeof artifact.size !== "number") {
    issues.push({ code: "invalid-bundle-artifact", message: `Bundle artifact ${key} has invalid content metadata.` });
    return summary;
  }
  const content = Buffer.from(artifact.content, "utf8");
  const sha256 = createHash("sha256").update(content).digest("hex");
  summary.size = content.byteLength;
  summary.sha256 = sha256;
  if (artifact.size !== content.byteLength) {
    issues.push({ code: "bundle-artifact-size-mismatch", message: `Bundle artifact ${key} size does not match content.` });
  }
  if (artifact.sha256 !== sha256) {
    issues.push({ code: "bundle-artifact-hash-mismatch", message: `Bundle artifact ${key} hash does not match content.` });
  }
  const verificationArtifacts = isRecord(verification.artifacts) ? verification.artifacts : {};
  const verificationArtifact = isRecord(verificationArtifacts[key]) ? verificationArtifacts[key] : undefined;
  if (verificationArtifact && (verificationArtifact.sha256 !== artifact.sha256 || verificationArtifact.size !== artifact.size)) {
    issues.push({ code: "bundle-verification-artifact-mismatch", message: `Embedded verification artifact ${key} does not match bundle artifact.` });
  }
  return summary;
}

function verifyBundleWorkflowChain(runId: string, status: string, artifacts: Map<string, Record<string, unknown>>, issues: WorkflowVerificationIssue[], warnings: WorkflowVerificationIssue[]): void {
  const preview = bundleJsonArtifact(artifacts, "preview", issues, status === "preview-ready" || status === "completed");
  const previewRequest = preview ? verificationPreviewRequest(preview, "bundle:preview", issues) : undefined;
  const previewHash = previewRequest ? workflowPreviewHash(previewRequest) : undefined;
  const approval = bundleJsonArtifact(artifacts, "approval", issues, status === "completed");
  if (!approval && status === "preview-ready") {
    warnings.push({ code: "approval-missing", message: "Bundle preview has not been approved." });
  }
  const approvedRequest = approval ? verifyBundleApproval(runId, approval, previewHash, issues) : undefined;
  const execute = bundleJsonArtifact(artifacts, "execute", issues, status === "completed");
  if (!execute && status !== "completed") {
    warnings.push({ code: "execute-missing", message: "Bundle workflow has not executed yet." });
  }
  if (execute) {
    verifyBundleExecute(execute, approvedRequest, issues);
  }
}

function bundleJsonArtifact(artifacts: Map<string, Record<string, unknown>>, key: string, issues: WorkflowVerificationIssue[], required: boolean): unknown | undefined {
  const artifact = artifacts.get(key);
  if (!artifact || artifact.exists !== true) {
    if (required) {
      issues.push({ code: "missing-required-artifact", message: `Bundle is missing required artifact: ${key}` });
    }
    return undefined;
  }
  if (typeof artifact.content !== "string") {
    issues.push({ code: "invalid-bundle-artifact", message: `Bundle artifact ${key} has no text content.` });
    return undefined;
  }
  try {
    return JSON.parse(artifact.content) as unknown;
  } catch (error) {
    issues.push({ code: `invalid-${key}`, message: `Bundle artifact ${key} is invalid JSON: ${errorMessage(error)}` });
    return undefined;
  }
}

function verifyBundleApproval(runId: string, approval: unknown, previewHash: string | undefined, issues: WorkflowVerificationIssue[]): WorkflowPreviewRequest | undefined {
  if (!isRecord(approval) || approval.kind !== "workflow-approval" || approval.schemaVersion !== 1) {
    issues.push({ code: "invalid-approval", message: "Bundle approval artifact has an invalid schema." });
    return undefined;
  }
  if (approval.runId !== runId) {
    issues.push({ code: "approval-runid-mismatch", message: "Bundle approval runId does not match bundle runId." });
  }
  if (typeof approval.previewHash !== "string" || approval.previewHash !== previewHash) {
    issues.push({ code: "approval-hash-mismatch", message: "Bundle approval hash does not match bundled preview." });
  }
  const request = verificationApprovalRequest(approval.request);
  if (!request || workflowPreviewHash(request) !== approval.previewHash) {
    issues.push({ code: "approval-request-mismatch", message: "Bundle approval request does not match approval hash." });
    return undefined;
  }
  return request;
}

function verifyBundleExecute(execute: unknown, approvedRequest: WorkflowPreviewRequest | undefined, issues: WorkflowVerificationIssue[]): void {
  if (!isRecord(execute) || execute.kind !== "workflow-execute" || execute.schemaVersion !== 1 || !isRecord(execute.request)) {
    issues.push({ code: "invalid-execute", message: "Bundle execute artifact has an invalid schema." });
    return;
  }
  if (approvedRequest && canonicalJson(execute.request) !== canonicalJson(approvedRequest)) {
    issues.push({ code: "execute-request-mismatch", message: "Bundle execute request does not match approved preview request." });
  }
}

async function workflowArtifactEvidence(state: WorkflowRunState): Promise<Record<string, Record<string, unknown>>> {
  const evidence: Record<string, Record<string, unknown>> = {};
  for (const [key, path] of Object.entries(state.artifacts)) {
    if (key === "verification") {
      continue;
    }
    try {
      const content = await readFile(path);
      evidence[key] = {
        path,
        exists: true,
        size: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex")
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        evidence[key] = { path, exists: false };
      } else {
        throw error;
      }
    }
  }
  return evidence;
}

async function workflowBundleArtifacts(state: WorkflowRunState): Promise<Array<Record<string, unknown>>> {
  const artifacts = [];
  for (const [key, path] of Object.entries(state.artifacts)) {
    if (key === "verification" || key === "bundle") {
      continue;
    }
    try {
      const content = await readFile(path);
      artifacts.push({
        key,
        path,
        exists: true,
        size: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        encoding: "utf8",
        content: content.toString("utf8")
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        artifacts.push({ key, path, exists: false });
      } else {
        throw error;
      }
    }
  }
  return artifacts;
}

async function readVerificationJson(path: string, issues: WorkflowVerificationIssue[], invalidCode: string, required: boolean): Promise<unknown | undefined> {
  try {
    return await readJson(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (required) {
        issues.push({ code: "missing-required-artifact", message: `Required workflow artifact is missing: ${path}`, path });
      }
      return undefined;
    }
    issues.push({ code: invalidCode, message: `Invalid workflow artifact: ${errorMessage(error)}`, path });
    return undefined;
  }
}

function verificationPreviewRequest(preview: unknown, path: string, issues: WorkflowVerificationIssue[]): WorkflowPreviewRequest | undefined {
  if (!isRecord(preview) || preview.kind !== "workflow-preview" || !isRecord(preview.request) || preview.request.method !== "POST" || typeof preview.request.path !== "string") {
    issues.push({ code: "invalid-preview", message: "Preview artifact does not contain a valid POST request.", path });
    return undefined;
  }
  return { method: "POST", path: preview.request.path, body: preview.request.body };
}

function verificationApproval(approval: unknown, state: WorkflowRunState, previewHash: string | undefined, issues: WorkflowVerificationIssue[]): { runId?: unknown; previewHash?: unknown; request?: WorkflowPreviewRequest } {
  const summary: { runId?: unknown; previewHash?: unknown; request?: WorkflowPreviewRequest } = {};
  if (!isRecord(approval) || approval.kind !== "workflow-approval" || approval.schemaVersion !== 1) {
    issues.push({ code: "invalid-approval", message: "Approval artifact has an invalid schema.", path: state.artifacts.approval });
    return summary;
  }
  summary.runId = approval.runId;
  summary.previewHash = approval.previewHash;
  if (approval.runId !== state.runId) {
    issues.push({ code: "approval-runid-mismatch", message: "Approval runId does not match run.json.", path: state.artifacts.approval });
  }
  if (typeof approval.previewHash !== "string" || approval.previewHash !== previewHash) {
    issues.push({ code: "approval-hash-mismatch", message: "Approval hash does not match current preview request.", path: state.artifacts.approval });
  }
  const request = verificationApprovalRequest(approval.request);
  if (!request || workflowPreviewHash(request) !== approval.previewHash) {
    issues.push({ code: "approval-request-mismatch", message: "Approval request does not match its recorded preview hash.", path: state.artifacts.approval });
  } else {
    summary.request = request;
  }
  return summary;
}

function verificationApprovalRequest(value: unknown): WorkflowPreviewRequest | undefined {
  if (!isRecord(value) || value.method !== "POST" || typeof value.path !== "string") {
    return undefined;
  }
  return { method: "POST", path: value.path, body: value.body };
}

function verificationExecute(execute: unknown, approvedRequest: WorkflowPreviewRequest | undefined, issues: WorkflowVerificationIssue[]): { request?: unknown; requestId?: unknown } {
  const summary: { request?: unknown; requestId?: unknown } = {};
  if (!isRecord(execute) || execute.kind !== "workflow-execute" || execute.schemaVersion !== 1 || !isRecord(execute.request)) {
    issues.push({ code: "invalid-execute", message: "Execute artifact has an invalid schema." });
    return summary;
  }
  summary.request = execute.request;
  summary.requestId = execute.requestId;
  if (approvedRequest && canonicalJson(execute.request) !== canonicalJson(approvedRequest)) {
    issues.push({ code: "execute-request-mismatch", message: "Execute request does not match approved preview request." });
  }
  return summary;
}

async function executeRunSteps(state: WorkflowRunState, runDir: string, session: Session, options: WorkflowRunOptions): Promise<void> {
  if (state.goal === "ask-question") {
    await runStep(state, runDir, "research", state.artifacts.research, async () => {
      const research = await runResearch(session, state, options);
      await writeJson(state.artifacts.research, research);
      return requestIdFrom(research);
    });
    await runStep(state, runDir, "draft-question", state.artifacts.question, async () => {
      const research = await readJson(state.artifacts.research);
      await writeFile(state.artifacts.question, questionMarkdown(state, options, research), "utf8");
    });
    await runStep(state, runDir, "review-topic", state.artifacts.review, async () => {
      const content = await readFile(state.artifacts.question, "utf8");
      await writeJson(state.artifacts.review, reviewArtifact(state, options, state.artifacts.question, content));
    });
    await runStep(state, runDir, "preview-topic-create", state.artifacts.preview, async () => {
      const content = await readFile(state.artifacts.question, "utf8");
      const body = {
        categoryId: effectiveCategoryId(state, options),
        title: effectiveTitle(state, options),
        content
      };
      await writeJson(state.artifacts.preview, {
        kind: "workflow-preview",
        schemaVersion: 1,
        profile: session.profile,
        baseUrl: session.baseUrl,
        request: { method: "POST", path: "/api/v1/topics", body },
        result: null
      });
    });
    if (options.execute) {
      await runStep(state, runDir, "execute-topic-create", state.artifacts.execute, async () => {
        const request = await previewRequest(state.artifacts.preview, "/api/v1/topics");
        const response = await requestJson(session.baseUrl, request.path, {
          token: session.token,
          method: "POST",
          body: request.body
        });
        const artifact = {
          kind: "workflow-execute",
          schemaVersion: 1,
          requestId: requestIdFrom(response),
          request: { method: "POST", path: request.path, body: request.body },
          result: response
        };
        await writeJson(state.artifacts.execute, artifact);
        return requestIdFrom(response);
      });
    }
    return;
  }

  await runStep(state, runDir, "topic-view", state.artifacts.topic, async () => {
    const topicId = effectiveTopicId(state, options);
    const path = `/api/v1/topics/${topicId}`;
    const topic = await requestJson(session.baseUrl, path, { token: session.token });
    const artifact = {
      kind: "workflow-topic",
      schemaVersion: 1,
      requestId: requestIdFrom(topic),
      request: { method: "GET", path },
      result: topic
    };
    await writeJson(state.artifacts.topic, artifact);
    return requestIdFrom(topic);
  });
  await runStep(state, runDir, "draft-reply", state.artifacts.reply, async () => {
    const topic = await readJson(state.artifacts.topic);
    await writeFile(state.artifacts.reply, replyMarkdown(state, options, topic), "utf8");
  });
  await runStep(state, runDir, "preview-reply-create", state.artifacts.preview, async () => {
    const content = await readFile(state.artifacts.reply, "utf8");
    const topicId = effectiveTopicId(state, options);
    const path = `/api/v1/topics/${topicId}/replies`;
    await writeJson(state.artifacts.preview, {
      kind: "workflow-preview",
      schemaVersion: 1,
      profile: session.profile,
      baseUrl: session.baseUrl,
      request: { method: "POST", path, body: { content } },
      result: null
    });
  });
  if (options.execute) {
    await runStep(state, runDir, "execute-reply-create", state.artifacts.execute, async () => {
      const topicId = effectiveTopicId(state, options);
      const path = `/api/v1/topics/${topicId}/replies`;
      const request = await previewRequest(state.artifacts.preview, path);
      const response = await requestJson(session.baseUrl, request.path, {
        token: session.token,
        method: "POST",
        body: request.body
      });
      const artifact = {
        kind: "workflow-execute",
        schemaVersion: 1,
        requestId: requestIdFrom(response),
        request: { method: "POST", path: request.path, body: request.body },
        result: response
      };
      await writeJson(state.artifacts.execute, artifact);
      return requestIdFrom(response);
    });
  }
}

async function runResearch(session: Session, state: WorkflowRunState, options: WorkflowRunOptions): Promise<Record<string, unknown>> {
  const keyword = effectiveKeyword(state, options);
  const search = await requestJson(session.baseUrl, "/api/v1/search", {
    token: session.token,
    query: { keyword, pageSize: 3 }
  });
  const items = itemsFromData(search).slice(0, 3);
  const topics = [];
  const requestIds = [];
  for (const [sourceItemIndex, item] of items.entries()) {
    const id = topicIdFromItem(item);
    if (id !== undefined) {
      const topic = await requestJson(session.baseUrl, `/api/v1/topics/${id}`, { token: session.token });
      const normalized = topicFromApiData(topic);
      topics.push(compactObject({
        sourceItemIndex,
        id: normalized.id ?? id,
        title: normalized.title,
        url: normalized.url ?? normalized.threadUrl,
        originalUrl: normalized.originalUrl,
        content: normalized.content ?? normalized.body,
        requestId: requestIdFrom(topic)
      }));
      const requestId = requestIdFrom(topic);
      if (requestId) {
        requestIds.push(requestId);
      }
    }
  }
  return {
    kind: "workflow-research",
    schemaVersion: 1,
    requestId: requestIdFrom(search),
    request: {
      method: "GET",
      path: "/api/v1/search",
      query: { keyword, pageSize: 3 }
    },
    result: {
      query: { keyword, limit: 3 },
      items,
      topics,
      links: researchLinks(items, topics),
      requestIds: {
        search: requestIdFrom(search),
        topics: requestIds
      },
      errors: []
    }
  };
}

async function runStep(state: WorkflowRunState, runDir: string, id: string, artifact: string | undefined, action: () => Promise<string | undefined | void>): Promise<void> {
  const current = stepState(state, id);
  if ((current.status === "completed" || current.status === "skipped") && artifact && await fileExists(artifact)) {
    current.status = "skipped";
    current.endedAt = now();
    await writeRunState(runDir, state);
    return;
  }
  current.status = "running";
  current.startedAt = now();
  current.error = undefined;
  touchState(state);
  await writeRunState(runDir, state);
  try {
    const requestId = await action();
    current.status = "completed";
    current.endedAt = now();
    if (requestId) {
      current.requestId = requestId;
    }
    touchState(state);
    await writeRunState(runDir, state);
  } catch (error) {
    current.status = "failed";
    current.endedAt = now();
    current.error = errorMessage(error);
    touchState(state);
    await writeRunState(runDir, state);
    throw error;
  }
}

function stepsForGoal(options: WorkflowPlanOptions, files: Record<string, string>): WorkflowStep[] {
  if (options.goal === "research-only") {
    return [
      step("research", "Build research bundle", researchCommand(options, files), "api-read", [], [files.research], false)
    ];
  }
  if (options.goal === "ask-question") {
    const steps = [
      step("research", "Build research bundle", researchCommand(options, files), "api-read", [], [files.research], false),
      step("draft-question", "Draft local question", draftQuestionCommand(options, files), "local", [files.research], [files.question], false),
      step("review-topic", "Review local topic draft", reviewTopicCommand(options, files), "local", [files.question], [], false),
      step("preview-topic-create", "Preview topic create API request", topicCreateCommand(options, files, true), "api-write-preview", [files.question], [], false)
    ];
    return options.includeExecute ? [...steps, step("execute-topic-create", "Create topic after confirmation", topicCreateCommand(options, files, false), "api-write-execute", [files.question], [], true)] : steps;
  }
  if (options.goal === "reply") {
    const steps = [
      step("topic-view", "Fetch topic context", topicViewCommand(options, files), "api-read", [], [files.topic], false),
      step("draft-reply", "Draft local reply", draftReplyCommand(options, files), "local", [files.topic], [files.reply], false),
      step("preview-reply-create", "Preview reply create API request", replyCreateCommand(options, files, true), "api-write-preview", [files.reply], [], false)
    ];
    return options.includeExecute ? [...steps, step("execute-reply-create", "Create reply after confirmation", replyCreateCommand(options, files, false), "api-write-execute", [files.reply], [], true)] : steps;
  }
  const steps = [
    step("review-topic", "Review existing topic Markdown", reviewTopicCommand(options, files), "local", [contentFile(options, files)], [], false),
    step("preview-topic-create", "Preview topic create API request", topicCreateCommand(options, files, true), "api-write-preview", [contentFile(options, files)], [], false)
  ];
  return options.includeExecute ? [...steps, step("execute-topic-create", "Create topic after confirmation", topicCreateCommand(options, files, false), "api-write-execute", [contentFile(options, files)], [], true)] : steps;
}

function initialRunState(goal: WorkflowRunGoal, runDir: string, options: WorkflowRunOptions): WorkflowRunState {
  const createdAt = now();
  const artifacts = runArtifacts(goal, runDir);
  return {
    kind: "workflow-run",
    schemaVersion: 1,
    runId: `run-${createdAt.replace(/[:.]/g, "-")}`,
    goal,
    inputs: workflowRunInputs(options),
    status: "running",
    createdAt,
    updatedAt: createdAt,
    steps: runStepIds(goal, options.execute === true).map((id) => ({ id, status: "pending" })),
    artifacts,
    nextAction: "Workflow run is in progress."
  };
}

function workflowRunInputs(options: WorkflowRunOptions): WorkflowRunInputs {
  return compactObject({
    keyword: fieldText(options.keyword).trim() || undefined,
    topicId: options.topicId,
    categoryId: options.categoryId,
    title: fieldText(options.title).trim() || undefined,
    problem: fieldText(options.problem).trim() || undefined,
    answer: fieldText(options.answer).trim() || undefined
  }) as WorkflowRunInputs;
}

function runArtifacts(goal: WorkflowRunGoal, runDir: string): Record<string, string> {
  if (goal === "ask-question") {
    return {
      state: join(runDir, "run.json"),
      research: join(runDir, "research.json"),
      question: join(runDir, "question.md"),
      review: join(runDir, "review.json"),
      preview: join(runDir, "preview.json"),
      approval: join(runDir, "approval.json"),
      execute: join(runDir, "execute.json")
    };
  }
  return {
    state: join(runDir, "run.json"),
    topic: join(runDir, "topic.json"),
    reply: join(runDir, "reply.md"),
    preview: join(runDir, "preview.json"),
    approval: join(runDir, "approval.json"),
    execute: join(runDir, "execute.json")
  };
}

function runStepIds(goal: WorkflowRunGoal, execute: boolean): string[] {
  if (goal === "ask-question") {
    return execute
      ? ["research", "draft-question", "review-topic", "preview-topic-create", "execute-topic-create"]
      : ["research", "draft-question", "review-topic", "preview-topic-create"];
  }
  return execute
    ? ["topic-view", "draft-reply", "preview-reply-create", "execute-reply-create"]
    : ["topic-view", "draft-reply", "preview-reply-create"];
}

function missingInputsForRun(options: WorkflowRunOptions, goal: WorkflowRunGoal): string[] {
  const missing = [];
  if (goal === "ask-question") {
    if (!fieldText(options.keyword).trim()) {
      missing.push("--keyword");
    }
    if (!fieldText(options.title).trim()) {
      missing.push("--title");
    }
    if (!fieldText(options.problem).trim()) {
      missing.push("--problem");
    }
    if (options.categoryId === undefined) {
      missing.push("--category-id");
    }
  } else {
    if (options.topicId === undefined) {
      missing.push("--topic-id");
    }
    if (!fieldText(options.answer).trim()) {
      missing.push("--answer");
    }
  }
  return missing;
}

async function loadWorkflowRun(runDir: string): Promise<{ runDir: string; state: WorkflowRunState } | undefined> {
  try {
    const data = await readJson(join(runDir, "run.json"));
    if (!isRecord(data) || data.kind !== "workflow-run" || !isWorkflowRunGoal(data.goal)) {
      return undefined;
    }
    const state = data as WorkflowRunState;
    state.inputs ??= {};
    state.artifacts = { ...runArtifacts(state.goal, runDir), ...state.artifacts };
    return { runDir, state };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function loadSession(io: WorkflowCommandOptions): Promise<Session | undefined> {
  try {
    const config = await loadConfig(io.configPath);
    const profile = config.current;
    const current = profile ? config.profiles[profile] : undefined;
    if (!profile || !current) {
      printError(io, { type: "no-profile", message: "No active profile" });
      process.exitCode = 1;
      return undefined;
    }
    return { profile, ...current };
  } catch (error) {
    if (error instanceof ConfigFileError) {
      printError(io, { type: "config", message: error.message });
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

function questionMarkdown(state: WorkflowRunState, options: WorkflowRunOptions, research: unknown): string {
  const source = isRecord(research) && isRecord(research.result) ? research.result : research;
  const links = isRecord(source) && Array.isArray(source.links) ? source.links.filter(isRecord) : [];
  return [
    `# ${effectiveTitle(state, options)}`,
    "",
    "## 问题",
    "",
    blockText(effectiveProblem(state, options)),
    "",
    "## 环境",
    "",
    "Oracle APEX / ORDS 环境，具体版本请在发布前确认。",
    "",
    "## 已尝试",
    "",
    "已检索社区相关话题并整理参考链接。",
    "",
    "## 期望结果",
    "",
    "希望获得可复现的排查步骤或配置建议。",
    "",
    "## 实际结果",
    "",
    blockText(effectiveProblem(state, options)),
    "",
    "## 参考链接",
    "",
    ...(links.length > 0 ? links.map((link, index) => `${index + 1}. ${fieldText(link.title ?? link.id ?? `reference ${index + 1}`)} - ${fieldText(link.url ?? link.originalUrl)}`) : ["本次搜索没有返回可引用链接。"])
  ].join("\n");
}

function replyMarkdown(state: WorkflowRunState, options: WorkflowRunOptions, topic: unknown): string {
  const source = isRecord(topic) && isRecord(topic.result) ? topic.result : topic;
  const normalized = isRecord(source) ? topicFromApiData(source) : {};
  const answer = effectiveAnswer(state, options);
  const reference = compactObject({
    id: normalized.id ?? effectiveTopicId(state, options),
    title: normalized.title,
    url: normalized.url ?? normalized.threadUrl,
    originalUrl: normalized.originalUrl
  });
  const referenceText = fieldText(reference.url ?? reference.originalUrl);
  return [
    "## 简短回应",
    "",
    "我建议先按下面步骤排查。",
    blockText(answer),
    "",
    "## 建议步骤",
    "",
    `- ${blockText(answer)}`,
    "",
    "## 参考链接",
    "",
    referenceText ? `1. ${fieldText(reference.title ?? reference.id ?? "topic")} - ${referenceText}` : "无参考链接。"
  ].join("\n");
}

function reviewArtifact(state: WorkflowRunState, options: WorkflowRunOptions, contentFile: string, content: string): Record<string, unknown> {
  const issues = [];
  if (content.includes("待补充")) {
    issues.push({ code: "placeholder-content", severity: "issue", message: "Content still contains 待补充 placeholders" });
  }
  return {
    kind: "workflow-review",
    schemaVersion: 1,
    request: {
      contentFile,
      title: effectiveTitle(state, options),
      categoryId: effectiveCategoryId(state, options)
    },
    result: {
      ok: issues.length === 0,
      issues,
      warnings: [],
      metrics: {
        titleLength: effectiveTitle(state, options).length,
        contentLength: content.length,
        referenceCount: (content.match(/https?:\/\/\S+/g) ?? []).length
      }
    }
  };
}

function parseWorkflowRunGoal(value: string): WorkflowRunGoal {
  if (value === "ask-question" || value === "reply") {
    return value;
  }
  throw new InvalidArgumentError(`Expected workflow run goal ask-question or reply: ${value}`);
}

function isWorkflowRunGoal(value: unknown): value is WorkflowRunGoal {
  return value === "ask-question" || value === "reply";
}

async function writeRunState(runDir: string, state: WorkflowRunState): Promise<void> {
  touchState(state);
  await writeJson(join(runDir, "run.json"), state);
}

function touchState(state: WorkflowRunState): void {
  state.updatedAt = now();
}

function stepState(state: WorkflowRunState, id: string): WorkflowRunStep {
  let item = state.steps.find((step) => step.id === id);
  if (!item) {
    item = { id, status: "pending" };
    state.steps.push(item);
  }
  return item;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function workflowApprovalError(state: WorkflowRunState): Promise<string | undefined> {
  let approvalData: unknown;
  try {
    approvalData = await readJson(state.artifacts.approval);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return `Workflow approval not found: ${state.artifacts.approval}`;
    }
    throw error;
  }
  if (!isRecord(approvalData) || approvalData.kind !== "workflow-approval" || approvalData.schemaVersion !== 1) {
    return `Invalid workflow approval artifact: ${state.artifacts.approval}`;
  }
  if (approvalData.runId !== state.runId) {
    return "Workflow approval runId does not match this run.";
  }
  if (typeof approvalData.previewHash !== "string") {
    return `Invalid workflow approval artifact: ${state.artifacts.approval}`;
  }
  const request = await workflowPreviewRequest(state.artifacts.preview);
  const currentHash = workflowPreviewHash(request);
  if (approvalData.previewHash !== currentHash) {
    return "Workflow approval hash mismatch; review and approve the current preview again.";
  }
  return undefined;
}

async function previewRequest(path: string, expectedPath: string): Promise<WorkflowPreviewRequest> {
  const request = await workflowPreviewRequest(path);
  if (request.path !== expectedPath) {
    throw new Error(`Workflow preview artifact does not match expected POST ${expectedPath}.`);
  }
  return request;
}

async function workflowPreviewRequest(path: string): Promise<WorkflowPreviewRequest> {
  let preview: unknown;
  try {
    preview = await readJson(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Invalid workflow preview artifact: ${path}`);
    }
    throw error;
  }
  if (!isRecord(preview) || preview.kind !== "workflow-preview" || !isRecord(preview.request)) {
    throw new Error(`Invalid workflow preview artifact: ${path}`);
  }
  const method = preview.request.method;
  const requestPath = preview.request.path;
  if (method !== "POST" || typeof requestPath !== "string") {
    throw new Error(`Invalid workflow preview artifact: ${path}`);
  }
  return { method, path: requestPath, body: preview.request.body };
}

function workflowPreviewHash(request: WorkflowPreviewRequest): string {
  return createHash("sha256").update(canonicalJson(request), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function now(): string {
  return new Date().toISOString();
}

function requestIdFrom(data: unknown): string | undefined {
  if (isRecord(data) && typeof data.requestId === "string") {
    return data.requestId;
  }
  if (isRecord(data) && isRecord(data.result) && typeof data.result.requestId === "string") {
    return data.result.requestId;
  }
  return undefined;
}

function itemsFromData(data: unknown): Array<Record<string, unknown>> {
  if (!isRecord(data) || !Array.isArray(data.items)) {
    return [];
  }
  return data.items.filter(isRecord);
}

function topicIdFromItem(item: Record<string, unknown>): number | undefined {
  for (const key of ["id", "topicId", "threadId"]) {
    const value = item[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function topicFromApiData(data: unknown): Record<string, unknown> {
  if (isRecord(data) && isRecord(data.topic)) {
    return data.topic;
  }
  return isRecord(data) ? data : {};
}

function researchLinks(items: Array<Record<string, unknown>>, topics: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return [...items, ...topics].map((item) => compactObject({
    id: item.id ?? item.topicId ?? item.threadId,
    title: item.title ?? item.topicTitle,
    url: item.url ?? item.threadUrl,
    originalUrl: item.originalUrl
  })).filter((item) => Object.keys(item).length > 0).filter((item) => {
    const key = [item.id, item.url, item.originalUrl].map(fieldText).join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

function effectiveKeyword(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.keyword ?? state.inputs.keyword).trim();
  if (!value) {
    throw new Error("Workflow run is missing keyword input.");
  }
  return value;
}

function effectiveTitle(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.title ?? state.inputs.title).trim();
  if (!value) {
    throw new Error("Workflow run is missing title input.");
  }
  return value;
}

function effectiveProblem(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.problem ?? state.inputs.problem).trim();
  if (!value) {
    throw new Error("Workflow run is missing problem input.");
  }
  return value;
}

function effectiveAnswer(state: WorkflowRunState, options: WorkflowRunOptions): string {
  const value = fieldText(options.answer ?? state.inputs.answer).trim();
  if (!value) {
    throw new Error("Workflow run is missing answer input.");
  }
  return value;
}

function effectiveCategoryId(state: WorkflowRunState, options: WorkflowRunOptions): number {
  const value = options.categoryId ?? state.inputs.categoryId;
  if (value === undefined) {
    throw new Error("Workflow run is missing category id input.");
  }
  return value;
}

function effectiveTopicId(state: WorkflowRunState, options: WorkflowRunOptions): number {
  const value = options.topicId ?? state.inputs.topicId;
  if (value === undefined) {
    throw new Error("Workflow run is missing topic id input.");
  }
  return value;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/\b[A-Za-z0-9]{26,}\b/g, "[redacted]");
}

function handleRunError(io: CommandIo, error: unknown, session: Session): void {
  if (error instanceof HttpError) {
    const requestId = error.requestId ? ` requestId=${error.requestId}` : "";
    printError(io, {
      type: "http",
      message: redactSecret(error.message, session.token),
      status: error.status,
      requestId: error.requestId
    }, `HTTP ${error.status}: ${redactSecret(error.message, session.token)}${requestId}\n`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    printError(io, { type: error instanceof TimeoutError ? "timeout" : "network", message: error.message });
    process.exitCode = 1;
    return;
  }
  throw error;
}

function formatWorkflowRunText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.steps)) {
    return "";
  }
  const steps = data.steps.filter(isRecord).map((step) => `${fieldText(step.id)}\t${fieldText(step.status)}`);
  return [
    `Run: ${fieldText(data.runId)}`,
    `Goal: ${fieldText(data.goal)}`,
    `Status: ${fieldText(data.status)}`,
    `Next: ${fieldText(data.nextAction)}`,
    "Steps:",
    ...steps
  ].join("\n");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function workflowFiles(outputDir = "."): Record<string, string> {
  const dir = outputDir.replace(/\/+$/, "") || ".";
  return {
    research: `${dir}/research.json`,
    topic: `${dir}/topic.json`,
    question: `${dir}/question.md`,
    reply: `${dir}/reply.md`
  };
}

function missingInputsForGoal(options: WorkflowPlanOptions): string[] {
  const missing = [];
  if ((options.goal === "ask-question" || options.goal === "research-only") && !fieldText(options.keyword).trim()) {
    missing.push("--keyword");
  }
  if ((options.goal === "ask-question" || options.goal === "publish-topic") && options.categoryId === undefined) {
    missing.push("--category-id");
  }
  if ((options.goal === "ask-question" || options.goal === "publish-topic") && !fieldText(options.title).trim()) {
    missing.push("--title");
  }
  if (options.goal === "ask-question" && !fieldText(options.problem).trim()) {
    missing.push("--problem");
  }
  if ((options.goal === "reply") && options.topicId === undefined) {
    missing.push("--topic-id");
  }
  if (options.goal === "reply" && !fieldText(options.answer).trim()) {
    missing.push("--answer");
  }
  if (options.goal === "publish-topic" && !options.contentFile) {
    missing.push("--content-file");
  }
  return missing;
}

function researchCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn research ${shellArg(options.keyword ?? "<keyword>")} --limit 3 --json > ${shellArg(files.research)}`;
}

function draftQuestionCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn draft question --title ${shellArg(options.title ?? "<title>")} --problem ${shellArg(options.problem ?? "<problem>")} --research-file ${shellArg(files.research)} --format text > ${shellArg(files.question)}`;
}

function reviewTopicCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn review topic --title ${shellArg(options.title ?? "<title>")} --content-file ${shellArg(contentFile(options, files))}${options.categoryId === undefined ? "" : ` --category-id ${options.categoryId}`} --json`;
}

function topicCreateCommand(options: WorkflowPlanOptions, files: Record<string, string>, preview: boolean): string {
  const category = options.categoryId === undefined ? "--category-id <id>" : `--category-id ${options.categoryId}`;
  return `apexcn topic create ${category} --title ${shellArg(options.title ?? "<title>")} --content-file ${shellArg(contentFile(options, files))} ${preview ? "--preview" : "--json"}`;
}

function topicViewCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn topic view ${options.topicId ?? "<topic-id>"} --json > ${shellArg(files.topic)}`;
}

function draftReplyCommand(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return `apexcn draft reply --topic-id ${options.topicId ?? "<topic-id>"} --answer ${shellArg(options.answer ?? "<answer>")} --topic-file ${shellArg(files.topic)} --format text > ${shellArg(files.reply)}`;
}

function replyCreateCommand(options: WorkflowPlanOptions, files: Record<string, string>, preview: boolean): string {
  return `apexcn reply create ${options.topicId ?? "<topic-id>"} --content-file ${shellArg(files.reply)} ${preview ? "--preview" : "--json"}`;
}

function contentFile(options: WorkflowPlanOptions, files: Record<string, string>): string {
  return options.contentFile ?? files.question;
}

function step(id: string, label: string, command: string, mode: WorkflowStepMode, inputFiles: string[], outputFiles: string[], requiresConfirmation: boolean): WorkflowStep {
  return { id, label, command, mode, inputFiles, outputFiles, requiresConfirmation };
}

function safetySummary(steps: WorkflowStep[]): WorkflowPlan["safetySummary"] {
  return {
    localSteps: steps.filter((step) => step.mode === "local").length,
    apiReadSteps: steps.filter((step) => step.mode === "api-read").length,
    apiWritePreviewSteps: steps.filter((step) => step.mode === "api-write-preview").length,
    apiWriteExecuteSteps: steps.filter((step) => step.mode === "api-write-execute").length,
    requiresConfirmation: steps.some((step) => step.requiresConfirmation)
  };
}

function formatWorkflowPlanText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.steps)) {
    return "";
  }
  const missing = isRecord(data.checkpoints) && Array.isArray(data.checkpoints.missingInputs) ? data.checkpoints.missingInputs.map(fieldText) : [];
  const steps = data.steps.filter(isRecord);
  return [
    `Workflow: ${fieldText(data.goal)}`,
    missing.length > 0 ? `Missing inputs: ${missing.join(", ")}` : "Missing inputs: none",
    "Steps:",
    ...steps.map((item, index) => `${index + 1}. [${fieldText(item.mode)}] ${fieldText(item.command)}${item.requiresConfirmation === true ? " (requires confirmation)" : ""}`)
  ].join("\n");
}

function parseWorkflowGoal(value: string): WorkflowGoal {
  if (value === "ask-question" || value === "reply" || value === "research-only" || value === "publish-topic") {
    return value;
  }
  throw new InvalidArgumentError(`Expected goal ask-question, reply, research-only, or publish-topic: ${value}`);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected a positive integer: ${value}`);
  }
  return parsed;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
