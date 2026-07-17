import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { ConfigFileError, loadConfig } from "../config.js";
import { formatHttpErrorText, formatTransportErrorText, remediationForHttpError, remediationForTransportError, stableErrorCode } from "../core/errors.js";
import {
  createWorkflowPlan,
  type WorkflowGoal,
  type WorkflowPlanInput
} from "../core/workflow-plan.js";
import { HttpError, NetworkError, redactSecret, requestJson, TimeoutError } from "../http.js";
import { blockText, fieldText, isRecord, outputFormat, parseOutputFormat, printData, printError, validateFormatOptions, type FormatOption } from "../output.js";
import type { CommandIo } from "./auth.js";

type WorkflowCommandOptions = CommandIo & {
  configPath?: string;
};

type WorkflowRunGoal =
  | "ask-question"
  | "reply"
  | "topic-create"
  | "topic-update"
  | "topic-delete"
  | "reply-create"
  | "reply-update"
  | "reply-delete";

type WorkflowPlanOptions = FormatOption & WorkflowPlanInput;

type WorkflowRunOptions = FormatOption & {
  goal?: WorkflowRunGoal;
  resume?: string;
  keyword?: string;
  topicId?: number;
  replyId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  contentFile?: string;
  ifVersion?: number;
  confirmTitle?: string;
  confirmId?: number;
  outputDir?: string;
  execute?: boolean;
  yes?: boolean;
};

type WorkflowApproveOptions = {
  runDir: string;
  approvedBy?: string;
  note?: string;
  expiresInMinutes?: number;
  json?: boolean;
};

type WorkflowVerifyOptions = {
  runDir: string;
  policy?: string;
  writeReport?: boolean;
  json?: boolean;
};

type WorkflowPolicyInitOptions = {
  output?: string;
  json?: boolean;
};

type WorkflowDiffOptions = {
  runDir: string;
  json?: boolean;
};

type WorkflowAuditLogOptions = {
  runDir: string;
  format?: "ndjson" | "json";
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

type Session = {
  profile: string;
  baseUrl: string;
  token: string;
};

type WorkflowRunStatus = "running" | "preview-ready" | "completed" | "failed" | "execution-uncertain";
type WorkflowRunStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

class WorkflowReviewError extends Error {
  constructor() {
    super("Workflow content review failed.");
    this.name = "WorkflowReviewError";
  }
}

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
  replyId?: number;
  categoryId?: number;
  title?: string;
  problem?: string;
  answer?: string;
  contentFile?: string;
  ifVersion?: number;
  confirmTitle?: string;
  confirmId?: number;
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
  expiresAt: string;
  approvedBy: string;
  note?: string;
  previewHash: string;
  target: WorkflowTarget;
  request: WorkflowPreviewRequest;
};

type WorkflowPreviewRequest = {
  method: "POST" | "DELETE";
  path: string;
  body: Record<string, unknown>;
};

type WorkflowTarget = {
  profile: string;
  baseUrl: string;
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
    .requiredOption("--goal <goal>", "workflow goal: ask-question, reply, research-only, publish-topic, topic-create/update/delete, reply-create/update/delete", parseWorkflowGoal)
    .option("--keyword <keyword>", "search or research keyword")
    .option("--topic-id <id>", "topic id", parsePositiveInteger)
    .option("--reply-id <id>", "reply id", parsePositiveInteger)
    .option("--category-id <id>", "category id", parsePositiveInteger)
    .option("--title <title>", "topic title")
    .option("--problem <text>", "question problem text for ask-question")
    .option("--answer <text>", "reply answer text for reply")
    .option("--content-file <path>", "existing Markdown content file for publish-topic")
    .option("--if-version <n>", "current object version for update/delete", parsePositiveInteger)
    .option("--confirm-title <title>", "exact topic title confirmation for topic delete")
    .option("--confirm-id <id>", "exact reply id confirmation for reply delete", parsePositiveInteger)
    .option("--output-dir <path>", "directory for planned local files")
    .option("--include-execute", "include final API execute steps after preview")
    .option("--json", "pretty-print JSON")
    .addOption(new Option("--format <format>", "output format: json, pretty, text").argParser(parseOutputFormat))
    .action((commandOptions: WorkflowPlanOptions) => {
      if (!validateFormatOptions(options, commandOptions)) {
        return;
      }
      const plan = createWorkflowPlan(commandOptions);
      printData(options, plan, outputFormat(commandOptions), formatWorkflowPlanText);
    });

  workflow
    .command("run")
    .option("--goal <goal>", "workflow goal: ask-question, reply, topic-create, topic-update, topic-delete, reply-create, reply-update, reply-delete", parseWorkflowRunGoal)
    .option("--resume <run-dir>", "resume an existing workflow run directory")
    .option("--keyword <keyword>", "search or research keyword for ask-question")
    .option("--topic-id <id>", "topic id for reply or topic update/delete", parsePositiveInteger)
    .option("--reply-id <id>", "reply id for reply update/delete", parsePositiveInteger)
    .option("--category-id <id>", "category id for topic create preview", parsePositiveInteger)
    .option("--title <title>", "topic title for ask-question")
    .option("--problem <text>", "question problem text for ask-question")
    .option("--answer <text>", "reply answer text for reply")
    .option("--content-file <path>", "Markdown content for topic/reply update")
    .option("--if-version <n>", "current object version for update/delete", parsePositiveInteger)
    .option("--confirm-title <title>", "exact topic title confirmation for topic delete")
    .option("--confirm-id <id>", "exact reply id confirmation for reply delete", parsePositiveInteger)
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
    .option("--expires-in-minutes <n>", "approval lifetime in minutes", parsePositiveInteger, 120)
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowApproveOptions) => {
      await approveWorkflow(options, commandOptions);
    });

  workflow
    .command("policy")
    .description("workflow policy helpers")
    .command("init")
    .option("--output <file>", "policy output path", "apexcn-policy.json")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowPolicyInitOptions) => {
      await initWorkflowPolicy(options, commandOptions);
    });

  workflow
    .command("verify")
    .requiredOption("--run-dir <run-dir>", "workflow run directory to verify")
    .option("--policy <file>", "JSON workflow policy file")
    .option("--write-report", "write verification.json in the run directory")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowVerifyOptions) => {
      await verifyWorkflow(options, commandOptions);
    });

  workflow
    .command("diff")
    .requiredOption("--run-dir <run-dir>", "workflow run directory to diff")
    .option("--json", "pretty-print JSON")
    .action(async (commandOptions: WorkflowDiffOptions) => {
      await diffWorkflow(options, commandOptions);
    });

  workflow
    .command("audit-log")
    .requiredOption("--run-dir <run-dir>", "workflow run directory")
    .option("--format <format>", "output format: ndjson or json", parseAuditLogFormat, "ndjson")
    .action(async (commandOptions: WorkflowAuditLogOptions) => {
      await auditWorkflow(options, commandOptions);
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

async function initWorkflowPolicy(io: CommandIo, options: WorkflowPolicyInitOptions): Promise<void> {
  const policy = defaultWorkflowPolicy();
  const output = options.output ?? "apexcn-policy.json";
  await writeJson(output, policy);
  printData(io, {
    kind: "workflow-policy-init",
    schemaVersion: 1,
    output,
    policy
  }, options.json === true);
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
  if (options.policy) {
    const policyResult = await verifyWorkflowPolicy(loaded.runDir, loaded.state, report, options.policy);
    report.policy = policyResult;
    if (!policyResult.ok) {
      report.ok = false;
    }
  }
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

async function diffWorkflow(io: CommandIo, options: WorkflowDiffOptions): Promise<void> {
  const loaded = await loadWorkflowRun(options.runDir);
  if (!loaded) {
    printError(io, { type: "validation", message: `Workflow run not found: ${options.runDir}` });
    process.exitCode = 1;
    return;
  }
  const preview = await readOptionalJson(loaded.state.artifacts.preview);
  const approval = await readOptionalJson(loaded.state.artifacts.approval);
  const previewRequest = verificationPreviewRequest(preview, loaded.state.artifacts.preview, []);
  const previewTarget = isRecord(preview) ? verificationWorkflowTarget({ profile: preview.profile, baseUrl: preview.baseUrl }) : undefined;
  const approvalRequest = isRecord(approval) ? verificationApprovalRequest(approval.request) : undefined;
  const approvalTarget = isRecord(approval) ? verificationWorkflowTarget(approval.target) : undefined;
  const currentHash = previewRequest && previewTarget ? workflowPreviewHash(previewTarget, previewRequest) : undefined;
  const approvalHash = isRecord(approval) && typeof approval.previewHash === "string" ? approval.previewHash : undefined;
  const allowed = Boolean(
    currentHash
    && approvalHash
    && currentHash === approvalHash
    && previewTarget
    && approvalTarget
    && canonicalJson(previewTarget) === canonicalJson(approvalTarget)
    && previewRequest
    && approvalRequest
    && canonicalJson(previewRequest) === canonicalJson(approvalRequest)
  );
  const differences = requestDifferences(previewRequest, approvalRequest);
  if (!allowed) {
    process.exitCode = 1;
  }
  printData(io, {
    kind: "workflow-diff",
    schemaVersion: 1,
    runId: loaded.state.runId,
    runDir: options.runDir,
    ok: allowed,
    previewRequest: previewRequest ?? null,
    approvalRequest: approvalRequest ?? null,
    previewHash: currentHash,
    approvalHash,
    approvedRequestHash: approvalHash,
    approvalBoundRequestHash: approvalHash,
    currentRequestHash: currentHash,
    hashMatches: allowed,
    executionAllowed: allowed,
    changes: differences,
    differences
  }, options.json === true);
}

async function auditWorkflow(io: CommandIo, options: WorkflowAuditLogOptions): Promise<void> {
  const loaded = await loadWorkflowRun(options.runDir);
  if (!loaded) {
    printError(io, { type: "validation", message: `Workflow run not found: ${options.runDir}` });
    process.exitCode = 1;
    return;
  }
  const report = await workflowVerificationReport(loaded.runDir, loaded.state);
  const events = workflowAuditEvents(loaded.state, report);
  if (options.format === "json") {
    printData(io, { kind: "workflow-audit-log", schemaVersion: 1, events }, true);
    return;
  }
  for (const event of events) {
    io.stdout(`${JSON.stringify(event)}\n`);
  }
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

  let preview: { target: WorkflowTarget; request: WorkflowPreviewRequest };
  try {
    preview = await workflowPreviewEnvelope(state.artifacts.preview);
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
    expiresAt: new Date(Date.now() + (options.expiresInMinutes ?? 120) * 60_000).toISOString(),
    approvedBy: fieldText(options.approvedBy).trim() || process.env.USER || "unknown",
    note: fieldText(options.note).trim() || undefined,
    previewHash: workflowPreviewHash(preview.target, preview.request),
    target: preview.target,
    request: preview.request
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
    if (loaded.state.status === "completed" || await fileExists(loaded.state.artifacts.execute)) {
      printError(io, { type: "safety", message: "Workflow execution is already completed; refusing duplicate execution." });
      process.exitCode = 1;
      return;
    }
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
  if (options.execute && loaded) {
    const targetError = await workflowTargetError(loaded.state, session);
    if (targetError) {
      loaded.state.nextAction = "Restore the approved profile and base URL, or create and approve a new workflow.";
      await writeRunState(loaded.runDir, loaded.state);
      printError(io, { type: "safety", message: targetError });
      process.exitCode = 1;
      return;
    }
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
    const uncertain = options.execute === true && isUncertainWriteError(error);
    state.status = uncertain ? "execution-uncertain" : "failed";
    state.nextAction = workflowRecoveryNextAction(error, runDir, options.execute === true, uncertain);
    await writeRunState(runDir, state);
    handleRunError(io, error, session);
    return;
  }
  state.status = options.execute ? "completed" : "preview-ready";
  state.nextAction = options.execute ? "Workflow completed." : `Review ${state.artifacts.preview} and approve it with apexcn workflow approve --run-dir ${shellArg(runDir)} --json.`;
  await writeRunState(runDir, state);
  printData(io, state, outputFormat(options), formatWorkflowRunText);
}

async function workflowVerificationReport(runDir: string, state: WorkflowRunState): Promise<Record<string, unknown> & { ok: boolean; reportPath?: string }> {
  const issues: WorkflowVerificationIssue[] = [];
  const warnings: WorkflowVerificationIssue[] = [];
  const artifacts = await workflowArtifactEvidence(state);
  const executionAttempted = state.steps.some((step) => step.id.startsWith("execute-") && step.status !== "pending");
  const previewRequired = state.status === "preview-ready"
    || state.status === "completed"
    || state.status === "execution-uncertain"
    || executionAttempted;
  const approvalRequired = state.status === "completed" || state.status === "execution-uncertain" || executionAttempted;
  const preview = await readVerificationJson(state.artifacts.preview, issues, "invalid-preview", previewRequired);
  const previewRequest = preview ? verificationPreviewRequest(preview, state.artifacts.preview, issues) : undefined;
  const previewTarget = isRecord(preview) ? verificationWorkflowTarget({ profile: preview.profile, baseUrl: preview.baseUrl }) : undefined;
  if (preview && !previewTarget) {
    issues.push({ code: "invalid-preview-target", message: "Preview target is invalid.", path: state.artifacts.preview });
  }
  const previewHash = previewRequest && previewTarget ? workflowPreviewHash(previewTarget, previewRequest) : undefined;

  const approval = await readVerificationJson(state.artifacts.approval, issues, "invalid-approval", approvalRequired);
  if (!approval && state.status === "preview-ready") {
    warnings.push({ code: "approval-missing", message: "Workflow preview has not been approved.", path: state.artifacts.approval });
  }
  const approvalSummary = approval ? verificationApproval(approval, state, previewTarget, previewHash, issues) : undefined;

  const execute = await readVerificationJson(state.artifacts.execute, issues, "invalid-execute", state.status === "completed");
  if (!execute && state.status !== "completed") {
    warnings.push({ code: "execute-missing", message: "Workflow has not executed yet.", path: state.artifacts.execute });
  }
  const executeSummary = execute ? verificationExecute(execute, approvalSummary?.target, approvalSummary?.request, issues) : undefined;

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

type WorkflowPolicy = {
  schemaVersion: 1;
  defaults: {
    requirePreview: boolean;
    requireApproval: boolean;
    approvalExpiresInMinutes: number;
  };
  commands: Record<string, Record<string, unknown>>;
  mcp: {
    allowExecute: false;
  };
};

function defaultWorkflowPolicy(): WorkflowPolicy {
  return {
    schemaVersion: 1,
    defaults: {
      requirePreview: true,
      requireApproval: true,
      approvalExpiresInMinutes: 120
    },
    commands: {
      "topic.create": { allowed: true, requireReview: true, minContentLength: 80 },
      "topic.delete": { allowed: true, requireExactTitle: true, requireTwoReviewers: true },
      "reply.delete": { allowed: true, requireExactTitle: false }
    },
    mcp: {
      allowExecute: false
    }
  };
}

async function verifyWorkflowPolicy(runDir: string, state: WorkflowRunState, report: Record<string, unknown> & { ok: boolean }, policyPath: string): Promise<Record<string, unknown> & { ok: boolean }> {
  const issues: WorkflowVerificationIssue[] = [];
  const policy = await readJson(policyPath);
  if (!isWorkflowPolicy(policy)) {
    return { kind: "workflow-policy-verification", schemaVersion: 1, ok: false, policyPath, issues: [{ code: "invalid-policy", message: "Workflow policy schema is invalid.", path: policyPath }] };
  }
  if (policy.mcp.allowExecute !== false) {
    issues.push({ code: "mcp-execute-enabled", message: "Policy must keep mcp.allowExecute=false.", path: policyPath });
  }
  const approval = await readOptionalJson(state.artifacts.approval);
  if (policy.defaults.requireApproval && !approval) {
    issues.push({ code: "policy-approval-required", message: "Policy requires approval.", path: state.artifacts.approval });
  }
  if (isRecord(approval) && typeof approval.approvedAt === "string") {
    const ageMs = Date.now() - Date.parse(approval.approvedAt);
    if (Number.isFinite(ageMs) && ageMs > policy.defaults.approvalExpiresInMinutes * 60_000) {
      issues.push({ code: "policy-approval-expired", message: "Approval is expired.", path: state.artifacts.approval });
    }
  }
  const approvalSummary = isRecord(report.approval) ? report.approval : undefined;
  if (approvalSummary && approvalSummary.hashMatches === false) {
    issues.push({ code: "policy-hash-mismatch", message: "Approval hash does not match preview request.", path: state.artifacts.approval });
  }
  const commandId = workflowCommandId(state.goal);
  const commandPolicy = policy.commands[commandId];
  if (commandPolicy?.allowed === false) {
    issues.push({ code: "policy-command-blocked", message: `Policy blocks ${commandId}.`, path: policyPath });
  }
  return {
    kind: "workflow-policy-verification",
    schemaVersion: 1,
    ok: issues.length === 0,
    policyPath,
    runDir,
    command: commandId,
    issues
  };
}

function isWorkflowPolicy(value: unknown): value is WorkflowPolicy {
  return isRecord(value)
    && value.schemaVersion === 1
    && isRecord(value.defaults)
    && typeof value.defaults.requirePreview === "boolean"
    && typeof value.defaults.requireApproval === "boolean"
    && typeof value.defaults.approvalExpiresInMinutes === "number"
    && isRecord(value.commands)
    && isRecord(value.mcp)
    && value.mcp.allowExecute === false;
}

async function readOptionalJson(path: string | undefined): Promise<unknown | undefined> {
  if (!path) {
    return undefined;
  }
  try {
    return await readJson(path);
  } catch {
    return undefined;
  }
}

function requestDifferences(left: WorkflowPreviewRequest | undefined, right: WorkflowPreviewRequest | undefined): Array<Record<string, unknown>> {
  if (!left || !right) {
    return [{ path: "request", leftPresent: Boolean(left), rightPresent: Boolean(right) }];
  }
  const differences = [];
  if (left.method !== right.method) {
    differences.push({ path: "method", left: left.method, right: right.method });
  }
  if (left.path !== right.path) {
    differences.push({ path: "path", left: left.path, right: right.path });
  }
  if (stableJson(left.body) !== stableJson(right.body)) {
    differences.push({
      path: "body",
      leftHash: createHash("sha256").update(stableJson(left.body), "utf8").digest("hex"),
      rightHash: createHash("sha256").update(stableJson(right.body), "utf8").digest("hex")
    });
  }
  return differences;
}

function workflowAuditEvents(state: WorkflowRunState, report: Record<string, unknown>): Array<Record<string, unknown>> {
  const time = state.updatedAt;
  const command = workflowCommandId(state.goal);
  const previewHash = typeof report.previewHash === "string" ? report.previewHash : undefined;
  const events = [
    auditEvent(time, state.runId, "plan", command, previewHash, "ok", "workflow state exists"),
    auditEvent(time, state.runId, "preview", command, previewHash, state.status === "preview-ready" || state.status === "completed" ? "ok" : "blocked", state.nextAction)
  ];
  if (isRecord(report.approval)) {
    events.push(auditEvent(time, state.runId, "approve", command, previewHash, report.approval.hashMatches === false ? "failed" : "ok", "approval artifact present"));
  }
  events.push(auditEvent(time, state.runId, "verify", command, previewHash, report.ok === false ? "failed" : "ok", report.ok === false ? "verification issues found" : "verification passed"));
  return events;
}

function auditEvent(time: string, runId: string, event: string, command: string, requestHash: string | undefined, result: string, reason: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    time,
    runId,
    event,
    command,
    requestHash,
    actor: "local-user",
    result,
    reason
  };
}

function workflowCommandId(goal: WorkflowRunGoal): string {
  if (goal === "ask-question" || goal === "topic-create") return "topic.create";
  if (goal === "topic-update") return "topic.update";
  if (goal === "topic-delete") return "topic.delete";
  if (goal === "reply" || goal === "reply-create") return "reply.create";
  if (goal === "reply-update") return "reply.update";
  return "reply.delete";
}

function parseAuditLogFormat(value: string): "ndjson" | "json" {
  if (value === "ndjson" || value === "json") {
    return value;
  }
  throw new InvalidArgumentError(`Expected audit-log format ndjson or json: ${value}`);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortJson(nested)]));
  }
  return value;
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
  const preview = bundleJsonArtifact(artifacts, "preview", issues, status === "preview-ready" || status === "completed" || status === "execution-uncertain");
  const previewRequest = preview ? verificationPreviewRequest(preview, "bundle:preview", issues) : undefined;
  const previewTarget = isRecord(preview) ? verificationWorkflowTarget({ profile: preview.profile, baseUrl: preview.baseUrl }) : undefined;
  const previewHash = previewRequest && previewTarget ? workflowPreviewHash(previewTarget, previewRequest) : undefined;
  const approval = bundleJsonArtifact(artifacts, "approval", issues, status === "completed" || status === "execution-uncertain");
  if (!approval && status === "preview-ready") {
    warnings.push({ code: "approval-missing", message: "Bundle preview has not been approved." });
  }
  const approved = approval ? verifyBundleApproval(runId, approval, previewTarget, previewHash, issues) : undefined;
  const execute = bundleJsonArtifact(artifacts, "execute", issues, status === "completed");
  if (!execute && status !== "completed") {
    warnings.push({ code: "execute-missing", message: "Bundle workflow has not executed yet." });
  }
  if (execute) {
    verifyBundleExecute(execute, approved?.target, approved?.request, issues);
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

function verifyBundleApproval(
  runId: string,
  approval: unknown,
  previewTarget: WorkflowTarget | undefined,
  previewHash: string | undefined,
  issues: WorkflowVerificationIssue[]
): { target: WorkflowTarget; request: WorkflowPreviewRequest } | undefined {
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
  const target = verificationWorkflowTarget(approval.target);
  if (!target || !previewTarget || canonicalJson(target) !== canonicalJson(previewTarget)) {
    issues.push({ code: "approval-target-mismatch", message: "Bundle approval target does not match bundled preview." });
    return undefined;
  }
  const request = verificationApprovalRequest(approval.request);
  if (!request || workflowPreviewHash(target, request) !== approval.previewHash) {
    issues.push({ code: "approval-request-mismatch", message: "Bundle approval request does not match approval hash." });
    return undefined;
  }
  return { target, request };
}

function verifyBundleExecute(
  execute: unknown,
  approvedTarget: WorkflowTarget | undefined,
  approvedRequest: WorkflowPreviewRequest | undefined,
  issues: WorkflowVerificationIssue[]
): void {
  if (!isRecord(execute) || execute.kind !== "workflow-execute" || execute.schemaVersion !== 1 || !isRecord(execute.request)) {
    issues.push({ code: "invalid-execute", message: "Bundle execute artifact has an invalid schema." });
    return;
  }
  if (approvedRequest && canonicalJson(execute.request) !== canonicalJson(approvedRequest)) {
    issues.push({ code: "execute-request-mismatch", message: "Bundle execute request does not match approved preview request." });
  }
  const target = verificationWorkflowTarget(execute.target);
  if (approvedTarget && (!target || canonicalJson(target) !== canonicalJson(approvedTarget))) {
    issues.push({ code: "execute-target-mismatch", message: "Bundle execute target does not match approved preview target." });
  }
  if (approvedTarget && approvedRequest && execute.requestHash !== workflowPreviewHash(approvedTarget, approvedRequest)) {
    issues.push({ code: "execute-hash-mismatch", message: "Bundle execute hash does not match approved preview hash." });
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
  if (!isRecord(preview)
      || preview.kind !== "workflow-preview"
      || !isRecord(preview.request)
      || (preview.request.method !== "POST" && preview.request.method !== "DELETE")
      || typeof preview.request.path !== "string"
      || !isRecord(preview.request.body)) {
    issues.push({ code: "invalid-preview", message: "Preview artifact does not contain a valid write request.", path });
    return undefined;
  }
  return { method: preview.request.method, path: preview.request.path, body: preview.request.body };
}

function verificationApproval(
  approval: unknown,
  state: WorkflowRunState,
  previewTarget: WorkflowTarget | undefined,
  previewHash: string | undefined,
  issues: WorkflowVerificationIssue[]
): { runId?: unknown; previewHash?: unknown; target?: WorkflowTarget; request?: WorkflowPreviewRequest } {
  const summary: { runId?: unknown; previewHash?: unknown; target?: WorkflowTarget; request?: WorkflowPreviewRequest } = {};
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
  if (typeof approval.expiresAt !== "string" || !Number.isFinite(Date.parse(approval.expiresAt))) {
    issues.push({ code: "approval-expiry-invalid", message: "Approval expiry is invalid.", path: state.artifacts.approval });
  } else if (Date.parse(approval.expiresAt) <= Date.now()) {
    issues.push({ code: "approval-expired", message: "Approval is expired.", path: state.artifacts.approval });
  }
  const target = verificationWorkflowTarget(approval.target);
  if (!target || !previewTarget || canonicalJson(target) !== canonicalJson(previewTarget)) {
    issues.push({ code: "approval-target-mismatch", message: "Approval target does not match preview target.", path: state.artifacts.approval });
  } else {
    summary.target = target;
  }
  const request = verificationApprovalRequest(approval.request);
  if (!request || !target || workflowPreviewHash(target, request) !== approval.previewHash) {
    issues.push({ code: "approval-request-mismatch", message: "Approval request does not match its recorded preview hash.", path: state.artifacts.approval });
  } else {
    summary.request = request;
  }
  return summary;
}

function verificationApprovalRequest(value: unknown): WorkflowPreviewRequest | undefined {
  if (!isRecord(value)
      || (value.method !== "POST" && value.method !== "DELETE")
      || typeof value.path !== "string"
      || !isRecord(value.body)) {
    return undefined;
  }
  return { method: value.method, path: value.path, body: value.body };
}

function verificationWorkflowTarget(value: unknown): WorkflowTarget | undefined {
  if (!isRecord(value) || typeof value.profile !== "string" || typeof value.baseUrl !== "string") {
    return undefined;
  }
  return { profile: value.profile, baseUrl: value.baseUrl };
}

function verificationExecute(
  execute: unknown,
  approvedTarget: WorkflowTarget | undefined,
  approvedRequest: WorkflowPreviewRequest | undefined,
  issues: WorkflowVerificationIssue[]
): { request?: unknown; requestId?: unknown; requestHash?: unknown } {
  const summary: { request?: unknown; requestId?: unknown; requestHash?: unknown } = {};
  if (!isRecord(execute) || execute.kind !== "workflow-execute" || execute.schemaVersion !== 1 || !isRecord(execute.request)) {
    issues.push({ code: "invalid-execute", message: "Execute artifact has an invalid schema." });
    return summary;
  }
  summary.request = execute.request;
  summary.requestId = execute.requestId;
  summary.requestHash = execute.requestHash;
  const target = verificationWorkflowTarget(execute.target);
  if (approvedTarget && (!target || canonicalJson(target) !== canonicalJson(approvedTarget))) {
    issues.push({ code: "execute-target-mismatch", message: "Execute target does not match approved preview target." });
  }
  if (approvedRequest && canonicalJson(execute.request) !== canonicalJson(approvedRequest)) {
    issues.push({ code: "execute-request-mismatch", message: "Execute request does not match approved preview request." });
  }
  if (approvedTarget && approvedRequest && execute.requestHash !== workflowPreviewHash(approvedTarget, approvedRequest)) {
    issues.push({ code: "execute-hash-mismatch", message: "Execute request hash does not match approved preview hash." });
  }
  return summary;
}

async function executeRunSteps(state: WorkflowRunState, runDir: string, session: Session, options: WorkflowRunOptions): Promise<void> {
  if (isContentMutationGoal(state.goal)) {
    await executeContentMutationSteps(state, runDir, session, options);
    return;
  }
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
      const review = reviewArtifact(state, options, state.artifacts.question, content);
      await writeJson(state.artifacts.review, review);
      await requirePassingWorkflowReview(state, review, state.artifacts.question);
    });
    await runStep(state, runDir, "preview-topic-create", state.artifacts.preview, async () => {
      const content = await readFile(state.artifacts.question, "utf8");
      const body = {
        categoryId: effectiveCategoryId(state, options),
        title: effectiveTitle(state, options),
        content
      };
      const request = replaySafeRequest(state, "POST", "/api/v1/topics", body);
      await writeJson(state.artifacts.preview, {
        kind: "workflow-preview",
        schemaVersion: 1,
        profile: session.profile,
        baseUrl: session.baseUrl,
        request,
        result: null
      });
    });
    if (options.execute) {
      await runStep(state, runDir, "execute-topic-create", state.artifacts.execute, async () => {
        return executePreviewRequest(state, session, "POST", "/api/v1/topics");
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
  await runStep(state, runDir, "review-reply", state.artifacts.review, async () => {
    const content = await readFile(state.artifacts.reply, "utf8");
    const review = workflowContentReview(state.goal, content, state.artifacts.reply);
    await writeJson(state.artifacts.review, review);
    await requirePassingWorkflowReview(state, review, state.artifacts.reply);
  });
  await runStep(state, runDir, "preview-reply-create", state.artifacts.preview, async () => {
    const content = await readFile(state.artifacts.reply, "utf8");
    const topicId = effectiveTopicId(state, options);
    const path = `/api/v1/topics/${topicId}/replies`;
    const request = replaySafeRequest(state, "POST", path, { content });
    await writeJson(state.artifacts.preview, {
      kind: "workflow-preview",
      schemaVersion: 1,
      profile: session.profile,
      baseUrl: session.baseUrl,
      request,
      result: null
    });
  });
  if (options.execute) {
    await runStep(state, runDir, "execute-reply-create", state.artifacts.execute, async () => {
      const topicId = effectiveTopicId(state, options);
      const path = `/api/v1/topics/${topicId}/replies`;
      return executePreviewRequest(state, session, "POST", path);
    });
  }
}

async function executeContentMutationSteps(
  state: WorkflowRunState,
  runDir: string,
  session: Session,
  options: WorkflowRunOptions
): Promise<void> {
  const contentArtifact = state.inputs.contentFile ? state.artifacts.content : undefined;
  if (contentArtifact) {
    await runStep(state, runDir, "capture-content", contentArtifact, async () => {
      const source = state.inputs.contentFile;
      if (!source) {
        throw new Error("Workflow run is missing content file input.");
      }
      await writeFile(contentArtifact, await readFile(source, "utf8"), "utf8");
    });
    await runStep(state, runDir, "review-content", state.artifacts.review, async () => {
      const content = await readFile(contentArtifact, "utf8");
      const review = workflowContentReview(state.goal, content, contentArtifact);
      await writeJson(state.artifacts.review, review);
      await requirePassingWorkflowReview(state, review, contentArtifact);
    });
  } else if (state.goal === "topic-update") {
    for (const id of ["capture-content", "review-content"]) {
      const step = stepState(state, id);
      step.status = "skipped";
      step.endedAt = now();
    }
    await writeRunState(runDir, state);
  }

  const request = await contentMutationRequest(state);
  const previewStep = `preview-${state.goal}`;
  await runStep(state, runDir, previewStep, state.artifacts.preview, async () => {
    await writeJson(state.artifacts.preview, {
      kind: "workflow-preview",
      schemaVersion: 1,
      profile: session.profile,
      baseUrl: session.baseUrl,
      request,
      result: null
    });
  });
  if (options.execute) {
    await runStep(state, runDir, `execute-${state.goal}`, state.artifacts.execute, async () =>
      executePreviewRequest(state, session, request.method, request.path)
    );
  }
}

async function contentMutationRequest(state: WorkflowRunState): Promise<WorkflowPreviewRequest> {
  if (state.goal === "topic-create") {
    const content = state.artifacts.content ? await readFile(state.artifacts.content, "utf8") : "";
    return replaySafeRequest(state, "POST", "/api/v1/topics", {
      categoryId: requiredWorkflowId(state.inputs.categoryId, "category id"),
      title: fieldText(state.inputs.title),
      content
    });
  }
  if (state.goal === "topic-update") {
    const body = compactObject({
      categoryId: state.inputs.categoryId,
      title: state.inputs.title,
      content: state.inputs.contentFile && state.artifacts.content ? await readFile(state.artifacts.content, "utf8") : undefined
    });
    return replaySafeRequest(state, "POST", `/api/v1/topics/${requiredWorkflowId(state.inputs.topicId, "topic id")}`, body, state.inputs.ifVersion);
  }
  if (state.goal === "topic-delete") {
    return replaySafeRequest(
      state,
      "DELETE",
      `/api/v1/topics/${requiredWorkflowId(state.inputs.topicId, "topic id")}`,
      { confirmTitle: fieldText(state.inputs.confirmTitle) },
      state.inputs.ifVersion
    );
  }
  if (state.goal === "reply-update") {
    const content = state.artifacts.content ? await readFile(state.artifacts.content, "utf8") : "";
    return replaySafeRequest(
      state,
      "POST",
      `/api/v1/replies/${requiredWorkflowId(state.inputs.replyId, "reply id")}`,
      { content },
      state.inputs.ifVersion
    );
  }
  if (state.goal === "reply-create") {
    const content = state.artifacts.content ? await readFile(state.artifacts.content, "utf8") : "";
    return replaySafeRequest(
      state,
      "POST",
      `/api/v1/topics/${requiredWorkflowId(state.inputs.topicId, "topic id")}/replies`,
      { content }
    );
  }
  return replaySafeRequest(
    state,
    "DELETE",
    `/api/v1/replies/${requiredWorkflowId(state.inputs.replyId, "reply id")}`,
    { confirmId: requiredWorkflowId(state.inputs.confirmId, "confirmed reply id") },
    state.inputs.ifVersion
  );
}

function replaySafeRequest(
  state: WorkflowRunState,
  method: WorkflowPreviewRequest["method"],
  path: string,
  payload: Record<string, unknown>,
  ifVersion?: number
): WorkflowPreviewRequest {
  const payloadHash = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  const operationSeed = canonicalJson({ runId: state.runId, method, path, payloadHash });
  const operationKey = `m060:${createHash("sha256").update(operationSeed, "utf8").digest("hex").slice(0, 48)}`;
  return {
    method,
    path,
    body: compactObject({
      ...payload,
      operationKey,
      payloadHash,
      ifVersion
    })
  };
}

async function executePreviewRequest(
  state: WorkflowRunState,
  session: Session,
  expectedMethod: WorkflowPreviewRequest["method"],
  expectedPath: string
): Promise<string | undefined> {
  const preview = await workflowPreviewEnvelope(state.artifacts.preview);
  const request = preview.request;
  if (request.method !== expectedMethod || request.path !== expectedPath) {
    throw new Error(`Workflow preview artifact does not match expected ${expectedMethod} ${expectedPath}.`);
  }
  const response = await requestJson(session.baseUrl, request.path, {
    token: session.token,
    method: request.method,
    body: request.body
  });
  const artifact = {
    kind: "workflow-execute",
    schemaVersion: 1,
    requestId: requestIdFrom(response),
    requestHash: workflowPreviewHash(preview.target, request),
    target: preview.target,
    request,
    result: response
  };
  await writeJson(state.artifacts.execute, artifact);
  return requestIdFrom(response);
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
    replyId: options.replyId,
    categoryId: options.categoryId,
    title: fieldText(options.title).trim() || undefined,
    problem: fieldText(options.problem).trim() || undefined,
    answer: fieldText(options.answer).trim() || undefined,
    contentFile: fieldText(options.contentFile).trim() || undefined,
    ifVersion: options.ifVersion,
    confirmTitle: fieldText(options.confirmTitle).trim() || undefined,
    confirmId: options.confirmId
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
  if (isContentMutationGoal(goal)) {
    return compactObject({
      state: join(runDir, "run.json"),
      content: goal.endsWith("-create") || goal.endsWith("-update") ? join(runDir, "content.md") : undefined,
      review: goal.endsWith("-create") || goal.endsWith("-update") ? join(runDir, "review.json") : undefined,
      preview: join(runDir, "preview.json"),
      approval: join(runDir, "approval.json"),
      execute: join(runDir, "execute.json")
    }) as Record<string, string>;
  }
  return {
    state: join(runDir, "run.json"),
    topic: join(runDir, "topic.json"),
    reply: join(runDir, "reply.md"),
    review: join(runDir, "review.json"),
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
  if (isContentMutationGoal(goal)) {
    const steps = goal.endsWith("-create") || goal.endsWith("-update")
      ? ["capture-content", "review-content", `preview-${goal}`]
      : [`preview-${goal}`];
    return execute ? [...steps, `execute-${goal}`] : steps;
  }
  return execute
    ? ["topic-view", "draft-reply", "review-reply", "preview-reply-create", "execute-reply-create"]
    : ["topic-view", "draft-reply", "review-reply", "preview-reply-create"];
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
  } else if (goal === "reply") {
    if (options.topicId === undefined) {
      missing.push("--topic-id");
    }
    if (!fieldText(options.answer).trim()) {
      missing.push("--answer");
    }
  } else if (goal === "topic-create") {
    if (options.categoryId === undefined) missing.push("--category-id");
    if (!fieldText(options.title).trim()) missing.push("--title");
    if (!options.contentFile) missing.push("--content-file");
  } else if (goal === "topic-update") {
    if (options.topicId === undefined) missing.push("--topic-id");
    if (options.ifVersion === undefined) missing.push("--if-version");
    if (!options.contentFile && !fieldText(options.title).trim() && options.categoryId === undefined) {
      missing.push("--content-file|--title|--category-id");
    }
  } else if (goal === "topic-delete") {
    if (options.topicId === undefined) missing.push("--topic-id");
    if (options.ifVersion === undefined) missing.push("--if-version");
    if (!fieldText(options.confirmTitle).trim()) missing.push("--confirm-title");
  } else if (goal === "reply-create") {
    if (options.topicId === undefined) missing.push("--topic-id");
    if (!options.contentFile) missing.push("--content-file");
  } else if (goal === "reply-update") {
    if (options.replyId === undefined) missing.push("--reply-id");
    if (options.ifVersion === undefined) missing.push("--if-version");
    if (!options.contentFile) missing.push("--content-file");
  } else {
    if (options.replyId === undefined) missing.push("--reply-id");
    if (options.ifVersion === undefined) missing.push("--if-version");
    if (options.confirmId === undefined) missing.push("--confirm-id");
    if (options.replyId !== undefined && options.confirmId !== undefined && options.replyId !== options.confirmId) {
      missing.push("--confirm-id must match --reply-id");
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
  if (containsPotentialSecret(content)) {
    issues.push({ code: "possible-secret", severity: "issue", message: "Content appears to contain a token, Authorization header, or password." });
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

function workflowContentReview(goal: WorkflowRunGoal, content: string, contentFile: string): Record<string, unknown> {
  const issues = [];
  if (!content.trim()) {
    issues.push({ code: "blank-content", severity: "issue", message: "Content must not be blank." });
  }
  if (content.includes("待补充")) {
    issues.push({ code: "placeholder-content", severity: "issue", message: "Content still contains 待补充 placeholders." });
  }
  if (containsPotentialSecret(content)) {
    issues.push({ code: "possible-secret", severity: "issue", message: "Content appears to contain a token, Authorization header, or password." });
  }
  return {
    kind: "workflow-review",
    schemaVersion: 1,
    request: {
      goal,
      contentFile
    },
    result: {
      ok: issues.length === 0,
      issues,
      warnings: [],
      metrics: {
        contentLength: content.length,
        referenceCount: (content.match(/https?:\/\/\S+/g) ?? []).length
      }
    }
  };
}

async function requirePassingWorkflowReview(
  state: WorkflowRunState,
  review: Record<string, unknown>,
  contentArtifact: string
): Promise<void> {
  if (isRecord(review.result) && review.result.ok === true) {
    return;
  }
  const issues = isRecord(review.result) && Array.isArray(review.result.issues) ? review.result.issues : [];
  if (issues.some((issue) => isRecord(issue) && issue.code === "possible-secret")) {
    if (state.goal === "ask-question") {
      state.inputs.problem = "[redacted]";
    } else if (state.goal === "reply") {
      state.inputs.answer = "[redacted]";
    }
    await writeFile(contentArtifact, "[redacted unsafe content]\n", "utf8");
  }
  throw new WorkflowReviewError();
}

function containsPotentialSecret(content: string): boolean {
  return /\b(Authorization:\s*Bearer\s+\S+|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|APEXCN_API_KEY\s*=|password\s*=|token\s*=)\b/i.test(content);
}

function parseWorkflowRunGoal(value: string): WorkflowRunGoal {
  if (isWorkflowRunGoal(value)) {
    return value;
  }
  throw new InvalidArgumentError(`Expected workflow run goal ask-question, reply, topic-create, topic-update, topic-delete, reply-create, reply-update, or reply-delete: ${value}`);
}

function isWorkflowRunGoal(value: unknown): value is WorkflowRunGoal {
  return value === "ask-question"
    || value === "reply"
    || value === "topic-create"
    || value === "topic-update"
    || value === "topic-delete"
    || value === "reply-create"
    || value === "reply-update"
    || value === "reply-delete";
}

function isContentMutationGoal(goal: WorkflowRunGoal): goal is Exclude<WorkflowRunGoal, "ask-question" | "reply"> {
  return goal === "topic-create"
    || goal === "topic-update"
    || goal === "topic-delete"
    || goal === "reply-create"
    || goal === "reply-update"
    || goal === "reply-delete";
}

function requiredWorkflowId(value: number | undefined, label: string): number {
  if (value === undefined) {
    throw new Error(`Workflow run is missing ${label}.`);
  }
  return value;
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
  if (typeof approvalData.expiresAt !== "string" || !Number.isFinite(Date.parse(approvalData.expiresAt))) {
    return `Invalid workflow approval expiry: ${state.artifacts.approval}`;
  }
  if (Date.parse(approvalData.expiresAt) <= Date.now()) {
    return "Workflow approval expired; create and review a new approval before execution.";
  }
  const preview = await workflowPreviewEnvelope(state.artifacts.preview);
  const currentHash = workflowPreviewHash(preview.target, preview.request);
  if (approvalData.previewHash !== currentHash) {
    return "Workflow approval hash mismatch; review and approve the current preview again.";
  }
  const approvalTarget = verificationWorkflowTarget(approvalData.target);
  const approvalRequest = verificationApprovalRequest(approvalData.request);
  if (!approvalTarget || canonicalJson(approvalTarget) !== canonicalJson(preview.target)) {
    return "Workflow approval target does not match the current preview target.";
  }
  if (!approvalRequest || canonicalJson(approvalRequest) !== canonicalJson(preview.request)) {
    return "Workflow approval request does not match the current preview request.";
  }
  return undefined;
}

async function workflowTargetError(state: WorkflowRunState, session: Session): Promise<string | undefined> {
  const preview = await workflowPreviewEnvelope(state.artifacts.preview);
  if (preview.target.profile !== session.profile || preview.target.baseUrl !== session.baseUrl) {
    return "Workflow execution target does not match the approved profile and base URL.";
  }
  return undefined;
}

async function workflowPreviewEnvelope(path: string): Promise<{ target: WorkflowTarget; request: WorkflowPreviewRequest }> {
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
  if ((method !== "POST" && method !== "DELETE") || typeof requestPath !== "string" || !isRecord(preview.request.body)) {
    throw new Error(`Invalid workflow preview artifact: ${path}`);
  }
  const target = verificationWorkflowTarget({ profile: preview.profile, baseUrl: preview.baseUrl });
  if (!target) {
    throw new Error(`Invalid workflow preview target: ${path}`);
  }
  return { target, request: { method, path: requestPath, body: preview.request.body } };
}

function workflowPreviewHash(target: WorkflowTarget, request: WorkflowPreviewRequest): string {
  return createHash("sha256").update(canonicalJson({ target, request }), "utf8").digest("hex");
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

function isUncertainWriteError(error: unknown): boolean {
  return error instanceof NetworkError
    || error instanceof TimeoutError
    || (error instanceof HttpError && error.status >= 500);
}

function workflowRecoveryNextAction(error: unknown, runDir: string, executing: boolean, uncertain: boolean): string {
  const retry = `apexcn workflow run --resume ${shellArg(runDir)} --execute --yes --json`;
  if (uncertain) {
    return `Execution outcome is uncertain. Retry only with ${retry} so the identical operationKey is reused.`;
  }
  if (!executing || !(error instanceof HttpError)) {
    return "Fix the failed step and rerun with --resume.";
  }
  if (error.status === 401) {
    return `Refresh the active profile credential, then rerun ${retry}; the identical operationKey and approved request will be reused.`;
  }
  if (error.status === 409) {
    return "Fetch the latest resource version and create and approve a new workflow. Do not retry the stale approval.";
  }
  if (error.status === 429) {
    const wait = error.retryAfterSeconds === undefined ? "Wait for the rate-limit window" : `Wait at least ${error.retryAfterSeconds} seconds`;
    return `${wait}, then rerun ${retry}; the identical operationKey and approved request will be reused.`;
  }
  if (error.status === 403) {
    return `Restore the required permission, then rerun ${retry}; do not create a replacement operation.`;
  }
  return "Fix the failed step and rerun with --resume.";
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
  if (error instanceof WorkflowReviewError) {
    printError(io, { type: "safety", message: error.message });
    process.exitCode = 1;
    return;
  }
  if (error instanceof HttpError) {
    printError(io, {
      type: "http",
      code: stableErrorCode(error),
      message: redactSecret(error.message, session.token),
      status: error.status,
      requestId: error.requestId,
      remediation: remediationForHttpError(error, session.token)
    }, formatHttpErrorText(error, session.token));
    process.exitCode = 1;
    return;
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    printError(io, {
      type: error instanceof TimeoutError ? "timeout" : "network",
      code: stableErrorCode(error),
      message: error.message,
      remediation: remediationForTransportError(error)
    }, formatTransportErrorText(error));
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
  throw new InvalidArgumentError(`Expected goal ask-question, reply, research-only, publish-topic, topic-create/update/delete, or reply-create/update/delete: ${value}`);
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
