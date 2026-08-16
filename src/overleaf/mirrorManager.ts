import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { OverleafClient } from './overleafClient';
import { manifestPath, readManifest } from './manifest';
import type { ProjectSummary } from './types';
import { expandHome } from './util';
import { registerSharedMirror } from './sharedState';
import {
  createProjectMirror,
  initializeMirrorGitRepository,
  projectMirrorRoot
} from './mirrorCore';

export { MIRROR_GITIGNORE_CONTENT } from './mirrorCore';

const LOCAL_MIRRORS_KEY = 'overleafCodex.localMirrors.v1';

export interface LocalMirrorRecord {
  root: string;
  name: string;
  projectId: string;
  serverUrl: string;
  lastSyncAt?: string;
}

export class MirrorManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getConfiguredProjectsRoot(): string {
    const configured = vscode.workspace
      .getConfiguration('overleafCodex')
      .get<string>('localProjectsRoot', '~/Documents/OverleafCodex/projects');
    return expandHome(configured);
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

  async listLocalMirrors(): Promise<LocalMirrorRecord[]> {
    const registry = await this.getRegisteredMirrors();
    const scanned = await this.scanConfiguredRootMirrors();
    const byRoot = new Map<string, LocalMirrorRecord>();
    for (const mirror of [...registry, ...scanned]) {
      const key = normalizeRoot(mirror.root);
      const existing = byRoot.get(key);
      if (!existing || (mirror.lastSyncAt ?? '').localeCompare(existing.lastSyncAt ?? '') > 0) {
        byRoot.set(key, mirror);
      }
    }
    const mirrors = [...byRoot.values()].sort((a, b) => (b.lastSyncAt ?? '').localeCompare(a.lastSyncAt ?? ''));
    await this.context.globalState.update(LOCAL_MIRRORS_KEY, mirrors);
    return mirrors;
  }

  async registerLocalMirror(root: string): Promise<LocalMirrorRecord | undefined> {
    const mirror = await this.recordForMirrorRoot(root);
    if (!mirror) return undefined;
    const registry = await this.getRegisteredMirrors(false);
    const next = [mirror, ...registry.filter(item => normalizeRoot(item.root) !== normalizeRoot(root))];
    await this.context.globalState.update(LOCAL_MIRRORS_KEY, next);
    await registerSharedMirror(root);
    return mirror;
  }

  async forgetLocalMirror(root: string): Promise<void> {
    const registry = await this.getRegisteredMirrors(false);
    const next = registry.filter(item => normalizeRoot(item.root) !== normalizeRoot(root));
    await this.context.globalState.update(LOCAL_MIRRORS_KEY, next);
  }

  async initializeGitRepository(root: string, commitMessage = 'Initial Overleaf mirror'): Promise<void> {
    await initializeMirrorGitRepository(root, commitMessage);
    await this.registerLocalMirror(root);
  }

  private async getRegisteredMirrors(cleanMissing = true): Promise<LocalMirrorRecord[]> {
    const stored = this.context.globalState.get<unknown>(LOCAL_MIRRORS_KEY, []);
    const raw = Array.isArray(stored) ? stored : [];
    if (!cleanMissing) return raw.filter(isLocalMirrorRecord);
    const mirrors: LocalMirrorRecord[] = [];
    for (const item of raw) {
      if (!isLocalMirrorRecord(item)) continue;
      const fresh = await this.recordForMirrorRoot(item.root);
      if (fresh) mirrors.push(fresh);
    }
    if (mirrors.length !== raw.length || mirrors.some((mirror, index) => mirror.lastSyncAt !== raw[index]?.lastSyncAt)) {
      await this.context.globalState.update(LOCAL_MIRRORS_KEY, mirrors);
    }
    return mirrors;
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
      root,
      name: manifest.projectName || path.basename(root),
      projectId: manifest.projectId,
      serverUrl: manifest.serverUrl,
      lastSyncAt: manifest.lastSyncAt
    };
  }
}

function isLocalMirrorRecord(value: unknown): value is LocalMirrorRecord {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as LocalMirrorRecord).root === 'string'
    && typeof (value as LocalMirrorRecord).projectId === 'string'
    && typeof (value as LocalMirrorRecord).serverUrl === 'string';
}

function normalizeRoot(root: string): string {
  return path.resolve(expandHome(root));
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}
