import * as path from 'path';
import * as vscode from 'vscode';
import { CompileDiagnosticProvider } from './diagnostics';
import { metadataPath, OUTPUT_DIR, readManifest, readTextFileBounded, MAX_METADATA_JSON_BYTES, writeManifest } from './manifest';
import { OverleafClient } from './overleafClient';
import { compileRemoteProject, type CompileOptions, type RemoteCompileResult } from './compileCore';

export interface RemoteCompileServiceOptions extends Pick<CompileOptions, 'signal' | 'onProgress'> {}

export class CompileService {
  constructor(private readonly diagnostics: CompileDiagnosticProvider) {}

  async compile(root: string, client: OverleafClient, options: RemoteCompileServiceOptions = {}): Promise<RemoteCompileResult> {
    await vscode.workspace.saveAll();
    const result = await compileRemoteProject(root, client, undefined, options);
    const logPath = result.logPath ?? path.join(result.outputRoot, 'output.log');
    const log = await readTextFileBounded(logPath, MAX_METADATA_JSON_BYTES).catch(() => '');
    this.diagnostics.publish(root, result.rootDocPath, log);
    const manifest = await readManifest(root);
    manifest.lastRemoteCompile = {
      completedAt: new Date().toISOString(),
      pdfPath: relativeOutputPath(root, result.pdfPath),
      logPath: relativeOutputPath(root, result.logPath)
    };
    await writeManifest(root, manifest, { updateSyncTimestamp: false });
    return result;
  }

  async showLog(root: string): Promise<void> {
    const manifest = await readManifest(root).catch(() => undefined);
    const stored = manifest?.lastRemoteCompile?.logPath;
    const candidate = stored ? path.resolve(root, stored) : path.join(metadataPath(root, OUTPUT_DIR), 'output.log');
    const logPath = stored && isWithin(root, candidate) ? candidate : path.join(metadataPath(root, OUTPUT_DIR), 'output.log');
    const logUri = vscode.Uri.file(logPath);
    await vscode.window.showTextDocument(logUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }

}

function relativeOutputPath(root: string, filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative) ? relative : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
