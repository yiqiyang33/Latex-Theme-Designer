import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { CompileDiagnosticProvider } from './diagnostics';
import { metadataPath, OUTPUT_DIR, readManifest } from './manifest';
import { outputFileName } from './mirrorManager';
import { OverleafClient } from './overleafClient';

export class CompileService {
  private lastBuildId?: string;

  constructor(private readonly diagnostics: CompileDiagnosticProvider) {}

  async compile(root: string, client: OverleafClient): Promise<void> {
    const manifest = await readManifest(root);
    await vscode.workspace.saveAll();

    const rootDocPath = manifest.rootDocPath ?? await this.detectRootDoc(root);
    const response = await client.compile(manifest.projectId, rootDocPath ?? null);
    if (response.status !== 'success') {
      throw new Error(`Overleaf compile failed with status: ${response.status}`);
    }

    const outputRoot = metadataPath(root, OUTPUT_DIR);
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(outputRoot, { recursive: true });

    for (const output of response.outputFiles ?? []) {
      const url = output.url;
      if (!url) {
        continue;
      }
      const outputName = outputFileName(output);
      const content = await client.downloadCompileOutput(url, response);
      const targetPath = path.join(outputRoot, outputName);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);
      this.lastBuildId = this.lastBuildId ?? extractBuildId(url);
    }

    const logPath = path.join(outputRoot, 'output.log');
    const log = await fs.readFile(logPath, 'utf8').catch(() => '');
    this.diagnostics.publish(root, rootDocPath, log);
  }

  async showLog(root: string): Promise<void> {
    const logUri = vscode.Uri.file(path.join(metadataPath(root, OUTPUT_DIR), 'output.log'));
    await vscode.window.showTextDocument(logUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }

  getBuildId(): string | undefined {
    return this.lastBuildId;
  }

  private async detectRootDoc(root: string): Promise<string | undefined> {
    const manifest = await readManifest(root);
    for (const file of Object.values(manifest.files)) {
      if (!file.path.endsWith('.tex')) {
        continue;
      }
      const content = await fs.readFile(path.join(root, file.path), 'utf8').catch(() => '');
      if (/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/.test(content)) {
        return file.path;
      }
    }
    return undefined;
  }
}

function extractBuildId(url: string): string | undefined {
  return /\/build\/([^/]+)/.exec(url)?.[1];
}
