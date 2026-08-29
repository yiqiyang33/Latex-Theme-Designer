import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LocalProjectStateStore } from "./types";

export const LOCAL_RESOURCE_MAX_ENTRIES = 500;
export const LOCAL_RESOURCE_ID_MAX_LENGTH = 128;
export const LOCAL_RESOURCE_LABEL_MAX_LENGTH = 256;
export const LOCAL_RESOURCE_PATH_MAX_LENGTH = 4096;

export interface LocalResourceBase {
  id: string;
  rootPath: string;
  label: string;
  createdAt: string;
}

export interface LocalResourceAdapter<T> {
  parse(raw: unknown): T | undefined;
  serialize(record: T): unknown;
  base(record: T): LocalResourceBase;
  isPresent?(record: T): Promise<boolean>;
}

export interface LocalResourceStatus<T> {
  record: T;
  missing: boolean;
}

export interface LocalResourceRegistryOptions<T> {
  stateKey: string;
  adapter: LocalResourceAdapter<T>;
  legacyKey?: string;
  migrateLegacy?: boolean;
  legacyFilter?: (raw: unknown) => boolean;
  maxEntries?: number;
}

export function scopedStateKey(baseKey: string, scope: string): string {
  const digest = createHash("sha256").update(String(scope || "unknown")).digest("hex").slice(0, 24);
  return `${baseKey}.scope.${digest}.v1`;
}

export function normalizeLocalPath(rawPath: string): string {
  const normalized = safeNormalizeLocalPath(rawPath);
  if (!normalized) throw new Error("Local resource path must be an absolute local path.");
  return normalized;
}

export function safeNormalizeLocalPath(rawPath: unknown): string | undefined {
  const value = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!value || !path.isAbsolute(value)) return undefined;
  const normalized = path.normalize(value);
  return normalized.length <= LOCAL_RESOURCE_PATH_MAX_LENGTH ? normalized : undefined;
}

export function sanitizeRecentProjectParents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const normalized = safeNormalizeLocalPath(item);
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= 8) break;
  }
  return result;
}

export class LocalResourceRegistry<T> {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ready: Promise<void>;
  private readonly maxEntries: number;

  constructor(
    private readonly store: LocalProjectStateStore,
    private readonly options: LocalResourceRegistryOptions<T>
  ) {
    this.maxEntries = options.maxEntries ?? LOCAL_RESOURCE_MAX_ENTRIES;
    this.ready = options.migrateLegacy
      ? this.migrateLegacyState(options.legacyKey ?? options.stateKey)
      : Promise.resolve();
  }

  list(): Promise<LocalResourceStatus<T>[]> {
    return this.runSerialized(async () => {
      const records = await this.readCleanEntries();
      return Promise.all(records.map(async record => ({
        record,
        missing: !(await this.isPresent(record))
      })));
    });
  }

  records(): Promise<T[]> {
    return this.runSerialized(() => this.readCleanEntries());
  }

  upsert(record: T): Promise<T> {
    return this.runSerialized(async () => {
      const nextRecord = this.normalizeRecord(record);
      const entries = await this.readCleanEntries();
      const targetKey = await canonicalPathKey(this.options.adapter.base(nextRecord).rootPath);
      let replaced = false;
      const next = [] as T[];
      for (const entry of entries) {
        if (await canonicalPathKey(this.options.adapter.base(entry).rootPath) === targetKey) {
          if (!replaced) next.push(nextRecord);
          replaced = true;
        } else {
          next.push(entry);
        }
      }
      if (!replaced) next.push(nextRecord);
      await this.writeEntries(next);
      return nextRecord;
    });
  }

  upsertForRoot(rootPath: string, create: (existing: T | undefined) => T): Promise<T> {
    return this.runSerialized(async () => {
      const normalizedRoot = normalizeLocalPath(rootPath);
      const targetKey = await canonicalPathKey(normalizedRoot);
      const entries = await this.readCleanEntries();
      const existing = await this.findByCanonicalKey(entries, targetKey);
      const nextRecord = this.normalizeRecord(create(existing));
      const next = existing
        ? entries.map(entry => this.options.adapter.base(entry).id === this.options.adapter.base(existing).id ? nextRecord : entry)
        : [...entries, nextRecord];
      await this.writeEntries(next);
      return nextRecord;
    });
  }

  findById(id: string): Promise<LocalResourceStatus<T> | undefined> {
    return this.runSerialized(async () => {
      const normalizedId = String(id || "").trim();
      if (!normalizedId || normalizedId.length > LOCAL_RESOURCE_ID_MAX_LENGTH) return undefined;
      const record = (await this.readCleanEntries()).find(item => this.options.adapter.base(item).id === normalizedId);
      return record ? { record, missing: !(await this.isPresent(record)) } : undefined;
    });
  }

  findByRoot(rootPath: string): Promise<LocalResourceStatus<T> | undefined> {
    return this.runSerialized(async () => {
      const targetKey = await canonicalPathKey(normalizeLocalPath(rootPath));
      const record = await this.findByCanonicalKey(await this.readCleanEntries(), targetKey);
      return record ? { record, missing: !(await this.isPresent(record)) } : undefined;
    });
  }

  removeByRoot(rootPath: string): Promise<boolean> {
    return this.runSerialized(async () => {
      const targetKey = await canonicalPathKey(normalizeLocalPath(rootPath));
      const entries = await this.readCleanEntries();
      const current = await this.findByCanonicalKey(entries, targetKey);
      if (!current) return false;
      await this.writeEntries(entries.filter(entry => this.options.adapter.base(entry).id !== this.options.adapter.base(current).id));
      return true;
    });
  }

  removeMissing(): Promise<number> {
    return this.runSerialized(async () => {
      const entries = await this.readCleanEntries();
      const existing: T[] = [];
      let removed = 0;
      for (const entry of entries) {
        if (await this.isPresent(entry)) existing.push(entry);
        else removed += 1;
      }
      if (removed > 0) await this.writeEntries(existing);
      return removed;
    });
  }

  private normalizeRecord(record: T): T {
    const base = this.options.adapter.base(record);
    normalizeLocalPath(base.rootPath);
    if (base.id.length === 0 || base.id.length > LOCAL_RESOURCE_ID_MAX_LENGTH) throw new Error("Local resource id is invalid.");
    if (base.label.length === 0 || base.label.length > LOCAL_RESOURCE_LABEL_MAX_LENGTH) throw new Error("Local resource label is invalid.");
    return record;
  }

  private async readCleanEntries(): Promise<T[]> {
    await this.ready;
    const raw = this.store.get<unknown>(this.options.stateKey);
    if (!Array.isArray(raw)) {
      if (raw !== undefined) await this.writeEntries([]);
      return [];
    }
    const parsed: T[] = [];
    for (const item of raw.slice(0, this.maxEntries * 4)) {
      const record = this.options.adapter.parse(item);
      if (!record) continue;
      const base = this.options.adapter.base(record);
      if (!safeNormalizeLocalPath(base.rootPath)
        || base.id.length === 0 || base.id.length > LOCAL_RESOURCE_ID_MAX_LENGTH
        || base.label.length === 0 || base.label.length > LOCAL_RESOURCE_LABEL_MAX_LENGTH) continue;
      parsed.push(record);
    }
    const byCanonicalPath = new Map<string, T>();
    for (const entry of parsed) {
      const base = this.options.adapter.base(entry);
      const key = await canonicalPathKey(base.rootPath);
      const previous = byCanonicalPath.get(key);
      if (!previous || base.createdAt >= this.options.adapter.base(previous).createdAt) byCanonicalPath.set(key, entry);
    }
    const cleaned = [...byCanonicalPath.values()]
      .sort((left, right) => this.options.adapter.base(right).createdAt.localeCompare(this.options.adapter.base(left).createdAt))
      .slice(0, this.maxEntries);
    const serialized = cleaned.map(entry => this.options.adapter.serialize(entry));
    if (JSON.stringify(serialized) !== JSON.stringify(raw)) await this.writeEntries(cleaned);
    return cleaned;
  }

  private async findByCanonicalKey(entries: T[], targetKey: string): Promise<T | undefined> {
    for (const entry of entries) {
      if (await canonicalPathKey(this.options.adapter.base(entry).rootPath) === targetKey) return entry;
    }
    return undefined;
  }

  private async writeEntries(entries: T[]): Promise<void> {
    await this.store.update(this.options.stateKey, entries.map(entry => this.options.adapter.serialize(entry)));
  }

  private async isPresent(record: T): Promise<boolean> {
    return this.options.adapter.isPresent
      ? this.options.adapter.isPresent(record)
      : isDirectory(this.options.adapter.base(record).rootPath);
  }

  private runSerialized<R>(task: () => Promise<R>): Promise<R> {
    const next = this.queue.then(() => this.ready).then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async migrateLegacyState(legacyKey: string): Promise<void> {
    const markerKey = `${this.options.stateKey}.legacyMigration.v1`;
    if (this.store.get<boolean>(markerKey)) return;
    if (this.options.stateKey !== legacyKey && this.store.get<unknown>(this.options.stateKey) === undefined) {
      const legacy = this.store.get<unknown>(legacyKey);
      if (Array.isArray(legacy)) {
        const filtered = this.options.legacyFilter ? legacy.filter(this.options.legacyFilter) : legacy;
        await this.store.update(this.options.stateKey, filtered);
      }
    }
    await this.store.update(markerKey, true);
  }
}

export async function canonicalPathKey(value: string): Promise<string> {
  let canonical = path.normalize(value);
  try { canonical = path.normalize(await fs.realpath(canonical)); } catch { /* Missing paths remain addressable. */ }
  return caseFoldPath(canonical);
}

export function caseFoldPath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}

export function stableResourceId(namespace: string, value: string): string {
  return `${namespace}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

async function isDirectory(target: string): Promise<boolean> {
  try { return (await fs.stat(target)).isDirectory(); } catch { return false; }
}
