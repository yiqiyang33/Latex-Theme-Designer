import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockingExitCode, installStopSignalHandlers, makeSuccessEnvelope, openCommand, parseArgs } from '../src/cli';
import { installCli, uninstallCli } from '../src/overleaf/cliInstaller';
import {
  FallbackCredentialStore,
  FileCredentialStore,
  KEYCHAIN_SERVICE,
  MacKeychainCredentialStore,
  SecretToolCredentialStore,
  type SecurityRunner
} from '../src/overleaf/keychainStore';
import { SecretStore } from '../src/overleaf/secretStore';
import {
  applicationDataRoot,
  applicationSupportRoot,
  defaultSharedState,
  readSharedState,
  registerSharedMirror,
  runtimeRoot,
  sharedStatePath,
  updateSharedState
} from '../src/overleaf/sharedState';
import { runtimePaths, SyncOwnerCoordinator } from '../src/overleaf/syncOwnerCoordinator';
import { metadataPath, OUTPUT_DIR, readManifest, writeManifest } from '../src/overleaf/manifest';
import type { Identity, OverleafCodexManifest, SyncStatusReport } from '../src/overleaf/types';
import { OverleafSyncEngine } from '../src/overleaf/overleafSyncEngine';
import { DEFAULT_SYNC_POLICY } from '../src/overleaf/sharedState';
import { sha1 } from '../src/overleaf/util';
import { createProjectMirror, projectMirrorRoot } from '../src/overleaf/mirrorCore';
import { compileRemoteProject, latestRemotePdf } from '../src/overleaf/compileCore';
import { BinaryTransactionStore, type BinaryTransaction } from '../src/overleaf/binaryTransactions';
import { recoverBinaryTransactions, type RemoteBinaryEntityState } from '../src/overleaf/remoteMutationCore';
import { fileHash, scanLocalProject } from '../src/overleaf/syncStatus';
import { mapWithByteConcurrency } from '../src/overleaf/syncHealthService';
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
      expect(runner.lastAddArgs).not.toContain(JSON.stringify(identity));
      expect(runner.lastAddArgs?.at(-1)).toBe('-w');
      expect(runner.lastStdin).toBe(JSON.stringify(identity));
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

  it('migrates SecretStorage identities once and keeps Keychain as the only credential copy', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-secret-migration-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'support');
    process.env.LATEX_TOOLKIT_ALLOW_MOCK_KEYCHAIN = '1';
    const identity: Identity = { cookies: 'legacy=private', csrfToken: 'legacy-csrf' };
    const legacyServer = 'https://legacy.example/';
    const values = new Map<string, string>([
      ['overleafCodex.servers', JSON.stringify([legacyServer])],
      [`overleafCodex.identity.${legacyServer}`, JSON.stringify(identity)]
    ]);
    const secrets = {
      get: async (key: string) => values.get(key),
      store: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
      onDidChange: (() => ({ dispose: () => undefined })) as never
    };
    const runner = new MemorySecurityRunner();
    const keychain = new MacKeychainCredentialStore(runner);
    const store = new SecretStore({ secrets } as never, keychain);
    try {
      expect(await store.listServers()).toEqual([legacyServer]);
      expect(await store.getIdentity(legacyServer)).toEqual(identity);
      expect(values.has('overleafCodex.servers')).toBe(false);
      expect(values.has(`overleafCodex.identity.${legacyServer}`)).toBe(false);
      expect(runner.items.get(legacyServer)).toEqual(identity);

      const current: Identity = { cookies: 'current=private', csrfToken: 'current-csrf' };
      await store.saveIdentity('https://current.example', current);
      expect([...values.keys()].filter(key => key.startsWith('overleafCodex.identity.'))).toEqual([]);
      expect(runner.items.get('https://current.example/')).toEqual(current);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('uses XDG config, data and cache roots on Linux', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-xdg-'));
    delete process.env.LATEX_TOOLKIT_SUPPORT_HOME;
    delete process.env.LATEX_TOOLKIT_DATA_HOME;
    delete process.env.LATEX_TOOLKIT_CACHE_HOME;
    process.env.XDG_CONFIG_HOME = path.join(temporary, 'config');
    process.env.XDG_DATA_HOME = path.join(temporary, 'data');
    process.env.XDG_CACHE_HOME = path.join(temporary, 'cache');
    try {
      expect(applicationSupportRoot()).toBe(path.join(temporary, 'config', 'latex-editing-toolkit'));
      expect(applicationDataRoot()).toBe(path.join(temporary, 'data', 'latex-editing-toolkit'));
      expect(runtimeRoot()).toBe(path.join(temporary, 'cache', 'latex-editing-toolkit', 'runtime'));
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('falls back to a private credential file when secret-tool is unavailable', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-file-credentials-'));
    const support = path.join(temporary, 'config');
    const credentialsRoot = path.join(temporary, 'data', 'credentials');
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = support;
    process.env.LATEX_TOOLKIT_DATA_HOME = path.join(temporary, 'data');
    const runner: SecurityRunner = {
      run: async () => { throw new Error('spawn secret-tool ENOENT'); }
    };
    const store = new FallbackCredentialStore(
      new SecretToolCredentialStore(runner),
      new FileCredentialStore(credentialsRoot)
    );
    const identity: Identity = { cookies: 'session=private', csrfToken: 'csrf' };
    try {
      await store.saveIdentity('https://example.test', identity);
      expect(await store.getIdentity('https://example.test/')).toEqual(identity);
      const entries = await fs.readdir(credentialsRoot);
      expect(entries).toHaveLength(1);
      expect((await fs.stat(credentialsRoot)).mode & 0o777).toBe(0o700);
      expect((await fs.stat(path.join(credentialsRoot, entries[0]))).mode & 0o777).toBe(0o600);
      expect(store.describe().kind).toBe('restricted-file');
      await store.deleteIdentity('https://example.test');
      expect(await fs.readdir(credentialsRoot)).toEqual([]);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('round-trips identities through the secret-tool backend without putting cookies in argv', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-secret-tool-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'config');
    const runner = new MemorySecretToolRunner();
    const store = new SecretToolCredentialStore(runner);
    const identity: Identity = { cookies: 'session=private', csrfToken: 'csrf', userEmail: 'test@example.com' };
    try {
      await store.saveIdentity('https://example.test', identity);
      expect(runner.lastArgs).toEqual([
        'store', '--label', 'LaTeX Editing Toolkit Overleaf', 'service', KEYCHAIN_SERVICE, 'account', 'https://example.test/'
      ]);
      expect(runner.lastStdin).toBe(JSON.stringify(identity));
      expect(await store.getIdentity('https://example.test')).toEqual(identity);
      await store.deleteIdentity('https://example.test');
      expect(await store.getIdentity('https://example.test')).toBeUndefined();
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('migrates a fallback file identity back into secret-tool when it becomes available', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-secret-migration-back-'));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'config');
    const credentialsRoot = path.join(temporary, 'credentials');
    const file = new FileCredentialStore(credentialsRoot);
    const runner = new MemorySecretToolRunner();
    const store = new FallbackCredentialStore(new SecretToolCredentialStore(runner), file);
    const identity: Identity = { cookies: 'session=private', csrfToken: 'csrf' };
    try {
      await file.saveIdentity('https://example.test', identity);
      expect(await store.getIdentity('https://example.test')).toEqual(identity);
      expect(runner.items.get('https://example.test/')).toBe(JSON.stringify(identity));
      expect(await fs.readdir(credentialsRoot)).toEqual([]);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('uses the platform PDF opener', () => {
    expect(openCommand()).toBe(process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open');
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

  it('serializes concurrent IPC commands at the owner boundary', async () => {
    const temporary = await fs.mkdtemp('/tmp/lt-owner-serial-');
    process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
    const root = path.join(temporary, 'mirror');
    await fs.mkdir(root, { recursive: true });
    const owner = new SyncOwnerCoordinator();
    const client = new SyncOwnerCoordinator();
    let active = 0;
    let maximumActive = 0;
    try {
      await owner.claim(root, async command => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 30));
        active -= 1;
        return command;
      });
      await client.claim(root, async () => undefined);
      expect(await Promise.all([
        client.request('first'),
        client.request('second'),
        client.request('third')
      ])).toEqual(['first', 'second', 'third']);
      expect(maximumActive).toBe(1);
    } finally {
      await client.release();
      await owner.release();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('drains an in-flight IPC command before owner handoff', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-owner-handoff-'));
    process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
    const root = path.join(temporary, 'mirror');
    await fs.mkdir(root, { recursive: true });
    const owner = new SyncOwnerCoordinator();
    const client = new SyncOwnerCoordinator();
    const successor = new SyncOwnerCoordinator();
    let commandStarted!: () => void;
    let finishCommand!: () => void;
    const started = new Promise<void>(resolve => { commandStarted = resolve; });
    const finish = new Promise<void>(resolve => { finishCommand = resolve; });
    try {
      await owner.claim(root, async () => {
        commandStarted();
        await finish;
        return 'finished';
      });
      await client.claim(root, async () => undefined);
      const request = client.request('sync-once');
      await started;
      let released = false;
      const releasing = owner.release().then(() => { released = true; });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(released).toBe(false);
      finishCommand();
      expect(await request).toBe('finished');
      await releasing;
      expect(await successor.claim(root, async () => 'successor')).toBe('owner');
    } finally {
      finishCommand?.();
      await successor.release();
      await client.release();
      await owner.release();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('serializes concurrent sync-once, push and pull IPC mutations', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-owner-mutations-'));
    process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
    const root = path.join(temporary, 'mirror');
    await fs.mkdir(root, { recursive: true });
    const owner = new SyncOwnerCoordinator();
    const client = new SyncOwnerCoordinator();
    let active = 0;
    let maximumActive = 0;
    const calls: string[] = [];
    const mutate = async (name: string): Promise<void> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(name);
      await new Promise(resolve => setTimeout(resolve, 15));
      active -= 1;
    };
    const backend: SyncCommandBackend = {
      status: async () => syncReport(),
      syncOnce: async () => { await mutate('sync-once'); return syncReport(); },
      push: async relPath => mutate(`push:${relPath}`),
      pull: async relPath => mutate(`pull:${relPath}`),
      conflicts: async () => [],
      resolveConflict: async () => undefined
    };
    try {
      await owner.claim(root, (command, args) => executeSyncCommand(backend, command, args));
      await client.claim(root, async () => undefined);
      await Promise.all([
        client.request('sync-once'),
        client.request('push', { path: 'local.tex' }),
        client.request('pull', { path: 'remote.tex' })
      ]);
      expect(maximumActive).toBe(1);
      expect(calls).toEqual(['sync-once', 'push:local.tex', 'pull:remote.tex']);
    } finally {
      await client.release();
      await owner.release();
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

describe('Remote Overleaf compile output transactions', () => {
  it('atomically replaces complete outputs, preserves duplicate names, and selects the newest PDF', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-compile-output-'));
    const outputRoot = metadataPath(temporary, OUTPUT_DIR);
    await writeManifest(temporary, manifest());
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(path.join(outputRoot, 'old.pdf'), 'old');
    const response = {
      status: 'success' as const,
      compileGroup: 'compile-1',
      outputFiles: [
        { path: 'main.pdf', url: '/first/main.pdf' },
        { path: 'nested/main.pdf', url: '/second/main.pdf' },
        { path: 'output.log', url: '/output.log' }
      ]
    };
    const client = {
      compile: async () => response,
      downloadCompileOutput: async (url: string) => Buffer.from(`download:${url}`)
    };
    try {
      const result = await compileRemoteProject(temporary, client as never);
      expect(result.files.map(file => path.basename(file))).toEqual(['main.pdf', 'main-2.pdf', 'output.log']);
      expect(path.basename(result.pdfPath!)).toBe('main-2.pdf');
      await expect(fs.stat(path.join(outputRoot, 'old.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(path.join(outputRoot, 'main.pdf'), 'utf8')).toContain('/first/main.pdf');
      expect(await fs.readFile(path.join(outputRoot, 'main-2.pdf'), 'utf8')).toContain('/second/main.pdf');

      const oldTime = new Date(Date.now() - 60_000);
      const newTime = new Date();
      await fs.utimes(path.join(outputRoot, 'main-2.pdf'), oldTime, oldTime);
      await fs.utimes(path.join(outputRoot, 'main.pdf'), newTime, newTime);
      expect(await latestRemotePdf(temporary)).toBe(path.join(outputRoot, 'main.pdf'));

      await fs.writeFile(path.join(outputRoot, 'preserve.txt'), 'trusted-old-output');
      const failing = {
        compile: async () => response,
        downloadCompileOutput: async (url: string) => {
          if (url.includes('second')) throw new Error('download failed');
          return Buffer.from('partial');
        }
      };
      await expect(compileRemoteProject(temporary, failing as never)).rejects.toThrow('download failed');
      expect(await fs.readFile(path.join(outputRoot, 'preserve.txt'), 'utf8')).toBe('trusted-old-output');
      const metadataEntries = await fs.readdir(metadataPath(temporary));
      expect(metadataEntries.filter(name => /output\.(?:staging|backup)-/.test(name))).toEqual([]);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('serializes concurrent output swaps and leaves no interrupted compile artifacts', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-compile-concurrent-'));
    await writeManifest(temporary, manifest());
    let compileSequence = 0;
    let activeDownloads = 0;
    let maximumDownloads = 0;
    const client = {
      compile: async () => {
        const id = ++compileSequence;
        return {
          status: 'success' as const,
          compileGroup: `compile-${id}`,
          outputFiles: [{ path: 'main.pdf', url: `/compile-${id}/main.pdf` }]
        };
      },
      downloadCompileOutput: async (url: string) => {
        activeDownloads += 1;
        maximumDownloads = Math.max(maximumDownloads, activeDownloads);
        await new Promise(resolve => setTimeout(resolve, 20));
        activeDownloads -= 1;
        return Buffer.from(url);
      }
    };
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => compileRemoteProject(temporary, client as never)));
      expect(maximumDownloads).toBe(1);
      expect(results.every(result => result.pdfPath === path.join(metadataPath(temporary, OUTPUT_DIR), 'main.pdf'))).toBe(true);
      expect(await fs.readFile(path.join(metadataPath(temporary, OUTPUT_DIR), 'main.pdf'), 'utf8')).toMatch(/^\/compile-\d+\/main\.pdf$/);
      expect((await fs.readdir(metadataPath(temporary))).filter(name => /^output\.(?:lock|staging|backup)/.test(name))).toEqual([]);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
});

describe('Overleaf CLI parser and managed installation', () => {
  it('routes SIGINT and SIGTERM through the graceful stop hook and removes listeners', () => {
    const beforeInt = process.listenerCount('SIGINT');
    const beforeTerm = process.listenerCount('SIGTERM');
    let stops = 0;
    const dispose = installStopSignalHandlers(() => { stops += 1; });
    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 1);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 1);
    process.emit('SIGTERM');
    expect(stops).toBe(1);
    dispose();
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
  });

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
    await fs.mkdir(path.join(extensionRoot, 'dist', 'vendor', 'socket.io-client', 'lib'), { recursive: true });
    await fs.writeFile(path.join(extensionRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\nconsole.log("one")\n');
    await fs.writeFile(path.join(extensionRoot, 'dist', 'vendor', 'socket.io-client', 'lib', 'io.js'), 'module.exports = {}\n');
    try {
      const installed = await installCli(extensionRoot, '1.0.0');
      expect((await fs.lstat(installed.commandPath)).isSymbolicLink()).toBe(true);
      expect((await fs.stat(path.join(installed.installRoot, 'cli.js'))).mode & 0o111).not.toBe(0);
      expect(await fs.readFile(path.join(installed.installRoot, 'vendor', 'socket.io-client', 'lib', 'io.js'), 'utf8'))
        .toContain('module.exports');
      await expect(fs.stat(path.join(installed.installRoot, 'cli-vendor'))).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('applies a remote non-empty folder rename once without moving its children separately', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-folder-rename-'));
    const content = 'chapter content\n';
    const project = {
      rootFolder: {
        _id: 'root', name: 'root', fileRefs: [], docs: [],
        folders: [{
          _id: 'folder-1', name: 'new', fileRefs: [], docs: [],
          folders: [{
            _id: 'folder-2', name: 'nested', folders: [], fileRefs: [],
            docs: [{ _id: 'doc-1', name: 'main.tex', version: 1 }]
          }]
        }]
      }
    };
    const session = {
      getProject: () => project,
      joinDoc: async () => ({ content, version: 1 }),
      on: () => undefined,
      disconnect: () => undefined
    };
    const engine = new OverleafSyncEngine(
      temporary,
      { connectSocket: async () => session } as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      { log: () => undefined, progress: () => undefined, status: () => undefined, conflict: () => undefined }
    );
    try {
      const state = manifest();
      state.rootDocPath = 'old/nested/main.tex';
      state.folders.old = { path: 'old', entityId: 'folder-1', parentFolderId: 'root' };
      state.folders['old/nested'] = { path: 'old/nested', entityId: 'folder-2', parentFolderId: 'folder-1' };
      state.files['old/nested/main.tex'] = {
        path: 'old/nested/main.tex', entityId: 'doc-1', entityType: 'doc', parentFolderId: 'folder-2',
        version: 1, sha1: sha1(content), baseHash: sha1(content)
      };
      await writeManifest(temporary, state);
      await fs.mkdir(path.join(temporary, 'old', 'nested'), { recursive: true });
      await fs.writeFile(path.join(temporary, 'old', 'nested', 'main.tex'), content);

      const report = await engine.syncOnce();
      expect(report.hasBlocking).toBe(false);
      expect(await fs.readFile(path.join(temporary, 'new', 'nested', 'main.tex'), 'utf8')).toBe(content);
      await expect(fs.stat(path.join(temporary, 'old'))).rejects.toMatchObject({ code: 'ENOENT' });
      const updated = await readManifest(temporary);
      expect(updated.folders.new?.entityId).toBe('folder-1');
      expect(updated.folders['new/nested']?.entityId).toBe('folder-2');
      expect(updated.files['new/nested/main.tex']?.entityId).toBe('doc-1');
      expect(updated.rootDocPath).toBe('new/nested/main.tex');
    } finally {
      await engine.stop();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('blocks a CLI remote folder rename when the local target already exists', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-folder-conflict-'));
    const content = 'tracked\n';
    const project = {
      rootFolder: {
        _id: 'root', name: 'root', fileRefs: [], docs: [],
        folders: [{
          _id: 'folder-1', name: 'new', folders: [], fileRefs: [],
          docs: [{ _id: 'doc-1', name: 'main.tex', version: 1 }]
        }]
      }
    };
    const conflicts: string[] = [];
    const session = {
      getProject: () => project,
      joinDoc: async () => ({ content, version: 1 }),
      on: () => undefined,
      disconnect: () => undefined
    };
    const engine = new OverleafSyncEngine(
      temporary,
      { connectSocket: async () => session } as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      {
        log: () => undefined,
        progress: () => undefined,
        status: () => undefined,
        conflict: (_path, reason) => conflicts.push(reason)
      }
    );
    try {
      const state = manifest();
      state.folders.old = { path: 'old', entityId: 'folder-1', parentFolderId: 'root' };
      state.files['old/main.tex'] = {
        path: 'old/main.tex', entityId: 'doc-1', entityType: 'doc', parentFolderId: 'folder-1',
        version: 1, sha1: sha1(content), baseHash: sha1(content)
      };
      await writeManifest(temporary, state);
      await fs.mkdir(path.join(temporary, 'old'), { recursive: true });
      await fs.mkdir(path.join(temporary, 'new'), { recursive: true });
      await fs.writeFile(path.join(temporary, 'old', 'main.tex'), content);
      await fs.writeFile(path.join(temporary, 'new', 'protected.txt'), 'keep');

      await expect(engine.syncOnce()).rejects.toThrow(/target already exists/);
      expect(await fs.readFile(path.join(temporary, 'old', 'main.tex'), 'utf8')).toBe(content);
      expect(await fs.readFile(path.join(temporary, 'new', 'protected.txt'), 'utf8')).toBe('keep');
      expect((await readManifest(temporary)).folders.old?.entityId).toBe('folder-1');
      expect(conflicts).toHaveLength(1);
    } finally {
      await engine.stop();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('serializes the complete sync-once plan so concurrent calls do not pull twice', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-sync-once-serial-'));
    const content = 'remote content\n';
    const project = {
      rootFolder: {
        _id: 'root', name: 'root', folders: [], fileRefs: [],
        docs: [{ _id: 'doc-1', name: 'main.tex', version: 1 }]
      }
    };
    let joins = 0;
    const session = {
      getProject: () => project,
      joinDoc: async () => {
        joins += 1;
        await new Promise(resolve => setTimeout(resolve, 15));
        return { content, version: 1 };
      },
      on: () => undefined,
      disconnect: () => undefined
    };
    const engine = new OverleafSyncEngine(
      temporary,
      { connectSocket: async () => session } as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      { log: () => undefined, progress: () => undefined, status: () => undefined, conflict: () => undefined }
    );
    try {
      await writeManifest(temporary, manifest());
      const reports = await Promise.all([engine.syncOnce(), engine.syncOnce(), engine.syncOnce()]);
      expect(reports.every(report => !report.hasBlocking)).toBe(true);
      expect(joins).toBe(2);
      expect(await fs.readFile(path.join(temporary, 'main.tex'), 'utf8')).toBe(content);
    } finally {
      await engine.stop();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it('waits for an in-flight reconcile before disconnecting during stop', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-sync-stop-'));
    const content = 'remote content\n';
    const project = {
      rootFolder: {
        _id: 'root', name: 'root', folders: [], fileRefs: [],
        docs: [{ _id: 'doc-1', name: 'main.tex', version: 1 }]
      }
    };
    let releaseFirstJoin!: () => void;
    const firstJoinReleased = new Promise<void>(resolve => { releaseFirstJoin = resolve; });
    let notifyFirstJoin!: () => void;
    const firstJoinStarted = new Promise<void>(resolve => { notifyFirstJoin = resolve; });
    let first = true;
    let disconnected = false;
    const session = {
      getProject: () => project,
      joinDoc: async () => {
        if (first) {
          first = false;
          notifyFirstJoin();
          await firstJoinReleased;
        }
        return { content, version: 1 };
      },
      on: () => undefined,
      disconnect: () => { disconnected = true; }
    };
    const engine = new OverleafSyncEngine(
      temporary,
      { connectSocket: async () => session } as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      { log: () => undefined, progress: () => undefined, status: () => undefined, conflict: () => undefined }
    );
    try {
      await writeManifest(temporary, manifest());
      const syncing = engine.syncOnce();
      await firstJoinStarted;
      const stopping = engine.stop();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(disconnected).toBe(false);
      releaseFirstJoin();
      expect((await syncing).hasBlocking).toBe(false);
      await stopping;
      expect(disconnected).toBe(true);
    } finally {
      releaseFirstJoin?.();
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

describe('Binary replacement crash recovery', () => {
  it('removes an uploaded temporary when the original was never renamed', async () => {
    const fixture = await binaryRecoveryFixture('temp-uploaded', 'final', 'temporary');
    try {
      expect(await recoverBinaryTransactions(
        fixture.client as never,
        'project',
        fixture.manifest,
        fixture.store,
        { inspectEntity: id => fixture.entities.get(id) }
      )).toBe(false);
      expect(fixture.entities.get('original')?.name).toBe('figure.pdf');
      expect(fixture.entities.has('temporary')).toBe(false);
      expect(fixture.manifest.files['figure.pdf'].entityId).toBe('original');
      expect(await fixture.store.list()).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it('rolls back when backup rename succeeded before its stage was persisted', async () => {
    const fixture = await binaryRecoveryFixture('temp-uploaded', 'backup', 'temporary');
    try {
      const changed = await recoverBinaryTransactions(
        fixture.client as never,
        'project',
        fixture.manifest,
        fixture.store,
        { inspectEntity: id => fixture.entities.get(id) }
      );
      expect(changed).toBe(false);
      expect(fixture.entities.get('original')?.name).toBe('figure.pdf');
      expect(fixture.entities.has('temporary')).toBe(false);
      expect(fixture.manifest.files['figure.pdf'].entityId).toBe('original');
      expect(await fixture.store.list()).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it('commits when promotion succeeded before its stage was persisted', async () => {
    const fixture = await binaryRecoveryFixture('original-backed-up', 'backup', 'final');
    try {
      const changed = await recoverBinaryTransactions(
        fixture.client as never,
        'project',
        fixture.manifest,
        fixture.store,
        { inspectEntity: id => fixture.entities.get(id) }
      );
      expect(changed).toBe(true);
      expect(fixture.entities.has('original')).toBe(false);
      expect(fixture.entities.get('temporary')?.name).toBe('figure.pdf');
      expect(fixture.manifest.files['figure.pdf']).toMatchObject({
        entityId: 'temporary',
        remoteBlobHash: 'new-blob',
        sha1: 'new-content'
      });
      expect(await fixture.store.list()).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it('commits when the backup was deleted before the new manifest was persisted', async () => {
    const fixture = await binaryRecoveryFixture('promoted', 'missing', 'final');
    try {
      expect(await recoverBinaryTransactions(
        fixture.client as never,
        'project',
        fixture.manifest,
        fixture.store,
        { inspectEntity: id => fixture.entities.get(id) }
      )).toBe(true);
      expect(fixture.entities.get('temporary')?.name).toBe('figure.pdf');
      expect(fixture.manifest.files['figure.pdf']).toMatchObject({
        entityId: 'temporary',
        remoteBlobHash: 'new-blob',
        sha1: 'new-content'
      });
      expect(await fixture.store.list()).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });
});

describe('Large mirror performance regressions', () => {
  it('scans a large tree once, hashes a large binary incrementally, and bounds bytes in flight', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-large-mirror-'));
    try {
      const state = manifest();
      await writeManifest(temporary, state);
      for (let directory = 0; directory < 40; directory += 1) {
        const relDir = `chapters/chapter-${directory}`;
        await fs.mkdir(path.join(temporary, relDir), { recursive: true });
        await Promise.all(Array.from({ length: 10 }, (_, file) =>
          fs.writeFile(path.join(temporary, relDir, `section-${file}.tex`), `content ${directory}:${file}\n`)
        ));
      }
      const binary = Buffer.alloc(8 * 1024 * 1024, 0x5a);
      await fs.writeFile(path.join(temporary, 'large.pdf'), binary);
      const loaded = await readManifest(temporary);
      const startedAt = performance.now();
      const scan = await scanLocalProject(temporary, loaded);
      const digest = await fileHash(path.join(temporary, 'large.pdf'));
      expect(performance.now() - startedAt).toBeLessThan(10_000);
      expect(scan.files).toHaveLength(401);
      expect(scan.folders).toHaveLength(41);
      expect(scan.fileMetadata.get('large.pdf')?.size).toBe(binary.length);
      expect(digest).toBe(sha1(binary));

      const sizes = [5, 5, 3, 3].map(value => value * 1024 * 1024);
      let activeBytes = 0;
      let maximumBytes = 0;
      await mapWithByteConcurrency(sizes, 4, 8 * 1024 * 1024, size => size, async size => {
        activeBytes += size;
        maximumBytes = Math.max(maximumBytes, activeBytes);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeBytes -= size;
      });
      expect(maximumBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }, 20_000);
});

async function binaryRecoveryFixture(
  stage: BinaryTransaction['stage'],
  originalState: 'backup' | 'final' | 'missing',
  temporaryState: 'temporary' | 'final'
): Promise<{
  client: { renameEntity: (...args: string[]) => Promise<void>; deleteEntity: (...args: string[]) => Promise<void> };
  manifest: OverleafCodexManifest;
  store: BinaryTransactionStore;
  entities: Map<string, RemoteBinaryEntityState>;
  dispose: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-binary-recovery-'));
  const finalName = 'figure.pdf';
  const tempName = 'figure.overleaf-codex-upload.pdf';
  const backupName = 'figure.overleaf-codex-backup.pdf';
  const entities = new Map<string, RemoteBinaryEntityState>([
    ...(originalState === 'missing' ? [] : [['original', {
      entityId: 'original',
      name: originalState === 'backup' ? backupName : finalName,
      parentFolderId: 'root'
    }] as [string, RemoteBinaryEntityState]]),
    ['temporary', {
      entityId: 'temporary',
      name: temporaryState === 'temporary' ? tempName : finalName,
      parentFolderId: 'root'
    }]
  ]);
  const state = manifest();
  state.files[finalName] = {
    path: finalName,
    entityId: 'original',
    entityType: 'file',
    parentFolderId: 'root',
    binary: true,
    sha1: 'old-content',
    remoteBlobHash: 'old-blob'
  };
  const transaction: BinaryTransaction = {
    id: 'transaction-1',
    path: finalName,
    parentFolderId: 'root',
    finalName,
    tempName,
    backupName,
    originalEntityId: 'original',
    tempEntityId: 'temporary',
    expectedBlobHash: 'new-blob',
    expectedSha1: 'new-content',
    stage,
    createdAt: new Date().toISOString()
  };
  const store = new BinaryTransactionStore(root);
  await store.upsert(transaction);
  const client = {
    renameEntity: async (_projectId: string, _entityType: string, entityId: string, name: string) => {
      const entity = entities.get(entityId);
      if (!entity) throw new Error(`Missing remote entity ${entityId}.`);
      entity.name = name;
    },
    deleteEntity: async (_projectId: string, _entityType: string, entityId: string) => {
      if (!entities.delete(entityId)) throw new Error(`Missing remote entity ${entityId}.`);
    }
  };
  return {
    client,
    manifest: state,
    store,
    entities,
    dispose: () => fs.rm(root, { recursive: true, force: true })
  };
}

class MemorySecurityRunner implements SecurityRunner {
  readonly items = new Map<string, Identity>();
  readonly serviceNames = new Set<string>();
  lastAddArgs?: string[];
  lastStdin?: string;

  async run(args: string[], stdin?: string): Promise<string> {
    const service = args[args.indexOf('-s') + 1];
    const account = args[args.indexOf('-a') + 1];
    this.serviceNames.add(service);
    if (args[0] === 'add-generic-password') {
      this.lastAddArgs = [...args];
      this.lastStdin = stdin;
      this.items.set(account, JSON.parse(stdin ?? '') as Identity);
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

class MemorySecretToolRunner implements SecurityRunner {
  readonly items = new Map<string, string>();
  lastArgs?: string[];
  lastStdin?: string;

  async run(args: string[], stdin?: string): Promise<string> {
    this.lastArgs = [...args];
    this.lastStdin = stdin;
    const account = args[args.indexOf('account') + 1];
    if (args[0] === 'store') {
      this.items.set(account, stdin ?? '');
      return '';
    }
    if (args[0] === 'lookup') {
      const value = this.items.get(account);
      if (value === undefined) throw new Error('No such secret.');
      return value;
    }
    if (args[0] === 'clear') {
      this.items.delete(account);
      return '';
    }
    throw new Error(`Unexpected secret-tool operation: ${args[0]}`);
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
