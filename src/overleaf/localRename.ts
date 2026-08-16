import * as fs from 'fs/promises';
import * as path from 'path';
import { toPosixPath } from './util';

export class LocalRenameConflictError extends Error {
  readonly code = 'local_rename_target_exists';

  constructor(readonly oldPath: string, readonly newPath: string) {
    super(`Cannot apply remote rename ${oldPath} -> ${newPath}; the local target already exists.`);
  }
}

export async function renameLocalPathSafely(root: string, oldPath: string, newPath: string): Promise<void> {
  const normalizedOld = validateRelativePath(oldPath);
  const normalizedNew = validateRelativePath(newPath);
  if (normalizedOld === normalizedNew) return;

  const oldAbsolute = resolveWithinRoot(root, normalizedOld);
  const newAbsolute = resolveWithinRoot(root, normalizedNew);
  const source = await fs.lstat(oldAbsolute).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!source) throw new Error(`Cannot apply remote rename; the local source does not exist: ${normalizedOld}`);

  const target = await fs.lstat(newAbsolute).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  const sameEntity = target && source.dev === target.dev && source.ino === target.ino;
  if (target && !sameEntity) throw new LocalRenameConflictError(normalizedOld, normalizedNew);

  await fs.mkdir(path.dirname(newAbsolute), { recursive: true });
  await fs.rename(oldAbsolute, newAbsolute);
}

export async function renameLocalPathTransactionally(
  root: string,
  oldPath: string,
  newPath: string,
  commit: () => Promise<void>,
  rollback: () => Promise<void>
): Promise<void> {
  await renameLocalPathSafely(root, oldPath, newPath);
  try {
    await commit();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await rollback().catch(rollbackError => rollbackErrors.push(rollbackError));
    await renameLocalPathSafely(root, newPath, oldPath).catch(rollbackError => rollbackErrors.push(rollbackError));
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Could not roll back local path change ${oldPath} -> ${newPath}.`
      );
    }
    throw error;
  }
}

function validateRelativePath(value: string): string {
  const normalized = toPosixPath(value);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.isAbsolute(value)) {
    throw new Error(`Invalid local mirror path: ${value}`);
  }
  return normalized;
}

function resolveWithinRoot(root: string, relPath: string): string {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relPath);
  const relative = path.relative(absoluteRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the local mirror: ${relPath}`);
  }
  return absolute;
}
