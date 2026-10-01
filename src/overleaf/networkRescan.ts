import { scanLocalProject } from './syncStatus';
import type { OverleafCodexManifest } from './types';
import { isNetworkFileSystem } from './util';

export const DEFAULT_NETWORK_RESCAN_MS = 30_000;

export interface RescanChange {
  relPath: string;
  kind: 'create' | 'change' | 'delete';
}

/**
 * Notices edits made on other machines. File watchers (inotify, FSEvents) only report changes made
 * through this machine's kernel, so on a mirror in an NFS home a save from another login node or a
 * cluster job is never reported. On a network filesystem this compares each file's size, mtime and
 * inode with the previous pass - a stat per file, no reads - and reports what differs.
 */
export class NetworkRescanner {
  private timer?: NodeJS.Timeout;
  private previous?: Map<string, string>;
  private scanning = false;
  private stopped = true;

  constructor(
    private readonly root: string,
    private readonly manifest: () => OverleafCodexManifest | undefined,
    private readonly onChanges: (changes: RescanChange[]) => void,
    private readonly intervalMs = DEFAULT_NETWORK_RESCAN_MS,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  /** Starts polling when the mirror is on a network filesystem (or when forced); returns whether it did. */
  async start(force = false): Promise<boolean> {
    if (this.intervalMs <= 0) return false;
    if (!force && !await isNetworkFileSystem(this.root)) return false;
    this.stopped = false;
    this.previous = await this.snapshot().catch(error => {
      this.onError(error);
      return undefined;
    });
    this.schedule();
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** One comparison pass; reports and returns the differences from the previous pass. */
  async poll(): Promise<RescanChange[]> {
    if (this.scanning) return [];
    this.scanning = true;
    try {
      const current = await this.snapshot();
      if (!current) return [];
      const previous = this.previous;
      this.previous = current;
      if (!previous) return [];
      const changes: RescanChange[] = [];
      for (const [relPath, stamp] of current) {
        const before = previous.get(relPath);
        if (before === undefined) changes.push({ relPath, kind: 'create' });
        else if (before !== stamp) changes.push({ relPath, kind: 'change' });
      }
      for (const relPath of previous.keys()) {
        if (!current.has(relPath)) changes.push({ relPath, kind: 'delete' });
      }
      if (changes.length && !this.stopped) this.onChanges(changes);
      return changes;
    } finally {
      this.scanning = false;
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll().catch(error => this.onError(error)).finally(() => this.schedule());
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async snapshot(): Promise<Map<string, string> | undefined> {
    const manifest = this.manifest();
    if (!manifest) return undefined;
    const scan = await scanLocalProject(this.root, manifest);
    const stamps = new Map<string, string>();
    for (const relPath of scan.files) {
      const metadata = scan.fileMetadata.get(relPath);
      stamps.set(relPath, metadata ? `${metadata.size}:${metadata.mtimeMs}:${metadata.inode}` : 'unknown');
    }
    return stamps;
  }
}
