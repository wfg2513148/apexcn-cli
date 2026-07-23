import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { defaultConfigPath } from "../config.js";
import { HttpError, NetworkError, requestJson, TimeoutError } from "../http.js";
import { assessCapabilityCompatibility } from "./capability-compatibility.js";

export type WriteOperationSession = {
  profile: string;
  baseUrl: string;
  token: string;
};

export type WriteOperationRequest = {
  method: "POST" | "DELETE";
  path: string;
  body: Record<string, unknown>;
};

type WriteOperationTarget = {
  profile: string;
  baseUrl: string;
  credentialFingerprint: string;
};

type WriteOperationStatus = "pending" | "approved" | "execution-uncertain" | "completed" | "failed" | "expired";

type WriteOperationApproval = {
  approvedAt: string;
  requestHash: string;
  target: WriteOperationTarget;
  request: WriteOperationRequest;
};

type WriteOperation = {
  kind: "write-operation";
  schemaVersion: 1;
  operationId: string;
  action: string;
  summary: string;
  status: WriteOperationStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  configScope: string;
  target: WriteOperationTarget;
  request: WriteOperationRequest;
  requestHash: string;
  approval?: WriteOperationApproval;
  requestId?: string;
  result?: unknown;
  error?: { name: string; message: string; status?: number; requestId?: string };
  audit: Array<{ at: string; event: string; requestHash: string }>;
};

export type WriteOperationPreview = {
  kind: "write-preview";
  schemaVersion: 1;
  dryRun: true;
  preview: true;
  mode: "preview";
  operationId: string;
  action: string;
  summary: string;
  expiresAt: string;
  willExecute: false;
  profile: string;
  baseUrl: string;
  method: "POST" | "DELETE";
  path: string;
  body: Record<string, unknown>;
  request: WriteOperationRequest;
  confirmation: { command: string };
};

export type WriteOperationResult = {
  kind: "write-result";
  schemaVersion: 1;
  operationId: string;
  action: string;
  status: "completed";
  requestId?: string;
  result: unknown;
};

export async function createWriteOperation(input: {
  configPath?: string;
  session: WriteOperationSession;
  action: string;
  summary: string;
  request: WriteOperationRequest;
  now?: Date;
}): Promise<WriteOperationPreview> {
  const operationId = `op_${randomBytes(8).toString("hex")}`;
  const now = input.now ?? new Date();
  const target = operationTarget(input.session);
  const request = withWriteIntegrity(operationId, input.request);
  const config = configScope(input.configPath);
  const expiresAt = new Date(now.getTime() + 120 * 60_000).toISOString();
  const requestHash = operationHash({ operationId, action: input.action, configScope: config, target, request, expiresAt });
  const operation: WriteOperation = {
    kind: "write-operation",
    schemaVersion: 1,
    operationId,
    action: input.action,
    summary: input.summary,
    status: "pending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt,
    configScope: config,
    target,
    request,
    requestHash,
    audit: [{ at: now.toISOString(), event: "preview-created", requestHash }]
  };
  await writeOperation(input.configPath, operation);
  return previewFrom(operation);
}

export async function confirmWriteOperation(input: {
  configPath?: string;
  session: WriteOperationSession;
  operationId: string;
  now?: Date;
}): Promise<WriteOperationResult> {
  const operation = await readOperation(input.configPath, input.operationId);
  const now = input.now ?? new Date();
  validateOperation(operation, input.configPath, input.session, now);
  if (operation.status === "completed") {
    throw new Error(`Operation ${operation.operationId} is already completed.`);
  }
  if (operation.status === "failed" || operation.status === "expired") {
    throw new Error(`Operation ${operation.operationId} cannot be confirmed; create a new preview.`);
  }
  await requireAdvertisedWriteCapability(input.session, operation);
  if (!operation.approval) {
    operation.approval = {
      approvedAt: now.toISOString(),
      requestHash: operation.requestHash,
      target: operation.target,
      request: operation.request
    };
    operation.status = "approved";
    operation.updatedAt = now.toISOString();
    operation.audit.push({ at: now.toISOString(), event: "confirmed", requestHash: operation.requestHash });
    await writeOperation(input.configPath, operation);
  } else {
    validateApproval(operation);
  }

  try {
    const result = await requestJson(input.session.baseUrl, operation.approval.request.path, {
      token: input.session.token,
      method: operation.approval.request.method,
      body: operation.approval.request.body
    });
    const completedAt = new Date().toISOString();
    operation.status = "completed";
    operation.updatedAt = completedAt;
    operation.requestId = requestIdFrom(result);
    operation.result = result;
    operation.error = undefined;
    operation.audit.push({ at: completedAt, event: "completed", requestHash: operation.requestHash });
    await writeOperation(input.configPath, operation);
    return {
      kind: "write-result",
      schemaVersion: 1,
      operationId: operation.operationId,
      action: operation.action,
      status: "completed",
      requestId: operation.requestId,
      result
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const uncertain = error instanceof NetworkError
      || error instanceof TimeoutError
      || (error instanceof HttpError && error.status >= 500);
    const retryable = uncertain || (error instanceof HttpError && (error.status === 401 || error.status === 429));
    operation.status = uncertain ? "execution-uncertain" : retryable ? "approved" : "failed";
    operation.updatedAt = failedAt;
    operation.error = {
      name: error instanceof Error ? error.name : "Error",
      message: safeErrorMessage(error),
      status: error instanceof HttpError ? error.status : undefined,
      requestId: error instanceof HttpError ? error.requestId : undefined
    };
    operation.audit.push({ at: failedAt, event: uncertain ? "execution-uncertain" : "execution-failed", requestHash: operation.requestHash });
    await writeOperation(input.configPath, operation);
    throw error;
  }
}

async function requireAdvertisedWriteCapability(
  session: WriteOperationSession,
  operation: WriteOperation
): Promise<void> {
  const endpoint = replyActionEndpoint(operation.action);
  if (!endpoint) {
    return;
  }
  const capabilities = await requestJson(session.baseUrl, "/api/v1/capabilities", {
    token: session.token
  });
  const compatibility = assessCapabilityCompatibility(capabilities, ["thread-detail-reply-actions"]);
  if (!compatibility.ok) {
    throw new Error(
      `Cannot confirm ${operation.action}: server capability thread-detail-reply-actions is unavailable or incompatible.`
    );
  }
  const entries = isRecord(capabilities) && Array.isArray(capabilities.capabilities)
    ? capabilities.capabilities.filter(isRecord)
    : [];
  const capability = entries.find((entry) => entry.id === "thread-detail-reply-actions");
  if (capability?.available !== true
      || !Array.isArray(capability.endpoints)
      || !capability.endpoints.includes(endpoint)) {
    throw new Error(
      `Cannot confirm ${operation.action}: server capability thread-detail-reply-actions does not advertise ${endpoint}.`
    );
  }
}

function replyActionEndpoint(action: string): string | undefined {
  if (action === "reply.mark-answer" || action === "reply.unmark-answer") {
    return "/topics/{topicId}/replies/{replyId}/correct-answer";
  }
  if (action === "favorite.reply.add" || action === "favorite.reply.remove") {
    return "/replies/{replyId}/favorite";
  }
  return undefined;
}

function withWriteIntegrity(operationId: string, request: WriteOperationRequest): WriteOperationRequest {
  const payload = Object.fromEntries(Object.entries(request.body).filter(([key]) => key !== "operationKey" && key !== "payloadHash"));
  const payloadHash = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  const operationKey = `op:${createHash("sha256").update(canonicalJson({ operationId, method: request.method, path: request.path, payloadHash }), "utf8").digest("hex").slice(0, 48)}`;
  return { ...request, body: { ...payload, operationKey, payloadHash } };
}

function validateOperation(operation: WriteOperation, configPath: string | undefined, session: WriteOperationSession, now: Date): void {
  if (operation.configScope !== configScope(configPath)) {
    throw new Error("Operation belongs to a different local configuration.");
  }
  if (canonicalJson(operation.target) !== canonicalJson(operationTarget(session))) {
    throw new Error("Operation target does not match the active account and community.");
  }
  if (operationHash(operation) !== operation.requestHash) {
    throw new Error("Operation request hash mismatch; create a new preview.");
  }
  if (Date.parse(operation.expiresAt) <= now.getTime()) {
    operation.status = "expired";
    throw new Error(`Operation ${operation.operationId} has expired; create a new preview.`);
  }
  if (operation.approval) {
    validateApproval(operation);
  }
}

function validateApproval(operation: WriteOperation): void {
  const approval = operation.approval;
  if (!approval
      || approval.requestHash !== operation.requestHash
      || canonicalJson(approval.target) !== canonicalJson(operation.target)
      || canonicalJson(approval.request) !== canonicalJson(operation.request)) {
    throw new Error("Operation approval does not match the preview; create a new preview.");
  }
}

async function readOperation(configPath: string | undefined, operationId: string): Promise<WriteOperation> {
  if (!/^op_[a-f0-9]{16}$/.test(operationId)) {
    throw new Error("Invalid operation id.");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(operationPath(configPath, operationId), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Operation ${operationId} was not found.`);
    }
    throw error;
  }
  if (!isRecord(value)
      || value.kind !== "write-operation"
      || value.schemaVersion !== 1
      || value.operationId !== operationId
      || typeof value.action !== "string"
      || typeof value.summary !== "string"
      || typeof value.status !== "string"
      || typeof value.expiresAt !== "string"
      || typeof value.configScope !== "string"
      || typeof value.requestHash !== "string"
      || !isRecord(value.target)
      || typeof value.target.profile !== "string"
      || typeof value.target.baseUrl !== "string"
      || typeof value.target.credentialFingerprint !== "string"
      || !isWriteRequest(value.request)
      || !Array.isArray(value.audit)) {
    throw new Error(`Operation ${operationId} is invalid.`);
  }
  return value as WriteOperation;
}

async function writeOperation(configPath: string | undefined, operation: WriteOperation): Promise<void> {
  const directory = operationsDirectory(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = operationPath(configPath, operation.operationId);
  await writeFile(path, `${JSON.stringify(operation, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function previewFrom(operation: WriteOperation): WriteOperationPreview {
  return {
    kind: "write-preview",
    schemaVersion: 1,
    dryRun: true,
    preview: true,
    mode: "preview",
    operationId: operation.operationId,
    action: operation.action,
    summary: operation.summary,
    expiresAt: operation.expiresAt,
    willExecute: false,
    profile: operation.target.profile,
    baseUrl: operation.target.baseUrl,
    method: operation.request.method,
    path: operation.request.path,
    body: operation.request.body,
    request: operation.request,
    confirmation: { command: `apexcn confirm ${operation.operationId} --yes` }
  };
}

function operationsDirectory(configPath?: string): string {
  return join(dirname(resolve(configPath ?? defaultConfigPath())), "operations");
}

function operationPath(configPath: string | undefined, operationId: string): string {
  return join(operationsDirectory(configPath), `${operationId}.json`);
}

function configScope(configPath?: string): string {
  return createHash("sha256").update(resolve(configPath ?? defaultConfigPath()), "utf8").digest("hex");
}

function operationTarget(session: WriteOperationSession): WriteOperationTarget {
  return {
    profile: session.profile,
    baseUrl: session.baseUrl,
    credentialFingerprint: createHash("sha256").update(session.token, "utf8").digest("hex")
  };
}

function integrityHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function operationHash(operation: Pick<WriteOperation, "operationId" | "action" | "configScope" | "target" | "request" | "expiresAt">): string {
  return integrityHash({
    operationId: operation.operationId,
    action: operation.action,
    configScope: operation.configScope,
    target: operation.target,
    request: operation.request,
    expiresAt: operation.expiresAt
  });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

function isWriteRequest(value: unknown): value is WriteOperationRequest {
  return isRecord(value)
    && (value.method === "POST" || value.method === "DELETE")
    && typeof value.path === "string"
    && isRecord(value.body);
}

function requestIdFrom(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.requestId === "string") return value.requestId;
  return undefined;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/\b[A-Za-z0-9]{26,}\b/g, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
