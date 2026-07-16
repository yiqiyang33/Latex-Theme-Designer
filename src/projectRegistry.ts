import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LocalNoteProject, LocalNoteProjectStatus, LocalProjectStateStore } from "./types";

export const LOCAL_PROJECTS_STATE_KEY = "latexEditingToolkit.localProjects";

export class LocalProjectRegistry {
  constructor(
    private readonly store: LocalProjectStateStore,
    private readonly stateKey = LOCAL_PROJECTS_STATE_KEY
  ) {}

  async list(): Promise<LocalNoteProjectStatus[]> {
    const entries = this.readEntries();
    const statuses = await Promise.all(entries.map(async (entry) => ({
      ...entry,
      missing: !(await this.isDirectory(entry.rootPath))
    })));
    return statuses.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async add(rootPath: string, templateId: string): Promise<LocalNoteProject> {
    const normalizedPath = normalizeProjectPath(rootPath);
    const entries = this.readEntries();
    const existing = entries.find((entry) => sameProjectPath(entry.rootPath, normalizedPath));
    const entry: LocalNoteProject = existing
      ? {
          ...existing,
          rootPath: normalizedPath,
          label: path.basename(normalizedPath),
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
      ? entries.map((item) => sameProjectPath(item.rootPath, normalizedPath) ? entry : item)
      : [...entries, entry];
    await this.writeEntries(next);
    return entry;
  }

  async remove(rootPath: string): Promise<boolean> {
    const normalizedPath = normalizeProjectPath(rootPath);
    const entries = this.readEntries();
    const next = entries.filter((entry) => !sameProjectPath(entry.rootPath, normalizedPath));
    if (next.length === entries.length) return false;
    await this.writeEntries(next);
    return true;
  }

  async relocate(oldRootPath: string, newRootPath: string): Promise<LocalNoteProject> {
    const oldPath = normalizeProjectPath(oldRootPath);
    const newPath = normalizeProjectPath(newRootPath);
    if (!(await this.isDirectory(newPath))) throw new Error("The selected location is not a local directory.");
    if (!(await this.isRegularFile(path.join(newPath, "main.tex")))) {
      throw new Error("The selected directory does not contain main.tex.");
    }

    const entries = this.readEntries();
    const current = entries.find((entry) => sameProjectPath(entry.rootPath, oldPath));
    if (!current) throw new Error("The local note project is no longer registered.");
    const duplicate = entries.find((entry) => entry.id !== current.id && sameProjectPath(entry.rootPath, newPath));
    if (duplicate) throw new Error(`The selected directory is already registered as '${duplicate.label}'.`);

    const updated: LocalNoteProject = {
      ...current,
      rootPath: newPath,
      label: path.basename(newPath)
    };
    await this.writeEntries(entries.map((entry) => entry.id === current.id ? updated : entry));
    return updated;
  }

  private readEntries(): LocalNoteProject[] {
    const raw = this.store.get<unknown>(this.stateKey);
    if (!Array.isArray(raw)) return [];
    const entries: LocalNoteProject[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const rawRootPath = typeof item.rootPath === "string" ? item.rootPath : item.root_path;
      const rootPath = typeof rawRootPath === "string" ? safeNormalizeProjectPath(rawRootPath) : undefined;
      if (!rootPath) continue;
      const key = projectPathKey(rootPath);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: typeof item.id === "string" && item.id ? item.id : legacyProjectId(rootPath),
        rootPath,
        label: typeof item.label === "string" && item.label ? item.label : path.basename(rootPath),
        templateId: typeof item.templateId === "string" && item.templateId
          ? item.templateId
          : typeof item.template_id === "string" && item.template_id ? item.template_id : "unknown",
        createdAt: typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))
          ? item.createdAt
          : typeof item.created_at === "string" && !Number.isNaN(Date.parse(item.created_at)) ? item.created_at
          : new Date(0).toISOString()
      });
    }
    return entries;
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

function sameProjectPath(left: string, right: string): boolean {
  return projectPathKey(left) === projectPathKey(right);
}

function projectPathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}

function legacyProjectId(rootPath: string): string {
  return `legacy-${createHash("sha1").update(projectPathKey(rootPath)).digest("hex").slice(0, 16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
