import * as fs from 'fs/promises';
import { atomicWriteText, CONFLICT_INDEX_NAME, MAX_METADATA_JSON_BYTES, metadataPath, readTextFileBounded } from './manifest';
import { assertValidConflicts, validateConflictList } from './metadataValidation';

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
    try {
      const raw = await readTextFileBounded(target, MAX_METADATA_JSON_BYTES).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const validationError = validateConflictList(parsed);
      if (validationError) throw new Error(validationError);
      return parsed as PersistedConflict[];
    } catch (error) {
      await fs.rename(target, `${target}.corrupt-${Date.now()}`).catch(() => undefined);
      console.warn(`Overleaf conflict index at ${target} was quarantined: ${error instanceof Error ? error.message : String(error)}`);
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
    assertValidConflicts(records);
    return atomicWriteText(metadataPath(this.root, CONFLICT_INDEX_NAME), `${JSON.stringify(records, null, 2)}\n`);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }
}
