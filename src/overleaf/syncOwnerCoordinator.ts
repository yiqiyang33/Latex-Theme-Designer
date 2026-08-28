import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';
import { EventEmitter } from 'events';
import { runtimeRoot } from './sharedState';
import { formatUnknownError, processAlive, processStartSignature } from './util';

export const SYNC_IPC_VERSION = 1;
const MAX_IPC_FRAME_BYTES = 1024 * 1024;
const MAX_IPC_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_IPC_MESSAGE_BYTES = 32 * 1024 * 1024;
const IPC_CHUNK_BYTES = 512 * 1024;

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

interface IpcChunk {
  version: 1;
  kind: 'chunk';
  id: string;
  index: number;
  total: number;
  payload: string;
}

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
  private readonly writeQueues = new WeakMap<net.Socket, Promise<void>>();
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
    for (const socket of this.eventSockets) {
      if (!socket.destroyed && !socket.writableEnded) {
        void this.enqueueMessage(socket, message).catch(error => {
          if (!socket.destroyed && !socket.writableEnded) {
            void this.enqueueMessage(socket, {
              version: 1,
              event: 'error',
              root: this.root,
              data: { code: 'message_too_large', message: formatUnknownError(error) }
            }).catch(() => undefined);
          }
        });
      }
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
    try {
      await this.enqueueMessage(socket, {
        version: 1,
        id: crypto.randomUUID(),
        command: 'subscribe',
        root: this.root,
        args: {}
      } satisfies OwnerRequest);
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
    await Promise.all([...this.clientSockets].map(socket => this.writeQueues.get(socket)?.catch(() => undefined)));
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
      void this.handleSocketRequest(socket, value).catch(() => undefined);
    });
  }

  private async handleSocketRequest(socket: net.Socket, value: unknown): Promise<void> {
    if (!isOwnerRequest(value) || !this.root || path.resolve(value.root) !== path.resolve(this.root)) {
      await this.enqueueMessage(socket, errorResponse(String((value as { id?: unknown })?.id ?? ''), 'invalid_request', 'Invalid IPC request.'));
      return;
    }
    if (value.command === 'subscribe') {
      this.eventSockets.add(socket);
      await this.enqueueMessage(socket, { version: 1, event: 'subscribed', root: this.root } satisfies OwnerEvent);
      return;
    }
    if (this.releasing) {
      await this.enqueueMessage(socket, errorResponse(value.id, 'owner_releasing', 'Sync owner is shutting down.'));
      return;
    }
    try {
      const result = await this.runCommand(() => this.handler?.(value.command, value.args));
      await this.enqueueMessage(socket, { version: 1, id: value.id, ok: true, result } satisfies OwnerResponse);
    } catch (error) {
      await this.enqueueMessage(socket, errorResponse(value.id, 'owner_command_failed', formatUnknownError(error)));
    }
  }

  private runCommand<T>(operation: () => Promise<T> | undefined): Promise<T | undefined> {
    const current = this.commandQueue.catch(() => undefined).then(operation);
    this.commandQueue = current.then(() => undefined, () => undefined);
    return current;
  }

  private enqueueMessage(socket: net.Socket, value: unknown): Promise<void> {
    const previous = this.writeQueues.get(socket) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => writeMessageBounded(socket, value));
    this.writeQueues.set(socket, current);
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
    socket.once('connect', () => void writeMessageBounded(socket, request).catch(error => finish(error)));
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
  const chunks = new Map<string, { total: number; parts: Array<Buffer | undefined>; received: number }>();
  const accept = (value: unknown): void => {
    if (!isIpcChunk(value)) {
      onValue(value);
      return;
    }
    if (value.total <= 0 || value.total > Math.ceil(MAX_IPC_MESSAGE_BYTES / IPC_CHUNK_BYTES)
      || value.index < 0 || value.index >= value.total) {
      socket.destroy(new Error('Sync IPC chunk metadata is invalid.'));
      return;
    }
    const payload = Buffer.from(value.payload, 'base64');
    if (payload.length > IPC_CHUNK_BYTES || !value.payload || payload.toString('base64') !== value.payload) {
      socket.destroy(new Error('Sync IPC chunk payload is invalid.'));
      return;
    }
    let entry = chunks.get(value.id);
    if (!entry) {
      entry = { total: value.total, parts: Array.from({ length: value.total }), received: 0 };
      chunks.set(value.id, entry);
    }
    if (entry.total !== value.total || entry.parts[value.index]) {
      socket.destroy(new Error('Sync IPC chunk sequence is invalid.'));
      return;
    }
    entry.parts[value.index] = payload;
    entry.received += 1;
    if (entry.received !== entry.total) return;
    chunks.delete(value.id);
    try { onValue(JSON.parse(Buffer.concat(entry.parts as Buffer[]).toString('utf8'))); }
    catch { socket.destroy(new Error('Invalid JSON received over sync IPC.')); }
  };
  socket.on('data', chunk => {
    pending += chunk.toString('utf8');
    while (pending.includes('\n')) {
      const index = pending.indexOf('\n');
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_IPC_FRAME_BYTES) {
        socket.destroy(new Error('Sync IPC frame exceeded its limit.'));
        return;
      }
      if (!line.trim()) continue;
      try { accept(JSON.parse(line)); } catch { socket.destroy(new Error('Invalid JSON received over sync IPC.')); }
    }
    if (Buffer.byteLength(pending, 'utf8') > MAX_IPC_BUFFER_BYTES) {
      socket.destroy(new Error('Sync IPC receive buffer exceeded its limit.'));
    }
  });
}

function writeMessageBounded(socket: net.Socket, value: unknown): Promise<void> {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  if (encoded.length <= MAX_IPC_FRAME_BYTES) return writeFrame(socket, `${encoded.toString('utf8')}\n`);
  if (encoded.length > MAX_IPC_MESSAGE_BYTES) {
    return Promise.reject(new Error('Sync IPC message exceeded its limit.'));
  }
  const candidateId = (value as { id?: unknown })?.id;
  const id = typeof candidateId === 'string' ? candidateId : crypto.randomUUID();
  const total = Math.ceil(encoded.length / IPC_CHUNK_BYTES);
  return Array.from({ length: total }, (_, index) => encoded.subarray(index * IPC_CHUNK_BYTES, (index + 1) * IPC_CHUNK_BYTES))
    .reduce(
      (promise, payload, index) => promise.then(() => writeFrame(socket, `${JSON.stringify({
        version: 1, kind: 'chunk', id, index, total, payload: payload.toString('base64')
      } satisfies IpcChunk)}\n`)),
      Promise.resolve()
    );
}

function writeFrame(socket: net.Socket, line: string): Promise<void> {
  if (Buffer.byteLength(line, 'utf8') > MAX_IPC_FRAME_BYTES || socket.writableLength > MAX_IPC_BUFFER_BYTES) {
    socket.destroy(new Error('Sync IPC send queue exceeded its limit.'));
    return Promise.reject(new Error('Sync IPC send queue exceeded its limit.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.off('drain', onDrain);
      socket.off('error', onError);
      socket.off('close', onClose);
      error ? reject(error) : resolve();
    };
    const onDrain = (): void => finish();
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new Error('Sync IPC socket closed while writing.'));
    socket.once('error', onError);
    socket.once('close', onClose);
    let accepted = false;
    if (socket.destroyed || socket.writableEnded) {
      finish(new Error('Sync IPC socket is not writable.'));
      return;
    }
    try {
      accepted = socket.write(line, error => {
        if (error) finish(error);
        else if (accepted) finish();
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!accepted) socket.once('drain', onDrain);
  });
}

function isIpcChunk(value: unknown): value is IpcChunk {
  return Boolean(value) && typeof value === 'object'
    && (value as IpcChunk).version === 1
    && (value as IpcChunk).kind === 'chunk'
    && typeof (value as IpcChunk).id === 'string'
    && Number.isInteger((value as IpcChunk).index)
    && Number.isInteger((value as IpcChunk).total)
    && typeof (value as IpcChunk).payload === 'string';
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
