import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { OverleafClient } from './overleafClient';
import { manifestPath, readManifest } from './manifest';
import type { ProjectSummary } from './types';
import { expandHome } from './util';
import { defaultLocalProjectsRoot, normalizeLocalProjectsRoot, registerSharedMirror } from './sharedState';
import {
  LOCAL_RESOURCE_MAX_ENTRIES,
  LocalResourceRegistry,
  canonicalPathKey,
  normalizeLocalPath,
  safeNormalizeLocalPath,
  scopedStateKey,
  stableResourceId,
  type LocalResourceAdapter
} from '../localResourceRegistry';
import {
  createProjectMirror,
  initializeMirrorGitRepository,
  projectMirrorRoot
} from './mirrorCore';

export { MIRROR_GITIGNORE_CONTENT } from './mirrorCore';

const LOCAL_MIRRORS_KEY = 'overleafCodex.localMirrors';
const IGNORED_MIRRORS_KEY = 'overleafCodex.ignoredLocalMirrors';

export interface LocalMirrorRecord {
  id: string;
  root: string;
  name: string;
  projectId: string;
  serverUrl: string;
  lastSyncAt?: string;
  createdAt: string;
}

export interface LocalMirrorStatus extends LocalMirrorRecord {
  missing: boolean;
}

const mirrorAdapter: LocalResourceAdapter<LocalMirrorRecord> = {
  parse(raw: unknown): LocalMirrorRecord | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const item = raw as Record<string, unknown>;
    const root = safeNormalizeLocalPath(item.root);
    const projectId = typeof item.projectId === 'string' ? item.projectId.trim() : '';
    const serverUrl = typeof item.serverUrl === 'string' ? item.serverUrl.trim() : '';
    if (!root || !projectId || !serverUrl || projectId.length > 256 || serverUrl.length > 2048) return undefined;
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : stableResourceId('mirror', `${serverUrl}|${projectId}|${root}`);
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : path.basename(root);
    const lastSyncAt = typeof item.lastSyncAt === 'string' && item.lastSyncAt.trim() ? item.lastSyncAt : undefined;
    const createdAt = typeof item.createdAt === 'string' && item.createdAt.trim()
      ? item.createdAt
      : lastSyncAt ?? new Date(0).toISOString();
    return { id, root, name, projectId, serverUrl, lastSyncAt, createdAt };
  },
  serialize(record) { return record; },
  base(record) { return { id: record.id, rootPath: record.root, label: record.name, createdAt: record.createdAt }; },
  async isPresent(record) {
    if (!await exists(manifestPath(record.root))) return false;
    return Boolean(await readManifest(record.root).catch(() => undefined));
  }
};

export class MirrorManager {
  private readonly registry: LocalResourceRegistry<LocalMirrorRecord>;
  private readonly stateKey: string;
  private readonly ignoredKey: string;

  constructor(private readonly context: vscode.ExtensionContext, scope = 'local', migrateLegacy = false) {
    this.stateKey = scopedStateKey(LOCAL_MIRRORS_KEY, scope);
    this.ignoredKey = scopedStateKey(IGNORED_MIRRORS_KEY, scope);
    this.registry = new LocalResourceRegistry(context.globalState, {
      stateKey: this.stateKey,
      adapter: mirrorAdapter,
      legacyKey: 'overleafCodex.localMirrors.v1',
      migrateLegacy,
      legacyFilter: raw => {
        const mirror = mirrorAdapter.parse(raw);
        return Boolean(mirror && isPathWithin(this.getConfiguredProjectsRoot(), mirror.root));
      },
      maxEntries: LOCAL_RESOURCE_MAX_ENTRIES
    });
  }

  getConfiguredProjectsRoot(): string {
    const configured = vscode.workspace
      .getConfiguration('overleafCodex')
      .get<string>('localProjectsRoot', defaultLocalProjectsRoot());
    return normalizeLocalProjectsRoot(configured);
  }

  getProjectMirrorRoot(parentRoot: string, project: ProjectSummary): string {
    return projectMirrorRoot(parentRoot, project);
  }

  async mirrorProject(client: OverleafClient, project: ProjectSummary, parentRoot?: string): Promise<string> {
    const projectsRoot = parentRoot ? expandHome(parentRoot) : this.getConfiguredProjectsRoot();
    return createProjectMirror(client, project, projectsRoot, {
      register: root => this.registerLocalMirror(root)
    });
  }

  async openFolder(root: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), false);
  }

  async listLocalMirrors(): Promise<LocalMirrorStatus[]> {
    const ignored = await this.getIgnoredRoots();
    const byRoot = new Map<string, LocalMirrorStatus>();
    for (const status of await this.registry.list()) {
      const rootKey = await canonicalPathKey(status.record.root);
      if (ignored.has(rootKey)) continue;
      const fresh = await this.recordForMirrorRoot(status.record.root);
      byRoot.set(rootKey, fresh
        ? { ...fresh, missing: false }
        : { ...status.record, missing: true });
      if (fresh) await this.registry.upsert(fresh);
    }
    for (const mirror of await this.scanConfiguredRootMirrors()) {
      const rootKey = await canonicalPathKey(mirror.root);
      if (ignored.has(rootKey)) continue;
      await this.registry.upsert(mirror);
      byRoot.set(rootKey, { ...mirror, missing: false });
    }
    return [...byRoot.values()].sort((a, b) => {
      if (a.missing !== b.missing) return a.missing ? 1 : -1;
      return (b.lastSyncAt ?? b.createdAt).localeCompare(a.lastSyncAt ?? a.createdAt);
    });
  }

  async findLocalMirrorById(id: string): Promise<LocalMirrorStatus | undefined> {
    const status = await this.registry.findById(id);
    if (!status) return undefined;
    const ignored = await this.getIgnoredRoots();
    if (ignored.has(await canonicalPathKey(status.record.root))) return undefined;
    const fresh = await this.recordForMirrorRoot(status.record.root);
    return fresh ? { ...fresh, missing: false } : { ...status.record, missing: true };
  }

  async findLocalMirrorByRoot(root: string): Promise<LocalMirrorStatus | undefined> {
    const status = await this.registry.findByRoot(normalizeLocalPath(root));
    if (!status) return undefined;
    const ignored = await this.getIgnoredRoots();
    if (ignored.has(await canonicalPathKey(status.record.root))) return undefined;
    const fresh = await this.recordForMirrorRoot(status.record.root);
    return fresh ? { ...fresh, missing: false } : { ...status.record, missing: true };
  }

  async registerLocalMirror(root: string): Promise<LocalMirrorRecord | undefined> {
    const mirror = await this.recordForMirrorRoot(root);
    if (!mirror) return undefined;
    await this.registry.upsert(mirror);
    await this.removeIgnoredRoot(root);
    await registerSharedMirror(root);
    return mirror;
  }

  async forgetLocalMirror(root: string): Promise<void> {
    await this.registry.removeByRoot(normalizeLocalPath(root));
    await this.addIgnoredRoot(root);
  }

  async clearMissingLocalMirrors(): Promise<number> {
    const removed = await this.registry.removeMissing();
    await this.pruneIgnoredRoots();
    return removed;
  }

  async initializeGitRepository(root: string, commitMessage = 'Initial Overleaf mirror'): Promise<void> {
    await initializeMirrorGitRepository(root, commitMessage);
    await this.registerLocalMirror(root);
  }

  private async scanConfiguredRootMirrors(): Promise<LocalMirrorRecord[]> {
    const projectsRoot = this.getConfiguredProjectsRoot();
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
    const mirrors: LocalMirrorRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const mirror = await this.recordForMirrorRoot(path.join(projectsRoot, entry.name));
      if (mirror) mirrors.push(mirror);
    }
    return mirrors;
  }

  private async recordForMirrorRoot(root: string): Promise<LocalMirrorRecord | undefined> {
    if (!await exists(manifestPath(root))) return undefined;
    const manifest = await readManifest(root).catch(() => undefined);
    if (!manifest) return undefined;
    return {
      id: stableResourceId('mirror', `${manifest.serverUrl}|${manifest.projectId}|${path.resolve(root)}`),
      root,
      name: manifest.projectName || path.basename(root),
      projectId: manifest.projectId,
      serverUrl: manifest.serverUrl,
      lastSyncAt: manifest.lastSyncAt,
      createdAt: manifest.lastSyncAt ?? new Date().toISOString()
    };
  }

  private async getIgnoredRoots(): Promise<Set<string>> {
    const raw = this.context.globalState.get<unknown>(this.ignoredKey, []);
    if (!Array.isArray(raw)) return new Set();
    const result = new Set<string>();
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const normalized = safeNormalizeLocalPath(item);
      if (normalized) result.add(await canonicalPathKey(normalized));
    }
    return result;
  }

  private async addIgnoredRoot(root: string): Promise<void> {
    const roots = [...await this.getIgnoredRoots(), await canonicalPathKey(normalizeLocalPath(root))];
    await this.context.globalState.update(this.ignoredKey, [...new Set(roots)].slice(-LOCAL_RESOURCE_MAX_ENTRIES));
  }

  private async removeIgnoredRoot(root: string): Promise<void> {
    const key = await canonicalPathKey(normalizeLocalPath(root));
    const roots = [...await this.getIgnoredRoots()].filter(item => item !== key);
    await this.context.globalState.update(this.ignoredKey, roots);
  }

  private async pruneIgnoredRoots(): Promise<void> {
    const roots = [...await this.getIgnoredRoots()];
    const existing: string[] = [];
    for (const root of roots) {
      try { await fs.stat(root); existing.push(root); } catch { /* stale tombstones are safe to discard */ }
    }
    await this.context.globalState.update(this.ignoredKey, existing);
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

function isPathWithin(parent: string, candidate: string): boolean {
  const base = path.resolve(parent);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}
