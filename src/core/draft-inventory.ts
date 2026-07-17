import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultConfigPath, loadConfig } from "../config.js";

export type DraftPayload = Record<string, unknown> & {
  kind: string;
  schemaVersion: number;
};

export type StoredDraft = {
  kind: "stored-draft";
  schemaVersion: 1;
  id: string;
  ownerProfileId: string;
  createdAt: string;
  updatedAt: string;
  draft: DraftPayload;
};

export type DraftSummary = {
  id: string;
  draftKind: string;
  title?: string;
  topicId?: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftInventoryBundle = {
  kind: "draft-inventory-export";
  schemaVersion: 1;
  sourceProfileId: string;
  exportedAt: string;
  drafts: StoredDraft[];
};

export class DraftInventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftInventoryError";
  }
}

type DraftContext = {
  profileId: string;
  directory: string;
};

export async function saveDraft(
  draft: DraftPayload,
  configPath?: string,
  options: { now?: Date; id?: string } = {}
): Promise<StoredDraft> {
  const context = await activeDraftContext(configPath);
  const timestamp = (options.now ?? new Date()).toISOString();
  const stored: StoredDraft = {
    kind: "stored-draft",
    schemaVersion: 1,
    id: options.id ?? randomUUID(),
    ownerProfileId: context.profileId,
    createdAt: timestamp,
    updatedAt: timestamp,
    draft
  };
  await writeStoredDraft(context, stored, false);
  return stored;
}

export async function listDrafts(configPath?: string): Promise<DraftSummary[]> {
  const context = await activeDraftContext(configPath);
  const drafts = await readAllDrafts(context);
  return drafts.map((stored) => ({
    id: stored.id,
    draftKind: stored.draft.kind,
    title: typeof stored.draft.title === "string" ? stored.draft.title : undefined,
    topicId: typeof stored.draft.topicId === "number" ? stored.draft.topicId : undefined,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt
  }));
}

export async function restoreDraft(id: string, configPath?: string): Promise<StoredDraft> {
  const context = await activeDraftContext(configPath);
  return readStoredDraft(context, validateDraftId(id));
}

export async function deleteDraft(id: string, configPath?: string): Promise<StoredDraft> {
  const context = await activeDraftContext(configPath);
  const stored = await readStoredDraft(context, validateDraftId(id));
  await rm(draftPath(context, stored.id));
  return stored;
}

export async function exportDrafts(configPath?: string, now = new Date()): Promise<DraftInventoryBundle> {
  const context = await activeDraftContext(configPath);
  return {
    kind: "draft-inventory-export",
    schemaVersion: 1,
    sourceProfileId: context.profileId,
    exportedAt: now.toISOString(),
    drafts: await readAllDrafts(context)
  };
}

export async function importDrafts(
  bundle: unknown,
  configPath?: string,
  options: { replace?: boolean } = {}
): Promise<{ kind: "draft-inventory-import"; schemaVersion: 1; importedCount: number }> {
  const context = await activeDraftContext(configPath);
  const parsed = parseBundle(bundle);
  if (!options.replace) {
    const existingIds = new Set((await readAllDrafts(context)).map((draft) => draft.id));
    const conflict = parsed.drafts.find((draft) => existingIds.has(draft.id));
    if (conflict) {
      throw new DraftInventoryError(`Saved draft already exists: ${conflict.id}. Use --replace to migrate over it.`);
    }
  }
  for (const source of parsed.drafts) {
    const stored: StoredDraft = { ...source, ownerProfileId: context.profileId };
    await writeStoredDraft(context, stored, options.replace === true);
  }
  return {
    kind: "draft-inventory-import",
    schemaVersion: 1,
    importedCount: parsed.drafts.length
  };
}

export async function writeDraftBundle(
  path: string,
  bundle: DraftInventoryBundle,
  options: { force?: boolean } = {}
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: options.force ? "w" : "wx"
    });
    await chmod(path, 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new DraftInventoryError(`Draft export already exists: ${path}. Use --force to replace it.`);
    }
    throw error;
  }
}

export async function readDraftBundle(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new DraftInventoryError(`Draft import file not found: ${path}`);
    }
    if (error instanceof SyntaxError) {
      throw new DraftInventoryError(`Invalid draft inventory file: ${path}`);
    }
    throw error;
  }
}

async function activeDraftContext(configPath = defaultConfigPath()): Promise<DraftContext> {
  const config = await loadConfig(configPath);
  const profile = config.current;
  if (!profile || !config.profiles[profile]) {
    throw new DraftInventoryError("No active profile. Run `apexcn auth use <profile>` before managing saved drafts.");
  }
  const profileId = createHash("sha256").update(profile).digest("hex");
  return {
    profileId,
    directory: join(dirname(configPath), "drafts", profileId)
  };
}

async function readAllDrafts(context: DraftContext): Promise<StoredDraft[]> {
  let names: string[];
  try {
    names = await readdir(context.directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const drafts = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
    drafts.push(await readStoredDraft(context, name.slice(0, -5)));
  }
  return drafts.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

async function readStoredDraft(context: DraftContext, id: string): Promise<StoredDraft> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(draftPath(context, id), "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new DraftInventoryError(`Saved draft not found: ${id}`);
    }
    if (error instanceof SyntaxError) {
      throw new DraftInventoryError(`Invalid saved draft: ${id}`);
    }
    throw error;
  }
  const stored = parseStoredDraft(parsed);
  if (stored.ownerProfileId !== context.profileId) {
    throw new DraftInventoryError(`Saved draft does not belong to the active profile: ${id}`);
  }
  return stored;
}

async function writeStoredDraft(context: DraftContext, stored: StoredDraft, replace: boolean): Promise<void> {
  validateDraftId(stored.id);
  await mkdir(context.directory, { recursive: true, mode: 0o700 });
  await chmod(dirname(context.directory), 0o700);
  await chmod(context.directory, 0o700);
  const target = draftPath(context, stored.id);
  const text = `${JSON.stringify(stored, null, 2)}\n`;
  if (!replace) {
    try {
      await writeFile(target, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(target, 0o600);
      return;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new DraftInventoryError(`Saved draft already exists: ${stored.id}. Use --replace to migrate over it.`);
      }
      throw error;
    }
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function draftPath(context: DraftContext, id: string): string {
  return join(context.directory, `${validateDraftId(id)}.json`);
}

function validateDraftId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new DraftInventoryError(`Invalid draft id: ${id}`);
  }
  return id;
}

function parseBundle(value: unknown): DraftInventoryBundle {
  if (!isRecord(value) || value.kind !== "draft-inventory-export" || value.schemaVersion !== 1 || typeof value.sourceProfileId !== "string" || typeof value.exportedAt !== "string" || !Array.isArray(value.drafts)) {
    throw new DraftInventoryError("Invalid draft inventory bundle");
  }
  const drafts = value.drafts.map(parseStoredDraft);
  const ids = new Set<string>();
  for (const draft of drafts) {
    if (ids.has(draft.id)) {
      throw new DraftInventoryError(`Duplicate draft id in inventory bundle: ${draft.id}`);
    }
    ids.add(draft.id);
  }
  return {
    kind: "draft-inventory-export",
    schemaVersion: 1,
    sourceProfileId: value.sourceProfileId,
    exportedAt: value.exportedAt,
    drafts
  };
}

function parseStoredDraft(value: unknown): StoredDraft {
  if (!isRecord(value) || value.kind !== "stored-draft" || value.schemaVersion !== 1 || typeof value.id !== "string" || typeof value.ownerProfileId !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" || !isRecord(value.draft) || typeof value.draft.kind !== "string" || typeof value.draft.schemaVersion !== "number") {
    throw new DraftInventoryError("Invalid stored draft");
  }
  return value as StoredDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
