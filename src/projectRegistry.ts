import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LocalNoteProject, LocalNoteProjectStatus, LocalProjectStateStore } from "./types";

export const LOCAL_PROJECTS_STATE_KEY = "latexEditingToolkit.localProjects";
export const LOCAL_PROJECTS_MAX_ENTRIES = 500;
export const LOCAL_PROJECT_ID_MAX_LENGTH = 128;
export const LOCAL_PROJECT_LABEL_MAX_LENGTH = 256;
export const LOCAL_PROJECT_TEMPLATE_MAX_LENGTH = 128;
export const LOCAL_PROJECT_PATH_MAX_LENGTH = 4096;

/** Build a stable, opaque state key for a VS Code authority namespace. */
export function scopedStateKey(baseKey: string, scope: string): string {
  const digest = createHash("sha256").update(String(scope || "unknown")).digest("hex").slice(0, 24);
  return `${baseKey}.scope.${digest}.v1`;
}

export function scopedLocalProjectsStateKey(scope: string): string {
  return scopedStateKey(LOCAL_PROJECTS_STATE_KEY, scope);
}

export function sanitizeRecentProjectParents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !path.isAbsolute(item) || item.length > LOCAL_PROJECT_PATH_MAX_LENGTH) continue;
    const normalized = path.normalize(path.resolve(item));
    if (!result.includes(normalized)) result.push(normalized);
    if (result.length >= 8) break;
  }
  return result;
}

export class LocalProjectRegistry {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LocalProjectStateStore,
    private readonly stateKey = LOCAL_PROJECTS_STATE_KEY,
    options: { legacyKey?: string; migrateLegacy?: boolean } = {}
  ) {
    this.ready = options.migrateLegacy
      ? this.migrateLegacyState(options.legacyKey ?? LOCAL_PROJECTS_STATE_KEY)
      : Promise.resolve();
  }

  private readonly ready: Promise<void>;

  list(): Promise<LocalNoteProjectStatus[]> {
    return this.runSerialized(async () => {
      const entries = await this.readCleanEntries();
      const statuses = await Promise.all(entries.map(async (entry) => ({
        ...entry,
        missing: !(await this.isDirectory(entry.rootPath))
      })));
      return statuses.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  }

  add(rootPath: string, templateId: string): Promise<LocalNoteProject> {
    return this.runSerialized(async () => {
      const normalizedPath = normalizeProjectPath(rootPath);
      const targetKey = await this.canonicalPathKey(normalizedPath);
      const entries = await this.readCleanEntries();
      const existing = await this.findByCanonicalKey(entries, targetKey);
      const entry: LocalNoteProject = existing
        ? {
            ...existing,
            // Preserve the original id, timestamp, and user-facing path. A symlink or
            // differently-cased path must not make an existing note appear recreated.
            templateId: String(templateId || existing.templateId || "unknown")
          }
        : {
            id: randomUUID(),
            rootPath: normalizedPath,
            label: path.basename(normalizedPath),
            templateId: String(templateId || "unknown"),
            createdAt: new Date().toISOString()
          };
      const next = existing
        ? entries.map((item) => item.id === existing.id ? entry : item)
        : [...entries, entry];
      await this.writeEntries(next);
      return entry;
    });
  }

  find(rootPath: string): Promise<LocalNoteProjectStatus | undefined> {
    return this.runSerialized(async () => {
      const normalizedPath = normalizeProjectPath(rootPath);
      const targetKey = await this.canonicalPathKey(normalizedPath);
      const entries = await this.readCleanEntries();
      const entry = await this.findByCanonicalKey(entries, targetKey);
      return entry ? { ...entry, missing: !(await this.isDirectory(entry.rootPath)) } : undefined;
    });
  }

  remove(rootPath: string): Promise<boolean> {
    return this.runSerialized(async () => {
      const normalizedPath = normalizeProjectPath(rootPath);
      const targetKey = await this.canonicalPathKey(normalizedPath);
      const entries = await this.readCleanEntries();
      const current = await this.findByCanonicalKey(entries, targetKey);
      if (!current) return false;
      await this.writeEntries(entries.filter((entry) => entry.id !== current.id));
      return true;
    });
  }

  findById(id: string): Promise<LocalNoteProjectStatus | undefined> {
    return this.runSerialized(async () => {
      const normalizedId = String(id || "").trim();
      if (!normalizedId || normalizedId.length > LOCAL_PROJECT_ID_MAX_LENGTH) return undefined;
      const entry = (await this.readCleanEntries()).find((item) => item.id === normalizedId);
      return entry ? { ...entry, missing: !(await this.isDirectory(entry.rootPath)) } : undefined;
    });
  }

  removeMissing(): Promise<number> {
    return this.runSerialized(async () => {
      const entries = await this.readCleanEntries();
      const existing: LocalNoteProject[] = [];
      let removed = 0;
      for (const entry of entries) {
        if (await this.isDirectory(entry.rootPath)) existing.push(entry);
        else removed += 1;
      }
      if (removed > 0) await this.writeEntries(existing);
      return removed;
    });
  }

  relocate(oldRootPath: string, newRootPath: string): Promise<LocalNoteProject> {
    return this.runSerialized(async () => {
      const oldPath = normalizeProjectPath(oldRootPath);
      const newPath = normalizeProjectPath(newRootPath);
      if (!(await this.isDirectory(newPath))) throw new Error("The selected location is not a local directory.");
      if (!(await this.isRegularFile(path.join(newPath, "main.tex")))) {
        throw new Error("The selected directory does not contain main.tex.");
      }

      const oldKey = await this.canonicalPathKey(oldPath);
      const newKey = await this.canonicalPathKey(newPath);
      const entries = await this.readCleanEntries();
      const current = await this.findByCanonicalKey(entries, oldKey);
      if (!current) throw new Error("The local note project is no longer registered.");
      const duplicate = await this.findByCanonicalKey(entries.filter((entry) => entry.id !== current.id), newKey);
      if (duplicate) throw new Error(`The selected directory is already registered as '${duplicate.label}'.`);

      const updated: LocalNoteProject = {
        ...current,
        rootPath: newPath,
        label: path.basename(newPath)
      };
      await this.writeEntries(entries.map((entry) => entry.id === current.id ? updated : entry));
      return updated;
    });
  }

  private async readCleanEntries(): Promise<LocalNoteProject[]> {
    await this.ready;
    const raw = this.store.get<unknown>(this.stateKey);
    if (!Array.isArray(raw)) {
      if (raw !== undefined) await this.writeEntries([]);
      return [];
    }

    const parsed: LocalNoteProject[] = [];
    for (const item of raw.slice(0, LOCAL_PROJECTS_MAX_ENTRIES * 4)) {
      if (!isRecord(item)) continue;
      const rawRootPath = typeof item.rootPath === "string" ? item.rootPath : item.root_path;
      const rootPath = typeof rawRootPath === "string" ? safeNormalizeProjectPath(rawRootPath) : undefined;
      if (!rootPath || rootPath.length > LOCAL_PROJECT_PATH_MAX_LENGTH) continue;
      const rawId = typeof item.id === "string" && item.id ? item.id : legacyProjectId(rootPath);
      const rawLabel = typeof item.label === "string" && item.label ? item.label : path.basename(rootPath);
      const rawTemplate = typeof item.templateId === "string" && item.templateId
        ? item.templateId
        : typeof item.template_id === "string" && item.template_id ? item.template_id : "unknown";
      if (rawId.length > LOCAL_PROJECT_ID_MAX_LENGTH || rawLabel.length > LOCAL_PROJECT_LABEL_MAX_LENGTH || rawTemplate.length > LOCAL_PROJECT_TEMPLATE_MAX_LENGTH) continue;
      parsed.push({
        id: rawId,
        rootPath,
        label: rawLabel,
        templateId: rawTemplate,
        createdAt: validTimestamp(item.createdAt) ?? validTimestamp(item.created_at) ?? new Date(0).toISOString()
      });
    }

    const byCanonicalPath = new Map<string, LocalNoteProject>();
    for (const entry of parsed) {
      const key = await this.canonicalPathKey(entry.rootPath);
      const previous = byCanonicalPath.get(key);
      if (!previous || entry.createdAt >= previous.createdAt) byCanonicalPath.set(key, entry);
    }
    const cleaned = [...byCanonicalPath.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, LOCAL_PROJECTS_MAX_ENTRIES);
    if (JSON.stringify(cleaned) !== JSON.stringify(raw)) await this.writeEntries(cleaned);
    return cleaned;
  }

  private async findByCanonicalKey(entries: LocalNoteProject[], targetKey: string): Promise<LocalNoteProject | undefined> {
    for (const entry of entries) {
      if (await this.canonicalPathKey(entry.rootPath) === targetKey) return entry;
    }
    return undefined;
  }

  private async canonicalPathKey(value: string): Promise<string> {
    let canonical = path.normalize(value);
    try {
      canonical = path.normalize(await fs.realpath(canonical));
    } catch {
      // Missing paths remain addressable so users can relocate or forget them.
    }
    return caseFoldPath(canonical);
  }

  private async writeEntries(entries: LocalNoteProject[]): Promise<void> {
    await this.store.update(this.stateKey, entries);
  }

  private async isDirectory(target: string): Promise<boolean> {
    try {
      return (await fs.stat(target)).isDirectory();
    } catch {
      return false;
    }
  }

  private async isRegularFile(target: string): Promise<boolean> {
    try {
      return (await fs.stat(target)).isFile();
    } catch {
      return false;
    }
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.ready).then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async migrateLegacyState(legacyKey: string): Promise<void> {
    const markerKey = `${this.stateKey}.legacyMigration.v1`;
    if (this.store.get<boolean>(markerKey)) return;
    if (this.stateKey !== legacyKey && this.store.get<unknown>(this.stateKey) === undefined) {
      const legacy = this.store.get<unknown>(legacyKey);
      if (Array.isArray(legacy)) await this.store.update(this.stateKey, legacy);
    }
    await this.store.update(markerKey, true);
  }
}

export function normalizeProjectPath(rawPath: string): string {
  const normalized = safeNormalizeProjectPath(rawPath);
  if (!normalized) throw new Error("Local note project path must be an absolute local path.");
  return normalized;
}

function safeNormalizeProjectPath(rawPath: string): string | undefined {
  const value = String(rawPath || "").trim();
  if (!value || !path.isAbsolute(value)) return undefined;
  return path.normalize(value);
}

function caseFoldPath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}

function legacyProjectId(rootPath: string): string {
  return `legacy-${createHash("sha1").update(caseFoldPath(rootPath)).digest("hex").slice(0, 16)}`;
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
