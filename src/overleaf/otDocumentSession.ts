import { JoinDocResult, OtUpdate } from './types';
import { applyOtOperations, buildOtOperations, mergeRemoteIntoLocal, shareJsBlobHash } from './ot';

export interface OtDocumentState {
  docId: string;
  version: number;
  localCache: string;
  remoteCache: string;
}

export interface OtSubmitResult {
  content: string;
  changed: boolean;
  conflictRemote?: string;
}

export interface OtDocumentTransport {
  joinDoc(docId: string, signal?: AbortSignal): Promise<JoinDocResult>;
  applyOtUpdate(docId: string, update: OtUpdate, signal?: AbortSignal): Promise<void>;
}

export class OtDocumentSession {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly state: OtDocumentState,
    private readonly transport: OtDocumentTransport
  ) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }

  submitLocal(content: string, source?: string): Promise<OtSubmitResult> {
    return this.run(() => this.submitLocalNow(content, source));
  }

  private async submitLocalNow(content: string, source?: string): Promise<OtSubmitResult> {
    let intended = content;
    if (this.state.remoteCache !== this.state.localCache) {
      const merge = mergeRemoteIntoLocal(this.state.localCache, this.state.remoteCache, content);
      if (!merge.clean) {
        return { content, changed: false, conflictRemote: this.state.remoteCache };
      }
      intended = merge.content;
    }

    const beforeRemote = this.state.remoteCache;
    const operations = buildOtOperations(beforeRemote, intended);
    if (operations.length === 0) {
      this.state.localCache = intended;
      return { content: intended, changed: false };
    }

    try {
      await this.apply(operations, this.state.version, intended, source);
      this.state.version += 1;
    } catch (error) {
      if (!isAmbiguousAckError(error)) throw error;
      const joined = await this.transport.joinDoc(this.state.docId);
      if (joined.content === intended) {
        this.state.version = joined.version;
      } else if (joined.content === beforeRemote) {
        const retry = buildOtOperations(joined.content, intended);
        await this.apply(retry, joined.version, intended, source);
        this.state.version = joined.version + 1;
      } else {
        const merge = mergeRemoteIntoLocal(beforeRemote, joined.content, intended);
        if (!merge.clean) {
          this.state.version = joined.version;
          this.state.remoteCache = joined.content;
          return { content: intended, changed: false, conflictRemote: joined.content };
        }
        intended = merge.content;
        const retry = buildOtOperations(joined.content, intended);
        if (retry.length > 0) {
          await this.apply(retry, joined.version, intended, source);
          this.state.version = joined.version + 1;
        } else {
          this.state.version = joined.version;
        }
      }
    }

    this.state.remoteCache = intended;
    this.state.localCache = intended;
    return { content: intended, changed: true };
  }

  applyRemote(update: OtUpdate): Promise<string> {
    return this.run(async () => {
      if (update.v < this.state.version) return this.state.remoteCache;
      if (update.v !== this.state.version) {
        throw new Error('Remote version changed unexpectedly.');
      }
      const next = applyOtOperations(this.state.remoteCache, update.op ?? []);
      this.state.version = update.v + 1;
      this.state.remoteCache = next;
      return next;
    });
  }

  private apply(operations: OtUpdate['op'], version: number, content: string, source?: string): Promise<void> {
    return this.transport.applyOtUpdate(this.state.docId, {
      doc: this.state.docId,
      op: operations,
      v: version,
      hash: shareJsBlobHash(content),
      meta: { source, ts: Date.now() }
    });
  }
}

function isAmbiguousAckError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out waiting for applyOtUpdate|cancelled|socket|disconnect/i.test(message);
}
