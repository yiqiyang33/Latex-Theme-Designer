import { toPosixPath } from './util';

export type RenameEntityType = 'doc' | 'file' | 'folder';

export interface RenameCandidate {
  path: string;
  hash: string;
  entityType: RenameEntityType;
  observedAt?: number;
}

export type RenameDetection =
  | { kind: 'none' }
  | { kind: 'matched'; oldPath: string; newPath: string }
  | { kind: 'ambiguous'; oldPaths: string[]; newPaths: string[] };

export class RenameDetector {
  private readonly deletes = new Map<string, Required<RenameCandidate>>();
  private readonly creates = new Map<string, Required<RenameCandidate>>();

  constructor(
    private readonly windowMs = 2000,
    private readonly now: () => number = Date.now
  ) {}

  registerDelete(candidate: RenameCandidate): RenameDetection {
    return this.register(this.deletes, this.creates, candidate, true);
  }

  registerCreate(candidate: RenameCandidate): RenameDetection {
    return this.register(this.creates, this.deletes, candidate, false);
  }

  forget(path: string): void {
    const normalized = toPosixPath(path);
    this.deletes.delete(normalized);
    this.creates.delete(normalized);
  }

  forgetSubtree(path: string): void {
    const normalized = toPosixPath(path);
    const prefix = `${normalized}/`;
    for (const candidates of [this.deletes, this.creates]) {
      for (const candidatePath of [...candidates.keys()]) {
        if (candidatePath === normalized || candidatePath.startsWith(prefix)) {
          candidates.delete(candidatePath);
        }
      }
    }
  }

  private register(
    own: Map<string, Required<RenameCandidate>>,
    opposite: Map<string, Required<RenameCandidate>>,
    candidate: RenameCandidate,
    deleting: boolean
  ): RenameDetection {
    const observedAt = candidate.observedAt ?? this.now();
    this.prune(observedAt);
    const normalized: Required<RenameCandidate> = {
      ...candidate,
      path: toPosixPath(candidate.path),
      observedAt
    };
    own.set(normalized.path, normalized);
    const matches = [...opposite.values()].filter(item =>
      item.hash === normalized.hash
      && item.entityType === normalized.entityType
      && Math.abs(item.observedAt - observedAt) <= this.windowMs
    );
    if (matches.length === 0) return { kind: 'none' };

    const sameSide = [...own.values()].filter(item =>
      item.hash === normalized.hash
      && item.entityType === normalized.entityType
      && Math.abs(item.observedAt - observedAt) <= this.windowMs
    );
    if (matches.length !== 1 || sameSide.length !== 1) {
      const oldPaths = deleting ? sameSide.map(item => item.path) : matches.map(item => item.path);
      const newPaths = deleting ? matches.map(item => item.path) : sameSide.map(item => item.path);
      for (const item of [...matches, ...sameSide]) this.forget(item.path);
      return { kind: 'ambiguous', oldPaths, newPaths };
    }

    const oppositeMatch = matches[0];
    this.forget(normalized.path);
    this.forget(oppositeMatch.path);
    return deleting
      ? { kind: 'matched', oldPath: normalized.path, newPath: oppositeMatch.path }
      : { kind: 'matched', oldPath: oppositeMatch.path, newPath: normalized.path };
  }

  private prune(now: number): void {
    for (const candidates of [this.deletes, this.creates]) {
      for (const [path, candidate] of candidates) {
        if (now - candidate.observedAt > this.windowMs) candidates.delete(path);
      }
    }
  }
}
