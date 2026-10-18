import * as vscode from 'vscode';
import { parseMacroDefinitions } from './macros';
import { findInlineMathRegions, regionIsActive, type MathRegion } from './mathRegions';
import { MathRenderer, type MathJaxMacros, type MathRenderOptions } from './mathRenderer';

const LANGUAGES = new Set(['latex', 'tex']);
const RESCAN_DELAY_MS = 150;
const MACRO_SCAN_DELAY_MS = 1000;
const MAX_MACRO_FILES = 200;
const MAX_MACRO_FILE_BYTES = 1024 * 1024;
/** Formulas this far outside the visible lines are rendered too, so scrolling does not show source first. */
const VISIBLE_MARGIN_LINES = 40;
const URI_CACHE_LIMIT = 2000;

interface DocumentScan {
  version: number;
  regions: MathRegion[];
  /** Workspace macros overlaid with the document's own, rebuilt only when either changes. */
  macros: MathJaxMacros;
  macroGeneration: number;
}

/**
 * Shows inline formulas rendered in place while the cursor is elsewhere, Obsidian-style. Leaving
 * the editor's text untouched is the point: the source is only hidden by decorations, so every
 * editing feature keeps working on it, and moving onto a formula shows it again.
 */
export class LiveMathPreview implements vscode.Disposable {
  // Hiding works by injecting CSS through textDecoration, which VS Code emits verbatim.
  private readonly hidden = vscode.window.createTextEditorDecorationType({ textDecoration: 'none; display: none;' });
  private readonly images = vscode.window.createTextEditorDecorationType({});
  private readonly errors = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline wavy var(--vscode-editorError-foreground)'
  });
  private readonly renderer = new MathRenderer();
  private readonly scans = new WeakMap<vscode.TextDocument, DocumentScan>();
  private readonly rescanTimers = new Map<string, NodeJS.Timeout>();
  private readonly uris = new Map<string, vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];
  private workspaceMacros: MathJaxMacros = {};
  private macroGeneration = 0;
  private macroTimer?: NodeJS.Timeout;
  private enabled = false;
  private starting?: Promise<void>;

  constructor(private readonly output: vscode.OutputChannel) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,sty}');
    this.disposables.push(
      this.hidden,
      this.images,
      this.errors,
      watcher,
      watcher.onDidCreate(() => this.scheduleMacroScan()),
      watcher.onDidChange(() => this.scheduleMacroScan()),
      watcher.onDidDelete(() => this.scheduleMacroScan()),
      vscode.window.onDidChangeTextEditorSelection(event => this.update(event.textEditor)),
      vscode.window.onDidChangeTextEditorVisibleRanges(event => this.update(event.textEditor)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll()),
      vscode.workspace.onDidChangeTextDocument(event => this.scheduleRescan(event.document)),
      vscode.window.onDidChangeActiveColorTheme(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration(event => this.onConfigurationChanged(event))
    );
    this.setEnabled(this.readEnabled());
  }

  async toggle(): Promise<void> {
    await vscode.workspace.getConfiguration('latexEditingToolkit.livePreview')
      .update('enabled', !this.enabled, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    this.enabled = false;
    for (const timer of this.rescanTimers.values()) clearTimeout(timer);
    if (this.macroTimer) clearTimeout(this.macroTimer);
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private readEnabled(): boolean {
    return vscode.workspace.getConfiguration('latexEditingToolkit.livePreview').get<boolean>('enabled', false);
  }

  private setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const editor of vscode.window.visibleTextEditors) this.clear(editor);
      return;
    }
    // Files may have changed while the preview was off, when the watcher skips rescanning.
    if (this.starting) this.scheduleMacroScan();
    this.starting ??= (async () => {
      const startedAt = Date.now();
      await this.renderer.load();
      await this.scanWorkspaceMacros();
      this.output.appendLine(`[${new Date().toISOString()}] Live math preview ready in ${Date.now() - startedAt}ms.`);
    })().catch(error => {
      this.starting = undefined;
      this.output.appendLine(`[${new Date().toISOString()}] Live math preview could not start: ${String(error)}`);
    });
    void this.starting.then(() => this.updateAll());
  }

  private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('latexEditingToolkit.livePreview.enabled')) {
      this.setEnabled(this.readEnabled());
      return;
    }
    if (event.affectsConfiguration('latexEditingToolkit.livePreview') || event.affectsConfiguration('editor.fontSize')
      || event.affectsConfiguration('editor.lineHeight')) {
      this.refresh();
    }
  }

  /** Re-renders everything, for changes that alter how every formula looks. */
  private refresh(): void {
    this.renderer.clearCache();
    this.uris.clear();
    this.updateAll();
  }

  private updateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.update(editor);
  }

  private scheduleRescan(document: vscode.TextDocument): void {
    if (!this.enabled || !LANGUAGES.has(document.languageId)) return;
    const key = document.uri.toString();
    clearTimeout(this.rescanTimers.get(key));
    this.rescanTimers.set(key, setTimeout(() => {
      this.rescanTimers.delete(key);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) this.update(editor);
      }
    }, RESCAN_DELAY_MS));
  }

  private scanFor(document: vscode.TextDocument): DocumentScan {
    const existing = this.scans.get(document);
    if (existing && existing.version === document.version && existing.macroGeneration === this.macroGeneration) {
      return existing;
    }
    const text = document.getText();
    const regions = existing?.version === document.version ? existing.regions : findInlineMathRegions(text, document.languageId);
    const scan: DocumentScan = {
      version: document.version,
      regions,
      macros: { ...this.workspaceMacros, ...parseMacroDefinitions(text) },
      macroGeneration: this.macroGeneration
    };
    this.scans.set(document, scan);
    return scan;
  }

  private update(editor: vscode.TextEditor): void {
    const document = editor.document;
    if (!this.enabled || !LANGUAGES.has(document.languageId)) {
      this.clear(editor);
      return;
    }
    if (!this.renderer.isReady) return;
    // While the user types, VS Code shifts the existing decorations along with the text. Rescanning
    // on every keystroke would cost a full parse each time, so a stale scan waits for the debounce.
    const cached = this.scans.get(document);
    if (cached && cached.version !== document.version && this.rescanTimers.has(document.uri.toString())) return;

    const scan = this.scanFor(document);
    const selections = editor.selections.map(selection => ({
      start: document.offsetAt(selection.start),
      end: document.offsetAt(selection.end)
    }));
    const visible = editor.visibleRanges.map(range => ({
      start: document.offsetAt(new vscode.Position(Math.max(0, range.start.line - VISIBLE_MARGIN_LINES), 0)),
      end: document.offsetAt(new vscode.Position(range.end.line + VISIBLE_MARGIN_LINES, Number.MAX_SAFE_INTEGER))
    }));
    const options: MathRenderOptions = { ...this.renderSizing(document), macros: scan.macros };

    const hidden: vscode.Range[] = [];
    const images: vscode.DecorationOptions[] = [];
    const errors: vscode.DecorationOptions[] = [];
    for (const region of scan.regions) {
      if (!visible.some(range => region.end >= range.start && region.start <= range.end)) continue;
      if (regionIsActive(region, selections)) continue;
      const range = new vscode.Range(document.positionAt(region.start), document.positionAt(region.end));
      const result = this.renderer.render(region.tex, options);
      if (!result.ok) {
        errors.push({ range, hoverMessage: `Live math preview: ${result.error}` });
        continue;
      }
      const { dataUri, widthPx, heightPx, verticalAlignPx } = result.image;
      hidden.push(range);
      images.push({
        range: new vscode.Range(range.start, range.start),
        renderOptions: {
          before: {
            contentIconPath: this.uriFor(dataUri),
            width: `${widthPx.toFixed(2)}px`,
            height: `${heightPx.toFixed(2)}px`,
            // The public options have no vertical-align; textDecoration carries it into the CSS.
            textDecoration: `none; vertical-align: ${verticalAlignPx.toFixed(2)}px;`
          }
        }
      });
    }
    editor.setDecorations(this.hidden, hidden);
    editor.setDecorations(this.images, images);
    editor.setDecorations(this.errors, errors);
  }

  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.hidden, []);
    editor.setDecorations(this.images, []);
    editor.setDecorations(this.errors, []);
  }

  private uriFor(dataUri: string): vscode.Uri {
    let uri = this.uris.get(dataUri);
    if (!uri) {
      if (this.uris.size >= URI_CACHE_LIMIT) this.uris.clear();
      uri = vscode.Uri.parse(dataUri);
      this.uris.set(dataUri, uri);
    }
    return uri;
  }

  private renderSizing(document: vscode.TextDocument): Omit<MathRenderOptions, 'macros'> {
    const editorConfig = vscode.workspace.getConfiguration('editor', document);
    const fontSizePx = editorConfig.get<number>('fontSize', 14);
    const configuredLineHeight = editorConfig.get<number>('lineHeight', 0);
    // VS Code's own rule: 0 means a golden ratio of the font size, below 8 a multiple of it.
    const lineHeightPx = configuredLineHeight <= 0
      ? Math.round(fontSizePx * (process.platform === 'darwin' ? 1.5 : 1.35))
      : configuredLineHeight < 8 ? Math.round(configuredLineHeight * fontSizePx) : configuredLineHeight;
    const configuredColor = vscode.workspace.getConfiguration('latexEditingToolkit.livePreview').get<string>('mathColor', '').trim();
    return { fontSizePx, maxHeightPx: lineHeightPx, color: configuredColor || themeTextColor(vscode.window.activeColorTheme.kind) };
  }

  private scheduleMacroScan(): void {
    if (!this.enabled) return;
    if (this.macroTimer) clearTimeout(this.macroTimer);
    this.macroTimer = setTimeout(() => {
      this.macroTimer = undefined;
      void this.scanWorkspaceMacros().then(() => this.updateAll());
    }, MACRO_SCAN_DELAY_MS);
  }

  /** Collects the macros every .tex and .sty file in the workspace defines. */
  private async scanWorkspaceMacros(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.{tex,sty}', '**/{.git,.overleaf-codex,node_modules}/**', MAX_MACRO_FILES);
    files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const macros: MathJaxMacros = {};
    for (const file of files) {
      const stat = await vscode.workspace.fs.stat(file).then(value => value, () => undefined);
      if (!stat || stat.size > MAX_MACRO_FILE_BYTES) continue;
      const bytes = await vscode.workspace.fs.readFile(file).then(value => value, () => undefined);
      if (bytes) Object.assign(macros, parseMacroDefinitions(Buffer.from(bytes).toString('utf8')));
    }
    this.workspaceMacros = macros;
    this.macroGeneration += 1;
  }
}

/** An image cannot take the editor's text colour, so each theme kind gets a close default. */
function themeTextColor(kind: vscode.ColorThemeKind): string {
  switch (kind) {
    case vscode.ColorThemeKind.Light: return '#3b3b3b';
    case vscode.ColorThemeKind.HighContrast: return '#ffffff';
    case vscode.ColorThemeKind.HighContrastLight: return '#292929';
    default: return '#cccccc';
  }
}
