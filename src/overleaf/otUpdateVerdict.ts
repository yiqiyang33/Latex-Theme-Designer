import { formatUnknownError } from './util';

/**
 * Overleaf turned an update down after accepting it for processing, so nothing was applied. Its
 * document updater rejects an update whose resulting text no longer matches the hash sent with it,
 * for instance, and Overleaf disconnects the client right after reporting that.
 */
export class OverleafUpdateRejectedError extends Error {
  readonly name = 'OverleafUpdateRejectedError';

  constructor(readonly docId: string, readonly reason: string) {
    super(`Overleaf rejected the update: ${reason}`);
  }
}

/** Overleaf neither confirmed nor rejected an update before the connection dropped or the wait ran out. */
export class OverleafUpdateUnconfirmedError extends Error {
  readonly name = 'OverleafUpdateUnconfirmedError';
}

type Handler = (...args: any[]) => void;

export interface UpdateVerdictSocket {
  on(event: string, handler: Handler): unknown;
  removeListener(event: string, handler: Handler): unknown;
}

export interface UpdateVerdict {
  /** Settles once Overleaf has applied the update, or rejects with why it may not have. */
  readonly settled: Promise<void>;
  /** Stops waiting without a verdict, for an update that was never sent. */
  dispose(): void;
}

/**
 * Waits for Overleaf's verdict on an update sent for `docId` at `sentVersion`. The acknowledgement
 * of applyOtUpdate only means the update was queued: the document updater applies it afterwards,
 * then answers the sender with a bare {doc, v} echo - or, when it refused the update, emits
 * otUpdateError and disconnects. Listening starts before the update is sent, since the echo can
 * arrive before the acknowledgement does.
 */
export function awaitUpdateVerdict(
  socket: UpdateVerdictSocket,
  docId: string,
  sentVersion: number,
  timeoutMs: number,
  signal?: AbortSignal
): UpdateVerdict {
  let dispose = (): void => undefined;
  const settled = new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener('otUpdateApplied', onApplied);
      socket.removeListener('otUpdateError', onError);
      socket.removeListener('disconnect', onDisconnect);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    // Only the sender gets the bare echo; every other client receives the update with its op.
    const onApplied = (update: unknown): void => {
      if (!isRecord(update) || update.doc !== docId || update.op !== undefined) return;
      if (typeof update.v === 'number' && update.v >= sentVersion) finish();
    };
    const onError = (error: unknown, message?: unknown): void => {
      const failedDoc = isRecord(message) ? message.doc_id : undefined;
      if (typeof failedDoc === 'string' && failedDoc !== docId) return;
      finish(new OverleafUpdateRejectedError(docId, formatUnknownError(error)));
    };
    const onDisconnect = (): void => finish(new OverleafUpdateUnconfirmedError('Overleaf disconnected before confirming the applyOtUpdate.'));
    const onAbort = (): void => finish(new OverleafUpdateUnconfirmedError('Stopped waiting for Overleaf to confirm the applyOtUpdate.'));
    const timer = setTimeout(
      () => finish(new OverleafUpdateUnconfirmedError('Timed out waiting for Overleaf to confirm the applyOtUpdate.')),
      timeoutMs
    );
    socket.on('otUpdateApplied', onApplied);
    socket.on('otUpdateError', onError);
    socket.on('disconnect', onDisconnect);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    dispose = () => finish();
  });
  // A verdict nobody awaits, because the send itself failed, must not surface as an unhandled rejection.
  settled.catch(() => undefined);
  return { settled, dispose: () => dispose() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
