import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { runtimeRoot } from './sharedState';
import { readTextFileBounded } from './manifest';
import {
  currentHostIdentity,
  hostRecordFields,
  hostRelation,
  hostTag,
  localProcessMatches,
  type HostIdentity,
  type HostRelation
} from './hostIdentity';
import { formatUnknownError, isNetworkFileSystem, processStartSignature } from './util';

const MAX_IPC_FRAME_BYTES = 1024 * 1024;
const MAX_IPC_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_IPC_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_ACTIVE_IPC_CHUNKS = 64;
const IPC_CHUNK_BYTES = 512 * 1024;
const MAX_LOCK_RECORD_BYTES = 64 * 1024;

// The lock directory and its records live under runtimeRoot(), which on Linux is ~/.cache and so,
// on a cluster, an NFS share every login node mounts. Ownership is therefore a lease: the owner
// rewrites a heartbeat, a reader on another host judges it only by whether that heartbeat keeps
// changing on the reader's own clock, and the owner stops itself well before the lease could look
// expired to anyone else.
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_FENCE_MARGIN_MS = 15_000;
const DEFAULT_IO_TIMEOUT_MS = 5_000;
const DEFAULT_ASSUME_DEAD_AFTER_MS = 10 * 60_000;
// VS Code keeps a disconnected remote extension host running for up to three hours, and an owner
// from a version without heartbeats cannot be judged any other way.
const DEFAULT_LEGACY_STALE_MS = 3 * 60 * 60_000 + 10 * 60_000;
const DEFAULT_MISSING_METADATA_STALE_MS = 10_000;
const DEFAULT_TAKEOVER_POLL_MS = 1_000;
// A claimer slower than this between creating the lock and recording itself re-checks that the
// lock is still its own, since a reader may have judged the empty lock abandoned meanwhile.
const CLAIM_WRITE_BUDGET_MS = 5_000;
const DEMOTE_LISTENER_TIMEOUT_MS = 10_000;

/** Nonces of owners alive in this process, so a lock naming this PID can be told live from abandoned. */
const LIVE_OWNER_NONCES = new Set<string>();

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

export interface OwnerMetadata {
  version: 1 | 2;
  pid: number;
  root: string;
  socketPath: string;
  nonce: string;
  startedAt: string;
  processStart?: string;
  hostname?: string;
  bootId?: string;
  pidNamespace?: string;
  heartbeatMs?: number;
  leaseMs?: number;
}

interface HeartbeatRecord {
  version: 1;
  nonce: string;
  seq: number;
  at: string;
}

interface TakeoverRecord {
  version: 1;
  root: string;
  targetNonce: string;
  requestedAt: string;
  requester: { hostname: string; bootId?: string; pidNamespace?: string; pid: number; token: string };
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

export type SyncOwnerRole = 'owner' | 'client' | 'standby' | 'none';

/** Why this coordinator is not syncing although a mirror root is selected. */
export type SyncStandbyReason =
  | 'foreign-owner'
  | 'legacy-owner'
  | 'unreachable'
  | 'unknown'
  | 'takeover-pending'
  | 'takeover-timeout'
  | 'superseded'
  | 'takeover-requested'
  | 'lease-lost'
  | 'lock-lost';

/** Who holds (or is taking) sync ownership, as far as this host can tell. */
export interface SyncHolder {
  reason: SyncStandbyReason;
  hostname?: string;
  pid?: number;
  startedAt?: string;
  heartbeatAgeMs?: number;
  sameHost: boolean;
  legacy: boolean;
}

export interface SyncDemotion {
  root: string;
  reason: SyncStandbyReason;
  holder?: SyncHolder;
}

/** Thrown when an operation needs the sync owner but ownership is held on another host. */
export class SyncStandbyError extends Error {
  readonly code = 'SYNC_STANDBY';

  constructor(readonly holder?: SyncHolder) {
    super(describeSyncHolder(holder));
    this.name = 'SyncStandbyError';
  }
}

export interface ClaimOptions {
  /** Ask a live owner on another host to hand over, waiting up to `takeoverTimeoutMs`. */
  takeover?: boolean;
  /** With `takeover`, also displace an owner from an older version, which cannot be asked. */
  forceLegacy?: boolean;
  signal?: AbortSignal;
}

export interface SyncOwnerCoordinatorOptions {
  ownerStartupTimeoutMs?: number;
  retryDelayMs?: number;
  connectTimeoutMs?: number;
  subscriptionTimeoutMs?: number;
  missingMetadataStaleMs?: number;
  heartbeatMs?: number;
  leaseMs?: number;
  /** The owner steps down once this much of the lease has passed without a successful renewal. */
  fenceMarginMs?: number;
  ioTimeoutMs?: number;
  assumeDeadAfterMs?: number;
  legacyStaleMs?: number;
  takeoverTimeoutMs?: number;
  takeoverPollMs?: number;
  host?: HostIdentity;
  /** Directory for the owner socket; defaults to $XDG_RUNTIME_DIR, then the runtime root. */
  socketDirectory?: string;
  /** Whether other machines share the runtime root; detected from its filesystem by default. */
  runtimeRootIsShared?: boolean;
  /** Replaces the heartbeat write (tests use it to inject NFS failures and hangs). */
  heartbeatWrite?: (lockPath: string, nonce: string, seq: number, at: number) => Promise<void>;
  now?: () => number;
  monotonicNow?: () => number;
  log?: (message: string) => void;
}

export interface RuntimePaths {
  hash: string;
  lockPath: string;
  metadataPath: string;
  takeoverPath: string;
  socketPath: string;
}

export interface OwnerInspection {
  reachable: boolean;
  metadata?: OwnerMetadata;
  holder?: {
    hostname?: string;
    pid?: number;
    relation: HostRelation;
    heartbeatAgeMs?: number;
  };
  takeoverRequested: boolean;
  lockPath: string;
  socketPath: string;
}

type OwnerLiveness = 'live-local' | 'live-foreign' | 'live-legacy' | 'stale' | 'unknown';

interface LockState {
  exists: boolean;
  lockMtimeMs?: number;
  metadata?: OwnerMetadata;
  heartbeat?: HeartbeatRecord;
  /** A read failed for a reason that says nothing about the lock (NFS EIO/ESTALE, timeout). */
  unreadable?: boolean;
}

interface Lease {
  paths: RuntimePaths;
  nonce: string;
  seq: number;
  renewedMono: number;
  renewedWall: number;
  timer?: NodeJS.Timeout;
  pending?: Promise<void>;
  failures: number;
  lockMissing: number;
}

type RenewalOutcome =
  | { kind: 'renewed' }
  | { kind: 'lock-missing' }
  | { kind: 'demote'; reason: SyncStandbyReason; holder?: SyncHolder };

type JsonRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'error'; error: unknown };

export class SyncOwnerCoordinator {
  /** The mirror's real path: what the lock is keyed by and what IPC messages carry. */
  private root?: string;
  /** The mirror path as the caller named it, which may go through a symlink. */
  private requestedRoot?: string;
  private metadata?: OwnerMetadata;
  private server?: net.Server;
  private handler?: OwnerHandler;
  private mode: SyncOwnerRole = 'none';
  private standbyHolder?: SyncHolder;
  private ownerSocketPath?: string;
  private lease?: Lease;
  private demoting?: Promise<void>;
  private legacyIsLocal?: boolean;
  private readonly observations = new Map<string, { key: string; since: number }>();
  private readonly demoteListeners = new Set<(event: SyncDemotion) => void | Promise<void>>();
  private clientSockets = new Set<net.Socket>();
  private subscriberSockets = new Set<net.Socket>();
  private eventSockets = new Set<net.Socket>();
  private readonly writeQueues = new WeakMap<net.Socket, Promise<void>>();
  private commandQueue: Promise<unknown> = Promise.resolve();
  private releasing = false;
  private readonly host: HostIdentity;
  private readonly heartbeatMs: number;
  private readonly leaseMs: number;
  private readonly fenceMarginMs: number;
  private readonly ioTimeoutMs: number;
  private readonly takeoverTimeoutMs: number;

  constructor(private readonly options: SyncOwnerCoordinatorOptions = {}) {
    this.host = options.host ?? currentHostIdentity();
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.fenceMarginMs = options.fenceMarginMs ?? DEFAULT_FENCE_MARGIN_MS;
    this.ioTimeoutMs = options.ioTimeoutMs ?? DEFAULT_IO_TIMEOUT_MS;
    this.takeoverTimeoutMs = options.takeoverTimeoutMs ?? this.leaseMs + 2 * this.heartbeatMs + 5_000;
    // The owner must fit several renewal attempts inside the part of the lease it may use, and give
    // up on a stuck write before that part runs out.
    if (3 * this.heartbeatMs > this.leaseMs - this.fenceMarginMs || this.ioTimeoutMs >= this.fenceMarginMs) {
      throw new Error('Sync owner lease timing is inconsistent: need 3 x heartbeat <= lease - margin and I/O timeout < margin.');
    }
  }

  get isOwner(): boolean {
    return this.mode === 'owner';
  }

  /** The selected mirror, as the caller named it in claim(). */
  get currentRoot(): string | undefined {
    return this.root ? this.requestedRoot : undefined;
  }

  get role(): SyncOwnerRole {
    return this.mode;
  }

  /** Who holds ownership while this coordinator is in standby. */
  get holder(): SyncHolder | undefined {
    return this.mode === 'standby' ? this.standbyHolder : undefined;
  }

  /**
   * Called when this owner loses ownership on its own: superseded, asked to hand over, or unable to
   * renew its lease. Listeners must stop syncing before they resolve; the lock is handed over only
   * after they finish (or after a bounded wait).
   */
  onDidDemote(listener: (event: SyncDemotion) => void | Promise<void>): () => void {
    this.demoteListeners.add(listener);
    return () => this.demoteListeners.delete(listener);
  }

  async claim(root: string, handler: OwnerHandler, options: ClaimOptions = {}): Promise<'owner' | 'client' | 'standby'> {
    await this.release();
    try {
      return await this.claimInner(root, handler, options);
    } catch (error) {
      // A failed claim must not leave the coordinator advertising a root it does not own: callers
      // read currentRoot to decide they are a client of an owner that, here, never started - which
      // strands the window with no owner and no retry.
      this.handler = undefined;
      this.root = undefined;
      this.requestedRoot = undefined;
      this.mode = 'none';
      this.standbyHolder = undefined;
      this.ownerSocketPath = undefined;
      throw error;
    }
  }

  private async claimInner(root: string, handler: OwnerHandler, options: ClaimOptions): Promise<'owner' | 'client' | 'standby'> {
    this.requestedRoot = path.resolve(root);
    this.root = await fs.realpath(this.requestedRoot).catch(() => this.requestedRoot!);
    this.handler = handler;
    const paths = runtimePaths(this.root, { socketDirectory: this.options.socketDirectory, host: this.host });
    await fs.mkdir(runtimeRoot(), { recursive: true, mode: 0o700 });
    await fs.chmod(runtimeRoot(), 0o700).catch(() => undefined);
    const socketPath = await this.prepareSocketPath(paths.hash);
    // A record from a version without host fields can only be trusted to be local when the lock
    // directory is not shared with other machines.
    this.legacyIsLocal ??= this.options.runtimeRootIsShared !== undefined
      ? !this.options.runtimeRootIsShared
      : !await isNetworkFileSystem(runtimeRoot());
    const connectTimeoutMs = this.options.connectTimeoutMs ?? 200;
    const deadline = this.mono() + (options.takeover ? this.takeoverTimeoutMs : this.options.ownerStartupTimeoutMs ?? 3_000);
    let reservation: { token: string; targetNonce: string } | undefined;
    let last: LockState | undefined;
    let lastLiveness: OwnerLiveness = 'unknown';
    try {
      while (true) {
        throwIfAborted(options.signal);
        if (await canConnect(socketPath, connectTimeoutMs)) return this.becomeClient(socketPath);
        const takeover = await this.readTakeover(paths);
        if (takeover && this.takeoverIsFresh(takeover) && takeover.requester.token !== reservation?.token) {
          // Another claimer asked the owner to hand over; the lock is promised to it.
          return this.enterStandby(this.holderFromTakeover(takeover, 'takeover-pending'));
        }
        if (await tryCreateDirectory(paths.lockPath)) {
          await this.publish(paths, socketPath);
          return 'owner';
        }
        const state = await this.readLockState(paths);
        if (!state.exists) continue;
        const liveness = await this.classify(paths.lockPath, state);
        last = state;
        lastLiveness = liveness;
        if (liveness === 'stale') {
          if (await this.reclaim(paths, state.metadata?.nonce)) continue;
        } else if (liveness === 'live-local') {
          const recorded = state.metadata?.socketPath;
          if (recorded && recorded !== socketPath && path.basename(recorded).startsWith(paths.hash)
            && await canConnect(recorded, connectTimeoutMs)) {
            return this.becomeClient(recorded);
          }
        } else if (liveness === 'live-foreign' || liveness === 'live-legacy') {
          const legacy = liveness === 'live-legacy';
          if (!options.takeover || (legacy && !options.forceLegacy)) {
            return this.enterStandby(this.holderFrom(state, legacy ? 'legacy-owner' : 'foreign-owner'));
          }
          if (legacy) {
            // An older version cannot be asked to hand over; the caller confirmed displacing it.
            if (await this.reclaim(paths, state.metadata?.nonce, true)) continue;
          } else if (state.metadata && reservation?.targetNonce !== state.metadata.nonce) {
            if (reservation) await this.withdrawTakeover(paths, reservation.token).catch(() => undefined);
            reservation = { token: await this.requestTakeover(paths, state.metadata.nonce), targetNonce: state.metadata.nonce };
            this.options.log?.(`Asked ${describeHolderLocation(this.holderFrom(state, 'foreign-owner'))} to hand over Overleaf sync for ${this.root}.`);
          }
        }
        if (this.mono() >= deadline) {
          const reason: SyncStandbyReason = options.takeover ? 'takeover-timeout'
            : lastLiveness === 'live-local' ? 'unreachable' : 'unknown';
          return this.enterStandby(last ? this.holderFrom(last, reason) : { reason, sameHost: false, legacy: false });
        }
        await delay(options.takeover ? this.options.takeoverPollMs ?? DEFAULT_TAKEOVER_POLL_MS : this.options.retryDelayMs ?? 50);
      }
    } finally {
      if (reservation) await this.withdrawTakeover(paths, reservation.token).catch(() => undefined);
    }
  }

  async request(command: string, args: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
    if (!this.root) throw new Error('No sync root is selected.');
    if (this.mode === 'standby') throw new SyncStandbyError(this.standbyHolder);
    if (this.mode === 'owner' && this.handler) {
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
    return sendRequest(this.clientSocketPath(), request, timeoutMs);
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
  }


  async subscribe(
    onEvent: (event: OwnerEvent) => void,
    timeoutMs = this.options.subscriptionTimeoutMs ?? 5_000
  ): Promise<net.Socket> {
    if (!this.root) throw new Error('No sync root is selected.');
    if (this.mode === 'standby') throw new SyncStandbyError(this.standbyHolder);
    const socket = net.createConnection(this.clientSocketPath());
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
    await this.demoting?.catch(() => undefined);
    const lease = this.lease;
    this.stopLease();
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
    if (this.metadata && lease) {
      LIVE_OWNER_NONCES.delete(this.metadata.nonce);
      // Delete the lock only while the lease still guarantees nobody else took it over.
      if (this.leaseElapsedMs(lease) < this.leaseMs - this.fenceMarginMs) {
        const current = await withTimeout(readJsonFile<OwnerMetadata>(lease.paths.metadataPath), this.ioTimeoutMs, 'owner record read')
          .catch(() => undefined);
        if (current?.status === 'ok' && current.value.nonce === this.metadata.nonce) {
          await fs.rm(this.metadata.socketPath, { force: true }).catch(() => undefined);
          await retireLockDirectory(lease.paths.lockPath).catch(() => undefined);
        }
      }
    }
    this.metadata = undefined;
    this.handler = undefined;
    this.root = undefined;
    this.requestedRoot = undefined;
    this.mode = 'none';
    this.standbyHolder = undefined;
    this.ownerSocketPath = undefined;
    this.releasing = false;
  }

  private becomeClient(socketPath: string): 'client' {
    this.ownerSocketPath = socketPath;
    this.mode = 'client';
    return 'client';
  }

  private enterStandby(holder: SyncHolder): 'standby' {
    this.mode = 'standby';
    this.standbyHolder = holder;
    this.ownerSocketPath = undefined;
    return 'standby';
  }

  private clientSocketPath(): string {
    return this.ownerSocketPath
      ?? runtimePaths(this.root!, { socketDirectory: this.options.socketDirectory, host: this.host }).socketPath;
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
    if (this.releasing || this.mode !== 'owner') {
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

  private async prepareSocketPath(hash: string): Promise<string> {
    for (const candidate of socketDirectoryCandidates(this.options.socketDirectory)) {
      const socketPath = socketPathFor(hash, candidate, this.host);
      if (await ensurePrivateDirectory(path.dirname(socketPath))) return socketPath;
    }
    throw new Error('No private directory is available for the Overleaf sync owner socket.');
  }

  /** Creates the owner record, starts the heartbeat, and opens the socket for this host's clients. */
  private async publish(paths: RuntimePaths, socketPath: string): Promise<void> {
    const startedMono = this.mono();
    const metadata: OwnerMetadata = {
      version: 2,
      pid: process.pid,
      root: this.root!,
      socketPath,
      nonce: crypto.randomBytes(16).toString('hex'),
      startedAt: new Date(this.now()).toISOString(),
      processStart: await processStartSignature(process.pid),
      ...hostRecordFields(this.host),
      heartbeatMs: this.heartbeatMs,
      leaseMs: this.leaseMs
    };
    let server: net.Server | undefined;
    try {
      await withTimeout(
        fs.writeFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' }),
        this.ioTimeoutMs,
        'Writing the sync owner record timed out'
      );
      const renewedMono = this.mono();
      const renewedWall = this.now();
      await withTimeout(writeHeartbeat(paths.lockPath, metadata.nonce, 0, renewedWall), this.ioTimeoutMs, 'Writing the sync owner heartbeat timed out');
      if (this.mono() - startedMono > CLAIM_WRITE_BUDGET_MS) {
        const current = await readJsonFile<OwnerMetadata>(paths.metadataPath);
        if (current.status !== 'ok' || current.value.nonce !== metadata.nonce) {
          throw new Error('Lost the sync owner lock while publishing it.');
        }
      }
      await fs.rm(socketPath, { force: true });
      server = net.createServer(socket => this.accept(socket));
      await listen(server, socketPath);
      await fs.chmod(socketPath, 0o600).catch(() => undefined);
      if (!await canConnect(socketPath, this.options.connectTimeoutMs ?? 200)) {
        throw new Error('Sync owner socket did not become reachable after startup.');
      }
      this.server = server;
      this.metadata = metadata;
      this.mode = 'owner';
      LIVE_OWNER_NONCES.add(metadata.nonce);
      this.lease = { paths, nonce: metadata.nonce, seq: 0, renewedMono, renewedWall, failures: 0, lockMissing: 0 };
      this.scheduleTick(this.heartbeatMs);
    } catch (error) {
      if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
      const current = await readJsonFile<OwnerMetadata>(paths.metadataPath).catch(() => undefined);
      if (!current || current.status !== 'ok' || current.value.nonce === metadata.nonce) {
        await retireLockDirectory(paths.lockPath).catch(() => undefined);
      }
      await fs.rm(socketPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private scheduleTick(delayMs: number): void {
    const lease = this.lease;
    if (!lease) return;
    if (lease.timer) clearTimeout(lease.timer);
    lease.timer = setTimeout(() => this.tick(lease), delayMs);
    lease.timer.unref?.();
  }

  /**
   * One heartbeat. The fence check runs on every tick, even while an earlier renewal is stuck on a
   * hung NFS call; a new renewal starts only once the previous one has settled, so stuck calls
   * never pile up on the I/O thread pool.
   */
  private tick(lease: Lease): void {
    if (this.lease !== lease || this.mode !== 'owner') return;
    if (this.leaseElapsedMs(lease) >= this.leaseMs - this.fenceMarginMs) {
      void this.demote('lease-lost');
      return;
    }
    if (!lease.pending) {
      const startedMono = this.mono();
      const startedWall = this.now();
      const operation = this.renew(lease, startedWall);
      const settled = operation.then(() => undefined, () => undefined);
      lease.pending = settled;
      void settled.then(() => {
        if (lease.pending === settled) lease.pending = undefined;
      });
      void withTimeout(operation, this.ioTimeoutMs, 'Sync owner heartbeat timed out').then(
        outcome => this.onRenewal(lease, outcome, startedMono, startedWall),
        error => this.onRenewalFailure(lease, error)
      );
    }
    this.scheduleTick(this.heartbeatMs);
  }

  private async renew(lease: Lease, at: number): Promise<RenewalOutcome> {
    const owner = await readJsonFile<OwnerMetadata>(lease.paths.metadataPath);
    if (owner.status === 'missing') {
      const lockExists = await fs.stat(lease.paths.lockPath).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (!lockExists) return { kind: 'lock-missing' };
      throw new Error('The sync owner record is missing from its lock.');
    }
    if (owner.status === 'error') throw owner.error;
    if (owner.status === 'invalid' || !isOwnerMetadata(owner.value)) throw new Error('The sync owner record is unreadable.');
    if (owner.value.nonce !== lease.nonce) {
      return { kind: 'demote', reason: 'superseded', holder: this.holderFrom({ exists: true, metadata: owner.value }, 'superseded') };
    }
    const takeover = await this.readTakeover(lease.paths);
    if (takeover && takeover.targetNonce === lease.nonce && this.takeoverIsFresh(takeover)) {
      return { kind: 'demote', reason: 'takeover-requested', holder: this.holderFromTakeover(takeover, 'takeover-requested') };
    }
    await (this.options.heartbeatWrite ?? writeHeartbeat)(lease.paths.lockPath, lease.nonce, lease.seq + 1, at);
    return { kind: 'renewed' };
  }

  private onRenewal(lease: Lease, outcome: RenewalOutcome, startedMono: number, startedWall: number): void {
    if (this.lease !== lease || this.mode !== 'owner') return;
    if (outcome.kind === 'renewed') {
      lease.seq += 1;
      // The renewal counts from when it started: a reader may not have seen it any earlier.
      lease.renewedMono = startedMono;
      lease.renewedWall = startedWall;
      if (lease.failures) this.options.log?.(`Sync owner heartbeat recovered after ${lease.failures} failed attempt(s).`);
      lease.failures = 0;
      lease.lockMissing = 0;
      return;
    }
    if (outcome.kind === 'lock-missing') {
      lease.lockMissing += 1;
      if (lease.lockMissing >= 2) void this.demote('lock-lost');
      else this.scheduleTick(Math.min(250, this.heartbeatMs));
      return;
    }
    void this.demote(outcome.reason, outcome.holder);
  }

  private onRenewalFailure(lease: Lease, error: unknown): void {
    if (this.lease !== lease || this.mode !== 'owner') return;
    lease.failures += 1;
    if (lease.failures === 1 || lease.failures % 3 === 0) {
      this.options.log?.(`Sync owner heartbeat failed (attempt ${lease.failures}): ${formatUnknownError(error)}`);
    }
    // Retry sooner than the regular beat, but only time - the fence - ever demotes.
    this.scheduleTick(Math.min(this.heartbeatMs, 1_000 * 2 ** Math.min(lease.failures - 1, 2)));
  }

  private stopLease(): void {
    if (this.lease?.timer) clearTimeout(this.lease.timer);
    this.lease = undefined;
  }

  private leaseElapsedMs(lease: Lease): number {
    // Wall-clock time also counts, so a suspended process (laptop sleep, VM pause) cannot resume
    // believing its lease is fresh.
    return Math.max(this.mono() - lease.renewedMono, this.now() - lease.renewedWall);
  }

  /** Stops acting as owner: listeners stop the sync engine first, then the lock is let go. */
  private demote(reason: SyncStandbyReason, holder?: SyncHolder): Promise<void> {
    if (this.demoting) return this.demoting;
    const lease = this.lease;
    const metadata = this.metadata;
    const root = this.requestedRoot ?? this.root;
    if (this.mode !== 'owner' || !lease || !metadata || !root) return Promise.resolve();
    this.demoting = (async () => {
      this.stopLease();
      LIVE_OWNER_NONCES.delete(metadata.nonce);
      const standby: SyncHolder = { ...(holder ?? { sameHost: false, legacy: false }), reason };
      this.mode = 'standby';
      this.standbyHolder = standby;
      this.options.log?.(`Sync owner for ${root} stepped down: ${describeSyncHolder(standby)}`);
      const event: SyncDemotion = { root, reason, holder: standby };
      await Promise.race([
        Promise.allSettled([...this.demoteListeners].map(listener => Promise.resolve().then(() => listener(event)))),
        delay(DEMOTE_LISTENER_TIMEOUT_MS)
      ]);
      const notices = [...this.eventSockets].map(socket => this.enqueueMessage(socket, {
        version: 1, event: 'owner-demoted', root, data: { reason, holder: standby }
      } satisfies OwnerEvent).catch(() => undefined));
      await Promise.race([Promise.allSettled(notices), delay(200)]);
      const server = this.server;
      this.server = undefined;
      for (const socket of this.clientSockets) socket.destroy();
      this.clientSockets.clear();
      this.eventSockets.clear();
      if (server) await new Promise<void>(resolve => server.close(() => resolve()));
      if (reason === 'takeover-requested' && this.leaseElapsedMs(lease) < this.leaseMs - this.fenceMarginMs) {
        const current = await withTimeout(readJsonFile<OwnerMetadata>(lease.paths.metadataPath), this.ioTimeoutMs, 'owner record read')
          .catch(() => undefined);
        if (current?.status === 'ok' && current.value.nonce === metadata.nonce) {
          await retireLockDirectory(lease.paths.lockPath).catch(() => undefined);
        }
      }
      this.metadata = undefined;
    })().finally(() => {
      this.demoting = undefined;
    });
    return this.demoting;
  }

  private async readLockState(paths: RuntimePaths): Promise<LockState> {
    const io = <T>(operation: Promise<T>): Promise<T> => withTimeout(operation, this.ioTimeoutMs, 'Reading the sync owner lock timed out');
    let lockMtimeMs: number;
    try {
      lockMtimeMs = (await io(fs.stat(paths.lockPath))).mtimeMs;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { exists: false } : { exists: true, unreadable: true };
    }
    const owner = await io(readJsonFile<OwnerMetadata>(paths.metadataPath)).catch((error: unknown) => ({ status: 'error' as const, error }));
    if (owner.status === 'error') return { exists: true, lockMtimeMs, unreadable: true };
    // A missing or half-written record is judged by the lock directory's age, which every live
    // owner keeps fresh by renaming its heartbeat into it.
    if (owner.status !== 'ok' || !isOwnerMetadata(owner.value)) return { exists: true, lockMtimeMs };
    const metadata = owner.value;
    if (metadata.version < 2) return { exists: true, lockMtimeMs, metadata };
    const beat = await io(readJsonFile<HeartbeatRecord>(heartbeatPath(paths.lockPath, metadata.nonce)))
      .catch((error: unknown) => ({ status: 'error' as const, error }));
    if (beat.status === 'error') return { exists: true, lockMtimeMs, metadata, unreadable: true };
    return beat.status === 'ok' && isHeartbeat(beat.value, metadata.nonce)
      ? { exists: true, lockMtimeMs, metadata, heartbeat: beat.value }
      : { exists: true, lockMtimeMs, metadata };
  }

  private async classify(lockPath: string, state: LockState): Promise<OwnerLiveness> {
    if (state.unreadable) return 'unknown';
    const metadata = state.metadata;
    if (!metadata) {
      const age = state.lockMtimeMs === undefined ? 0 : this.now() - state.lockMtimeMs;
      return age >= (this.options.missingMetadataStaleMs ?? DEFAULT_MISSING_METADATA_STALE_MS) ? 'stale' : 'unknown';
    }
    const relation = hostRelation(metadata, this.host);
    if (relation === 'same' || (relation === 'legacy' && this.legacyIsLocal)) {
      if (metadata.pid === process.pid) return LIVE_OWNER_NONCES.has(metadata.nonce) ? 'live-local' : 'stale';
      return await localProcessMatches(metadata.pid, metadata.processStart) ? 'live-local' : 'stale';
    }
    if (relation === 'legacy') {
      if (await localProcessMatches(metadata.pid, metadata.processStart)) return 'live-local';
      return this.observedUnchanged(lockPath, `legacy:${metadata.nonce}`, this.options.legacyStaleMs ?? DEFAULT_LEGACY_STALE_MS)
        ? 'stale' : 'live-legacy';
    }
    const beatAt = Date.parse(state.heartbeat?.at ?? metadata.startedAt);
    const age = Number.isFinite(beatAt) ? this.now() - beatAt : Number.POSITIVE_INFINITY;
    const lease = Math.max(typeof metadata.leaseMs === 'number' ? metadata.leaseMs : 0, this.leaseMs);
    if (relation === 'rebooted') return age > lease ? 'stale' : 'live-foreign';
    const unchangedMs = this.unchangedFor(lockPath, `${metadata.nonce}:${state.heartbeat?.seq ?? -1}`);
    if (unchangedMs >= lease) return 'stale';
    // A heartbeat that is very old by the clock is dead once it is also seen standing still for a
    // couple of beats; requiring both keeps a badly skewed clock from ever stealing a live lock.
    const beat = typeof metadata.heartbeatMs === 'number' ? metadata.heartbeatMs : this.heartbeatMs;
    return age > (this.options.assumeDeadAfterMs ?? DEFAULT_ASSUME_DEAD_AFTER_MS) && unchangedMs >= 2 * beat
      ? 'stale' : 'live-foreign';
  }

  /** Whether `key` has stayed the same for `windowMs` of this process's own monotonic time. */
  private observedUnchanged(lockPath: string, key: string, windowMs: number): boolean {
    return this.unchangedFor(lockPath, key) >= windowMs;
  }

  /** How long this process has seen `key` for the lock unchanged, on its own monotonic clock. */
  private unchangedFor(lockPath: string, key: string): number {
    const now = this.mono();
    const seen = this.observations.get(lockPath);
    if (!seen || seen.key !== key) {
      this.observations.set(lockPath, { key, since: now });
      return 0;
    }
    return now - seen.since;
  }

  private async reclaim(paths: RuntimePaths, expectedNonce: string | undefined, force = false): Promise<boolean> {
    const guardPath = `${paths.lockPath}.reclaim`;
    if (!await acquireReclaimGuard(
      guardPath,
      Math.max((this.options.ownerStartupTimeoutMs ?? 3_000) * 2, 10_000)
    )) return false;
    try {
      const state = await this.readLockState(paths);
      if (!state.exists) return true;
      if (state.unreadable || state.metadata?.nonce !== expectedNonce) return false;
      if (!force && await this.classify(paths.lockPath, state) !== 'stale') return false;
      // Never touch the socket a record names: it may be another host's, or a successor's.
      await retireLockDirectory(paths.lockPath);
      this.observations.delete(paths.lockPath);
      return true;
    } finally {
      await fs.rm(guardPath, { recursive: true, force: true });
    }
  }

  private async readTakeover(paths: RuntimePaths): Promise<TakeoverRecord | undefined> {
    const read = await withTimeout(readJsonFile<TakeoverRecord>(paths.takeoverPath), this.ioTimeoutMs, 'takeover read')
      .catch(() => undefined);
    return read?.status === 'ok' && isTakeoverRecord(read.value) ? read.value : undefined;
  }

  private takeoverIsFresh(record: TakeoverRecord): boolean {
    const requestedAt = Date.parse(record.requestedAt);
    return Number.isFinite(requestedAt) && this.now() - requestedAt < this.takeoverTimeoutMs + this.heartbeatMs;
  }

  private async requestTakeover(paths: RuntimePaths, targetNonce: string): Promise<string> {
    const token = crypto.randomBytes(16).toString('hex');
    const record: TakeoverRecord = {
      version: 1,
      root: this.root!,
      targetNonce,
      requestedAt: new Date(this.now()).toISOString(),
      requester: { ...hostRecordFields(this.host), pid: process.pid, token }
    };
    const temporary = `${paths.takeoverPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    try {
      await fs.rename(temporary, paths.takeoverPath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return token;
  }

  private async withdrawTakeover(paths: RuntimePaths, token: string): Promise<void> {
    const record = await this.readTakeover(paths);
    if (record?.requester.token === token) await fs.rm(paths.takeoverPath, { force: true });
  }

  private holderFrom(state: LockState, reason: SyncStandbyReason): SyncHolder {
    const metadata = state.metadata;
    if (!metadata) return { reason, sameHost: false, legacy: false };
    const relation = hostRelation(metadata, this.host);
    const beatAt = Date.parse(state.heartbeat?.at ?? metadata.startedAt);
    return {
      reason,
      ...(metadata.hostname ? { hostname: metadata.hostname } : relation === 'same' ? { hostname: this.host.hostname } : {}),
      pid: metadata.pid,
      startedAt: metadata.startedAt,
      ...(Number.isFinite(beatAt) ? { heartbeatAgeMs: Math.max(0, this.now() - beatAt) } : {}),
      sameHost: relation === 'same',
      legacy: relation === 'legacy'
    };
  }

  private holderFromTakeover(record: TakeoverRecord, reason: SyncStandbyReason): SyncHolder {
    return {
      reason,
      hostname: record.requester.hostname,
      pid: record.requester.pid,
      sameHost: hostRelation(record.requester, this.host) === 'same',
      legacy: false
    };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private mono(): number {
    return this.options.monotonicNow?.() ?? performance.now();
  }
}

export function describeSyncHolder(holder?: SyncHolder): string {
  const where = describeHolderLocation(holder);
  switch (holder?.reason) {
    case 'takeover-pending':
      return `${where} is taking over Overleaf sync for this mirror; sync is paused here.`;
    case 'takeover-timeout':
      return `${where} did not hand over Overleaf sync in time; sync is paused here.`;
    case 'legacy-owner':
      return `An older version of the extension on ${where} is syncing this mirror; sync is paused here.`;
    case 'unreachable':
      return `${where} holds Overleaf sync for this mirror but is not responding; sync is paused here.`;
    case 'superseded':
    case 'takeover-requested':
      return `Overleaf sync for this mirror moved to ${where}; sync is paused here.`;
    case 'lease-lost':
      return 'Overleaf sync stopped here because its lock could not be renewed in time (is the home directory reachable?).';
    case 'lock-lost':
      return 'Overleaf sync stopped here because its lock was removed.';
    case 'unknown':
      return 'Overleaf sync for this mirror is held elsewhere and its lock could not be read; sync is paused here.';
    default:
      return `Overleaf sync for this mirror is running on ${where}; sync is paused here.`;
  }
}

function describeHolderLocation(holder?: SyncHolder): string {
  if (holder?.sameHost) return 'another window on this machine';
  const host = holder?.hostname ?? 'another machine';
  return holder?.pid ? `${host} (pid ${holder.pid})` : host;
}

interface SocketDirectoryCandidate {
  directory: string;
  /** Whether other machines may see the directory, so socket names must carry the host. */
  shared: boolean;
}

/**
 * Where the owner socket may live, best first. AF_UNIX sockets only work within one host, so a
 * host-local directory (VS Code itself uses $XDG_RUNTIME_DIR) beats the runtime root, which on
 * Linux sits under ~/.cache and may be an NFS share.
 */
function socketDirectoryCandidates(explicit?: string): SocketDirectoryCandidate[] {
  if (explicit) return [{ directory: path.resolve(explicit), shared: false }];
  const candidates: SocketDirectoryCandidate[] = [];
  if (process.env.LATEX_TOOLKIT_SOCKET_HOME) {
    candidates.push({ directory: path.resolve(process.env.LATEX_TOOLKIT_SOCKET_HOME), shared: false });
  }
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime && path.isAbsolute(xdgRuntime)) {
    candidates.push({ directory: path.join(xdgRuntime, 'latex-editing-toolkit'), shared: false });
  }
  candidates.push({ directory: runtimeRoot(), shared: process.platform !== 'darwin' });
  return candidates;
}

function socketPathFor(hash: string, candidate: SocketDirectoryCandidate, host: HostIdentity): string {
  const name = candidate.shared ? `${hash}.${hostTag(host)}` : hash;
  const socketPath = path.join(candidate.directory, name);
  // sun_path holds 108 bytes on Linux and 104 on macOS, including the terminating NUL.
  const limit = process.platform === 'darwin' ? 103 : 107;
  return Buffer.byteLength(socketPath) <= limit
    ? socketPath
    : path.join('/tmp', `latex-toolkit-${process.getuid?.() ?? 'user'}`, name);
}

export function runtimePaths(
  root: string,
  options: { socketDirectory?: string; host?: HostIdentity } = {}
): RuntimePaths {
  const hash = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 32);
  const lockPath = path.join(runtimeRoot(), `${hash}.lock`);
  return {
    hash,
    lockPath,
    metadataPath: path.join(lockPath, 'owner.json'),
    takeoverPath: path.join(runtimeRoot(), `${hash}.takeover.json`),
    socketPath: socketPathFor(hash, socketDirectoryCandidates(options.socketDirectory)[0], options.host ?? currentHostIdentity())
  };
}

export async function inspectOwner(root: string): Promise<OwnerInspection> {
  const resolved = await fs.realpath(path.resolve(root)).catch(() => path.resolve(root));
  const paths = runtimePaths(resolved);
  const owner = await readJsonFile<OwnerMetadata>(paths.metadataPath).catch(() => undefined);
  const metadata = owner?.status === 'ok' && isOwnerMetadata(owner.value) ? owner.value : undefined;
  const beat = metadata && metadata.version >= 2
    ? await readJsonFile<HeartbeatRecord>(heartbeatPath(paths.lockPath, metadata.nonce)).catch(() => undefined)
    : undefined;
  const beatAt = Date.parse(beat?.status === 'ok' ? beat.value.at : metadata?.startedAt ?? '');
  const relation = metadata ? hostRelation(metadata) : undefined;
  const takeover = await readJsonFile<TakeoverRecord>(paths.takeoverPath).catch(() => undefined);
  const recordedSocket = metadata && relation !== 'foreign' && relation !== 'rebooted' ? metadata.socketPath : undefined;
  return {
    reachable: await canConnect(recordedSocket ?? paths.socketPath),
    ...(metadata ? { metadata } : {}),
    ...(metadata && relation ? {
      holder: {
        ...(metadata.hostname ? { hostname: metadata.hostname } : {}),
        pid: metadata.pid,
        relation,
        ...(Number.isFinite(beatAt) ? { heartbeatAgeMs: Math.max(0, Date.now() - beatAt) } : {})
      }
    } : {}),
    takeoverRequested: takeover?.status === 'ok' && isTakeoverRecord(takeover.value),
    lockPath: paths.lockPath,
    socketPath: paths.socketPath
  };
}

function heartbeatPath(lockPath: string, nonce: string): string {
  return path.join(lockPath, `heartbeat-${nonce}.json`);
}

/**
 * Replaces the heartbeat without ever creating directories: if a successor has retired this lock,
 * the write must fail rather than resurrect it.
 */
async function writeHeartbeat(lockPath: string, nonce: string, seq: number, at: number): Promise<void> {
  const target = heartbeatPath(lockPath, nonce);
  const temporary = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const record: HeartbeatRecord = { version: 1, nonce, seq, at: new Date(at).toISOString() };
  await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Moves a lock out of the way atomically, so a concurrent reader never sees it half-deleted. */
async function retireLockDirectory(lockPath: string): Promise<void> {
  const retired = `${lockPath}.retired-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.rename(lockPath, retired);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await fs.rm(retired, { recursive: true, force: true }).catch(() => undefined);
}

async function tryCreateDirectory(target: string): Promise<boolean> {
  try {
    await fs.mkdir(target, { mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Makes `directory` a private directory of this user, refusing symlinks and directories owned by
 * someone else (a predictable /tmp path could otherwise be pre-created by another user).
 */
async function ensurePrivateDirectory(directory: string): Promise<boolean> {
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    let stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) return false;
    if ((stat.mode & 0o077) !== 0) {
      await fs.chmod(directory, 0o700);
      stat = await fs.lstat(directory);
      if ((stat.mode & 0o077) !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function listen(server: net.Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

async function readJsonFile<T>(target: string): Promise<JsonRead<T>> {
  let raw: string;
  try {
    raw = await readTextFileBounded(target, MAX_LOCK_RECORD_BYTES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return { status: 'error', error };
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) as T };
  } catch {
    return { status: 'invalid' };
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'ETIMEDOUT' })), timeoutMs);
    operation.then(
      value => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Operation cancelled.');
}

function isOwnerMetadata(value: unknown): value is OwnerMetadata {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OwnerMetadata>;
  return (record.version === 1 || record.version === 2)
    && typeof record.pid === 'number'
    && typeof record.nonce === 'string'
    && typeof record.socketPath === 'string'
    && typeof record.startedAt === 'string';
}

function isHeartbeat(value: unknown, nonce: string): value is HeartbeatRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<HeartbeatRecord>;
  return record.nonce === nonce && typeof record.seq === 'number' && typeof record.at === 'string';
}

function isTakeoverRecord(value: unknown): value is TakeoverRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<TakeoverRecord>;
  return record.version === 1
    && typeof record.targetNonce === 'string'
    && typeof record.requestedAt === 'string'
    && Boolean(record.requester) && typeof record.requester?.token === 'string'
    && typeof record.requester?.hostname === 'string' && typeof record.requester?.pid === 'number';
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
  let chunkBytes = 0;
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
      if (chunks.size >= MAX_ACTIVE_IPC_CHUNKS || chunkBytes + payload.length > MAX_IPC_MESSAGE_BYTES) {
        socket.destroy(new Error('Sync IPC active chunk cache exceeded its limit.'));
        return;
      }
      entry = { total: value.total, parts: Array.from({ length: value.total }), received: 0 };
      chunks.set(value.id, entry);
    }
    if (entry.total !== value.total || entry.parts[value.index]) {
      socket.destroy(new Error('Sync IPC chunk sequence is invalid.'));
      return;
    }
    entry.parts[value.index] = payload;
    entry.received += 1;
    chunkBytes += payload.length;
    if (entry.received !== entry.total) return;
    chunks.delete(value.id);
    chunkBytes = Math.max(0, chunkBytes - entry.parts.reduce((sum, part) => sum + (part?.length ?? 0), 0));
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
