import * as vscode from 'vscode';
import { AuxIndex } from './auxIndex';
import { citationOverlays, findCitations, type CitationRegion } from './citations';
import { parseMacroDefinitions } from './macros';
import { findMathRegions, previewSource, regionIsActive, type DisplayMathRegion, type MathRegions } from './mathRegions';
import { MathRenderer, type MathJaxMacros, type MathRenderOptions, type RenderedBlock } from './mathRenderer';
import type { Insertion, Overlay, RangeStyle } from './overlays';
import {
  emptyCrefSettings,
  equationTags,
  findReferences,
  formatReference,
  readCrefSettings,
  referenceOverlays,
  rootHint,
  substituteReferences,
  type AuxData,
  type CrefSettings,
  type ReferenceRegion,
  type RootHint
} from './references';
import { findStructure, readTheoremSettings, structureOverlays, type Structure, type TheoremSettings } from './structure';

const LANGUAGES = new Set(['latex', 'tex']);
const RESCAN_DELAY_MS = 150;
const MACRO_SCAN_DELAY_MS = 1000;
const MAX_MACRO_FILES = 200;
const MAX_MACRO_FILE_BYTES = 1024 * 1024;
/** Formulas this far outside the visible lines are rendered too, so scrolling does not show source first. */
const VISIBLE_MARGIN_LINES = 40;
/** Columns between the longest line of a block being edited and its rendering. */
const EDIT_PREVIEW_GAP = 4;

interface DocumentScan {
  version: number;
  regions: MathRegions;
  references: ReferenceRegion[];
  citations: CitationRegion[];
  structure: Structure;
  /** What the document says about its root, whose compile numbers its references. */
  root: RootHint;
  /** Workspace macros overlaid with the document's own, rebuilt only when either changes. */
  macros: MathJaxMacros;
  macroGeneration: number;
  /** What to draw over the markup, for the aux files as they were at `generation`. */
  overlays?: { generation: number; list: Overlay[] };
}

/** How each style a stretch of source can take is drawn. */
const RANGE_STYLES: Record<RangeStyle, vscode.DecorationRenderOptions> = {
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  // textDecoration carries CSS the public options do not have, as for hiding.
  smallCaps: { textDecoration: 'none; font-variant: small-caps;' },
  dim: { opacity: '0.45' },
  chapter: { fontWeight: 'bold', textDecoration: 'none; font-size: 1.3em;' },
  section: { fontWeight: 'bold', textDecoration: 'none; font-size: 1.2em;' },
  subsection: { fontWeight: 'bold', textDecoration: 'none; font-size: 1.1em;' }
};

/**
 * Shows formulas rendered in place while the cursor is elsewhere, Obsidian-style. Leaving the
 * editor's text untouched is the point: the source is only hidden by decorations, so every
 * editing feature keeps working on it, and moving onto a formula shows it again.
 *
 * Display formulas are drawn over the lines their source takes, since an extension cannot change
 * line heights. The source keeps its lines when shown again, so nothing below it moves.
 */
export class LiveMathPreview implements vscode.Disposable {
  // Hiding works by injecting CSS through textDecoration, which VS Code emits verbatim.
  private readonly hidden = vscode.window.createTextEditorDecorationType({ textDecoration: 'none; display: none;' });
  private readonly inlineImages = vscode.window.createTextEditorDecorationType({});
  // Display images are large; keeping them apart means moving through inline math does not resend them.
  private readonly blockImages = vscode.window.createTextEditorDecorationType({});
  // The editor still draws indent guides for a block's hidden source, and on lines carrying an image
  // it measures them from the image's right edge. Painting the lines in the editor's background
  // covers them; rulers are drawn above this layer, so they stay.
  private readonly blockBackgrounds = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.background')
  });
  private readonly errors = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline wavy var(--vscode-editorError-foreground)'
  });
  /** Text drawn in place of markup: numbers, citations, theorem heads and list labels. */
  private readonly insertions = vscode.window.createTextEditorDecorationType({});
  private readonly rangeStyles = new Map(Object.entries(RANGE_STYLES).map(([style, options]) =>
    [style as RangeStyle, vscode.window.createTextEditorDecorationType(options)]));
  private readonly renderer = new MathRenderer();
  private readonly aux: AuxIndex;
  private readonly scans = new WeakMap<vscode.TextDocument, DocumentScan>();
  /** What each editor shows per decoration type, so unchanged decorations are not sent again. */
  private readonly applied = new WeakMap<vscode.TextEditor, Map<vscode.TextEditorDecorationType, string>>();
  /** The last block rendered beside its source, kept while an edit leaves it unrenderable. */
  private readonly lastEditPreview = new WeakMap<vscode.TextDocument, { line: number; block: RenderedBlock }>();
  private readonly rescanTimers = new Map<string, NodeJS.Timeout>();
  private readonly uris = new WeakMap<{ dataUri: string }, vscode.Uri>();
  private readonly disposables: vscode.Disposable[] = [];
  private workspaceMacros: MathJaxMacros = {};
  private cref: CrefSettings = emptyCrefSettings();
  private theorems: TheoremSettings = new Map();
  private macroGeneration = 0;
  private macroTimer?: NodeJS.Timeout;
  private enabled = false;
  private starting?: Promise<void>;

  constructor(private readonly output: vscode.OutputChannel) {
    this.aux = new AuxIndex(output);
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,sty}');
    this.disposables.push(
      this.hidden,
      this.inlineImages,
      this.blockImages,
      this.blockBackgrounds,
      this.errors,
      this.insertions,
      ...this.rangeStyles.values(),
      this.aux,
      this.aux.onDidChange(() => this.updateAll()),
      watcher,
      watcher.onDidCreate(() => this.scheduleMacroScan()),
      watcher.onDidChange(() => this.scheduleMacroScan()),
      watcher.onDidDelete(() => this.scheduleMacroScan()),
      vscode.window.onDidChangeTextEditorSelection(event => this.update(event.textEditor)),
      vscode.window.onDidChangeTextEditorVisibleRanges(event => this.update(event.textEditor)),
      vscode.window.onDidChangeTextEditorOptions(event => this.update(event.textEditor)),
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
    const parsed: ParsedDocument = existing?.version === document.version ? existing : parseDocument(text, document.languageId);
    const scan: DocumentScan = {
      version: document.version,
      regions: parsed.regions,
      references: parsed.references,
      citations: parsed.citations,
      structure: parsed.structure,
      root: parsed.root,
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
    const isVisible = (start: number, end: number) => visible.some(range => end >= range.start && start <= range.end);
    const options: MathRenderOptions = { ...this.renderSizing(document), macros: scan.macros };
    const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
    // Until the root has been compiled there are no numbers, and references stay as source.
    const aux = this.aux.auxFor(document, scan.root);
    const labels = aux?.labels;
    const withNumbers = (tex: string) => labels
      ? substituteReferences(tex, reference => formatReference(reference, labels, this.cref).text)
      : tex;

    const hidden = new Decorations<vscode.Range>();
    const inlineImages = new Decorations<vscode.DecorationOptions>();
    const blockImages = new Decorations<vscode.DecorationOptions>();
    const blockBackgrounds = new Decorations<vscode.Range>();
    const errors = new Decorations<vscode.DecorationOptions>();
    const insertions = new Decorations<vscode.DecorationOptions>();
    const styled = new Map([...this.rangeStyles.keys()].map(style => [style, new Decorations<vscode.Range>()]));

    scan.regions.inline.forEach((region, index) => {
      if (!isVisible(region.start, region.end) || regionIsActive(region, selections)) return;
      const range = new vscode.Range(document.positionAt(region.start), document.positionAt(region.end));
      const result = this.renderer.render(withNumbers(region.tex), options);
      if (!result.ok) {
        errors.add(`i${index}`, { range, hoverMessage: `Live math preview: ${result.error}` });
        return;
      }
      const { widthPx, heightPx, verticalAlignPx } = result.image;
      hidden.add(`i${index}`, range);
      inlineImages.add(`i${index}`, {
        range: new vscode.Range(range.start, range.start),
        renderOptions: {
          before: {
            contentIconPath: this.uriFor(result.image),
            width: `${widthPx.toFixed(2)}px`,
            height: `${heightPx.toFixed(2)}px`,
            // The public options have no vertical-align; textDecoration carries it into the CSS.
            textDecoration: `none; vertical-align: ${verticalAlignPx.toFixed(2)}px;`
          }
        }
      });
    });

    scan.regions.display.forEach((region, index) => {
      if (!isVisible(region.linesStart, region.linesEnd)) return;
      const firstLine = document.positionAt(region.start).line;
      const result = this.renderer.renderBlock(withNumbers(region.tex), region.rows, options, equationTags(region.tex, labels));
      if (regionIsActive({ start: region.linesStart, end: region.linesEnd }, selections)) {
        const rendered = result.ok ? result.image : undefined;
        for (const item of this.besideSource(document, region, rendered, tabSize, options.lineHeightPx)) blockImages.add(`p${index}`, item);
        return;
      }
      if (!result.ok) {
        const opening = new vscode.Range(document.positionAt(region.start), document.lineAt(firstLine).range.end);
        errors.add(`d${index}`, { range: opening, hoverMessage: `Live math preview: ${result.error}` });
        return;
      }
      for (let row = 0; row < region.rows; row++) {
        const line = document.lineAt(firstLine + row);
        if (!line.range.isEmpty) hidden.add(`d${index}`, line.range);
      }
      blockBackgrounds.add(`d${index}`, new vscode.Range(firstLine, 0, firstLine + region.rows - 1, 0));
      // Indented one level from its delimiter, as display math stands out from the text around it.
      const indent = visualColumn(document.lineAt(firstLine).text, document.positionAt(region.start).character, tabSize) + tabSize;
      for (const slice of result.image.slices) {
        const start = new vscode.Position(firstLine + slice.row, 0);
        blockImages.add(`d${index}`, {
          range: new vscode.Range(start, start),
          renderOptions: {
            before: {
              contentIconPath: this.uriFor(slice),
              width: `${result.image.widthPx.toFixed(2)}px`,
              height: `${options.lineHeightPx}px`,
              margin: `0 0 0 ${indent}ch`,
              // Each strip fills its line exactly, so the strips join into one formula.
              textDecoration: 'none; vertical-align: top;'
            }
          }
        });
      }
    });

    const range = (start: number, end: number) => new vscode.Range(document.positionAt(start), document.positionAt(end));
    this.overlaysFor(document, scan, aux).forEach((item, index) => {
      if (!isVisible(item.start, item.end) || regionIsActive(item, selections)) return;
      const key = `o${index}`;
      for (const [start, end] of item.hide) hidden.add(key, range(start, end));
      for (const part of item.style) styled.get(part.style)?.add(key, range(part.start, part.end));
      item.insert.forEach((insertion, position) => {
        // The hover goes on the whole markup, so pointing at the drawn text finds it.
        const hover = position === 0 && item.hover ? hoverText(item.hover) : undefined;
        insertions.add(key, {
          range: hover ? range(item.start, item.end) : range(insertion.at, insertion.at),
          hoverMessage: hover,
          renderOptions: { before: insertionStyle(insertion) }
        });
      });
    });

    // Everything a type shows follows from these, so equal keys mean equal decorations.
    const state = [
      scan.version, scan.macroGeneration, this.aux.generation, options.color, options.fontSizePx, options.lineHeightPx, tabSize
    ].join(':');
    this.apply(editor, this.hidden, hidden, state);
    this.apply(editor, this.inlineImages, inlineImages, state);
    this.apply(editor, this.blockImages, blockImages, state);
    this.apply(editor, this.blockBackgrounds, blockBackgrounds, state);
    this.apply(editor, this.errors, errors, state);
    this.apply(editor, this.insertions, insertions, state);
    for (const [style, type] of this.rangeStyles) this.apply(editor, type, styled.get(style)!, state);
  }

  /** What to draw over the document's markup, rebuilt only when the document, its root's aux file or the settings change. */
  private overlaysFor(document: vscode.TextDocument, scan: DocumentScan, aux: AuxData | undefined): Overlay[] {
    if (scan.overlays?.generation === this.aux.generation) return scan.overlays.list;
    const text = document.getText();
    const list = [
      // Without a compile there is nothing to number references and citations with, so they stay as source.
      ...aux ? referenceOverlays(scan.references, aux.labels, this.cref) : [],
      ...aux ? citationOverlays(scan.citations, aux.citations) : [],
      ...structureOverlays(scan.structure, text, this.theorems, aux)
    ];
    scan.overlays = { generation: this.aux.generation, list };
    return list;
  }

  /**
   * While a block is edited its source shows, and its rendering sits to the right of its longest
   * line, as Obsidian shows it below. An edit that leaves it unrenderable keeps the last rendering.
   */
  private besideSource(
    document: vscode.TextDocument,
    region: DisplayMathRegion,
    rendered: RenderedBlock | undefined,
    tabSize: number,
    lineHeightPx: number
  ): vscode.DecorationOptions[] {
    const firstLine = document.positionAt(region.start).line;
    const last = this.lastEditPreview.get(document);
    const block = rendered ?? (last?.line === firstLine ? last.block : undefined);
    if (!block) return [];
    if (rendered) this.lastEditPreview.set(document, { line: firstLine, block: rendered });
    let widest = 0;
    for (let row = 0; row < region.rows; row++) {
      const text = document.lineAt(firstLine + row).text;
      widest = Math.max(widest, visualColumn(text, text.length, tabSize));
    }
    return block.slices.filter(slice => slice.row < region.rows).map(slice => {
      const end = document.lineAt(firstLine + slice.row).range.end;
      return {
        range: new vscode.Range(end, end),
        renderOptions: {
          after: {
            contentIconPath: this.uriFor(slice),
            width: `${block.widthPx.toFixed(2)}px`,
            height: `${lineHeightPx}px`,
            // Positioned out of the text flow, so the cursor and line lengths stay as they are.
            textDecoration: `none; position: absolute; top: 0; left: ${widest + EDIT_PREVIEW_GAP}ch;`
          }
        }
      };
    });
  }

  private apply<T extends vscode.Range | vscode.DecorationOptions>(
    editor: vscode.TextEditor,
    type: vscode.TextEditorDecorationType,
    decorations: Decorations<T>,
    state: string
  ): void {
    let applied = this.applied.get(editor);
    if (!applied) this.applied.set(editor, applied = new Map());
    const key = `${state}|${decorations.keys.join(',')}`;
    if (applied.get(type) === key) return;
    applied.set(type, key);
    editor.setDecorations(type, decorations.items as vscode.Range[] | vscode.DecorationOptions[]);
  }

  private clear(editor: vscode.TextEditor): void {
    this.applied.delete(editor);
    editor.setDecorations(this.hidden, []);
    editor.setDecorations(this.inlineImages, []);
    editor.setDecorations(this.blockImages, []);
    editor.setDecorations(this.blockBackgrounds, []);
    editor.setDecorations(this.errors, []);
    editor.setDecorations(this.insertions, []);
    for (const type of this.rangeStyles.values()) editor.setDecorations(type, []);
  }

  /** Parsing a data URI is not free, so each image keeps its Uri for as long as the renderer keeps the image. */
  private uriFor(image: { dataUri: string }): vscode.Uri {
    let uri = this.uris.get(image);
    if (!uri) {
      uri = vscode.Uri.parse(image.dataUri);
      this.uris.set(image, uri);
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
    return { fontSizePx, lineHeightPx, color: configuredColor || themeTextColor(vscode.window.activeColorTheme.kind) };
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
    const cref = emptyCrefSettings();
    const theorems: TheoremSettings = new Map();
    for (const file of files) {
      const stat = await vscode.workspace.fs.stat(file).then(value => value, () => undefined);
      if (!stat || stat.size > MAX_MACRO_FILE_BYTES) continue;
      const bytes = await vscode.workspace.fs.readFile(file).then(value => value, () => undefined);
      if (!bytes) continue;
      const text = Buffer.from(bytes).toString('utf8');
      Object.assign(macros, parseMacroDefinitions(text));
      readCrefSettings(text, cref);
      readTheoremSettings(text, theorems);
    }
    this.workspaceMacros = macros;
    this.cref = cref;
    this.theorems = theorems;
    this.macroGeneration += 1;
  }
}

/** Decorations for one type, with a key per formula that says which formulas they show. */
class Decorations<T> {
  readonly items: T[] = [];
  readonly keys: string[] = [];

  add(key: string, item: T): void {
    this.items.push(item);
    if (this.keys[this.keys.length - 1] !== key) this.keys.push(key);
  }
}

/** The screen column `character` falls at, with tabs expanded. */
function visualColumn(text: string, character: number, tabSize: number): number {
  let column = 0;
  for (let i = 0; i < character; i++) column = text[i] === '\t' ? column + tabSize - (column % tabSize) : column + 1;
  return column;
}

type ParsedDocument = Pick<DocumentScan, 'regions' | 'references' | 'citations' | 'structure' | 'root'>;

/** What a document's text holds for the preview, read in one pass over its TeX. */
function parseDocument(text: string, languageId: string): ParsedDocument {
  const source = previewSource(text, languageId);
  const regions = findMathRegions(text, languageId, source);
  return {
    regions,
    references: findReferences(text, regions, languageId, source),
    citations: findCitations(text, regions, languageId, source),
    structure: findStructure(text, regions, languageId, source),
    root: rootHint(text, source)
  };
}

function hoverText(lines: string[]): vscode.MarkdownString {
  const hover = new vscode.MarkdownString();
  lines.forEach((line, index) => {
    if (index) hover.appendMarkdown('\n\n');
    hover.appendText(line);
  });
  return hover;
}

function insertionStyle(insertion: Insertion): vscode.ThemableDecorationAttachmentRenderOptions {
  const color = insertion.color === 'link' ? 'textLink.foreground' : insertion.color === 'warning' ? 'editorWarning.foreground' : undefined;
  return {
    contentText: insertion.text,
    color: color && new vscode.ThemeColor(color),
    fontWeight: insertion.bold ? 'bold' : undefined,
    fontStyle: insertion.italic ? 'italic' : undefined,
    textDecoration: insertion.size ? `none; font-size: ${insertion.size}em;` : undefined
  };
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
