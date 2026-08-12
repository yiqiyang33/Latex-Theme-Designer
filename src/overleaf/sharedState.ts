import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { NetworkTimeouts } from './types';
import type { SyncPolicy } from './coreInterfaces';
import { atomicWriteText, manifestPath, readManifest } from './manifest';
import { normalizeServerUrl } from './util';

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
    : path.join(os.homedir(), 'Library', 'Application Support', 'latex-editing-toolkit');
}

export function runtimeRoot(): string {
  return process.env.LATEX_TOOLKIT_CACHE_HOME
    ? path.resolve(process.env.LATEX_TOOLKIT_CACHE_HOME)
    : path.join(os.homedir(), 'Library', 'Caches', 'latex-editing-toolkit', 'runtime');
}

export function sharedStatePath(): string {
  return path.join(applicationSupportRoot(), 'overleaf.json');
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
  const raw = await fs.readFile(sharedStatePath(), 'utf8').catch(() => undefined);
  if (!raw) return defaultSharedState();
  const parsed = JSON.parse(raw) as Partial<SharedOverleafState>;
  const defaults = defaultSharedState();
  return {
    ...defaults,
    ...parsed,
    schemaVersion: 1,
    servers: Array.isArray(parsed.servers) ? [...new Set(parsed.servers.map(normalizeServerUrl))].sort() : [],
    mirrors: Array.isArray(parsed.mirrors) ? parsed.mirrors.filter(isMirrorRecord) : [],
    credentialMigrations: Array.isArray(parsed.credentialMigrations)
      ? [...new Set(parsed.credentialMigrations.map(normalizeServerUrl))].sort()
      : [],
    credentialTombstones: Array.isArray(parsed.credentialTombstones)
      ? [...new Set(parsed.credentialTombstones.map(normalizeServerUrl))].sort()
      : [],
    policy: {
      ...defaults.policy,
      ...(parsed.policy ?? {}),
      networkTimeouts: {
        ...defaults.policy.networkTimeouts,
        ...(parsed.policy?.networkTimeouts ?? {})
      }
    }
  };
}

export async function writeSharedState(state: SharedOverleafState): Promise<void> {
  await atomicWriteText(sharedStatePath(), `${JSON.stringify({ ...state, schemaVersion: 1 }, null, 2)}\n`);
}

export async function updateSharedState(
  mutate: (state: SharedOverleafState) => void | Promise<void>
): Promise<SharedOverleafState> {
  const state = await readSharedState();
  await mutate(state);
  state.servers = [...new Set(state.servers.map(normalizeServerUrl))].sort();
  state.credentialMigrations = [...new Set(state.credentialMigrations.map(normalizeServerUrl))].sort();
  state.credentialTombstones = [...new Set(state.credentialTombstones.map(normalizeServerUrl))].sort();
  state.mirrors = dedupeMirrors(state.mirrors);
  await writeSharedState(state);
  return state;
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
  const records: SharedMirrorRecord[] = [];
  for (const record of state.mirrors) {
    if (!await exists(manifestPath(record.root))) continue;
    records.push(await registerSharedMirror(record.root) ?? record);
  }
  return records.sort((a, b) => (b.lastSyncAt ?? '').localeCompare(a.lastSyncAt ?? ''));
}

function dedupeMirrors(records: SharedMirrorRecord[]): SharedMirrorRecord[] {
  const result = new Map<string, SharedMirrorRecord>();
  for (const record of records.filter(isMirrorRecord)) result.set(path.resolve(record.root), record);
  return [...result.values()];
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
