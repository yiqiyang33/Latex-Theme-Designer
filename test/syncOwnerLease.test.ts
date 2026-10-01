import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileRemoteProject } from '../src/overleaf/compileCore';
import { hostRelation, lockAgeMs, shortLockIsStale, type HostIdentity } from '../src/overleaf/hostIdentity';
import { metadataPath, OUTPUT_DIR, writeManifest } from '../src/overleaf/manifest';
import { RealtimeSyncService } from '../src/overleaf/realtimeSync';
import { readSharedState, sharedStateLockPath, updateSharedState } from '../src/overleaf/sharedState';
import {
  inspectOwner,
  runtimePaths,
  SyncOwnerCoordinator,
  SyncStandbyError,
  type SyncDemotion,
  type SyncOwnerCoordinatorOptions
} from '../src/overleaf/syncOwnerCoordinator';
import type { OverleafCodexManifest } from '../src/overleaf/types';
import { createExtensionContextMock, createOutputChannelMock } from './mocks/vscode';

const originalEnvironment = { ...process.env };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => undefined);
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});

// Two login nodes of one cluster, simulated in one process: same user, same NFS home, different
// kernels.
const HOST_A: HostIdentity = { hostname: 'mfe01', bootId: 'boot-a', pidNamespace: 'pid:[4026531836]' };
const HOST_B: HostIdentity = { hostname: 'mfe02', bootId: 'boot-b', pidNamespace: 'pid:[4026531836]' };

const FAST: SyncOwnerCoordinatorOptions = {
  heartbeatMs: 40,
  leaseMs: 400,
  fenceMarginMs: 150,
  ioTimeoutMs: 100,
  connectTimeoutMs: 50,
  retryDelayMs: 10,
  takeoverPollMs: 20,
  ownerStartupTimeoutMs: 300,
  missingMetadataStaleMs: 200
};

interface Sandbox {
  temporary: string;
  root: string;
  socketDirectory(name: string): string;
}

async function sandbox(): Promise<Sandbox> {
  // Short path: the socket must fit in sun_path.
  const temporary = await fs.mkdtemp('/tmp/lt-lease-');
  cleanups.push(() => fs.rm(temporary, { recursive: true, force: true }));
  process.env.LATEX_TOOLKIT_CACHE_HOME = path.join(temporary, 'runtime');
  const root = path.join(temporary, 'mirror');
  await fs.mkdir(root);
  return {
    temporary,
    root: await fs.realpath(root),
    socketDirectory: name => path.join(temporary, `s-${name}`)
  };
}

function coordinator(host: HostIdentity, socketDirectory: string, extra: SyncOwnerCoordinatorOptions = {}): SyncOwnerCoordinator {
  const created = new SyncOwnerCoordinator({ ...FAST, host, socketDirectory, ...extra });
  cleanups.push(() => created.release());
  return created;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function readOwnerRecord(root: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(runtimePaths(root).metadataPath, 'utf8'));
}

/** Plants a lock as another (possibly dead) process would have left it. */
async function plantLock(root: string, record: Record<string, unknown>, heartbeat?: { seq: number; at: string }): Promise<void> {
  const paths = runtimePaths(root);
  await fs.mkdir(paths.lockPath, { recursive: true });
  await fs.writeFile(paths.metadataPath, JSON.stringify({
    version: 2,
    root,
    startedAt: new Date().toISOString(),
    heartbeatMs: 40,
    leaseMs: 400,
    ...record
  }));
  if (heartbeat) {
    await fs.writeFile(path.join(paths.lockPath, `heartbeat-${record.nonce}.json`), JSON.stringify({ version: 1, nonce: record.nonce, ...heartbeat }));
  }
}

/** Keeps a planted foreign lock's heartbeat moving, like a live owner that never reads takeover requests. */
function keepBeating(root: string, nonce: string, everyMs = 30): () => void {
  let seq = 0;
  const file = path.join(runtimePaths(root).lockPath, `heartbeat-${nonce}.json`);
  const timer = setInterval(() => {
    seq += 1;
    void fs.writeFile(file, JSON.stringify({ version: 1, nonce, seq, at: new Date().toISOString() })).catch(() => undefined);
  }, everyMs);
  return () => clearInterval(timer);
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  return child.pid!;
}

async function claimUntil(target: SyncOwnerCoordinator, root: string, wanted: string, timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await target.claim(root, async () => 'claimed') === wanted) return Date.now() - started;
    await sleep(20);
  }
  throw new Error(`Did not become ${wanted} within ${timeoutMs} ms.`);
}

function demotions(target: SyncOwnerCoordinator): SyncDemotion[] {
  const seen: SyncDemotion[] = [];
  target.onDidDemote(event => { seen.push(event); });
  return seen;
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

describe('host identity', () => {
  it('tells this host, a reboot, another host and an old record apart', () => {
    const self: HostIdentity = { hostname: 'mfe03', bootId: 'boot-1', pidNamespace: 'pid:[1]' };
    expect(hostRelation({}, self)).toBe('legacy');
    expect(hostRelation({ hostname: 'mfe03', bootId: 'boot-1', pidNamespace: 'pid:[1]' }, self)).toBe('same');
    // The boot id decides: a renamed host is still this one.
    expect(hostRelation({ hostname: 'renamed', bootId: 'boot-1' }, self)).toBe('same');
    expect(hostRelation({ hostname: 'mfe03', bootId: 'boot-1', pidNamespace: 'pid:[2]' }, self)).toBe('foreign');
    expect(hostRelation({ hostname: 'mfe03', bootId: 'boot-0' }, self)).toBe('rebooted');
    expect(hostRelation({ hostname: 'mfe01', bootId: 'boot-9' }, self)).toBe('foreign');
    // Without boot ids (macOS) only the hostname is left.
    expect(hostRelation({ hostname: 'mac' }, { hostname: 'mac' })).toBe('same');
    expect(hostRelation({ hostname: 'other' }, { hostname: 'mac' })).toBe('foreign');
  });

  it('judges short locks of other hosts by age and local ones by PID', async () => {
    const self: HostIdentity = { hostname: 'mfe03', bootId: 'boot-1' };
    const foreign = { hostname: 'mfe01', bootId: 'boot-9', pid: 1 };
    expect(await shortLockIsStale(foreign, 1_000, 30_000, self)).toBe(false);
    expect(await shortLockIsStale(foreign, 31_000, 30_000, self)).toBe(true);
    expect(await shortLockIsStale({ hostname: 'mfe03', bootId: 'boot-1', pid: await deadPid() }, 0, 30_000, self)).toBe(true);
    expect(await shortLockIsStale({ hostname: 'mfe03', bootId: 'boot-1', pid: process.pid }, 0, 30_000, self)).toBe(false);
    // Records from older versions keep their PID check.
    expect(await shortLockIsStale({ pid: process.pid }, 999_999, 30_000, self)).toBe(false);
  });

  it('measures a lock by the younger of its recorded time and directory mtime', () => {
    expect(lockAgeMs(1_000, { mtimeMs: 9_000 }, 10_000)).toBe(1_000);
    expect(lockAgeMs(9_500, { mtimeMs: 2_000 }, 10_000)).toBe(500);
    expect(lockAgeMs(undefined, undefined, 10_000)).toBe(0);
  });
});

describe('sync ownership across hosts', () => {
  it('puts a second host in standby while the owner heartbeats, without touching its lock or socket', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const other = coordinator(HOST_B, box.socketDirectory('b'));
    expect(await owner.claim(box.root, async () => 'from owner')).toBe('owner');
    const before = await readOwnerRecord(box.root);
    expect(before).toMatchObject({ version: 2, hostname: 'mfe01', bootId: 'boot-a' });
    for (const _ of Array.from({ length: 12 })) {
      expect(await other.claim(box.root, async () => 'wrong')).toBe('standby');
      await sleep(100);
    }
    expect(other.holder).toMatchObject({ reason: 'foreign-owner', hostname: 'mfe01', sameHost: false, legacy: false });
    expect(owner.isOwner).toBe(true);
    expect((await readOwnerRecord(box.root)).nonce).toBe(before.nonce);
    expect(await canConnect(before.socketPath)).toBe(true);
    expect(await fs.readdir(box.socketDirectory('b'))).toEqual([]);
    await expect(other.request('status')).rejects.toBeInstanceOf(SyncStandbyError);
    await expect(other.subscribe(() => undefined)).rejects.toBeInstanceOf(SyncStandbyError);
  });

  it('never steals a live owner when the clocks disagree', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const ahead = coordinator(HOST_B, box.socketDirectory('b'), { now: () => Date.now() + 20 * 60_000 });
    const behind = coordinator({ ...HOST_B, bootId: 'boot-c', hostname: 'mfe04' }, box.socketDirectory('c'), {
      now: () => Date.now() - 20 * 60_000
    });
    await owner.claim(box.root, async () => undefined);
    for (const _ of Array.from({ length: 10 })) {
      expect(await ahead.claim(box.root, async () => undefined)).toBe('standby');
      expect(await behind.claim(box.root, async () => undefined)).toBe('standby');
      await sleep(80);
    }
    expect(owner.isOwner).toBe(true);
  });

  it('reclaims a dead foreign owner only after watching its heartbeat stand still for a lease', async () => {
    const box = await sandbox();
    const orphanSocket = path.join(box.temporary, 'orphan.sock');
    await fs.writeFile(orphanSocket, '');
    await plantLock(box.root, { pid: 4_000_000, hostname: 'mfe01', bootId: 'boot-a', nonce: 'dead', socketPath: orphanSocket },
      { seq: 7, at: new Date().toISOString() });
    const other = coordinator(HOST_B, box.socketDirectory('b'));
    expect(await other.claim(box.root, async () => undefined)).toBe('standby');
    const waited = await claimUntil(other, box.root, 'owner', 3_000);
    expect(waited).toBeGreaterThanOrEqual(300);
    // The dead owner's socket may belong to its host: it is never deleted from here.
    await expect(fs.stat(orphanSocket)).resolves.toBeTruthy();
    expect((await readOwnerRecord(box.root)).hostname).toBe('mfe02');
  });

  it('treats a very old heartbeat as dead once it is also seen standing still', async () => {
    const box = await sandbox();
    await plantLock(box.root, { pid: 1, hostname: 'mfe01', bootId: 'boot-a', nonce: 'ancient', socketPath: '/nonexistent' },
      { seq: 1, at: new Date(Date.now() - 11 * 60_000).toISOString() });
    const other = coordinator(HOST_B, box.socketDirectory('b'));
    const waited = await claimUntil(other, box.root, 'owner', 3_000);
    expect(waited).toBeLessThan(400);
  });

  it('reclaims a lock from before this host rebooted once its heartbeat is older than the lease', async () => {
    const box = await sandbox();
    const rebooted: HostIdentity = { ...HOST_A, bootId: 'boot-a-after-reboot' };
    await plantLock(box.root, { pid: 1, hostname: 'mfe01', bootId: 'boot-a', nonce: 'before-reboot', socketPath: '/nonexistent' },
      { seq: 1, at: new Date(Date.now() - 1_000).toISOString() });
    const self = coordinator(rebooted, box.socketDirectory('a'));
    expect(await self.claim(box.root, async () => undefined)).toBe('owner');
  });

  it('keeps reclaiming a dead owner on the same host immediately', async () => {
    const box = await sandbox();
    await plantLock(box.root, { pid: await deadPid(), ...HOST_A, nonce: 'crashed', socketPath: '/nonexistent' },
      { seq: 1, at: new Date().toISOString() });
    const self = coordinator(HOST_A, box.socketDirectory('a'));
    expect(await self.claim(box.root, async () => undefined)).toBe('owner');
  });

  it('connects to an owner on the same host through the socket path it recorded', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const sibling = coordinator(HOST_A, box.socketDirectory('elsewhere'));
    await owner.claim(box.root, async command => `owner handled ${command}`);
    expect(await sibling.claim(box.root, async () => 'wrong')).toBe('client');
    expect(await sibling.request('status')).toBe('owner handled status');
  });

  it('steps down at once when another process replaces its lock record', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const seen = demotions(owner);
    await owner.claim(box.root, async () => undefined);
    const socketPath = (await readOwnerRecord(box.root)).socketPath;
    const thief = { version: 1, pid: 1, root: box.root, socketPath: '/elsewhere', nonce: 'thief', startedAt: new Date().toISOString() };
    await fs.writeFile(runtimePaths(box.root).metadataPath, JSON.stringify(thief));
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 1_000 });
    expect(seen[0].reason).toBe('superseded');
    expect(owner.isOwner).toBe(false);
    expect(owner.role).toBe('standby');
    expect((await readOwnerRecord(box.root)).nonce).toBe('thief');
    await vi.waitFor(async () => expect(await canConnect(socketPath)).toBe(false), { timeout: 1_000 });
  });

  it('rides out transient heartbeat failures without stepping down', async () => {
    const box = await sandbox();
    let failing = true;
    const writes: number[] = [];
    const owner = coordinator(HOST_A, box.socketDirectory('a'), {
      heartbeatWrite: async () => {
        writes.push(Date.now());
        if (failing) throw Object.assign(new Error('Stale file handle'), { code: 'ESTALE' });
      }
    });
    const seen = demotions(owner);
    await owner.claim(box.root, async () => undefined);
    await sleep(120);
    failing = false;
    await sleep(400);
    expect(seen).toEqual([]);
    expect(owner.isOwner).toBe(true);
    expect(writes.length).toBeGreaterThan(3);
  });

  it('steps down before its lease could expire when renewals keep failing, and leaves the lock', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'), {
      heartbeatWrite: async () => { throw Object.assign(new Error('Input/output error'), { code: 'EIO' }); }
    });
    const seen = demotions(owner);
    const started = Date.now();
    await owner.claim(box.root, async () => undefined);
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 2_000 });
    const elapsed = Date.now() - started;
    expect(seen[0].reason).toBe('lease-lost');
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(400);
    // Its own lock stays, and this process takes it back as soon as it claims again.
    const record = await readOwnerRecord(box.root);
    expect(record.hostname).toBe('mfe01');
    const recovered = coordinator(HOST_A, box.socketDirectory('a2'));
    expect(await recovered.claim(box.root, async () => undefined)).toBe('owner');
  });

  it('still fences when a heartbeat write never returns', async () => {
    const box = await sandbox();
    let calls = 0;
    const owner = coordinator(HOST_A, box.socketDirectory('a'), {
      heartbeatWrite: () => {
        calls += 1;
        return new Promise<void>(() => undefined);
      }
    });
    const seen = demotions(owner);
    await owner.claim(box.root, async () => undefined);
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 2_000 });
    expect(seen[0].reason).toBe('lease-lost');
    // A stuck write is never piled on with more writes.
    expect(calls).toBe(1);
  });

  it('steps down when its lock disappears, without recreating it', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const seen = demotions(owner);
    await owner.claim(box.root, async () => undefined);
    await fs.rm(runtimePaths(box.root).lockPath, { recursive: true, force: true });
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 1_000 });
    expect(seen[0].reason).toBe('lock-lost');
    await sleep(150);
    await expect(fs.stat(runtimePaths(box.root).lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never reclaims a lock it cannot read', async () => {
    const box = await sandbox();
    await plantLock(box.root, { pid: 1, hostname: 'mfe01', bootId: 'boot-a', nonce: 'unreadable', socketPath: '/nonexistent' },
      { seq: 1, at: new Date(Date.now() - 60 * 60_000).toISOString() });
    // A heartbeat that cannot be read (EISDIR here, like EIO/ESTALE on NFS) says nothing either way.
    const beat = path.join(runtimePaths(box.root).lockPath, 'heartbeat-unreadable.json');
    await fs.rm(beat);
    await fs.mkdir(beat);
    const other = coordinator(HOST_B, box.socketDirectory('b'), { ownerStartupTimeoutMs: 50 });
    for (const _ of Array.from({ length: 8 })) {
      expect(await other.claim(box.root, async () => undefined)).toBe('standby');
      await sleep(80);
    }
    expect(other.holder?.reason).toBe('unknown');
  });

  it('reclaims an abandoned lock with no owner record only after a grace period', async () => {
    const box = await sandbox();
    await fs.mkdir(runtimePaths(box.root).lockPath, { recursive: true });
    const other = coordinator(HOST_B, box.socketDirectory('b'), { ownerStartupTimeoutMs: 50 });
    expect(await other.claim(box.root, async () => undefined)).toBe('standby');
    const old = new Date(Date.now() - 10_000);
    await fs.utimes(runtimePaths(box.root).lockPath, old, old);
    expect(await other.claim(box.root, async () => undefined)).toBe('owner');
  });
});

describe('sync takeover', () => {
  it('hands over cooperatively: the old owner stops before the new one starts', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const taker = coordinator(HOST_B, box.socketDirectory('b'));
    let fencedAt = 0;
    owner.onDidDemote(async () => {
      await sleep(50);
      fencedAt = Date.now();
    });
    await owner.claim(box.root, async () => undefined);
    expect(await taker.claim(box.root, async () => undefined, { takeover: true })).toBe('owner');
    const ownedAt = Date.now();
    expect(fencedAt).toBeGreaterThan(0);
    expect(fencedAt).toBeLessThanOrEqual(ownedAt);
    expect(owner.role).toBe('standby');
    expect(owner.holder).toMatchObject({ reason: 'takeover-requested', hostname: 'mfe02' });
    expect((await readOwnerRecord(box.root)).hostname).toBe('mfe02');
    await expect(fs.stat(runtimePaths(box.root).takeoverPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the old host from grabbing sync back while a takeover is under way', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    const sibling = coordinator(HOST_A, box.socketDirectory('a2'));
    const taker = coordinator(HOST_B, box.socketDirectory('b'));
    let siblingRole: string | undefined;
    owner.onDidDemote(async () => {
      // The old owner has stopped but not yet released; its window races the taker for the lock.
      siblingRole = await sibling.claim(box.root, async () => undefined);
    });
    await owner.claim(box.root, async () => undefined);
    expect(await taker.claim(box.root, async () => undefined, { takeover: true })).toBe('owner');
    expect(siblingRole).not.toBe('owner');
    expect(await sibling.claim(box.root, async () => undefined)).toBe('standby');
    expect(sibling.holder).toMatchObject({ hostname: 'mfe02' });
  });

  it('gives up on an owner that keeps renewing but ignores the request', async () => {
    const box = await sandbox();
    await plantLock(box.root, { pid: 1, hostname: 'mfe01', bootId: 'boot-a', nonce: 'stubborn', socketPath: '/nonexistent' },
      { seq: 0, at: new Date().toISOString() });
    const stop = keepBeating(box.root, 'stubborn');
    cleanups.push(async () => stop());
    const taker = coordinator(HOST_B, box.socketDirectory('b'), { takeoverTimeoutMs: 300 });
    const started = Date.now();
    expect(await taker.claim(box.root, async () => undefined, { takeover: true })).toBe('standby');
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(taker.holder).toMatchObject({ reason: 'takeover-timeout', hostname: 'mfe01' });
    await expect(fs.stat(runtimePaths(box.root).takeoverPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('withdraws its request when the takeover is cancelled', async () => {
    const box = await sandbox();
    await plantLock(box.root, { pid: 1, hostname: 'mfe01', bootId: 'boot-a', nonce: 'stubborn', socketPath: '/nonexistent' },
      { seq: 0, at: new Date().toISOString() });
    const stop = keepBeating(box.root, 'stubborn');
    cleanups.push(async () => stop());
    const taker = coordinator(HOST_B, box.socketDirectory('b'), { takeoverTimeoutMs: 5_000 });
    const aborter = new AbortController();
    setTimeout(() => aborter.abort(new Error('cancelled by test')), 120);
    await expect(taker.claim(box.root, async () => undefined, { takeover: true, signal: aborter.signal })).rejects.toThrow(/cancelled by test/);
    await expect(fs.stat(runtimePaths(box.root).takeoverPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(taker.currentRoot).toBeUndefined();
  });

  it('waits out an older version on a shared home unless the takeover is forced', async () => {
    const box = await sandbox();
    const legacySocket = path.join(box.temporary, 'legacy.sock');
    await fs.writeFile(legacySocket, '');
    const paths = runtimePaths(box.root);
    await fs.mkdir(paths.lockPath, { recursive: true });
    await fs.writeFile(paths.metadataPath, JSON.stringify({
      version: 1, pid: await deadPid(), root: box.root, socketPath: legacySocket, nonce: 'old-version',
      startedAt: new Date().toISOString(), processStart: 'whatever'
    }));
    const other = coordinator(HOST_B, box.socketDirectory('b'), { runtimeRootIsShared: true });
    expect(await other.claim(box.root, async () => undefined)).toBe('standby');
    expect(other.holder).toMatchObject({ reason: 'legacy-owner', legacy: true });
    expect(await other.claim(box.root, async () => undefined, { takeover: true })).toBe('standby');
    expect(await other.claim(box.root, async () => undefined, { takeover: true, forceLegacy: true })).toBe('owner');
    await expect(fs.stat(legacySocket)).resolves.toBeTruthy();
  });
});

describe('sync owner sockets', () => {
  it('keeps the socket in a private directory under XDG_RUNTIME_DIR', async () => {
    const box = await sandbox();
    delete process.env.LATEX_TOOLKIT_SOCKET_HOME;
    process.env.XDG_RUNTIME_DIR = path.join(box.temporary, 'xdg');
    await fs.mkdir(process.env.XDG_RUNTIME_DIR, { mode: 0o700 });
    // A group-readable directory left behind is tightened before use.
    await fs.mkdir(path.join(process.env.XDG_RUNTIME_DIR, 'latex-editing-toolkit'), { mode: 0o755 });
    const owner = new SyncOwnerCoordinator({ ...FAST, host: HOST_A });
    cleanups.push(() => owner.release());
    await owner.claim(box.root, async () => undefined);
    const record = await readOwnerRecord(box.root);
    expect(record.socketPath.startsWith(path.join(process.env.XDG_RUNTIME_DIR, 'latex-editing-toolkit') + path.sep)).toBe(true);
    expect((await fs.stat(path.dirname(record.socketPath))).mode & 0o777).toBe(0o700);
  });

  it('refuses a symlinked socket directory', async () => {
    const box = await sandbox();
    delete process.env.LATEX_TOOLKIT_SOCKET_HOME;
    process.env.XDG_RUNTIME_DIR = path.join(box.temporary, 'xdg');
    await fs.mkdir(process.env.XDG_RUNTIME_DIR, { mode: 0o700 });
    await fs.mkdir(path.join(box.temporary, 'attacker'), { mode: 0o700 });
    await fs.symlink(path.join(box.temporary, 'attacker'), path.join(process.env.XDG_RUNTIME_DIR, 'latex-editing-toolkit'));
    const owner = new SyncOwnerCoordinator({ ...FAST, host: HOST_A });
    cleanups.push(() => owner.release());
    await owner.claim(box.root, async () => undefined);
    const record = await readOwnerRecord(box.root);
    expect(record.socketPath.startsWith(process.env.XDG_RUNTIME_DIR)).toBe(false);
    expect(await fs.readdir(path.join(box.temporary, 'attacker'))).toEqual([]);
  });

  it('falls back to a short private path when the socket path would not fit', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, path.join(box.temporary, 'd'.repeat(120)));
    await owner.claim(box.root, async () => undefined);
    const record = await readOwnerRecord(box.root);
    expect(record.socketPath.startsWith(path.join('/tmp', `latex-toolkit-${process.getuid?.() ?? 'user'}`))).toBe(true);
    expect(Buffer.byteLength(record.socketPath)).toBeLessThan(104);
  });

  it.runIf(process.platform === 'linux')('tags sockets with the host when they would live in a shared runtime root', async () => {
    const box = await sandbox();
    delete process.env.XDG_RUNTIME_DIR;
    delete process.env.LATEX_TOOLKIT_SOCKET_HOME;
    const a = runtimePaths(box.root, { host: HOST_A }).socketPath;
    const b = runtimePaths(box.root, { host: HOST_B }).socketPath;
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(path.join(box.temporary, 'runtime'));
  });

  it('reports who holds a mirror and how fresh its heartbeat is', async () => {
    const box = await sandbox();
    const owner = coordinator(HOST_A, box.socketDirectory('a'));
    await owner.claim(box.root, async () => undefined);
    await sleep(60);
    const inspection = await inspectOwner(box.root);
    expect(inspection.holder).toMatchObject({ hostname: 'mfe01', relation: 'foreign' });
    expect(inspection.holder?.heartbeatAgeMs).toBeLessThan(1_000);
    expect(inspection.takeoverRequested).toBe(false);
  });
});

describe('short-lived locks shared across hosts', () => {
  it('replaces a shared-configuration lock another host abandoned long ago', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lt-shared-lock-'));
    cleanups.push(() => fs.rm(temporary, { recursive: true, force: true }));
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = path.join(temporary, 'config');
    const lockPath = sharedStateLockPath();
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({
      pid: 1, nonce: 'gone', createdAt: new Date(Date.now() - 40_000).toISOString(), hostname: 'elsewhere', bootId: 'other-boot'
    }));
    const old = new Date(Date.now() - 40_000);
    await fs.utimes(lockPath, old, old);
    const started = Date.now();
    await updateSharedState(state => { state.serverUrl = 'https://example.test/'; });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await readSharedState()).serverUrl).toBe('https://example.test/');
  });

  it('waits for a compile lock another host holds, and replaces it once it is far too old', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lt-compile-lock-'));
    cleanups.push(() => fs.rm(temporary, { recursive: true, force: true }));
    await writeManifest(temporary, minimalManifest());
    const lock = `${metadataPath(temporary, OUTPUT_DIR)}.lock`;
    const client = { compile: async () => ({ status: 'success' as const, compileGroup: 'standard', outputFiles: [] }) };
    await fs.mkdir(lock, { recursive: true });
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({
      pid: process.pid, startedAt: Date.now(), nonce: 'remote', hostname: 'elsewhere', bootId: 'other-boot'
    }));
    await expect(compileRemoteProject(temporary, client as never, undefined, { lockWaitMs: 60, lockForeignStaleMs: 60_000 }))
      .rejects.toThrow(/Timed out waiting for the Overleaf compile lock/);
    const old = new Date(Date.now() - 10_000);
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({
      pid: process.pid, startedAt: old.getTime(), nonce: 'remote', hostname: 'elsewhere', bootId: 'other-boot'
    }));
    await fs.utimes(lock, old, old);
    await expect(compileRemoteProject(temporary, client as never, undefined, { lockWaitMs: 500, lockForeignStaleMs: 5_000 }))
      .resolves.toMatchObject({ files: [] });
  });
});

describe('fencing the realtime engine', () => {
  it('drops the Overleaf connection before in-flight work drains, and does not reconnect', async () => {
    const service = new RealtimeSyncService(createExtensionContextMock() as never, createOutputChannelMock() as never);
    const internals = service as unknown as Record<string, any>;
    const disconnect = vi.fn();
    internals.session = { disconnect };
    internals.shouldReconnect = true;
    let finish!: () => void;
    internals.inFlight.set('main.tex', new Promise<void>(resolve => { finish = resolve; }));
    const fencing = service.fence('moved to mfe02');
    expect(disconnect).toHaveBeenCalled();
    let done = false;
    void fencing.then(() => { done = true; });
    await sleep(20);
    expect(done).toBe(false);
    finish();
    await fencing;
    expect(internals.shouldReconnect).toBe(false);
    expect(internals.session).toBeUndefined();
  });
});

function minimalManifest(): OverleafCodexManifest {
  return {
    schemaVersion: 3,
    serverUrl: 'https://example.test/',
    projectId: 'project',
    projectName: 'Project',
    files: {},
    folders: { '': { path: '', entityId: 'root' } },
    ignore: [],
    lastSyncAt: '2026-08-12T00:00:00.000Z'
  } as OverleafCodexManifest;
}
