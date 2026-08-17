import * as fs from 'fs/promises';
import * as path from 'path';
import { sha1, isTextLike, toPosixPath } from './util';
import { shouldIgnore, shouldIgnoreUntrackedLocalPath } from './manifest';
import type { OverleafCodexManifest } from './types';
import { hashFileDigests } from './binaryTransfer';
import { mapWithConcurrency } from './syncHealthService';

/** Builds every manifest folder fingerprint in one pass instead of rescanning the tree per folder. */
export function buildManifestFolderFingerprints(manifest: OverleafCodexManifest): Map<string, string> {
  const parts = new Map<string, string[]>();
  for (const folder of Object.values(manifest.folders)) parts.set(folder.path, []);
  const addToAncestors = (relPath: string, value: string): void => {
    let current = path.posix.dirname(relPath);
    if (current === '.') current = '';
    while (true) {
      const bucket = parts.get(current);
      if (bucket && !shouldIgnore(manifest, relPath)) bucket.push(valueForFolder(current, relPath, value));
      if (!current) break;
      current = path.posix.dirname(current);
      if (current === '.') current = '';
    }
  };
  for (const folder of Object.values(manifest.folders)) {
    if (!folder.path) continue;
    addToAncestors(folder.path, `D\0${folder.path}`);
  }
  for (const file of Object.values(manifest.files)) {
    addToAncestors(file.path, `F\0${file.path}\0${file.entityType}\0${file.localHashCache ?? file.sha1 ?? ''}`);
  }
  return new Map([...parts].map(([folder, values]) => [
    folder,
    sha1(`folder\0${values.map(value => value.replace(`${folder}/`, '')).sort().join('\n')}`)
  ]));
}

function valueForFolder(folder: string, relPath: string, value: string): string {
  const prefix = folder ? `${folder}/` : '';
  if (!relPath.startsWith(prefix)) return value;
  const marker = value.indexOf('\0');
  return `${value.slice(0, marker + 1)}${relPath.slice(prefix.length)}${value.slice(marker + 1)}`;
}

/** Computes a local folder fingerprint with bounded file hashing and the same ignore rules as syncStatus. */
export async function folderFingerprintFromLocal(
  root: string,
  relPath: string,
  manifest: OverleafCodexManifest,
  concurrency = 4
): Promise<string> {
  const parts: string[] = [];
  const files: Array<{ relative: string; absolute: string; type: 'doc' | 'file' }> = [];
  const walk = async (absolute: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = toPosixPath(path.posix.join(relative, entry.name));
      const projectPath = toPosixPath(path.posix.join(relPath, child));
      if (shouldIgnore(manifest, projectPath) || shouldIgnoreUntrackedLocalPath(manifest, projectPath)) continue;
      if (entry.isDirectory()) {
        parts.push(`D\0${child}`);
        await walk(path.join(absolute, entry.name), child);
      } else if (entry.isFile()) {
        files.push({ relative: child, absolute: path.join(absolute, entry.name), type: isTextLike(child) ? 'doc' : 'file' });
      }
    }
  };
  await walk(path.join(root, relPath), '');
  await mapWithConcurrency(files, concurrency, async file => {
    const digest = file.type === 'doc'
      ? sha1(await fs.readFile(file.absolute))
      : (await hashFileDigests(file.absolute)).sha1;
    parts.push(`F\0${file.relative}\0${file.type}\0${digest}`);
  });
  return sha1(`folder\0${parts.sort().join('\n')}`);
}
