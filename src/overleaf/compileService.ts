import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { CompileDiagnosticProvider } from './diagnostics';
import { metadataPath, OUTPUT_DIR } from './manifest';
import { OverleafClient } from './overleafClient';
import { compileRemoteProject } from './compileCore';

export class CompileService {
  constructor(private readonly diagnostics: CompileDiagnosticProvider) {}

  async compile(root: string, client: OverleafClient): Promise<void> {
    await vscode.workspace.saveAll();
    const result = await compileRemoteProject(root, client);
    const logPath = result.logPath ?? path.join(result.outputRoot, 'output.log');
    const log = await fs.readFile(logPath, 'utf8').catch(() => '');
    this.diagnostics.publish(root, result.rootDocPath, log);
  }

  async showLog(root: string): Promise<void> {
    const logUri = vscode.Uri.file(path.join(metadataPath(root, OUTPUT_DIR), 'output.log'));
    await vscode.window.showTextDocument(logUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }

}
