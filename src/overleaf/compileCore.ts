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
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  const files: string[] = [];
  for (const output of response.outputFiles ?? []) {
    if (!output.url) continue;
    const target = path.join(outputRoot, compileOutputName(output));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await client.downloadCompileOutput(output.url, response));
    files.push(target);
  }
  const pdfPath = files.find(file => file.toLowerCase().endsWith('.pdf'));
  const logPath = files.find(file => file.toLowerCase().endsWith('.log'));
  return { rootDocPath, outputRoot, files, pdfPath, logPath };
}

export async function latestRemotePdf(root: string): Promise<string | undefined> {
  const outputRoot = metadataPath(root, OUTPUT_DIR);
  const entries = await fs.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  return entries.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    ? path.join(outputRoot, entries.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))!.name)
    : undefined;
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
  const raw = output.path || output.type || output.build || output.url || 'output.bin';
  const clean = raw.split('?')[0].replace(/^.*\//, '');
  return clean || 'output.bin';
}

