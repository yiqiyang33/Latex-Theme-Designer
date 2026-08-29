import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LocalNoteProject, LocalNoteProjectStatus, LocalProjectStateStore } from "./types";
import {
  LOCAL_RESOURCE_ID_MAX_LENGTH,
  LOCAL_RESOURCE_LABEL_MAX_LENGTH,
  LOCAL_RESOURCE_MAX_ENTRIES,
  LOCAL_RESOURCE_PATH_MAX_LENGTH,
  LocalResourceRegistry,
  normalizeLocalPath,
  safeNormalizeLocalPath,
  scopedStateKey,
  sanitizeRecentProjectParents,
  stableResourceId,
  type LocalResourceAdapter
} from "./localResourceRegistry";

export const LOCAL_PROJECTS_STATE_KEY = "latexEditingToolkit.localProjects";
export const LOCAL_PROJECTS_MAX_ENTRIES = LOCAL_RESOURCE_MAX_ENTRIES;
export const LOCAL_PROJECT_ID_MAX_LENGTH = LOCAL_RESOURCE_ID_MAX_LENGTH;
export const LOCAL_PROJECT_LABEL_MAX_LENGTH = LOCAL_RESOURCE_LABEL_MAX_LENGTH;
export const LOCAL_PROJECT_TEMPLATE_MAX_LENGTH = 128;
export const LOCAL_PROJECT_PATH_MAX_LENGTH = LOCAL_RESOURCE_PATH_MAX_LENGTH;

export { scopedStateKey, sanitizeRecentProjectParents };

export function scopedLocalProjectsStateKey(scope: string): string {
  return scopedStateKey(LOCAL_PROJECTS_STATE_KEY, scope);
}

const noteAdapter: LocalResourceAdapter<LocalNoteProject> = {
  parse(raw: unknown): LocalNoteProject | undefined {
    if (!isRecord(raw)) return undefined;
    const rawRootPath = typeof raw.rootPath === "string" ? raw.rootPath : raw.root_path;
    const rootPath = safeNormalizeLocalPath(rawRootPath);
    if (!rootPath || rootPath.length > LOCAL_PROJECT_PATH_MAX_LENGTH) return undefined;
    const id = typeof raw.id === "string" && raw.id ? raw.id : stableResourceId("legacy", rootPath);
    const label = typeof raw.label === "string" && raw.label ? raw.label : path.basename(rootPath);
    const templateId = typeof raw.templateId === "string" && raw.templateId
      ? raw.templateId
      : typeof raw.template_id === "string" && raw.template_id ? raw.template_id : "unknown";
    if (id.length > LOCAL_PROJECT_ID_MAX_LENGTH || label.length > LOCAL_PROJECT_LABEL_MAX_LENGTH || templateId.length > LOCAL_PROJECT_TEMPLATE_MAX_LENGTH) return undefined;
    return {
      id,
      rootPath,
      label,
      templateId,
      createdAt: validTimestamp(raw.createdAt) ?? validTimestamp(raw.created_at) ?? new Date(0).toISOString()
    };
  },
  serialize(record) { return record; },
  base(record) {
    return { id: record.id, rootPath: record.rootPath, label: record.label, createdAt: record.createdAt };
  }
};

export class LocalProjectRegistry {
  private readonly registry: LocalResourceRegistry<LocalNoteProject>;

  constructor(
    store: LocalProjectStateStore,
    stateKey = LOCAL_PROJECTS_STATE_KEY,
    options: { legacyKey?: string; migrateLegacy?: boolean } = {}
  ) {
    this.registry = new LocalResourceRegistry(store, {
      stateKey,
      adapter: noteAdapter,
      legacyKey: options.legacyKey,
      migrateLegacy: options.migrateLegacy
    });
  }

  async list(): Promise<LocalNoteProjectStatus[]> {
    return (await this.registry.list()).map(status => ({ ...status.record, missing: status.missing }));
  }

  async add(rootPath: string, templateId: string): Promise<LocalNoteProject> {
    const normalizedPath = normalizeProjectPath(rootPath);
    return this.registry.upsertForRoot(normalizedPath, existing => existing
      ? { ...existing, templateId: String(templateId || existing.templateId || "unknown") }
      : {
          id: randomUUID(),
          rootPath: normalizedPath,
          label: path.basename(normalizedPath),
          templateId: String(templateId || "unknown"),
          createdAt: new Date().toISOString()
        });
  }

  async find(rootPath: string): Promise<LocalNoteProjectStatus | undefined> {
    const status = await this.registry.findByRoot(normalizeProjectPath(rootPath));
    return status ? { ...status.record, missing: status.missing } : undefined;
  }

  async findById(id: string): Promise<LocalNoteProjectStatus | undefined> {
    const status = await this.registry.findById(id);
    return status ? { ...status.record, missing: status.missing } : undefined;
  }

  remove(rootPath: string): Promise<boolean> {
    return this.registry.removeByRoot(normalizeProjectPath(rootPath));
  }

  removeMissing(): Promise<number> {
    return this.registry.removeMissing();
  }

  async relocate(oldRootPath: string, newRootPath: string): Promise<LocalNoteProject> {
    const oldPath = normalizeProjectPath(oldRootPath);
    const newPath = normalizeProjectPath(newRootPath);
    if (!(await isDirectory(newPath))) throw new Error("The selected location is not a local directory.");
    if (!(await isRegularFile(path.join(newPath, "main.tex")))) throw new Error("The selected directory does not contain main.tex.");
    const current = await this.registry.findByRoot(oldPath);
    if (!current) throw new Error("The local note project is no longer registered.");
    const duplicate = await this.registry.findByRoot(newPath);
    if (duplicate && duplicate.record.id !== current.record.id) throw new Error(`The selected directory is already registered as '${duplicate.record.label}'.`);
    await this.registry.removeByRoot(oldPath);
    return this.registry.upsert({ ...current.record, rootPath: newPath, label: path.basename(newPath) });
  }
}

export function normalizeProjectPath(rawPath: string): string {
  return normalizeLocalPath(rawPath);
}

async function isDirectory(target: string): Promise<boolean> {
  try { return (await fs.stat(target)).isDirectory(); } catch { return false; }
}

async function isRegularFile(target: string): Promise<boolean> {
  try { return (await fs.stat(target)).isFile(); } catch { return false; }
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
