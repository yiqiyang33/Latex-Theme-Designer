import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { metadataPath, OUTPUT_DIR, readManifest } from './manifest';
import type { CompileOutputFile } from './types';
import { OverleafClient } from './overleafClient';

export interface RemoteCompileResult {
  rootDocPath?: string;
  outputRoot: string;
  files: string[];
  pdfPath?: string;
  logPath?: string;
}

export async function compileRemoteProject(
  root: string,
  client: OverleafClient,
  rootDocOverride?: string
): Promise<RemoteCompileResult> {
  const manifest = await readManifest(root);
  const rootDocPath = rootDocOverride ?? manifest.rootDocPath ?? await detectRootDoc(root);
  const response = await client.compile(manifest.projectId, rootDocPath ?? null);
  if (response.status !== 'success') throw new Error(`Overleaf compile failed with status: ${response.status}`);

  const outputRoot = metadataPath(root, OUTPUT_DIR);
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const stagingRoot = metadataPath(root, `${OUTPUT_DIR}.staging-${token}`);
  const backupRoot = metadataPath(root, `${OUTPUT_DIR}.backup-${token}`);
  const stagedFiles: string[] = [];
  const usedNames = new Set<string>();
  let committed = false;
  await fs.mkdir(stagingRoot, { recursive: true });
  try {
    for (const output of response.outputFiles ?? []) {
      if (!output.url) continue;
      const name = uniqueCompileOutputName(output, usedNames);
      const target = path.join(stagingRoot, name);
      await fs.writeFile(target, await client.downloadCompileOutput(output.url, response));
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
}

export async function latestRemotePdf(root: string): Promise<string | undefined> {
  const outputRoot = metadataPath(root, OUTPUT_DIR);
  const entries = await fs.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  return latestPathByExtension(
    entries.filter(entry => entry.isFile()).map(entry => path.join(outputRoot, entry.name)),
    '.pdf'
  );
}

async function replaceOutputDirectory(outputRoot: string, stagingRoot: string, backupRoot: string): Promise<void> {
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
    const content = await fs.readFile(path.join(root, file.path), 'utf8').catch(() => '');
    if (/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(content)) return file.path;
  }
  return undefined;
}

function compileOutputName(output: CompileOutputFile): string {
  const raw = output.path || output.url || output.build || output.type || 'output.bin';
  const clean = path.posix.basename(raw.split('?')[0].replace(/\\/g, '/'));
  if (clean) return clean;
  return output.type ? `output.${output.type.replace(/^\./, '')}` : 'output.bin';
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}
