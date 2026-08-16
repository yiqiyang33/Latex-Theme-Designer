import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockingExitCode, makeSuccessEnvelope, parseArgs } from '../src/cli';
import { installCli, uninstallCli } from '../src/overleaf/cliInstaller';
import { KEYCHAIN_SERVICE, MacKeychainCredentialStore, type SecurityRunner } from '../src/overleaf/keychainStore';
import { defaultSharedState, readSharedState, registerSharedMirror, sharedStatePath, updateSharedState } from '../src/overleaf/sharedState';
import { runtimePaths, SyncOwnerCoordinator } from '../src/overleaf/syncOwnerCoordinator';
import { readManifest, writeManifest } from '../src/overleaf/manifest';
import type { Identity, OverleafCodexManifest, SyncStatusReport } from '../src/overleaf/types';
import { OverleafSyncEngine } from '../src/overleaf/overleafSyncEngine';
import { DEFAULT_SYNC_POLICY } from '../src/overleaf/sharedState';
import { sha1 } from '../src/overleaf/util';
import { createProjectMirror, projectMirrorRoot } from '../src/overleaf/mirrorCore';
import {
  executeSyncCommand,
  planSafeSyncActions,
  selectRemoteWriteTarget,
  syncOperationRequiresForce,
  type SyncCommandBackend
} from '../src/overleaf/syncCommandCore';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

describe('Overleaf CLI shared infrastructure', () => {
  it('writes shared configuration atomically and registers compatible mirrors', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-shared-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'support');
    try {
      expect((await readSharedState()).policy.syncBinaryFiles).toBe(true);
      await updateSharedState(state => {
        state.serverUrl = 'https://example.test/';
        state.policy.autoPushLocalAhead = false;
      });
      const root = path.join(temporary, 'mirror');
      await writeManifest(root, manifest());
      const record = await registerSharedMirror(root);
      const state = await readSharedState();
      expect(record?.root).toBe(root);
      expect(state.mirrors).toHaveLength(1);
      expect(state.policy.autoPushLocalAhead).toBe(false);
      expect(JSON.parse(await fs.readFile(sharedStatePath(), 'utf8')).schemaVersion).toBe(1);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('serializes concurrent shared configuration updates without losing fields', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-shared-lock-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'support');
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const firstHoldingLock = new Promise<void>(resolve => { firstStarted = resolve; });
    try {
      const first = updateSharedState(async state => {
        state.servers.push('https://first.example/');
        firstStarted();
        await firstPaused;
      });
      await firstHoldingLock;
      const second = updateSharedState(state => {
        state.servers.push('https://second.example/');
        state.policy.syncBinaryFiles = false;
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      releaseFirst();
      await Promise.all([first, second]);
      const state = await readSharedState();
      expect(state.servers).toEqual(['https://first.example/', 'https://second.example/']);
      expect(state.policy.syncBinaryFiles).toBe(false);
    } finally {
      releaseFirst?.();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('stores complete identities under the normalized server and honors logout tombstones', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-keychain-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'support');
    process.env.LATEX_TOOLKIT_ALLOW_MOCK_KEYCHAIN = '1';
    const runner = new MemorySecurityRunner();
    const store = new MacKeychainCredentialStore(runner);
    const identity: Identity = { cookies: 'session=private', csrfToken: 'csrf', userEmail: 'test@example.com' };
    try {
      await store.saveIdentity('https://example.test', identity);
      expect(runner.items.get(`https://example.test/`)?.cookies).toBe('session=private');
      expect(await store.getIdentity('https://example.test/')).toEqual(identity);
      await store.deleteIdentity('https://example.test');
      expect(await store.getIdentity('https://example.test')).toBeUndefined();
      const shared = await readSharedState();
      expect(shared.credentialTombstones).toContain('https://example.test/');
      expect(shared.credentialMigrations).toContain('https://example.test/');
      expect(runner.serviceNames).toEqual(new Set([KEYCHAIN_SERVICE]));
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('elects one owner, forwards commands and events, then allows takeover', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-owner-'));
    process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
    const root = path.join(temporary, 'a'.repeat(180), 'mirror with spaces');
    await fs.mkdir(root, { recursive: true });
    const first = new SyncOwnerCoordinator();
    const second = new SyncOwnerCoordinator();
    try {
      expect(await first.claim(root, async (command, args) => ({ command, args }))).toBe('owner');
      expect(runtimePaths(root).socketPath.length).toBeLessThan(104);
      expect(await second.claim(root, async () => 'wrong owner')).toBe('client');
      expect(await second.request('status', { full: true })).toEqual({ command: 'status', args: { full: true } });
      const event = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for IPC event.')), 2000);
        void second.subscribe(value => {
          if (value.event !== 'status') return;
          clearTimeout(timer);
          resolve(value.data);
        }).then(() => first.emit('status', { clean: true }), reject);
      });
      expect(await event).toEqual({ clean: true });
      await first.release();
      expect(await second.claim(root, async () => 'new owner')).toBe('owner');
    } finally {
      await second.release();
      await first.release();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('cleans a stale lock even when its PID has been reused', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-stale-'));
    process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
    const root = path.join(temporary, 'mirror');
    await fs.mkdir(root, { recursive: true });
    const paths = runtimePaths(root);
    await fs.mkdir(paths.lockPath, { recursive: true });
    await fs.writeFile(paths.metadataPath, JSON.stringify({
      version: 1, pid: process.pid, root, socketPath: paths.socketPath, nonce: 'stale',
      startedAt: new Date(0).toISOString(), processStart: 'not-the-current-process-start'
    }));
    const coordinator = new SyncOwnerCoordinator();
    try {
      expect(await coordinator.claim(root, async () => undefined)).toBe('owner');
    } finally {
      await coordinator.release();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('waits for an owner socket during startup and times out an unacknowledged subscription', async () => {
    const temporary = await fs.mkdtemp('/tmp/lt-owner-startup-');
    process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
    const root = path.join(temporary, 'mirror');
    await fs.mkdir(root, { recursive: true });
    const paths = runtimePaths(await fs.realpath(root));
    await fs.mkdir(paths.lockPath, { recursive: true });
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('close', () => sockets.delete(socket));
    });
    const coordinator = new SyncOwnerCoordinator({
      ownerStartupTimeoutMs: 1_000,
      retryDelayMs: 20,
      connectTimeoutMs: 30,
      subscriptionTimeoutMs: 75,
      missingMetadataStaleMs: 500
    });
    try {
      const claim = coordinator.claim(root, async () => undefined);
      await new Promise(resolve => setTimeout(resolve, 80));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(paths.socketPath, resolve);
      });
      expect(await claim).toBe('client');
      await expect(coordinator.subscribe(() => undefined)).rejects.toThrow(/subscription/);
    } finally {
      await coordinator.release();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await fs.rm(paths.socketPath, { force: true });
      await fs.rm(paths.lockPath, { recursive: true, force: true });
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});

describe('Shared Overleaf mirror creation', () => {
  it('creates the same complete mirror support files for CLI and extension adapters', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-mirror-core-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'support');
    const parent = path.join(temporary, 'mirrors');
    const project = { id: 'project-1', name: 'Shared Mirror' };
    const registered: string[] = [];
    let disconnected = false;
    const remoteProject = {
      compiler: 'pdflatex',
      rootDoc_id: 'doc-1',
      rootFolder: {
        _id: 'root', name: 'root', docs: [], fileRefs: [{ _id: 'file-1', name: 'figure.pdf', hash: 'blob-1' }],
        folders: [{
          _id: 'chapters', name: 'chapters', fileRefs: [], folders: [],
          docs: [{ _id: 'doc-1', name: 'main.tex', version: 3 }]
        }]
      }
    };
    const session = {
      getProject: () => remoteProject,
      joinDoc: async () => ({ content: '\\documentclass{article}\n', version: 3 }),
      leaveDoc: async () => undefined,
      disconnect: () => { disconnected = true; }
    };
    const client = {
      getServerUrl: () => 'https://example.test/',
      connectSocket: async () => session,
      downloadProjectFile: async () => Buffer.from('%PDF-test')
    };
    try {
      const root = await createProjectMirror(client as never, project, parent, {
        register: async created => { registered.push(created); }
      });
      expect(root).toBe(projectMirrorRoot(parent, project));
      expect(registered).toEqual([root]);
      expect(disconnected).toBe(true);
      expect(await fs.readFile(path.join(root, 'chapters', 'main.tex'), 'utf8')).toContain('documentclass');
      expect(await fs.readFile(path.join(root, 'figure.pdf'), 'utf8')).toBe('%PDF-test');
      const settings = JSON.parse(await fs.readFile(path.join(root, '.vscode', 'settings.json'), 'utf8'));
      expect(settings['latex-workshop.latex.recipe.default']).toBe('latexmk (local mirror)');
      expect(settings['latex-workshop.latex.search.rootFiles.include']).toEqual(['chapters/main.tex']);
      expect(await fs.readFile(path.join(root, 'chapters', '.latexmkrc'), 'utf8')).toContain('overleaf_codex_build_dir');
      expect(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).toContain('real local mirror');
      expect((await fs.stat(path.join(root, '.git'))).isDirectory()).toBe(true);
      expect((await readManifest(root)).rootDocPath).toBe('chapters/main.tex');

      const broken = { id: 'broken', name: 'Broken Mirror' };
      const brokenRoot = projectMirrorRoot(parent, broken);
      const brokenClient = {
        getServerUrl: () => 'https://example.test/',
        connectSocket: async () => ({ getProject: () => undefined, disconnect: () => undefined })
      };
      await expect(createProjectMirror(brokenClient as never, broken, parent, { register: async () => undefined }))
        .rejects.toThrow(/project tree/);
      await expect(fs.stat(brokenRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});

describe('Overleaf CLI parser and managed installation', () => {
  it('parses global options independently from command positionals and reserves exit code 2 for blocking reports', () => {
    const parsed = parseArgs(['--root', '/tmp/mirror', 'sync', '--once', '--json']);
    expect(parsed.positionals).toEqual(['sync']);
    expect(parsed.options.get('root')).toBe('/tmp/mirror');
    expect(parsed.options.get('once')).toBe(true);
    expect(() => parseArgs(['auth', 'login', '--cookie=secret'])).toThrow(/must not be passed in argv/);
    const report = { ...syncReport(), hasBlocking: true };
    expect(blockingExitCode(report)).toBe(2);
    expect(blockingExitCode({ ok: true })).toBe(0);
  });

  it('installs, upgrades and uninstalls only its managed command', async () => {
    if (Number(process.versions.node.split('.')[0]) < 20) return;
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-install-'));
    const extensionRoot = path.join(temporary, 'extension');
    const binRoot = path.join(temporary, 'bin');
    process.env.LATEX_TOOLKIT_CLI_SUPPORT_HOME = path.join(temporary, 'support', 'cli');
    process.env.LATEX_TOOLKIT_BIN_HOME = binRoot;
    await fs.mkdir(path.join(extensionRoot, 'dist', 'cli-vendor', 'socket.io-client', 'lib'), { recursive: true });
    await fs.writeFile(path.join(extensionRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\nconsole.log("one")\n');
    await fs.writeFile(path.join(extensionRoot, 'dist', 'cli-vendor', 'socket.io-client', 'lib', 'io.js'), 'module.exports = {}\n');
    try {
      const installed = await installCli(extensionRoot, '1.0.0');
      expect((await fs.lstat(installed.commandPath)).isSymbolicLink()).toBe(true);
      expect((await fs.stat(path.join(installed.installRoot, 'cli.js'))).mode & 0o111).not.toBe(0);
      await fs.writeFile(path.join(extensionRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\nconsole.log("two")\n');
      await installCli(extensionRoot, '1.0.0');
      expect(await fs.readFile(path.join(installed.installRoot, 'cli.js'), 'utf8')).toContain('two');
      expect((await uninstallCli()).removed).toBe(true);
      await fs.mkdir(binRoot, { recursive: true });
      await fs.writeFile(installed.commandPath, 'user-owned');
      await expect(installCli(extensionRoot, '1.0.1')).rejects.toThrow(/non-managed/);
      expect(await fs.readFile(installed.commandPath, 'utf8')).toBe('user-owned');
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});

describe('Shared Overleaf sync command contract', () => {
  it('uses the same authorization, mutation and targeted refresh sequence for every owner adapter', async () => {
    const first = recordingBackend();
    const second = recordingBackend();
    const args = { path: 'main.tex', force: true };

    const firstResult = await executeSyncCommand(first.backend, 'push', args);
    const secondResult = await executeSyncCommand(second.backend, 'push', args);

    expect(first.calls).toEqual(second.calls);
    expect(first.calls).toEqual([
      'authorize:push:main.tex:true',
      'push:main.tex:true',
      'status:true:false:main.tex:post-push'
    ]);
    expect(firstResult).toEqual(syncReport());
    expect(secondResult).toEqual(firstResult);
    expect(blockingExitCode(firstResult)).toBe(0);
    expect(makeSuccessEnvelope('push', '/mirror', firstResult, [])).toMatchObject({
      schemaVersion: 1,
      ok: true,
      command: 'push',
      root: '/mirror',
      data: firstResult,
      warnings: []
    });
  });

  it('keeps status read-only and plans only safe sync actions', async () => {
    const owner = recordingBackend();
    await executeSyncCommand(owner.backend, 'status', { refresh: true, full: true });
    expect(owner.calls).toEqual(['status:true:true::ipc-status']);

    const report = syncReport();
    report.items = [
      { path: 'remote.tex', entityType: 'doc', status: 'remote ahead', blocking: true },
      { path: 'local.tex', entityType: 'doc', status: 'local ahead', blocking: true },
      { path: 'figure.pdf', entityType: 'file', status: 'local only', blocking: true },
      { path: 'conflict.tex', entityType: 'doc', status: 'diverged', blocking: true }
    ];
    const plan = planSafeSyncActions(report, { autoPushLocalAhead: true, syncBinaryFiles: false });
    expect(plan.pulls.map(item => item.path)).toEqual(['remote.tex']);
    expect(plan.pushes.map(item => item.path)).toEqual(['local.tex']);
  });

  it('never reuses a stale remote entity when force-restoring a deleted path', () => {
    const stale = {
      path: 'main.tex', entityId: 'deleted-doc', entityType: 'doc' as const, parentFolderId: 'root'
    };
    expect(() => selectRemoteWriteTarget('main.tex', stale, undefined, false)).toThrow(/deleted on Overleaf/);
    expect(selectRemoteWriteTarget('main.tex', stale, undefined, true)).toBeUndefined();
    const current = { ...stale, entityId: 'current-doc' };
    expect(selectRemoteWriteTarget('main.tex', stale, current, false)).toBe(current);
    expect(syncOperationRequiresForce('pull', 'remote deleted')).toBe(true);
    expect(syncOperationRequiresForce('pull', 'remote ahead')).toBe(false);
  });

  it('keeps refreshed status read-only and reserves inferred remote renames for sync', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-status-read-only-'));
    const content = 'same content\n';
    const project = {
      rootFolder: {
        _id: 'root', name: 'root', folders: [], fileRefs: [],
        docs: [{ _id: 'doc-1', name: 'old.tex', version: 1 }]
      }
    };
    const remoteRenames: string[] = [];
    const session = {
      getProject: () => project,
      joinDoc: async () => ({ content, version: 1 }),
      on: () => undefined,
      disconnect: () => undefined
    };
    const client = {
      connectSocket: async () => session,
      renameEntity: async (_projectId: string, _entityType: string, _entityId: string, name: string) => {
        remoteRenames.push(name);
      }
    };
    const engine = new OverleafSyncEngine(
      temporary,
      client as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      { log: () => undefined, progress: () => undefined, status: () => undefined, conflict: () => undefined }
    );
    try {
      const state = manifest();
      state.files['old.tex'] = {
        path: 'old.tex', entityId: 'doc-1', entityType: 'doc', parentFolderId: 'root',
        version: 1, sha1: sha1(content), baseHash: sha1(content)
      };
      await writeManifest(temporary, state);
      await fs.writeFile(path.join(temporary, 'new.tex'), content, 'utf8');

      await engine.status(true, false);
      expect(remoteRenames).toEqual([]);

      await engine.syncOnce();
      expect(remoteRenames).toEqual(['new.tex']);
    } finally {
      await engine.stop();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('reuses incremental remote metadata and limits binary downloads to four at a time', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-cli-remote-cache-'));
    const files = Array.from({ length: 7 }, (_, index) => ({
      id: `file-${index}`,
      name: `figure-${index}.pdf`,
      content: Buffer.from(`binary-${index}`),
      blobHash: `blob-${index}`
    }));
    const project = {
      rootFolder: {
        _id: 'root', name: 'root', folders: [], docs: [],
        fileRefs: files.map(file => ({ _id: file.id, name: file.name, hash: file.blobHash }))
      }
    };
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    let downloadCount = 0;
    const session = {
      getProject: () => project,
      on: () => undefined,
      disconnect: () => undefined
    };
    const client = {
      connectSocket: async () => session,
      downloadProjectFile: async (_projectId: string, entityId: string) => {
        downloadCount += 1;
        activeDownloads += 1;
        maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
        await new Promise(resolve => setTimeout(resolve, 25));
        activeDownloads -= 1;
        return files.find(file => file.id === entityId)!.content;
      }
    };
    const engine = new OverleafSyncEngine(
      temporary,
      client as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      { log: () => undefined, progress: () => undefined, status: () => undefined, conflict: () => undefined }
    );
    try {
      const state = manifest();
      for (const file of files) {
        state.files[file.name] = {
          path: file.name,
          entityId: file.id,
          entityType: 'file',
          parentFolderId: 'root',
          binary: true,
          sha1: sha1(file.content),
          remoteBlobHash: `old-${file.blobHash}`
        };
        await fs.writeFile(path.join(temporary, file.name), file.content);
      }
      await writeManifest(temporary, state);
      expect((await engine.status(true, false))?.hasBlocking).toBe(false);
      expect(downloadCount).toBe(files.length);
      expect(maxActiveDownloads).toBeGreaterThan(1);
      expect(maxActiveDownloads).toBeLessThanOrEqual(4);

      expect((await engine.status(true, false))?.hasBlocking).toBe(false);
      expect(downloadCount).toBe(files.length);
    } finally {
      await engine.stop();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});

class MemorySecurityRunner implements SecurityRunner {
  readonly items = new Map<string, Identity>();
  readonly serviceNames = new Set<string>();

  async run(args: string[]): Promise<string> {
    const service = args[args.indexOf('-s') + 1];
    const account = args[args.indexOf('-a') + 1];
    this.serviceNames.add(service);
    if (args[0] === 'add-generic-password') {
      this.items.set(account, JSON.parse(args[args.indexOf('-w') + 1]) as Identity);
      return '';
    }
    if (args[0] === 'find-generic-password') {
      const found = this.items.get(account);
      if (!found) throw new Error('The specified item could not be found in the keychain.');
      return JSON.stringify(found);
    }
    if (args[0] === 'delete-generic-password') {
      if (!this.items.delete(account)) throw new Error('The specified item could not be found in the keychain.');
      return '';
    }
    throw new Error(`Unexpected security operation: ${args[0]}`);
  }
}

function manifest(): OverleafCodexManifest {
  return {
    schemaVersion: 3,
    serverUrl: 'https://example.test/',
    projectId: 'project',
    projectName: 'Project',
    files: {},
    folders: { '': { path: '', entityId: 'root' } },
    ignore: defaultSharedState().mirrors.map(item => item.root),
    lastSyncAt: '2026-08-12T00:00:00.000Z'
  };
}

function syncReport(): SyncStatusReport {
  return {
    schemaVersion: 2,
    checkedAt: '2026-08-12T00:00:00.000Z',
    projectId: 'project',
    projectName: 'Project',
    hasBlocking: false,
    completeness: 'complete',
    items: []
  };
}

function recordingBackend(): { backend: SyncCommandBackend; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    backend: {
      status: async request => {
        calls.push(`status:${request.refresh}:${request.full}:${request.paths?.join(',') ?? ''}:${request.reason ?? ''}`);
        return syncReport();
      },
      syncOnce: async () => {
        calls.push('sync-once');
        return syncReport();
      },
      push: async (relPath, force) => { calls.push(`push:${relPath}:${force}`); },
      pull: async (relPath, force) => { calls.push(`pull:${relPath}:${force}`); },
      conflicts: async () => [],
      resolveConflict: async (relPath, use) => { calls.push(`resolve:${relPath}:${use}`); },
      authorize: async (command, relPath, force) => { calls.push(`authorize:${command}:${relPath}:${force}`); }
    }
  };
}
