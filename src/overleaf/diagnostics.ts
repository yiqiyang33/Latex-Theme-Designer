import * as path from 'path';
import * as vscode from 'vscode';
import { isSubpath } from '../utils';

export interface ParsedLatexDiagnostic {
  filePath?: string;
  line: number;
  message: string;
  severity: vscode.DiagnosticSeverity;
}

export class CompileDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor(name = 'Overleaf Codex') {
    this.collection = vscode.languages.createDiagnosticCollection(name);
  }

  dispose(): void {
    this.collection.dispose();
  }

  publish(root: string, fallbackRootDoc: string | undefined, log: string): void {
    this.collection.clear();
    const grouped = new Map<string, vscode.Diagnostic[]>();

    for (const item of parseLatexLog(log)) {
      const relPath = item.filePath ?? fallbackRootDoc;
      if (!relPath) {
        continue;
      }
      const candidate = path.resolve(root, relPath);
      if (!isSubpath(candidate, root)) continue;
      const uri = vscode.Uri.file(candidate);
      const range = new vscode.Range(Math.max(item.line - 1, 0), 0, Math.max(item.line - 1, 0), 120);
      const diagnostic = new vscode.Diagnostic(range, item.message, item.severity);
      diagnostic.source = this.collection.name;
      const key = uri.toString();
      grouped.set(key, [...(grouped.get(key) ?? []), diagnostic]);
    }

    for (const [uri, diagnostics] of grouped) {
      this.collection.set(vscode.Uri.parse(uri), diagnostics);
    }
  }
}

export function parseLatexLog(log: string): ParsedLatexDiagnostic[] {
  const diagnostics: ParsedLatexDiagnostic[] = [];
  const lines = log.split(/\r?\n/);
  let pendingError: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fileLine = /^(.+\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$/.exec(line);
    if (fileLine) {
      diagnostics.push({
        filePath: fileLine[1],
        line: Number(fileLine[2]),
        message: fileLine[3],
        severity: /warning/i.test(fileLine[3])
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error
      });
      continue;
    }

    if (line.startsWith('! ')) {
      pendingError = line.slice(2).trim();
      continue;
    }

    const latexLine = /^l\.(\d+)\s*(.*)$/.exec(line);
    if (latexLine && pendingError) {
      diagnostics.push({
        line: Number(latexLine[1]),
        message: `${pendingError}${latexLine[2] ? `: ${latexLine[2].trim()}` : ''}`,
        severity: vscode.DiagnosticSeverity.Error
      });
      pendingError = undefined;
      continue;
    }

    const warning = /LaTeX Warning:\s*(.+?)(?: on input line (\d+))?\./.exec(line);
    if (warning) {
      diagnostics.push({
        line: warning[2] ? Number(warning[2]) : 1,
        message: warning[1],
        severity: vscode.DiagnosticSeverity.Warning
      });
    }
  }

  return diagnostics;
}
