import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runtimeRoot } from './sharedState';
import { formatUnknownError } from './util';

export const SYNC_IPC_VERSION = 1;
const MAX_IPC_FRAME_BYTES = 1024 * 1024;
const MAX_IPC_BUFFER_BYTES = 4 * 1024 * 1024;

export interface OwnerRequest {
  version: 1;
  id: string;
  command: string;
  root: string;
  args: Record<string, unknown>;
}

export interface OwnerResponse {
  version: 1;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface OwnerEvent {
  version: 1;
  event: string;
  root: string;
  data?: unknown;
}

interface OwnerMetadata {
  version: 1;
  pid: number;
  root: string;
  socketPath: string;
  nonce: string;
  startedAt: string;
  processStart?: string;
}

const execFileAsync = promisify(execFile);

export type OwnerHandler = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export interface SyncOwnerCoordinatorOptions {
  ownerStartupTimeoutMs?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
  subscriptionTimeoutMs?: number;
  missingMetadataStaleMs?: number;
}

export class SyncOwnerCoordinator {
  private root?: string;
  private metadata?: OwnerMetadata;
  private server?: net.Server;
  private handler?: OwnerHandler;
  private clientSockets = new Set<net.Socket>();
  private subscriberSockets = new Set<net.Socket>();
  private eventSockets = new Set<net.Socket>();
  private readonly events = new EventEmitter();
  private commandQueue: Promise<unknown> = Promise.resolve();
  private releasing = false;

  constructor(private readonly options: SyncOwnerCoordinatorOptions = {}) {}

  get isOwner(): boolean {
    return Boolean(this.server);
  }

  get currentRoot(): string | undefined {
    return this.root;
  }

  async claim(root: string, handler: OwnerHandler): Promise<'owner' | 'client'> {
    await this.release();
    this.root = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root));
    this.handler = handler;
    await fs.mkdir(runtimeRoot(), { recursive: true, mode: 0o700 });
    await fs.chmod(runtimeRoot(), 0o700).catch(() => undefined);
    const paths = runtimePaths(this.root);
    const deadline = Date.now() + (this.options.ownerStartupTimeoutMs ?? 3_000);
    while (true) {
      if (await canConnect(paths.socketPath, this.options.connectTimeoutMs ?? 200)) return 'client';
      try {
        await fs.mkdir(paths.lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      if (await this.clearStaleLock(paths)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the sync owner socket for ${this.root}.`);
      }
      await delay(this.options.retryDelayMs ?? 50);
    }

    const metadata: OwnerMetadata = {
      version: 1,
      pid: process.pid,
      root: this.root,
      socketPath: paths.socketPath,
      nonce: crypto.randomBytes(16).toString('hex'),
      startedAt: new Date().toISOString(),
      processStart: await processStartSignature(process.pid)
    };
    try {
      await fs.writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
      await fs.rm(paths.socketPath, { force: true });
      this.server = net.createServer(socket => this.accept(socket));
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(paths.socketPath, () => {
          this.server!.removeListener('error', reject);
          resolve();
        });
      });
      await fs.chmod(paths.socketPath, 0o600);
      if (!await canConnect(paths.socketPath, this.options.connectTimeoutMs ?? 200)) {
        throw new Error('Sync owner socket did not become reachable after startup.');
      }
      this.metadata = metadata;
      return 'owner';
    } catch (error) {
      const server = this.server;
      this.server = undefined;
      if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      await fs.rm(paths.lockPath, { recursive: true, force: true });
      await fs.rm(paths.socketPath, { force: true });
      throw error;
    }
  }

  async request(command: string, args: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
    if (!this.root) throw new Error('No sync root is selected.');
    if (this.server && this.handler) {
      if (this.releasing) throw new Error('Sync owner is shutting down.');
      return this.runCommand(() => this.handler?.(command, args));
    }
    const request: OwnerRequest = {
      version: 1,
      id: crypto.randomUUID(),
      command,
      root: this.root,
      args
    };
    return sendRequest(runtimePaths(this.root).socketPath, request, timeoutMs);
  }

  emit(event: string, data?: unknown): void {
    if (!this.root) return;
    const message: OwnerEvent = { version: 1, event, root: this.root, data };
    const line = `${JSON.stringify(message)}\n`;
    for (const socket of this.eventSockets) {
      if (!socket.destroyed && !socket.writableEnded) writeBounded(socket, line);
    }
    this.events.emit('event', message);
  }

  onEvent(listener: (event: OwnerEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  async subscribe(
    onEvent: (event: OwnerEvent) => void,
    timeoutMs = this.options.subscriptionTimeoutMs ?? 5_000
  ): Promise<net.Socket> {
    if (!this.root) throw new Error('No sync root is selected.');
    const socket = net.createConnection(runtimePaths(this.root).socketPath);
    socket.on('error', () => undefined);
    try {
      await onceConnected(socket, timeoutMs);
    } catch (error) {
      socket.destroy();
      throw error;
    }
    this.subscriberSockets.add(socket);
    socket.once('close', () => this.subscriberSockets.delete(socket));
    const subscribed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Timed out waiting for sync owner subscription after ${timeoutMs}ms.`)),
        timeoutMs
      );
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('error', onError);
        socket.off('close', onClose);
        error ? reject(error) : resolve();
      };
      const onError = (error: Error): void => finish(error);
      const onClose = (): void => finish(new Error('Sync owner closed the socket before confirming the subscription.'));
      socket.once('error', onError);
      socket.once('close', onClose);
      parseJsonLines(socket, value => {
        if (!isOwnerEvent(value)) return;
        if (value.event === 'subscribed') {
          finish();
        }
        onEvent(value);
      });
    });
    writeBounded(socket, `${JSON.stringify({
      version: 1,
      id: crypto.randomUUID(),
      command: 'subscribe',
      root: this.root,
      args: {}
    } satisfies OwnerRequest)}\n`);
    try {
      await subscribed;
      return socket;
    } catch (error) {
      this.subscriberSockets.delete(socket);
      socket.destroy();
      throw error;
    }
  }

  async release(): Promise<void> {
    this.releasing = true;
    await this.commandQueue.catch(() => undefined);
    for (const socket of this.subscriberSockets) socket.destroy();
    this.subscriberSockets.clear();
    for (const socket of this.clientSockets) socket.destroy();
    this.clientSockets.clear();
    this.eventSockets.clear();
    if (this.server) {
      const server = this.server;
      this.server = undefined;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (this.metadata && this.root) {
      const paths = runtimePaths(this.root);
      const current = await readMetadata(paths.metadataPath);
      if (current?.nonce === this.metadata.nonce) {
        await fs.rm(paths.socketPath, { force: true });
        await fs.rm(paths.lockPath, { recursive: true, force: true });
      }
    }
    this.metadata = undefined;
    this.handler = undefined;
    this.root = undefined;
    this.releasing = false;
  }

  private accept(socket: net.Socket): void {
    this.clientSockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.clientSockets.delete(socket);
      this.eventSockets.delete(socket);
    });
    parseJsonLines(socket, value => {
      void this.handleSocketRequest(socket, value);
    });
  }

  private async handleSocketRequest(socket: net.Socket, value: unknown): Promise<void> {
    if (!isOwnerRequest(value) || !this.root || path.resolve(value.root) !== path.resolve(this.root)) {
      writeBounded(socket, `${JSON.stringify(errorResponse(String((value as { id?: unknown })?.id ?? ''), 'invalid_request', 'Invalid IPC request.'))}\n`);
      return;
    }
    if (value.command === 'subscribe') {
      this.eventSockets.add(socket);
      writeBounded(socket, `${JSON.stringify({ version: 1, event: 'subscribed', root: this.root } satisfies OwnerEvent)}\n`);
      return;
    }
    if (this.releasing) {
      writeBounded(socket, `${JSON.stringify(errorResponse(value.id, 'owner_releasing', 'Sync owner is shutting down.'))}\n`);
      return;
    }
    try {
      const result = await this.runCommand(() => this.handler?.(value.command, value.args));
      writeBounded(socket, `${JSON.stringify({ version: 1, id: value.id, ok: true, result } satisfies OwnerResponse)}\n`);
    } catch (error) {
      writeBounded(socket, `${JSON.stringify(errorResponse(value.id, 'owner_command_failed', formatUnknownError(error)))}\n`);
    }
  }

  private runCommand<T>(operation: () => Promise<T> | undefined): Promise<T | undefined> {
    const current = this.commandQueue.catch(() => undefined).then(operation);
    this.commandQueue = current.then(() => undefined, () => undefined);
    return current;
  }

  private async lockIsStale(paths: ReturnType<typeof runtimePaths>): Promise<boolean> {
    const metadata = await readMetadata(paths.metadataPath);
    if (!metadata) {
      const stat = await fs.stat(paths.lockPath).catch(() => undefined);
      return Boolean(stat && Date.now() - stat.mtimeMs >= (this.options.missingMetadataStaleMs ?? 1_000));
    }
    if (processAlive(metadata.pid)) {
      const currentStart = await processStartSignature(metadata.pid);
      if (!metadata.processStart || !currentStart || metadata.processStart === currentStart) return false;
    }
    return true;
  }

  private async clearStaleLock(paths: ReturnType<typeof runtimePaths>): Promise<boolean> {
    const guardPath = `${paths.lockPath}.reclaim`;
    if (!await acquireReclaimGuard(
      guardPath,
      Math.max((this.options.ownerStartupTimeoutMs ?? 3_000) * 2, 10_000)
    )) return false;
    try {
      if (!await this.lockIsStale(paths)) return false;
      await fs.rm(paths.lockPath, { recursive: true, force: true });
      await fs.rm(paths.socketPath, { force: true });
      return true;
    } finally {
      await fs.rm(guardPath, { recursive: true, force: true });
    }
  }
}

export function runtimePaths(root: string): { lockPath: string; metadataPath: string; socketPath: string } {
  const hash = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 32);
  const lockPath = path.join(runtimeRoot(), `${hash}.lock`);
  return {
    lockPath,
    metadataPath: path.join(lockPath, 'owner.json'),
    // macOS limits AF_UNIX paths to roughly 104 bytes. The lock retains the
    // full 128-bit hash; the socket uses 64 bits and no suffix to leave room
    // for the user's absolute cache directory.
    socketPath: path.join(runtimeRoot(), hash.slice(0, 16))
  };
}

export async function inspectOwner(root: string): Promise<{ reachable: boolean; metadata?: OwnerMetadata }> {
  const paths = runtimePaths(root);
  return { reachable: await canConnect(paths.socketPath), metadata: await readMetadata(paths.metadataPath) };
}

function sendRequest(socketPath: string, request: OwnerRequest, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for sync owner after ${timeoutMs}ms.`)), timeoutMs);
    let settled = false;
    const finish = (error?: Error, result?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    socket.once('error', error => finish(error));
    socket.once('connect', () => writeBounded(socket, `${JSON.stringify(request)}\n`));
    parseJsonLines(socket, value => {
      const response = value as Partial<OwnerResponse>;
      if (response.id !== request.id || typeof response.ok !== 'boolean') return;
      if (response.ok) finish(undefined, response.result);
      else finish(new Error(response.error?.message ?? 'Sync owner rejected the request.'));
    });
  });
}

function parseJsonLines(socket: net.Socket, onValue: (value: unknown) => void): void {
  let pending = '';
  socket.on('data', chunk => {
    pending += chunk.toString('utf8');
    if (Buffer.byteLength(pending, 'utf8') > MAX_IPC_BUFFER_BYTES) {
      socket.destroy(new Error('Sync IPC receive buffer exceeded its limit.'));
      return;
    }
    while (pending.includes('\n')) {
      const index = pending.indexOf('\n');
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_IPC_FRAME_BYTES) {
        socket.destroy(new Error('Sync IPC frame exceeded its limit.'));
        return;
      }
      if (!line.trim()) continue;
      try { onValue(JSON.parse(line)); } catch { socket.destroy(new Error('Invalid JSON received over sync IPC.')); }
    }
  });
}

function writeBounded(socket: net.Socket, line: string): void {
  if (Buffer.byteLength(line, 'utf8') > MAX_IPC_FRAME_BYTES || socket.writableLength > MAX_IPC_BUFFER_BYTES) {
    socket.destroy(new Error('Sync IPC send queue exceeded its limit.'));
    return;
  }
  socket.write(line, error => { if (error) socket.destroy(); });
}

function onceConnected(socket: net.Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out connecting to sync owner after ${timeoutMs}ms.`)), timeoutMs);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('error', onError);
      error ? reject(error) : resolve();
    };
    const onConnect = (): void => finish();
    const onError = (error: Error): void => finish(error);
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}

function canConnect(socketPath: string, timeoutMs = 500): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireReclaimGuard(guardPath: string, staleMs: number): Promise<boolean> {
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

async function readMetadata(target: string): Promise<OwnerMetadata | undefined> {
  const raw = await fs.readFile(target, 'utf8').catch(() => undefined);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as OwnerMetadata; } catch { return undefined; }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function processStartSignature(pid: number): Promise<string | undefined> {
  try {
    const result = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
    return String(result.stdout ?? '').trim() || undefined;
  } catch {
    return undefined;
  }
}

function isOwnerRequest(value: unknown): value is OwnerRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<OwnerRequest>;
  return request.version === 1 && typeof request.id === 'string' && typeof request.command === 'string'
    && typeof request.root === 'string' && Boolean(request.args) && typeof request.args === 'object';
}

function isOwnerEvent(value: unknown): value is OwnerEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<OwnerEvent>;
  return event.version === 1 && typeof event.event === 'string' && typeof event.root === 'string';
}

function errorResponse(id: string, code: string, message: string): OwnerResponse {
  return { version: 1, id, ok: false, error: { code, message } };
}
