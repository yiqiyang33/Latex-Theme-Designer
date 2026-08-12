import type { Identity, NetworkTimeouts, SyncStatusReport } from './types';

export interface SyncPolicy {
  autoPushLocalAhead: boolean;
  syncBinaryFiles: boolean;
  syncDestructiveChanges: boolean;
  networkTimeouts: NetworkTimeouts;
}

export interface SyncProgressEvent {
  phase: string;
  message: string;
  path?: string;
  completed?: number;
  total?: number;
}

export interface SyncHost {
  log(message: string): void;
  progress(event: SyncProgressEvent): void;
  status(report: SyncStatusReport): void;
  conflict(path: string, reason: string): void;
}

export interface CredentialStore {
  saveIdentity(serverUrl: string, identity: Identity): Promise<void>;
  getIdentity(serverUrl: string): Promise<Identity | undefined>;
  deleteIdentity(serverUrl: string): Promise<void>;
  listServers(): Promise<string[]>;
}

