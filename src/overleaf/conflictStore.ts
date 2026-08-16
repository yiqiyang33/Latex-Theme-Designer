import * as fs from 'fs/promises';
import { atomicWriteText, CONFLICT_INDEX_NAME, metadataPath } from './manifest';

export interface PersistedConflict {
  relPath: string;
  docId: string;
  remoteVersion: number;
  remotePath: string;
  reason: string;
  createdAt: string;
}

export class ConflictStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  async list(): Promise<PersistedConflict[]> {
    const target = metadataPath(this.root, CONFLICT_INDEX_NAME);
    const raw = await fs.readFile(target, 'utf8').catch(() => undefined);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.relPath !== 'string' || typeof item.docId !== 'string')) throw new Error('invalid conflict index');
      return parsed as PersistedConflict[];
    } catch {
      await fs.rename(target, `${target}.corrupt-${Date.now()}`).catch(() => undefined);
      return [];
    }
  }

  upsert(conflict: PersistedConflict): Promise<void> {
    return this.run(async () => {
      const records = await this.list();
      const index = records.findIndex(item => item.relPath === conflict.relPath);
      if (index >= 0) records[index] = conflict; else records.push(conflict);
      await this.write(records);
    });
  }

  remove(relPath: string): Promise<void> {
    return this.run(async () => this.write((await this.list()).filter(item => item.relPath !== relPath)));
  }

  remap(oldPath: string, newPath: string, subtree = false): Promise<void> {
    return this.run(async () => {
      const oldPrefix = `${oldPath}/`;
      const records = (await this.list()).map(item => {
        if (item.relPath === oldPath) return { ...item, relPath: newPath };
        if (subtree && item.relPath.startsWith(oldPrefix)) {
          return { ...item, relPath: `${newPath}/${item.relPath.slice(oldPrefix.length)}` };
        }
        return item;
      });
      await this.write(records);
    });
  }

  private write(records: PersistedConflict[]): Promise<void> {
    return atomicWriteText(metadataPath(this.root, CONFLICT_INDEX_NAME), `${JSON.stringify(records, null, 2)}\n`);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }
}
