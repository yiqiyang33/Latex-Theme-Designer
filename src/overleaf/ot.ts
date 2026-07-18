import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from 'diff-match-patch';
import { OtOperation } from './types';
import { sha1 } from './util';

export function buildOtOperations(before: string, after: string): OtOperation[] {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupEfficiency(diffs);
  const ops: OtOperation[] = [];
  let position = 0;
  for (const [kind, text] of diffs) {
    if (kind === DIFF_EQUAL) position += text.length;
    else if (kind === DIFF_DELETE) ops.push({ p: position, d: text });
    else if (kind === DIFF_INSERT) {
      ops.push({ p: position, i: text });
      position += text.length;
    }
  }
  return ops;
}

export function applyOtOperations(content: string, ops: OtOperation[]): string {
  let next = content;
  for (const op of ops) {
    if (op.d !== undefined) next = `${next.slice(0, op.p)}${next.slice(op.p + op.d.length)}`;
    if (op.i !== undefined) next = `${next.slice(0, op.p)}${op.i}${next.slice(op.p)}`;
  }
  return next;
}

export function shareJsBlobHash(content: string): string {
  return sha1(`blob ${content.length}\x00${content}`);
}

export function mergeRemoteIntoLocal(base: string, remote: string, local: string): { clean: boolean; content: string } {
  if (remote === base) return { clean: true, content: local };
  if (local === base) return { clean: true, content: remote };
  if (local.startsWith(base)) {
    return { clean: true, content: `${remote}${local.slice(base.length)}` };
  }
  if (local.endsWith(base)) {
    return { clean: true, content: `${local.slice(0, local.length - base.length)}${remote}` };
  }
  const dmp = new diff_match_patch();
  const patches = dmp.patch_make(base, remote);
  const [content, applied] = dmp.patch_apply(patches, local) as [string, boolean[]];
  return { clean: applied.every(Boolean), content };
}

export function hasLocalChangedSinceLastSync(localHash: string | undefined, manifestHash: string | undefined, remoteHash?: string): boolean {
  if (localHash === undefined) return false;
  if (manifestHash !== undefined) return localHash !== manifestHash;
  return remoteHash !== undefined && localHash !== remoteHash;
}

export function hasRemoteChangedSinceLastSync(
  remoteVersion: number,
  manifestVersion: number | undefined,
  remoteHash: string,
  manifestHash: string | undefined
): boolean {
  return manifestVersion !== undefined ? remoteVersion !== manifestVersion : manifestHash !== remoteHash;
}
