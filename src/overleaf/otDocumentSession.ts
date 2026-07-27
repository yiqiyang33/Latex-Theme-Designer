import { JoinDocResult, OtUpdate } from './types';
import { applyOtOperations, buildOtOperations, mergeRemoteIntoLocal, shareJsBlobHash } from './ot';
import { formatUnknownError } from './util';

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

interface AmbiguousApplyResult {
  applied: boolean;
  content: string;
  version: number;
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

  submitLocal(content: string): Promise<OtSubmitResult> {
    return this.run(() => this.submitLocalNow(content));
  }

  private async submitLocalNow(content: string): Promise<OtSubmitResult> {
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

    const applied = await this.applyOrReadBack(operations, this.state.version, intended);
    if (applied.applied) {
      this.state.version = applied.version;
    } else if (applied.content === beforeRemote) {
      const retry = await this.applyOrReadBack(
        buildOtOperations(applied.content, intended),
        applied.version,
        intended
      );
      if (retry.applied) {
        this.state.version = retry.version;
      } else {
        const merge = mergeRemoteIntoLocal(applied.content, retry.content, intended);
        if (!merge.clean) {
          this.state.version = retry.version;
          this.state.remoteCache = retry.content;
          return { content: intended, changed: false, conflictRemote: retry.content };
        }
        intended = merge.content;
        const merged = await this.applyOrReadBack(
          buildOtOperations(retry.content, intended),
          retry.version,
          intended
        );
        if (!merged.applied) {
          this.state.version = merged.version;
          this.state.remoteCache = merged.content;
          return { content: intended, changed: false, conflictRemote: merged.content };
        }
        this.state.version = merged.version;
      }
    } else {
      const merge = mergeRemoteIntoLocal(beforeRemote, applied.content, intended);
      if (!merge.clean) {
        this.state.version = applied.version;
        this.state.remoteCache = applied.content;
        return { content: intended, changed: false, conflictRemote: applied.content };
      }
      intended = merge.content;
      const retry = buildOtOperations(applied.content, intended);
      if (retry.length > 0) {
        const merged = await this.applyOrReadBack(retry, applied.version, intended);
        if (!merged.applied) {
          this.state.version = merged.version;
          this.state.remoteCache = merged.content;
          return { content: intended, changed: false, conflictRemote: merged.content };
        }
        this.state.version = merged.version;
      } else {
        this.state.version = applied.version;
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

  private apply(operations: OtUpdate['op'], version: number, content: string): Promise<void> {
    return this.transport.applyOtUpdate(this.state.docId, {
      doc: this.state.docId,
      op: operations,
      v: version,
      hash: shareJsBlobHash(content)
    });
  }

  private async applyOrReadBack(
    operations: OtUpdate['op'],
    version: number,
    content: string
  ): Promise<AmbiguousApplyResult> {
    if (!operations || operations.length === 0) {
      return { applied: true, content, version };
    }
    try {
      await this.apply(operations, version, content);
      return { applied: true, content, version: version + 1 };
    } catch (error) {
      if (!isAmbiguousAckError(error)) throw error;
      const joined = await this.transport.joinDoc(this.state.docId);
      return {
        applied: joined.content === content,
        content: joined.content,
        version: joined.version
      };
    }
  }
}

function isAmbiguousAckError(error: unknown): boolean {
  if (error && typeof error === 'object' && !(error instanceof Error)) {
    return true;
  }
  const message = formatUnknownError(error);
  return /applyOtUpdate|acknowledg|cancelled|socket|disconnect|version|hash|out.?of.?order/i.test(message);
}
