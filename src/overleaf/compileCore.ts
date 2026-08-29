import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { metadataPath, OUTPUT_DIR, readManifest, readTextFileBounded } from './manifest';
import type { CompileOutputFile } from './types';
import { OverleafClient } from './overleafClient';
import { assertNoSymlinkPath, assertPathWithin, processAlive, processStartSignature, validateProjectPathSegment } from './util';

export interface RemoteCompileResult {
  rootDocPath?: string;
  outputRoot: string;
  files: string[];
  pdfPath?: string;
  logPath?: string;
}

export interface CompileOptions {
  lockWaitMs?: number;
  lockMissingOwnerGraceMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

const DEFAULT_COMPILE_LOCK_WAIT_MS = 120_000;
const DEFAULT_COMPILE_LOCK_MISSING_OWNER_GRACE_MS = 5_000;

export async function compileRemoteProject(
  root: string,
  client: OverleafClient,
  rootDocOverride?: string,
  options: CompileOptions = {}
): Promise<RemoteCompileResult> {
  const manifest = await readManifest(root);
  const rootDocPath = rootDocOverride ?? manifest.rootDocPath ?? await detectRootDoc(root);
  options.signal?.throwIfAborted();
  const response = await client.compile(manifest.projectId, rootDocPath ?? null, false, false, options.signal);
  if (response.status !== 'success') throw new Error(`Overleaf compile failed with status: ${response.status}`);

  const outputRoot = metadataPath(root, OUTPUT_DIR);
  const releaseCompileLock = await acquireCompileLock(outputRoot, options);
  try {
  await cleanupInterruptedCompileArtifacts(root);
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const stagingRoot = metadataPath(root, `${OUTPUT_DIR}.staging-${token}`);
  const backupRoot = metadataPath(root, `${OUTPUT_DIR}.backup-${token}`);
  const stagedFiles: string[] = [];
  const usedNames = new Set<string>();
  let committed = false;
  await fs.mkdir(stagingRoot, { recursive: true });
  try {
    for (const output of response.outputFiles ?? []) {
      options.signal?.throwIfAborted();
      if (!output.url) continue;
      const name = uniqueCompileOutputName(output, usedNames);
      const target = assertPathWithin(stagingRoot, path.join(stagingRoot, name));
      options.onProgress?.(`Downloading ${name}`);
      await client.downloadCompileOutputToPath(output.url, response, target, { signal: options.signal });
      stagedFiles.push(target);
    }
    await replaceOutputDirectory(outputRoot, stagingRoot, backupRoot);
    committed = true;
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    if (committed) await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  const files = stagedFiles.map(file => path.join(outputRoot, path.basename(file)));
  const pdfPath = await latestPathByExtension(files, '.pdf');
  const logPath = await latestPathByExtension(files, '.log');
  return { rootDocPath, outputRoot, files, pdfPath, logPath };
  } finally {
    await releaseCompileLock();
  }
}

async function cleanupInterruptedCompileArtifacts(root: string): Promise<void> {
  const dir = metadataPath(root);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const backups = entries.filter(entry => entry.name.startsWith(`${OUTPUT_DIR}.backup-`)).sort((a, b) => b.name.localeCompare(a.name));
  const outputRoot = path.join(dir, OUTPUT_DIR);
  let retainedBackup: string | undefined;
  if (!await exists(outputRoot) && backups.length) {
    retainedBackup = backups[0].name;
    await fs.rename(path.join(dir, retainedBackup), outputRoot).catch(() => undefined);
  }
  await Promise.all(entries
    .filter(entry => entry.name.startsWith(`${OUTPUT_DIR}.staging-`) || entry.name.startsWith(`${OUTPUT_DIR}.backup-`))
    .filter(entry => entry.name !== retainedBackup)
    .map(entry => fs.rm(path.join(dir, entry.name), { recursive: true, force: true })));
}

async function acquireCompileLock(outputRoot: string, options: CompileOptions = {}): Promise<() => Promise<void>> {
  const lock = `${outputRoot}.lock`;
  const owner = path.join(lock, 'owner.json');
  const deadline = Date.now() + Math.max(1, options.lockWaitMs ?? DEFAULT_COMPILE_LOCK_WAIT_MS);
  const missingOwnerGraceMs = Math.max(1, options.lockMissingOwnerGraceMs ?? DEFAULT_COMPILE_LOCK_MISSING_OWNER_GRACE_MS);
  for (;;) {
    try {
      await fs.mkdir(lock, { recursive: false });
      const nonce = crypto.randomBytes(8).toString('hex');
      await fs.writeFile(owner, JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        processStart: await processStartSignature(process.pid),
        nonce
      }));
      return async () => {
        const current = await readTextFileBounded(owner, 64 * 1024).catch(() => undefined);
        if (current?.includes(nonce)) await fs.rm(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const raw = await readTextFileBounded(owner, 64 * 1024).catch(() => undefined);
      let stale = false;
      try {
        const value = JSON.parse(raw ?? '') as { pid?: number; startedAt?: number; processStart?: string };
        if (typeof value.pid !== 'number' || typeof value.startedAt !== 'number') {
          stale = await lockAge(lock) >= missingOwnerGraceMs;
        } else if (!processAlive(value.pid)) {
          stale = true;
        } else if (value.processStart) {
          const currentStart = await processStartSignature(value.pid);
          stale = Boolean(currentStart && currentStart !== value.processStart);
        }
      } catch {
        stale = await lockAge(lock) >= missingOwnerGraceMs;
      }
      if (stale) { await fs.rm(lock, { recursive: true, force: true }); continue; }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the Overleaf compile lock: ${lock}`);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

async function lockAge(lock: string): Promise<number> {
  const stat = await fs.stat(lock).catch(() => undefined);
  return stat ? Math.max(0, Date.now() - stat.mtimeMs) : Number.POSITIVE_INFINITY;
}

export async function latestRemotePdf(root: string): Promise<string | undefined> {
  const outputRoot = metadataPath(root, OUTPUT_DIR);
  const entries = await fs.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  return latestPathByExtension(
    entries.filter(entry => entry.isFile()).map(entry => path.join(outputRoot, entry.name)),
    '.pdf'
  );
}

export async function replaceOutputDirectory(outputRoot: string, stagingRoot: string, backupRoot: string): Promise<void> {
  const hadPreviousOutput = await exists(outputRoot);
  if (hadPreviousOutput) await fs.rename(outputRoot, backupRoot);
  try {
    await fs.rename(stagingRoot, outputRoot);
  } catch (error) {
    if (hadPreviousOutput) {
      try {
        await restoreOutputBackup(outputRoot, backupRoot);
      } catch (restoreError) {
        const detail = restoreError instanceof Error ? restoreError.message : String(restoreError);
        throw new Error(`Could not install new compile output or restore the previous output. Backup retained at ${backupRoot}: ${detail}`, {
          cause: error
        });
      }
    }
    throw error;
  }
}

async function restoreOutputBackup(outputRoot: string, backupRoot: string): Promise<void> {
  if (!await exists(backupRoot)) return;
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.rename(backupRoot, outputRoot);
}

async function latestPathByExtension(files: string[], extension: string): Promise<string | undefined> {
  const candidates = await Promise.all(files
    .filter(file => file.toLowerCase().endsWith(extension))
    .map(async (file, index) => ({
      file,
      index,
      mtimeMs: (await fs.stat(file).catch(() => undefined))?.mtimeMs ?? Number.NEGATIVE_INFINITY
    })));
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.index - a.index || b.file.localeCompare(a.file));
  return candidates[0]?.file;
}

function uniqueCompileOutputName(output: CompileOutputFile, used: Set<string>): string {
  const candidate = compileOutputName(output);
  const extension = path.extname(candidate);
  const stem = extension ? candidate.slice(0, -extension.length) : candidate;
  let name = candidate;
  let suffix = 2;
  while (used.has(name.toLowerCase())) {
    name = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

async function detectRootDoc(root: string): Promise<string | undefined> {
  const manifest = await readManifest(root);
  for (const file of Object.values(manifest.files)) {
    if (!file.path.endsWith('.tex')) continue;
    const content = await fs.readFile(await assertNoSymlinkPath(root, file.path), 'utf8').catch(() => '');
    if (/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(content)) return file.path;
  }
  return undefined;
}

function compileOutputName(output: CompileOutputFile): string {
  const raw = output.path || output.url || output.build || output.type || 'output.bin';
  const clean = path.posix.basename(raw.split('?')[0].replace(/\\/g, '/'));
  const candidate = clean || (output.type ? `output.${output.type.replace(/^\./, '')}` : 'output.bin');
  if (candidate === '.' || candidate === '..' || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new Error('Overleaf compile returned an unsafe output filename.');
  }
  validateProjectPathSegment(candidate);
  return candidate;
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}
