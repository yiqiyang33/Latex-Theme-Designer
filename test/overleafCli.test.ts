import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockingExitCode, parseArgs } from '../src/cli';
import { installCli, uninstallCli } from '../src/overleaf/cliInstaller';
import { KEYCHAIN_SERVICE, MacKeychainCredentialStore, type SecurityRunner } from '../src/overleaf/keychainStore';
import { defaultSharedState, readSharedState, registerSharedMirror, sharedStatePath, updateSharedState } from '../src/overleaf/sharedState';
import { runtimePaths, SyncOwnerCoordinator } from '../src/overleaf/syncOwnerCoordinator';
import { writeManifest } from '../src/overleaf/manifest';
import type { Identity, OverleafCodexManifest, SyncStatusReport } from '../src/overleaf/types';

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
