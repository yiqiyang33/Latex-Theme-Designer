import * as fs from 'fs/promises';
import * as path from 'path';
import {
  atomicWriteText,
  baseDocPath,
  metadataPath,
  readManifest,
  syncStatusPath,
  writeBaseDoc,
  writeManifest,
  writeSyncStatus
} from './manifest';
import { OverleafCodexManifest, SyncStatusReport } from './types';

export class ManifestStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly root: string) {}

  readManifest(): Promise<OverleafCodexManifest> {
    return readManifest(this.root);
  }

  writeManifest(manifest: OverleafCodexManifest): Promise<void> {
    return this.run(() => writeManifest(this.root, manifest));
  }

  writeSyncStatus(report: SyncStatusReport): Promise<void> {
    return this.run(() => writeSyncStatus(this.root, report));
  }

  writeBaseDoc(docId: string, content: string): Promise<string> {
    return this.run(() => writeBaseDoc(this.root, docId, content));
  }

  async readJson<T>(name: string, fallback: T): Promise<T> {
    const raw = await fs.readFile(metadataPath(this.root, name), 'utf8').catch(() => undefined);
    return raw ? JSON.parse(raw) as T : fallback;
  }

  writeJson(name: string, value: unknown): Promise<void> {
    return this.run(() => atomicWriteText(metadataPath(this.root, name), `${JSON.stringify(value, null, 2)}\n`));
  }

  paths(): { manifest: string; status: string; base: (docId: string) => string } {
    return {
      manifest: path.join(this.root, '.overleaf-codex', 'manifest.json'),
      status: syncStatusPath(this.root),
      base: docId => baseDocPath(this.root, docId)
    };
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }
}
