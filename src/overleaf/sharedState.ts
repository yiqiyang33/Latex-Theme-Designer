import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { NetworkTimeouts } from './types';
import type { SyncPolicy } from './coreInterfaces';
import { atomicWriteText, manifestPath, readManifest, readTextFileBounded, MAX_METADATA_JSON_BYTES } from './manifest';
import { normalizeServerUrl, processAlive, processStartSignature } from './util';
import { mapWithConcurrency } from './syncHealthService';

export interface SharedMirrorRecord {
  root: string;
  name: string;
  projectId: string;
  serverUrl: string;
  lastSyncAt?: string;
}

export interface SharedOverleafState {
  schemaVersion: 1;
  servers: string[];
  mirrors: SharedMirrorRecord[];
  credentialMigrations: string[];
  credentialTombstones: string[];
  policy: SyncPolicy;
  serverUrl: string;
  localProjectsRoot: string;
}

export const DEFAULT_NETWORK_TIMEOUTS: NetworkTimeouts = {
  connectMs: 20_000,
  projectJoinMs: 30_000,
  httpMs: 60_000,
  joinDocMs: 30_000,
  otAckMs: 15_000
};

export const DEFAULT_SYNC_POLICY: SyncPolicy = {
  autoPushLocalAhead: true,
  syncBinaryFiles: true,
  syncDestructiveChanges: false,
  networkTimeouts: DEFAULT_NETWORK_TIMEOUTS
};

export function applicationSupportRoot(): string {
  return process.env.LATEX_TOOLKIT_SUPPORT_HOME
    ? path.resolve(process.env.LATEX_TOOLKIT_SUPPORT_HOME)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'latex-editing-toolkit')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'latex-editing-toolkit');
}

export function applicationDataRoot(): string {
  return process.env.LATEX_TOOLKIT_DATA_HOME
    ? path.resolve(process.env.LATEX_TOOLKIT_DATA_HOME)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'latex-editing-toolkit')
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'latex-editing-toolkit');
}

export function credentialRoot(): string {
  return path.join(applicationDataRoot(), 'credentials');
}

export function runtimeRoot(): string {
  return process.env.LATEX_TOOLKIT_CACHE_HOME
    ? path.resolve(process.env.LATEX_TOOLKIT_CACHE_HOME)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'latex-editing-toolkit', 'runtime')
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'latex-editing-toolkit', 'runtime');
}

export function sharedStatePath(): string {
  return path.join(applicationSupportRoot(), 'overleaf.json');
}

export function sharedStateLockPath(): string {
  return `${sharedStatePath()}.lock`;
}

export function defaultSharedState(): SharedOverleafState {
  return {
    schemaVersion: 1,
    servers: [],
    mirrors: [],
    credentialMigrations: [],
    credentialTombstones: [],
    policy: structuredClone(DEFAULT_SYNC_POLICY),
    serverUrl: 'https://www.overleaf.com/',
    localProjectsRoot: path.join(os.homedir(), 'Documents', 'OverleafCodex', 'projects')
  };
}

export async function readSharedState(): Promise<SharedOverleafState> {
  await migrateLegacyLinuxPaths();
  const raw = await readTextFileBounded(sharedStatePath(), MAX_METADATA_JSON_BYTES).catch(() => undefined);
  if (!raw) return defaultSharedState();
  let parsed: Partial<SharedOverleafState>;
  try { parsed = JSON.parse(raw) as Partial<SharedOverleafState>; }
  catch {
    await fs.rename(sharedStatePath(), `${sharedStatePath()}.corrupt-${Date.now()}`).catch(() => undefined);
    return defaultSharedState();
  }
  const defaults = defaultSharedState();
  const parsedPolicy: Record<string, any> = isRecord(parsed.policy) ? parsed.policy : {};
  const parsedTimeouts: Record<string, any> = isRecord(parsedPolicy.networkTimeouts) ? parsedPolicy.networkTimeouts : {};
  return {
    ...defaults,
    ...parsed,
    schemaVersion: 1,
    servers: normalizeServerList(parsed.servers),
    mirrors: Array.isArray(parsed.mirrors) ? parsed.mirrors.filter(isMirrorRecord) : [],
    credentialMigrations: Array.isArray(parsed.credentialMigrations)
      ? normalizeServerList(parsed.credentialMigrations)
      : [],
    credentialTombstones: Array.isArray(parsed.credentialTombstones)
      ? normalizeServerList(parsed.credentialTombstones)
      : [],
    policy: {
      autoPushLocalAhead: typeof parsedPolicy.autoPushLocalAhead === 'boolean'
        ? parsedPolicy.autoPushLocalAhead : defaults.policy.autoPushLocalAhead,
      syncBinaryFiles: typeof parsedPolicy.syncBinaryFiles === 'boolean'
        ? parsedPolicy.syncBinaryFiles : defaults.policy.syncBinaryFiles,
      syncDestructiveChanges: typeof parsedPolicy.syncDestructiveChanges === 'boolean'
        ? parsedPolicy.syncDestructiveChanges : defaults.policy.syncDestructiveChanges,
      networkTimeouts: {
        ...defaults.policy.networkTimeouts,
        connectMs: validTimeout(parsedTimeouts.connectMs, defaults.policy.networkTimeouts.connectMs),
        projectJoinMs: validTimeout(parsedTimeouts.projectJoinMs, defaults.policy.networkTimeouts.projectJoinMs),
        httpMs: validTimeout(parsedTimeouts.httpMs, defaults.policy.networkTimeouts.httpMs),
        joinDocMs: validTimeout(parsedTimeouts.joinDocMs, defaults.policy.networkTimeouts.joinDocMs),
        otAckMs: validTimeout(parsedTimeouts.otAckMs, defaults.policy.networkTimeouts.otAckMs)
      }
    },
    serverUrl: safeNormalizeServerUrl(parsed.serverUrl, defaults.serverUrl),
    localProjectsRoot: typeof parsed.localProjectsRoot === 'string' && parsed.localProjectsRoot.trim()
      ? path.resolve(parsed.localProjectsRoot) : defaults.localProjectsRoot
  };
}

export async function migrateLegacyLinuxPaths(): Promise<void> {
  if (process.platform !== 'linux') return;
  if (process.env.LATEX_TOOLKIT_SUPPORT_HOME || process.env.LATEX_TOOLKIT_DATA_HOME || process.env.LATEX_TOOLKIT_CACHE_HOME) return;
  const legacySupport = path.join(os.homedir(), 'Library', 'Application Support', 'latex-editing-toolkit');
  const legacyCache = path.join(os.homedir(), 'Library', 'Caches', 'latex-editing-toolkit');
  const configRoot = applicationSupportRoot();
  const dataRoot = applicationDataRoot();
  const cacheRoot = runtimeRoot();
  const marker = path.join(configRoot, '.legacy-migration-v1');
  if (await exists(marker)) return;

  const legacyState = path.join(legacySupport, 'overleaf.json');
  if (!await exists(sharedStatePath()) && await exists(legacyState)) {
    await fs.mkdir(configRoot, { recursive: true, mode: 0o700 });
    await fs.copyFile(legacyState, sharedStatePath());
  }
  await copyDirectoryIfMissing(path.join(legacySupport, 'cli'), path.join(dataRoot, 'cli'));
  await copyDirectoryIfMissing(path.join(legacyCache, 'runtime'), cacheRoot);
  await fs.mkdir(configRoot, { recursive: true, mode: 0o700 });
  await fs.writeFile(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
}

async function copyDirectoryIfMissing(source: string, target: string): Promise<void> {
  if (await exists(target) || !await exists(source)) return;
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.cp(source, target, { recursive: true });
}

export async function writeSharedState(state: SharedOverleafState): Promise<void> {
  const release = await acquireSharedStateLock();
  try {
    await writeSharedStateUnlocked(normalizeSharedState(state));
  } finally {
    await release();
  }
}

export async function updateSharedState(
  mutate: (state: SharedOverleafState) => void | Promise<void>
): Promise<SharedOverleafState> {
  const release = await acquireSharedStateLock();
  try {
    const state = await readSharedState();
    await mutate(state);
    const normalized = normalizeSharedState(state);
    await writeSharedStateUnlocked(normalized);
    return normalized;
  } finally {
    await release();
  }
}

export async function registerSharedMirror(root: string): Promise<SharedMirrorRecord | undefined> {
  const absolute = path.resolve(root);
  const manifest = await readManifest(absolute).catch(() => undefined);
  if (!manifest) return undefined;
  const record: SharedMirrorRecord = {
    root: absolute,
    name: manifest.projectName || path.basename(absolute),
    projectId: manifest.projectId,
    serverUrl: normalizeServerUrl(manifest.serverUrl),
    lastSyncAt: manifest.lastSyncAt
  };
  await updateSharedState(state => {
    state.mirrors = [record, ...state.mirrors.filter(item => path.resolve(item.root) !== absolute)];
  });
  return record;
}

export async function listSharedMirrors(): Promise<SharedMirrorRecord[]> {
  const state = await readSharedState();
  const refreshed = new Map<string, SharedMirrorRecord | undefined>();
  await mapWithConcurrency(state.mirrors, 8, async record => {
    const absolute = path.resolve(record.root);
    if (!await exists(manifestPath(absolute))) {
      refreshed.set(absolute, undefined);
      return;
    }
    const manifest = await readManifest(absolute).catch(() => undefined);
    refreshed.set(absolute, manifest ? {
      root: absolute,
      name: manifest.projectName || path.basename(absolute),
      projectId: manifest.projectId,
      serverUrl: normalizeServerUrl(manifest.serverUrl),
      lastSyncAt: manifest.lastSyncAt
    } : record);
  });

  const release = await acquireSharedStateLock();
  try {
    const latest = await readSharedState();
    const records = mergeRefreshedMirrorRecords(latest.mirrors, refreshed);
    const normalized = normalizeSharedState({ ...latest, mirrors: records });
    if (JSON.stringify(normalized.mirrors) !== JSON.stringify(latest.mirrors)) {
      await writeSharedStateUnlocked(normalized);
    }
    return normalized.mirrors.sort((a, b) => (b.lastSyncAt ?? '').localeCompare(a.lastSyncAt ?? ''));
  } finally {
    await release();
  }
}

export function mergeRefreshedMirrorRecords(
  latest: SharedMirrorRecord[],
  refreshed: ReadonlyMap<string, SharedMirrorRecord | undefined>
): SharedMirrorRecord[] {
  return latest.flatMap(record => {
    const absolute = path.resolve(record.root);
    return refreshed.has(absolute) ? refreshed.get(absolute) ?? [] : record;
  });
}

function dedupeMirrors(records: SharedMirrorRecord[]): SharedMirrorRecord[] {
  const result = new Map<string, SharedMirrorRecord>();
  for (const record of records.filter(isMirrorRecord)) result.set(path.resolve(record.root), record);
  return [...result.values()];
}

interface SharedStateLockMetadata {
  pid: number;
  nonce: string;
  createdAt: string;
  processStart?: string;
}

const SHARED_STATE_LOCK_TIMEOUT_MS = 15_000;
const SHARED_STATE_STALE_GRACE_MS = 5_000;

function normalizeSharedState(state: SharedOverleafState): SharedOverleafState {
  return {
    ...state,
    schemaVersion: 1,
    servers: normalizeServerList(state.servers),
    credentialMigrations: normalizeServerList(state.credentialMigrations),
    credentialTombstones: normalizeServerList(state.credentialTombstones),
    mirrors: dedupeMirrors(state.mirrors)
  };
}

function normalizeServerList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    try { normalized.push(normalizeServerUrl(item)); } catch { /* discard malformed persisted entries */ }
  }
  return [...new Set(normalized)].sort();
}

function safeNormalizeServerUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  try { return normalizeServerUrl(value); } catch { return fallback; }
}

function validTimeout(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10 * 60 * 1000
    ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function writeSharedStateUnlocked(state: SharedOverleafState): Promise<void> {
  await atomicWriteText(sharedStatePath(), `${JSON.stringify(state, null, 2)}\n`);
}

async function acquireSharedStateLock(): Promise<() => Promise<void>> {
  const lockPath = sharedStateLockPath();
  const metadataPath = path.join(lockPath, 'owner.json');
  const deadline = Date.now() + SHARED_STATE_LOCK_TIMEOUT_MS;
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  while (true) {
    const metadata: SharedStateLockMetadata = {
      pid: process.pid,
      nonce: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString()
      ,processStart: await processStartSignature(process.pid)
    };
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      try {
        await fs.writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        const current = await readSharedStateLockMetadata(metadataPath);
        if (current?.nonce === metadata.nonce) {
          await fs.rm(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    if (await clearStaleSharedStateLock(lockPath, metadataPath, deadline)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the shared Overleaf configuration lock: ${lockPath}`);
    }
    await delay(25 + Math.floor(Math.random() * 25));
  }
}

async function clearStaleSharedStateLock(lockPath: string, metadataPath: string, deadline: number): Promise<boolean> {
  const guardPath = `${lockPath}.reclaim`;
  if (!await acquireReclaimGuard(guardPath, Math.max(1, Math.min(SHARED_STATE_LOCK_TIMEOUT_MS * 2, deadline - Date.now())))) return false;
  try {
    if (!await sharedStateLockIsStale(lockPath, metadataPath)) return false;
    await fs.rm(lockPath, { recursive: true, force: true });
    return true;
  } finally {
    await fs.rm(guardPath, { recursive: true, force: true });
  }
}

async function acquireReclaimGuard(guardPath: string, staleMs = SHARED_STATE_LOCK_TIMEOUT_MS * 2): Promise<boolean> {
  try {
    await fs.mkdir(guardPath, { mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = await fs.stat(guardPath).catch(() => undefined);
  if (!stat || Date.now() - stat.mtimeMs < staleMs) return false;
  await fs.rm(guardPath, { recursive: true, force: true });
  try {
    await fs.mkdir(guardPath, { mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

async function sharedStateLockIsStale(lockPath: string, metadataPath: string): Promise<boolean> {
  const metadata = await readSharedStateLockMetadata(metadataPath);
  if (metadata) {
    if (!processAlive(metadata.pid)) return true;
    const currentStart = await processStartSignature(metadata.pid);
    return Boolean(metadata.processStart && currentStart && metadata.processStart !== currentStart);
  }
  const stat = await fs.stat(lockPath).catch(() => undefined);
  return Boolean(stat && Date.now() - stat.mtimeMs >= SHARED_STATE_STALE_GRACE_MS);
}

async function readSharedStateLockMetadata(target: string): Promise<SharedStateLockMetadata | undefined> {
  const raw = await readTextFileBounded(target, 64 * 1024).catch(() => undefined);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SharedStateLockMetadata>;
    return typeof parsed.pid === 'number' && typeof parsed.nonce === 'string'
      ? parsed as SharedStateLockMetadata
      : undefined;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isMirrorRecord(value: unknown): value is SharedMirrorRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SharedMirrorRecord>;
  return typeof record.root === 'string'
    && typeof record.projectId === 'string'
    && typeof record.serverUrl === 'string'
    && typeof record.name === 'string';
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}
