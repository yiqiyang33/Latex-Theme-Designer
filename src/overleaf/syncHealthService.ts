import { ManifestFile, OverleafCodexManifest } from './types';
import { toPosixPath } from './util';
import { shouldIgnore } from './manifest';

export interface RemoteReadPlan {
  docsToJoin: ManifestFile[];
  binariesToGet: ManifestFile[];
  reusedPaths: Set<string>;
}

export class SyncHealthService {
  planRemoteReads(
    previous: OverleafCodexManifest,
    remote: OverleafCodexManifest,
    options: { mode: 'incremental' | 'full'; paths?: Iterable<string> }
  ): RemoteReadPlan {
    const requested = options.paths ? new Set([...options.paths].map(toPosixPath)) : undefined;
    const plan: RemoteReadPlan = {
      docsToJoin: [],
      binariesToGet: [],
      reusedPaths: new Set<string>()
    };
    for (const file of Object.values(remote.files)) {
      if (shouldIgnore(previous, file.path)) continue;
      if (requested && !requested.has(file.path)) continue;
      const previousFile = previous.files[file.path];
      if (options.mode === 'incremental' && canReuseRemoteMetadata(previousFile, file)) {
        plan.reusedPaths.add(file.path);
      } else if (file.entityType === 'doc') {
        plan.docsToJoin.push(file);
      } else {
        plan.binariesToGet.push(file);
      }
    }
    return plan;
  }
}

export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await handler(item);
    }
  });
  await Promise.all(workers);
}

/** Limits both the number of active transfers and their aggregate payload size. */
export async function mapWithByteConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  maxBytes: number,
  estimateBytes: (item: T) => number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  let inFlightBytes = 0;
  const waiters: Array<() => void> = [];
  const wake = (): void => waiters.splice(0).forEach(resolve => resolve());
  const acquire = async (bytes: number): Promise<void> => {
    const amount = Math.max(1, Math.min(bytes, maxBytes));
    while (inFlightBytes + amount > maxBytes && inFlightBytes > 0) {
      await new Promise<void>(resolve => waiters.push(resolve));
    }
    inFlightBytes += amount;
  };
  const release = (bytes: number): void => { inFlightBytes = Math.max(0, inFlightBytes - Math.max(1, Math.min(bytes, maxBytes))); wake(); };
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      const bytes = estimateBytes(item);
      await acquire(bytes);
      try { await handler(item); } finally { release(bytes); }
    }
  });
  await Promise.all(workers);
}

export interface DynamicByteReservation {
  reserve(bytes: number): Promise<void>;
}

/** Starts a bounded number of requests, then reserves their real response size before body consumption. */
export async function mapWithDynamicByteConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  maxBytes: number,
  handler: (item: T, reservation: DynamicByteReservation) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  let reservedBytes = 0;
  const waiters: Array<() => void> = [];
  const wake = (): void => waiters.splice(0).forEach(resolve => resolve());
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      let amount = 0;
      let didReserve = false;
      const reservation: DynamicByteReservation = {
        reserve: async bytes => {
          if (didReserve) throw new Error('Transfer size was reserved more than once.');
          didReserve = true;
          amount = Number.isFinite(bytes) && bytes >= 0 ? Math.max(1, Math.min(bytes, maxBytes)) : maxBytes;
          while (reservedBytes + amount > maxBytes && reservedBytes > 0) {
            await new Promise<void>(resolve => waiters.push(resolve));
          }
          reservedBytes += amount;
        }
      };
      try {
        await handler(item, reservation);
      } finally {
        if (didReserve) {
          reservedBytes = Math.max(0, reservedBytes - amount);
          wake();
        }
      }
    }
  });
  await Promise.all(workers);
}

export function canReuseRemoteMetadata(previous: ManifestFile | undefined, remote: ManifestFile): boolean {
  if (!previous?.sha1 || previous.entityId !== remote.entityId || previous.entityType !== remote.entityType) {
    return false;
  }
  if (remote.entityType === 'doc') {
    return previous.version !== undefined
      && remote.version !== undefined
      && previous.version === remote.version;
  }
  if (previous.remoteBlobHash !== undefined && remote.remoteBlobHash !== undefined) {
    return previous.remoteBlobHash === remote.remoteBlobHash;
  }
  return previous.remoteRevision !== undefined
    && remote.remoteRevision !== undefined
    && previous.remoteRevision === remote.remoteRevision;
}
