import type { PersistedConflict } from './conflictStore';
import type { ManifestFile, SyncStatusItem, SyncStatusKind, SyncStatusReport } from './types';
import { isTextLike } from './util';

export interface SyncStatusRequest {
  refresh: boolean;
  full: boolean;
  paths?: string[];
  reason?: string;
}

export interface SyncCommandBackend {
  status(request: SyncStatusRequest): Promise<SyncStatusReport | undefined>;
  syncOnce(): Promise<SyncStatusReport>;
  push(path: string, force: boolean): Promise<void>;
  pull(path: string, force: boolean): Promise<void>;
  conflicts(): Promise<PersistedConflict[] | unknown[]>;
  resolveConflict(path: string, use: 'local' | 'remote'): Promise<void>;
  authorize?(command: 'push' | 'pull', path: string, force: boolean): Promise<void>;
}

export interface SafeSyncPlan {
  pulls: SyncStatusItem[];
  pushes: SyncStatusItem[];
}

export function planSafeSyncActions(
  report: SyncStatusReport,
  policy: { autoPushLocalAhead: boolean; syncBinaryFiles: boolean }
): SafeSyncPlan {
  return {
    pulls: report.items.filter(item => item.status === 'remote ahead' || item.status === 'remote only'),
    pushes: policy.autoPushLocalAhead
      ? report.items.filter(item =>
        item.entityType !== 'folder'
        && (item.status === 'local ahead' || item.status === 'local only')
        && (isTextLike(item.path) || policy.syncBinaryFiles)
      )
      : []
  };
}

export function selectRemoteWriteTarget(
  relPath: string,
  manifestFile: ManifestFile | undefined,
  remoteFile: ManifestFile | undefined,
  force: boolean
): ManifestFile | undefined {
  if (manifestFile && !remoteFile && !force) {
    throw new Error(`${relPath} was deleted on Overleaf; use --force to restore it with a new remote entity.`);
  }
  return remoteFile;
}

export function syncOperationRequiresForce(operation: 'push' | 'pull', status: SyncStatusKind | undefined): boolean {
  if (!status) return false;
  return operation === 'push'
    ? ['remote ahead', 'remote deleted', 'diverged', 'local deleted'].includes(status)
    : ['local ahead', 'local only', 'remote deleted', 'diverged'].includes(status);
}

export async function executeSyncCommand(
  backend: SyncCommandBackend,
  command: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  switch (command) {
    case 'status':
      return backend.status({
        refresh: Boolean(args.refresh),
        full: Boolean(args.full),
        paths: stringArray(args.paths),
        reason: typeof args.reason === 'string' ? args.reason : 'ipc-status'
      });
    case 'sync-once':
      return backend.syncOnce();
    case 'push':
    case 'pull': {
      const path = requiredPath(args.path);
      const force = Boolean(args.force);
      await backend.authorize?.(command, path, force);
      await backend[command](path, force);
      return backend.status({
        refresh: true,
        full: false,
        paths: [path],
        reason: `post-${command}`
      });
    }
    case 'conflicts-list':
      return backend.conflicts();
    case 'conflicts-resolve': {
      const path = requiredPath(args.path);
      await backend.resolveConflict(path, args.use === 'remote' ? 'remote' : 'local');
      return backend.conflicts();
    }
    default:
      throw new Error(`Unsupported sync owner command: ${command}`);
  }
}

function requiredPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A project-relative path is required.');
  return value;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}
