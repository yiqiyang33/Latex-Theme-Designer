import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ManifestFile,
  OverleafCodexManifest,
  SyncStatusItem,
  SyncStatusKind,
  SyncStatusReport
} from './types';
import { shouldIgnore, shouldIgnoreUntrackedLocalPath } from './manifest';
import { sha1, toPosixPath } from './util';

export interface SyncStatusDecisionInput {
  path: string;
  manifestFile?: ManifestFile;
  remoteFile?: ManifestFile;
  localHash?: string;
  remoteHash?: string;
  baseHash?: string;
  localExists: boolean;
  remoteReadError?: string;
}

export function classifySyncStatus(input: SyncStatusDecisionInput): SyncStatusItem {
  const entity = input.remoteFile ?? input.manifestFile;
  const baseHash = input.baseHash ?? input.manifestFile?.baseHash ?? input.manifestFile?.sha1;
  const itemBase = {
    path: input.path,
    entityId: entity?.entityId,
    entityType: entity?.entityType,
    parentFolderId: entity?.parentFolderId,
    version: input.manifestFile?.version,
    remoteVersion: input.remoteFile?.version,
    localHash: input.localHash,
    remoteHash: input.remoteHash,
    baseHash
  };

  let status: SyncStatusKind;
  let message: string | undefined;
  if (input.remoteReadError) {
    status = 'error';
    message = input.remoteReadError;
  } else if (!input.manifestFile && input.localExists && input.remoteFile) {
    if (input.localHash && input.remoteHash && input.localHash === input.remoteHash) {
      status = 'synced';
      message = 'Present locally and remotely but missing from the local manifest; the manifest can be repaired.';
    } else {
      status = 'diverged';
      message = 'The same path exists locally and remotely, but the local manifest has no base snapshot.';
    }
  } else if (!input.manifestFile && input.localExists && !input.remoteFile) {
    status = 'local only';
  } else if (!input.manifestFile && !input.localExists && input.remoteFile) {
    status = 'remote only';
  } else if (input.manifestFile && !input.localExists && input.remoteFile) {
    status = 'local deleted';
  } else if (input.manifestFile && input.localExists && !input.remoteFile) {
    status = 'remote deleted';
  } else if (!input.localExists && !input.remoteFile) {
    status = 'remote deleted';
  } else if (input.localHash && input.remoteHash && input.localHash === input.remoteHash) {
    status = 'synced';
  } else if (!baseHash) {
    status = 'diverged';
  } else {
    const localChanged = input.localHash !== undefined && input.localHash !== baseHash;
    const remoteChanged = input.remoteHash !== undefined && input.remoteHash !== baseHash;
    if (localChanged && !remoteChanged) {
      status = 'local ahead';
    } else if (!localChanged && remoteChanged) {
      status = 'remote ahead';
    } else if (localChanged && remoteChanged) {
      status = 'diverged';
    } else {
      status = 'synced';
    }
  }

  return {
    ...itemBase,
    status,
    message,
    blocking: isBlockingStatus(status),
    blockingScope: status === 'synced' ? 'none' : 'path',
    localPath: input.localExists ? input.path : undefined,
    remotePath: input.remoteFile ? input.path : undefined,
    changeKind: status === 'error'
      ? 'read-error'
      : status === 'local only' || status === 'remote only'
        ? 'create'
        : status === 'local deleted' || status === 'remote deleted'
          ? 'delete'
          : status === 'synced' ? undefined : 'content'
  };
}

export function isBlockingStatus(status: SyncStatusKind): boolean {
  return status !== 'synced';
}

export function classifyFolderStructure(
  manifest: OverleafCodexManifest,
  remote: OverleafCodexManifest,
  requestedPaths?: Iterable<string>
): { items: SyncStatusItem[]; globalBlockReason?: string } {
  const localRoot = manifest.folders[''];
  const remoteRoot = remote.folders[''];
  if (!localRoot || !remoteRoot || localRoot.entityId !== remoteRoot.entityId) {
    return {
      items: [],
      globalBlockReason: 'The Overleaf project root folder is missing or changed identity; outbound writes are frozen.'
    };
  }
  const requested = requestedPaths ? [...requestedPaths].map(toPosixPath) : undefined;
  const paths = new Set([
    ...Object.keys(manifest.folders),
    ...Object.keys(remote.folders)
  ]);
  const items: SyncStatusItem[] = [];
  for (const folderPath of paths) {
    if (!folderPath || requested && !requested.some(item =>
      item === folderPath || item.startsWith(`${folderPath}/`) || folderPath.startsWith(`${item}/`)
    )) continue;
    const localFolder = manifest.folders[folderPath];
    const remoteFolder = remote.folders[folderPath];
    if (localFolder?.entityId === remoteFolder?.entityId
      && localFolder?.parentFolderId === remoteFolder?.parentFolderId) continue;
    if (localFolder && remoteFolder) {
      items.push({
        path: folderPath,
        status: 'error',
        entityId: remoteFolder.entityId,
        entityType: 'folder',
        parentFolderId: remoteFolder.parentFolderId,
        blocking: true,
        blockingScope: 'subtree',
        localPath: folderPath,
        remotePath: folderPath,
        changeKind: 'type-change',
        message: 'The local manifest and Overleaf tree assign different identities to this folder.'
      });
    } else if (remoteFolder) {
      items.push({
        path: folderPath,
        status: 'remote only',
        entityId: remoteFolder.entityId,
        entityType: 'folder',
        parentFolderId: remoteFolder.parentFolderId,
        blocking: true,
        blockingScope: 'subtree',
        remotePath: folderPath,
        changeKind: 'create',
        message: 'This Overleaf folder is not represented by the trusted local manifest.'
      });
    } else if (localFolder) {
      items.push({
        path: folderPath,
        status: 'remote deleted',
        entityId: localFolder.entityId,
        entityType: 'folder',
        parentFolderId: localFolder.parentFolderId,
        blocking: true,
        blockingScope: 'subtree',
        localPath: folderPath,
        changeKind: 'delete',
        message: 'This tracked folder is absent from the current Overleaf project tree.'
      });
    }
  }
  return { items };
}

export interface FolderManifestRepair {
  adopted: string[];
  remapped: Array<{ oldPath: string; newPath: string }>;
}

/**
 * Repairs folder metadata only when the local directory layout corroborates the
 * remote tree. Entity identity makes renames unambiguous; exact-path adoption
 * recovers a folder whose successful create was lost from a stale manifest write.
 */
export function repairFolderManifestFromRemote(
  manifest: OverleafCodexManifest,
  remote: OverleafCodexManifest,
  localFolderPaths: Iterable<string>
): FolderManifestRepair {
  const local = new Set([...localFolderPaths].map(toPosixPath));
  const adopted: string[] = [];
  const remapped: Array<{ oldPath: string; newPath: string }> = [];
  const remoteFolders = Object.values(remote.folders)
    .filter(folder => folder.path)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  for (const remoteFolder of remoteFolders) {
    if (manifest.folders[remoteFolder.path]) continue;
    const oldFolder = Object.values(manifest.folders)
      .find(folder => folder.entityId === remoteFolder.entityId);
    if (!oldFolder?.path || !local.has(remoteFolder.path) || local.has(oldFolder.path)) continue;
    const oldPath = oldFolder.path;
    remapManifestSubtree(manifest, oldPath, remoteFolder.path);
    const moved = manifest.folders[remoteFolder.path];
    if (moved) moved.parentFolderId = remoteFolder.parentFolderId;
    remapped.push({ oldPath, newPath: remoteFolder.path });
  }

  for (const remoteFolder of remoteFolders) {
    if (manifest.folders[remoteFolder.path] || !local.has(remoteFolder.path)) continue;
    if (Object.values(manifest.folders).some(folder => folder.entityId === remoteFolder.entityId)) continue;
    manifest.folders[remoteFolder.path] = { ...remoteFolder };
    adopted.push(remoteFolder.path);
  }

  return { adopted, remapped };
}

function remapManifestSubtree(manifest: OverleafCodexManifest, oldPath: string, newPath: string): void {
  const oldPrefix = `${oldPath}/`;
  for (const folder of Object.values(manifest.folders)) {
    if (folder.path !== oldPath && !folder.path.startsWith(oldPrefix)) continue;
    delete manifest.folders[folder.path];
    folder.path = folder.path === oldPath
      ? newPath
      : `${newPath}/${folder.path.slice(oldPrefix.length)}`;
    manifest.folders[folder.path] = folder;
  }
  for (const file of Object.values(manifest.files)) {
    if (!file.path.startsWith(oldPrefix)) continue;
    delete manifest.files[file.path];
    file.path = `${newPath}/${file.path.slice(oldPrefix.length)}`;
    manifest.files[file.path] = file;
  }
  if (manifest.rootDocPath?.startsWith(oldPrefix)) {
    manifest.rootDocPath = `${newPath}/${manifest.rootDocPath.slice(oldPrefix.length)}`;
  }
}

export function makeSyncStatusReport(
  manifest: OverleafCodexManifest,
  items: SyncStatusItem[],
  options: {
    mode?: 'incremental' | 'full';
    completeness?: 'complete' | 'partial' | 'failed';
    globalBlockReason?: string;
  } = {}
): SyncStatusReport {
  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    projectId: manifest.projectId,
    projectName: manifest.projectName,
    hasBlocking: sorted.some(item => item.blocking),
    items: sorted,
    checkMode: options.mode ?? 'full',
    completeness: options.completeness ?? 'complete',
    globalBlockReason: options.globalBlockReason
  };
}

export function mergeTargetedSyncStatusReport(
  previous: SyncStatusReport | undefined,
  targeted: SyncStatusReport,
  requestedPaths: Iterable<string>
): SyncStatusReport {
  if (!previous || previous.projectId !== targeted.projectId) {
    return targeted;
  }
  const requested = new Set([...requestedPaths].map(toPosixPath));
  const replacements = new Set(targeted.items.map(item => toPosixPath(item.path)));
  const items = [
    ...previous.items.filter(item => {
      const itemPath = toPosixPath(item.path);
      return !requested.has(itemPath) && !replacements.has(itemPath);
    }),
    ...targeted.items
  ].sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...targeted,
    schemaVersion: 2,
    items,
    hasBlocking: items.some(item => item.blocking),
    globalBlockReason: targeted.globalBlockReason ?? previous.globalBlockReason
  };
}

export async function listLocalProjectFiles(root: string, manifest: OverleafCodexManifest): Promise<string[]> {
  const files: string[] = [];
  await walk(root, '');
  return files.sort();

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relPath = toPosixPath(path.posix.join(relDir, entry.name));
      const tracked = isTrackedPathOrParent(manifest, relPath);
      if (
        !relPath
        || shouldSkip(relPath)
        || shouldIgnore(manifest, relPath)
        || (!tracked && shouldIgnoreUntrackedLocalPath(manifest, relPath))
      ) {
        continue;
      }
      const absPath = path.join(root, relPath);
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }
}

export async function listLocalProjectFolders(root: string, manifest: OverleafCodexManifest): Promise<string[]> {
  const folders: string[] = [];
  await walk(root, '');
  return folders.sort();

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relPath = toPosixPath(path.posix.join(relDir, entry.name));
      const tracked = isTrackedPathOrParent(manifest, relPath);
      if (
        !relPath
        || shouldSkip(relPath)
        || shouldIgnore(manifest, relPath)
        || (!tracked && shouldIgnoreUntrackedLocalPath(manifest, relPath))
      ) {
        continue;
      }
      folders.push(relPath);
      await walk(path.join(root, relPath), relPath);
    }
  }
}

function isTrackedPathOrParent(manifest: OverleafCodexManifest, relPath: string): boolean {
  if (manifest.files[relPath] || manifest.folders[relPath]) {
    return true;
  }
  const prefix = `${relPath}/`;
  return Object.keys(manifest.files).some(item => item.startsWith(prefix))
    || Object.keys(manifest.folders).some(item => item.startsWith(prefix));
}

export async function fileHash(filePath: string): Promise<string | undefined> {
  const content = await fs.readFile(filePath).catch(() => undefined);
  return content ? sha1(content) : undefined;
}

export async function cachedLocalFileHash(
  filePath: string,
  manifestFile: ManifestFile | undefined,
  force = false
): Promise<{ hash?: string; cacheChanged: boolean; reused: boolean }> {
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat?.isFile()) {
    if (manifestFile) {
      const cacheChanged = manifestFile.localHashCache !== undefined
        || manifestFile.localSize !== undefined
        || manifestFile.localMtimeMs !== undefined
        || manifestFile.localCtimeMs !== undefined
        || manifestFile.localInode !== undefined;
      delete manifestFile.localHashCache;
      delete manifestFile.localSize;
      delete manifestFile.localMtimeMs;
      delete manifestFile.localCtimeMs;
      delete manifestFile.localInode;
      return { hash: undefined, cacheChanged, reused: false };
    }
    return { hash: undefined, cacheChanged: false, reused: false };
  }

  const inode = Number(stat.ino);
  if (
    !force
    && manifestFile?.localHashCache !== undefined
    && manifestFile.localSize === stat.size
    && manifestFile.localMtimeMs === stat.mtimeMs
    && manifestFile.localCtimeMs === stat.ctimeMs
    && manifestFile.localInode === inode
  ) {
    return { hash: manifestFile.localHashCache, cacheChanged: false, reused: true };
  }

  const hash = await fileHash(filePath);
  if (!manifestFile) return { hash, cacheChanged: false, reused: false };
  const cacheChanged = manifestFile.localHashCache !== hash
    || manifestFile.localSize !== stat.size
    || manifestFile.localMtimeMs !== stat.mtimeMs
    || manifestFile.localCtimeMs !== stat.ctimeMs
    || manifestFile.localInode !== inode;
  manifestFile.localHashCache = hash;
  manifestFile.localSize = stat.size;
  manifestFile.localMtimeMs = stat.mtimeMs;
  manifestFile.localCtimeMs = stat.ctimeMs;
  manifestFile.localInode = inode;
  return { hash, cacheChanged, reused: false };
}

export function trashPathFor(root: string, relPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(root, '.overleaf-codex', 'trash', stamp, relPath);
}

function shouldSkip(relPath: string): boolean {
  return /(^|\/)(\.overleaf-codex|\.vscode|\.git)(\/|$)/.test(relPath);
}
