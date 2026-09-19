import { SyncStatusKind, SyncStatusReport } from './types';
import { toPosixPath } from './util';

/**
 * Statuses that are worth flagging for review but must not stop an upload, because uploading is
 * exactly what resolves them. Gating these deadlocks the file: the write that would clear the
 * status is the write the gate refuses.
 */
const UPLOADABLE_BLOCKING_STATUSES: ReadonlySet<SyncStatusKind> = new Set<SyncStatusKind>(['local ahead', 'local only']);

export type ProjectSyncGate = 'ready' | 'checking' | 'reconnecting' | 'blocked-auth' | 'blocked-tree' | 'stopped';
export type PathSyncState = 'active' | 'pending' | 'conflict' | 'error' | 'busy';

/**
 * Project states that close the gate only while sync catches up with itself. They clear on their
 * own, so work blocked by them should be retried rather than recorded as needing review.
 */
const TRANSIENT_PROJECT_GATES: ReadonlySet<ProjectSyncGate> = new Set<ProjectSyncGate>(['checking', 'reconnecting']);

export interface PathGateEntry {
  path: string;
  state: Exclude<PathSyncState, 'active'>;
  subtree: boolean;
  reason?: string;
}

export class SyncGate {
  private projectState: ProjectSyncGate = 'stopped';
  private projectReason?: string;
  private readonly paths = new Map<string, PathGateEntry>();

  get project(): ProjectSyncGate {
    return this.projectState;
  }

  get reason(): string | undefined {
    return this.projectReason;
  }

  setProject(state: ProjectSyncGate, reason?: string): void {
    this.projectState = state;
    this.projectReason = reason;
  }

  setPath(path: string, state: Exclude<PathSyncState, 'active'>, reason?: string, subtree = false): void {
    const normalized = toPosixPath(path);
    this.paths.set(normalized, { path: normalized, state, reason, subtree });
  }

  clearPath(path: string): void {
    this.paths.delete(toPosixPath(path));
  }

  clearPaths(): void {
    this.paths.clear();
  }

  remapPath(oldPath: string, newPath: string, subtree = false): void {
    const normalizedOld = toPosixPath(oldPath);
    const normalizedNew = toPosixPath(newPath);
    const oldPrefix = `${normalizedOld}/`;
    for (const entry of [...this.paths.values()]) {
      if (entry.path !== normalizedOld && !(subtree && entry.path.startsWith(oldPrefix))) continue;
      this.paths.delete(entry.path);
      const path = entry.path === normalizedOld
        ? normalizedNew
        : `${normalizedNew}/${entry.path.slice(oldPrefix.length)}`;
      this.paths.set(path, { ...entry, path });
    }
  }

  canSync(path: string): boolean {
    if (this.projectState !== 'ready') return false;
    return this.findBlocking(path) === undefined;
  }

  /**
   * True when `path` is held up only by a reconnect or an in-flight check, with nothing
   * path-specific against it. Such work is worth retrying once the gate reopens.
   */
  isTransientlyBlocked(path: string): boolean {
    return TRANSIENT_PROJECT_GATES.has(this.projectState) && this.findBlocking(path) === undefined;
  }

  findBlocking(path: string): PathGateEntry | undefined {
    const normalized = toPosixPath(path);
    const exact = this.paths.get(normalized);
    if (exact) return exact;
    return [...this.paths.values()].find(entry => entry.subtree && (normalized === entry.path || normalized.startsWith(`${entry.path}/`)));
  }

  entries(): PathGateEntry[] {
    return [...this.paths.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  applyReport(report: SyncStatusReport): void {
    this.paths.clear();
    for (const item of report.items) {
      if (!item.blocking || UPLOADABLE_BLOCKING_STATUSES.has(item.status)) continue;
      const state = item.status === 'error' ? 'error' : item.status === 'diverged' ? 'conflict' : 'pending';
      this.setPath(item.path, state, item.message, item.blockingScope === 'subtree');
    }
    this.setProject(report.globalBlockReason ? 'blocked-tree' : 'ready', report.globalBlockReason);
  }
}
