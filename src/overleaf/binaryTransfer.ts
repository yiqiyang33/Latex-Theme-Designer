import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';

export interface FileDigests {
  size: number;
  sha1: string;
  gitBlobHash: string;
}

export async function hashFileDigests(filePath: string): Promise<FileDigests> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Binary transfer source is not a file: ${filePath}`);
  const sha1 = createHash('sha1');
  const git = createHash('sha1');
  git.update(`blob ${stat.size}\0`);
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on('data', chunk => {
      sha1.update(chunk);
      git.update(chunk);
    });
    input.on('error', reject);
    input.on('end', resolve);
  });
  return { size: stat.size, sha1: sha1.digest('hex'), gitBlobHash: git.digest('hex') };
}

export async function installStagedFile(stagedPath: string, targetPath: string): Promise<void> {
  const token = `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const directory = path.dirname(targetPath);
  const incomingPath = path.join(directory, `.${path.basename(targetPath)}.incoming-${token}`);
  const backupPath = path.join(directory, `.${path.basename(targetPath)}.backup-${token}`);
  let backedUp = false;
  try {
    await fs.mkdir(directory, { recursive: true });
    // Bring the staged file next to the target first, so the swap below is two renames within one
    // directory. Staging may sit on another filesystem (a local /tmp beside an NFS home), and a slow
    // copy must not happen while the target is moved aside.
    await moveOrCopy(stagedPath, incomingPath);
    try {
      await fs.rename(targetPath, backupPath);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.rename(incomingPath, targetPath);
    if (backedUp) await fs.rm(backupPath, { force: true });
  } catch (error) {
    if (backedUp) {
      await fs.rm(targetPath, { force: true }).catch(() => undefined);
      await fs.rename(backupPath, targetPath).catch(() => undefined);
    }
    throw error;
  } finally {
    await fs.rm(incomingPath, { force: true }).catch(() => undefined);
    await fs.rm(stagedPath, { force: true }).catch(() => undefined);
  }
}

async function moveOrCopy(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.copyFile(source, target);
  }
}
