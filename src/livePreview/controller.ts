import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as vscode from 'vscode';
import { defaultHomeworkSettings, HOMEWORK_SETTINGS_FILE, parseHomeworkSettings } from '../homework';
import type { HomeworkSettings } from '../types';
import { AuxIndex } from './auxIndex';
import { citationOverlays, findCitations, type CitationRegion } from './citations';
import { ImageStore } from './imageStore';
import { decoratedLines, type LineWindow } from './lineWindow';
import { parseMacroDefinitions } from './macros';
import { findMathRegions, previewSource, regionIsActive, type DisplayMathRegion, type MathRegions } from './mathRegions';
import { MathRenderer, type MathJaxMacros, type MathRenderOptions, type RenderedBlock } from './mathRenderer';
import type { Insertion, Overlay, RangeStyle } from './overlays';
import {
  equationTags,
  findReferences,
  formatReference,
  referenceOverlays,
  rootHint,
  substituteReferences,
  type AuxData,
  type EquationTag,
  type ReferenceRegion,
  type RootHint
} from './references';
import { findStructure, solutionBoxes, structureOverlays, type Structure } from './structure';
import {
  emptyWorkspaceSettings,
  HOMEWORK_PACKAGE,
  mergeSettings,
  readFileSettings,
  settingsFingerprint,
  type WorkspaceSettings
} from './workspaceSettings';

const LANGUAGES = new Set(['latex', 'tex']);
const RESCAN_DELAY_MS = 150;
const MACRO_SCAN_DELAY_MS = 1000;
const MAX_MACRO_FILES = 200;
const MAX_MACRO_FILE_BYTES = 1024 * 1024;
/** Lines decorated on each side of the viewport, so scrolling within them sends VS Code nothing. */
const WINDOW_MARGIN_LINES = 100;
/** How near the viewport may come to an edge of the decorated lines before they move with it. */
const WINDOW_GUARD_LINES = 30;
/** Formulas this near the viewport render at once; the rest of the decorated lines render in the background. */
const NEAR_LINES = 10;
/** Lines beyond the decorated ones rendered in the background too, so scrolling there finds them ready. */
const PREFETCH_LINES = 300;
/** Longest stretch of background rendering before other events get their turn. */
const SLICE_MS = 8;
/** How often formulas rendered in the background are shown while more are still coming. */
const SHOW_EVERY_MS = 100;
/** Columns between the longest line of a block being edited and its rendering. */
const EDIT_PREVIEW_GAP = 4;
/**
 * Names the backgrounds laid under display formulas, which span their lines as wide as VS Code lays
 * the lines out: a formula is centred against one with CSS anchor positioning. Unlike the lines'
 * text, VS Code does not measure them, so their width follows the editor's as it is resized.
 */
const PAGE_ANCHOR = '--latex-toolkit-page';
/** homework.sty's solution box, tinted from the link colour as a callout is, and its title bar more strongly. */
const SOLUTION_TINT = 'color-mix(in srgb, var(--vscode-textLink-foreground) 6%, transparent)';
const SOLUTION_TITLE_TINT = 'color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent)';

interface DocumentScan {
  version: number;
  regions: MathRegions;
  references: ReferenceRegion[];
  citations: CitationRegion[];
  structure: Structure;
  /** The text with comments and verbatim blanked. */
  source: string;
  /** What the document says about its root, whose compile numbers its references. */
  root: RootHint;
  /** Workspace macros overlaid with the document's own, rebuilt only when either changes. */
  macros: MathJaxMacros;
  macroGeneration: number;
  /** What to draw over the markup, for the aux files as they were at `generation`. */
  overlays?: Markup;
}

interface Markup {
  generation: number;
  list: Overlay[];
  /** Solutions, whose lines are tinted as homework.sty's box. */
  boxes: Array<{ start: number; end: number }>;
}

/** A formula to render in the background, nearest the viewport first. */
interface RenderTask {
  editor: vscode.TextEditor;
  distance: number;
  /** Whether it is among the decorated lines, so the editor shows it once rendered. */
  shown: boolean;
  render: () => void;
}

/**
 * Marks a decoration as changing how wide its text is drawn. On a line with none of these and no
 * attached content, VS Code places the cursor and reads clicks by counting columns of a
 * monospaced font, which text the preview hides or resizes throws off; with one, it measures the
 * line as drawn. VS Code only asks whether letter spacing is set, so this keeps the editor's own.
 */
const CHANGES_WIDTH: vscode.DecorationRenderOptions = { letterSpacing: 'inherit' };

/** How each style a stretch of source can take is drawn. */
const RANGE_STYLES: Record<RangeStyle, vscode.DecorationRenderOptions> = {
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  // textDecoration carries CSS the public options do not have, as for hiding.
  smallCaps: { ...CHANGES_WIDTH, textDecoration: 'none; font-variant: small-caps;' },
  dim: { opacity: '0.45' },
  chapter: { ...CHANGES_WIDTH, fontWeight: 'bold', textDecoration: 'none; font-size: 1.3em;' },
  section: { ...CHANGES_WIDTH, fontWeight: 'bold', textDecoration: 'none; font-size: 1.2em;' },
  subsection: { ...CHANGES_WIDTH, fontWeight: 'bold', textDecoration: 'none; font-size: 1.1em;' }
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
  private readonly hidden = vscode.window.createTextEditorDecorationType({ ...CHANGES_WIDTH, textDecoration: 'none; display: none;' });
  private readonly inlineImages = vscode.window.createTextEditorDecorationType({});
  // Display images are large; keeping them apart means moving through inline math does not resend them.
  private readonly blockImages = vscode.window.createTextEditorDecorationType({});
  // The editor still draws indent guides for a block's hidden source, and on lines carrying an image
  // it measures them from the image's right edge. Painting the lines in the editor's background
  // covers them; rulers are drawn above this layer, so they stay.
  private readonly blockBackgrounds = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: `var(--vscode-editor-background); anchor-name: ${PAGE_ANCHOR};`
  });
  // Translucent, as decorations are drawn above the selection.
  private readonly solutionTitles = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: SOLUTION_TITLE_TINT });
  private readonly solutionBodies = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: SOLUTION_TINT });
  // A formula's lines in a solution take the box over the editor's background, which covers their
  // indent guides as blockBackgrounds does; two separate types could be drawn in either order.
  private readonly solutionBlockBackgrounds = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: `var(--vscode-editor-background); background-image: linear-gradient(${SOLUTION_TINT}, ${SOLUTION_TINT}); anchor-name: ${PAGE_ANCHOR};`
  });
  private readonly errors = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline wavy var(--vscode-editorError-foreground)'
  });
  /** Text drawn in place of markup: numbers, citations, theorem heads and list labels. */
  private readonly insertions = vscode.window.createTextEditorDecorationType({});
  private readonly rangeStyles = new Map(Object.entries(RANGE_STYLES).map(([style, options]) =>
    [style as RangeStyle, vscode.window.createTextEditorDecorationType(options)]));
  private readonly images: ImageStore | undefined;
  private readonly renderer: MathRenderer;
  private readonly aux: AuxIndex;
  private readonly scans = new WeakMap<vscode.TextDocument, DocumentScan>();
  /** What each editor shows per decoration type, so unchanged decorations are not sent again. */
  private readonly applied = new WeakMap<vscode.TextEditor, Map<vscode.TextEditorDecorationType, string>>();
  /** The last block rendered beside its source, kept while an edit leaves it unrenderable. */
  private readonly lastEditPreview = new WeakMap<vscode.TextDocument, { line: number; block: RenderedBlock }>();
  private readonly rescanTimers = new Map<string, NodeJS.Timeout>();
  private readonly uris = new WeakMap<{ uri: string }, vscode.Uri>();
  /** The lines each editor decorates, kept while it scrolls within them. */
  private readonly windows = new WeakMap<vscode.TextEditor, LineWindow>();
  /** What each editor's background rendering was planned for, so it is planned again only when that changes. */
  private plans = new WeakMap<vscode.TextEditor, string>();
  private readonly shownAt = new WeakMap<vscode.TextEditor, number>();
  private tasks: RenderTask[] = [];
  private backgroundTimer?: NodeJS.Immediate;
  private readonly disposables: vscode.Disposable[] = [];
  private workspace: WorkspaceSettings = emptyWorkspaceSettings();
  private workspaceFingerprint = '';
  /** What each workspace file sets, kept until the file changes. */
  private readonly fileSettings = new Map<string, { mtime: number; size: number; settings: WorkspaceSettings }>();
  private macroGeneration = 0;
  private macroTimer?: NodeJS.Timeout;
  private enabled = false;
  private starting?: Promise<void>;

  /** `imageRoot` is where rendered images are kept as files; without one they travel as data URIs. */
  constructor(private readonly output: vscode.OutputChannel, imageRoot?: string) {
    this.images = imageRoot ? new ImageStore(imageRoot) : undefined;
    this.renderer = new MathRenderer(this.images?.write);
    this.aux = new AuxIndex(output);
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,sty}');
    this.disposables.push(
      this.hidden,
      this.inlineImages,
      this.blockImages,
      this.blockBackgrounds,
      this.solutionTitles,
      this.solutionBodies,
      this.solutionBlockBackgrounds,
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
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.tasks = this.tasks.filter(task => vscode.window.visibleTextEditors.includes(task.editor));
        this.updateAll();
      }),
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
    if (this.backgroundTimer) clearImmediate(this.backgroundTimer);
    this.tasks = [];
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.images?.dispose();
  }

  private readEnabled(): boolean {
    return vscode.workspace.getConfiguration('latexEditingToolkit.livePreview').get<boolean>('enabled', false);
  }

  private setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const editor of vscode.window.visibleTextEditors) this.clear(editor);
      this.tasks = [];
      this.plans = new WeakMap();
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
    } else if (event.affectsConfiguration('editor.wordWrap') || event.affectsConfiguration('editor.wordWrapColumn')) {
      this.updateAll();
    }
  }

  /** Re-renders everything, for changes that alter how every formula looks. */
  private refresh(): void {
    this.renderer.clearCache();
    // The renderings the queues were planned around are gone.
    this.plans = new WeakMap();
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
      source: parsed.source,
      root: parsed.root,
      macros: { ...this.workspace.macros, ...parseMacroDefinitions(text, parsed.source) },
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
    // Decorated: the lines around the viewport, kept while it scrolls within them, so that scrolling
    // sends nothing. Near: the lines just around what is in view, whose formulas render at once.
    const viewport = editor.visibleRanges;
    const top = viewport.length ? Math.min(...viewport.map(range => range.start.line)) : 0;
    const bottom = viewport.length ? Math.max(...viewport.map(range => range.end.line)) : 0;
    const lines = decoratedLines(this.windows.get(editor), top, bottom, WINDOW_MARGIN_LINES, WINDOW_GUARD_LINES);
    this.windows.set(editor, lines);
    const span = (first: number, last: number) => ({
      start: document.offsetAt(new vscode.Position(Math.max(0, first), 0)),
      end: document.offsetAt(new vscode.Position(Math.max(0, last), Number.MAX_SAFE_INTEGER))
    });
    const decorated = span(lines.first, lines.last);
    const near = viewport.map(range => span(range.start.line - NEAR_LINES, range.end.line + NEAR_LINES));
    const isVisible = (start: number, end: number) => end >= decorated.start && start <= decorated.end;
    const isNear = (start: number, end: number) => near.some(part => end >= part.start && start <= part.end);
    const options: MathRenderOptions = { ...this.renderSizing(document), macros: scan.macros };
    const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
    const editorConfig = vscode.workspace.getConfiguration('editor', document);
    const wrapMode = editorConfig.get<string>('wordWrap', 'off');
    const wraps = wrapMode !== 'off';
    // A text width the settings fix is the page display formulas centre on, as LaTeX centres them
    // on its text width; bounded wraps at the window when it is narrower.
    const pageColumns = wrapMode === 'bounded' || wrapMode === 'wordWrapColumn' ? editorConfig.get<number>('wordWrapColumn', 80) : undefined;
    // Until the root has been compiled there are no numbers, and references stay as source.
    const aux = this.aux.auxFor(document, scan.root);
    const labels = aux?.labels;
    const withNumbers = (tex: string) => labels
      ? substituteReferences(tex, reference => formatReference(reference, labels, this.workspace.cref).text)
      : tex;

    const hidden = new Decorations<vscode.Range>();
    const inlineImages = new Decorations<vscode.DecorationOptions>();
    const blockImages = new Decorations<vscode.DecorationOptions>();
    const blockBackgrounds = new Decorations<vscode.Range>();
    const solutionTitles = new Decorations<vscode.Range>();
    const solutionBodies = new Decorations<vscode.Range>();
    const solutionBlockBackgrounds = new Decorations<vscode.Range>();
    const errors = new Decorations<vscode.DecorationOptions>();
    const insertions = new Decorations<vscode.DecorationOptions>();
    const styled = new Map([...this.rangeStyles.keys()].map(style => [style, new Decorations<vscode.Range>()]));

    scan.regions.inline.forEach((region, index) => {
      if (!isVisible(region.start, region.end) || regionIsActive(region, selections)) return;
      const tex = withNumbers(region.tex);
      // The rest render in the background and show once they have.
      const result = isNear(region.start, region.end) ? this.renderer.render(tex, options) : this.renderer.peek(tex, options);
      if (!result) return;
      const range = new vscode.Range(document.positionAt(region.start), document.positionAt(region.end));
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

    const markup = this.markupFor(document, scan, aux);
    // A solution nested in another lies in its box already.
    const boxes: Array<{ index: number; first: number; last: number; formulas: Array<{ index: number; first: number; last: number }> }> = [];
    markup.boxes.forEach((box, index) => {
      if (!isVisible(box.start, box.end)) return;
      const first = document.positionAt(box.start).line;
      if (boxes.length && first <= boxes[boxes.length - 1].last) return;
      boxes.push({ index, first, last: document.positionAt(box.end).line, formulas: [] });
    });

    scan.regions.display.forEach((region, index) => {
      if (!isVisible(region.linesStart, region.linesEnd)) return;
      const firstLine = document.positionAt(region.start).line;
      const tex = withNumbers(region.tex);
      const tags = equationTags(region.tex, labels);
      if (regionIsActive({ start: region.linesStart, end: region.linesEnd }, selections)) {
        const result = this.renderer.renderBlock(tex, region.rows, options, tags);
        const rendered = result.ok ? result.image : undefined;
        for (const item of this.besideSource(document, region, rendered, tabSize, options.lineHeightPx)) blockImages.add(`p${index}`, item);
        return;
      }
      const result = isNear(region.linesStart, region.linesEnd)
        ? this.renderer.renderBlock(tex, region.rows, options, tags)
        : this.renderer.peekBlock(tex, region.rows, options, tags);
      if (!result) return;
      if (!result.ok) {
        const opening = new vscode.Range(document.positionAt(region.start), document.lineAt(firstLine).range.end);
        errors.add(`d${index}`, { range: opening, hoverMessage: `Live math preview: ${result.error}` });
        return;
      }
      for (let row = 0; row < region.rows; row++) {
        const line = document.lineAt(firstLine + row);
        if (!line.range.isEmpty) hidden.add(`d${index}`, line.range);
      }
      const lastLine = firstLine + region.rows - 1;
      const box = boxes.find(item => item.first < firstLine && lastLine <= item.last);
      box?.formulas.push({ index, first: firstLine, last: lastLine });
      (box ? solutionBlockBackgrounds : blockBackgrounds).add(`d${index}`, new vscode.Range(firstLine, 0, lastLine, 0));
      // Indented one level from its delimiter, as display math stands out from the text around it.
      const indent = visualColumn(document.lineAt(firstLine).text, document.positionAt(region.start).character, tabSize) + tabSize;
      // VS Code wraps a line by its text even while the preview hides it, and does not tell
      // extensions where, so with word wrap a row that wraps would push the strips below it down
      // and split the formula. Then all of them hang from the block's last line instead, one above
      // another: whatever the rows take, the formula stays whole within the block. It shows while
      // that line is on screen, so scrolling down never takes it away while it is being read.
      // The formula is centred on the lines as the editor shows them, or on the page where the
      // settings fix one, and starts at the left edge when wider. The strips are fixed so that
      // the backgrounds of the lines, which hold the anchor, are within their reach.
      const anchor = wraps ? region.rows - 1 : -1;
      const half = (result.image.formulaWidthPx / 2).toFixed(2);
      const page = pageColumns === undefined ? undefined : `${pageColumns / 2}ch`;
      const lines = `anchor(${PAGE_ANCHOR} center, ${page ?? `calc(${indent}ch + ${half}px)`})`;
      const centre = wrapMode === 'wordWrapColumn' ? page : wrapMode === 'bounded' ? `min(${lines}, ${page})` : lines;
      const left = `max(0px, ${centre} - ${half}px)`;
      for (const slice of result.image.slices) {
        const start = new vscode.Position(firstLine + (wraps ? anchor : slice.row), 0);
        blockImages.add(`d${index}`, {
          range: new vscode.Range(start, start),
          renderOptions: {
            before: {
              contentIconPath: this.uriFor(slice),
              width: `${result.image.widthPx.toFixed(2)}px`,
              height: `${options.lineHeightPx}px`,
              ...wraps
                ? { textDecoration: `none; position: fixed; margin-top: ${(slice.row - anchor) * options.lineHeightPx}px; left: ${left};` }
                // Each strip fills its line exactly, so the strips join into one formula.
                : { margin: `0 0 0 ${indent}ch`, textDecoration: 'none; vertical-align: top;' }
            }
          }
        });
      }
    });

    // The first line as the box's title bar, the rest as its body around the formulas drawn over theirs.
    for (const box of boxes) {
      solutionTitles.add(`s${box.index}`, new vscode.Range(box.first, 0, box.first, 0));
      const key = `s${box.index}:${box.formulas.map(formula => formula.index).join('.')}`;
      let from = box.first + 1;
      for (const formula of box.formulas) {
        if (formula.first > from) solutionBodies.add(key, new vscode.Range(from, 0, formula.first - 1, 0));
        from = formula.last + 1;
      }
      if (from <= box.last) solutionBodies.add(key, new vscode.Range(from, 0, box.last, 0));
    }

    const range = (start: number, end: number) => new vscode.Range(document.positionAt(start), document.positionAt(end));
    markup.list.forEach((item, index) => {
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
      scan.version, scan.macroGeneration, this.aux.generation, options.color, options.fontSizePx, options.lineHeightPx, tabSize, wraps, pageColumns
    ].join(':');
    this.apply(editor, this.hidden, hidden, state);
    this.apply(editor, this.inlineImages, inlineImages, state);
    this.apply(editor, this.blockImages, blockImages, state);
    this.apply(editor, this.blockBackgrounds, blockBackgrounds, state);
    this.apply(editor, this.solutionTitles, solutionTitles, state);
    this.apply(editor, this.solutionBodies, solutionBodies, state);
    this.apply(editor, this.solutionBlockBackgrounds, solutionBlockBackgrounds, state);
    this.apply(editor, this.errors, errors, state);
    this.apply(editor, this.insertions, insertions, state);
    for (const [style, type] of this.rangeStyles) this.apply(editor, type, styled.get(style)!, state);
    this.planBackground(editor, scan, lines, options, withNumbers, labels);
  }

  /**
   * Queues the formulas of the decorated lines that have not rendered yet, and those of the lines
   * beyond them, nearest the viewport first, unless the editor's queue is already for these lines,
   * this text and these settings.
   */
  private planBackground(
    editor: vscode.TextEditor,
    scan: DocumentScan,
    lines: LineWindow,
    options: MathRenderOptions,
    withNumbers: (tex: string) => string,
    labels: AuxData['labels'] | undefined
  ): void {
    const plan = [
      scan.version, scan.macroGeneration, this.aux.generation, lines.first, lines.last, options.color, options.fontSizePx, options.lineHeightPx
    ].join(':');
    if (this.plans.get(editor) === plan) return;
    this.plans.set(editor, plan);
    const document = editor.document;
    const from = document.offsetAt(new vscode.Position(Math.max(0, lines.first - PREFETCH_LINES), 0));
    const to = document.offsetAt(new vscode.Position(lines.last + PREFETCH_LINES, Number.MAX_SAFE_INTEGER));
    const middle = (lines.first + lines.last) / 2;
    const tasks: RenderTask[] = [];
    const queue = (start: number, render: () => void) => {
      const line = document.positionAt(start).line;
      tasks.push({ editor, distance: Math.abs(line - middle), shown: line >= lines.first && line <= lines.last, render });
    };
    for (const region of scan.regions.inline) {
      if (region.end < from || region.start > to) continue;
      const tex = withNumbers(region.tex);
      if (!this.renderer.peek(tex, options)) queue(region.start, () => this.renderer.render(tex, options));
    }
    for (const region of scan.regions.display) {
      if (region.end < from || region.start > to) continue;
      const tex = withNumbers(region.tex);
      const tags: EquationTag[] = equationTags(region.tex, labels);
      if (!this.renderer.peekBlock(tex, region.rows, options, tags)) queue(region.start, () => this.renderer.renderBlock(tex, region.rows, options, tags));
    }
    tasks.sort((a, b) => a.distance - b.distance);
    this.tasks = [...this.tasks.filter(task => task.editor !== editor), ...tasks];
    if (this.tasks.length && !this.backgroundTimer) this.backgroundTimer = setImmediate(this.runBackground);
  }

  /**
   * Renders queued formulas for a slice of time, then yields so that other events, typing among
   * them, are not held up. An editor shows what it gained once its decorated lines are done, and
   * every so often while many are still coming.
   */
  private readonly runBackground = (): void => {
    this.backgroundTimer = undefined;
    if (!this.enabled) return;
    const deadline = performance.now() + SLICE_MS;
    const gained = new Set<vscode.TextEditor>();
    while (this.tasks.length && performance.now() < deadline) {
      const task = this.tasks.shift()!;
      task.render();
      if (task.shown) gained.add(task.editor);
    }
    const now = performance.now();
    for (const editor of gained) {
      const more = this.tasks.some(task => task.editor === editor && task.shown);
      if (more && now - (this.shownAt.get(editor) ?? 0) < SHOW_EVERY_MS) continue;
      this.shownAt.set(editor, now);
      if (vscode.window.visibleTextEditors.includes(editor)) this.update(editor);
    }
    if (this.tasks.length) this.backgroundTimer = setImmediate(this.runBackground);
  };

  /** What to draw over the document's markup, rebuilt only when the document, its root's aux file or the settings change. */
  private markupFor(document: vscode.TextDocument, scan: DocumentScan, aux: AuxData | undefined): Markup {
    if (scan.overlays?.generation === this.aux.generation) return scan.overlays;
    const text = document.getText();
    const homework = this.homeworkFor(document, text, scan.source);
    const list = [
      // Without a compile there is nothing to number references and citations with, so they stay as source.
      ...aux ? referenceOverlays(scan.references, aux.labels, this.workspace.cref) : [],
      ...aux ? citationOverlays(scan.citations, aux.citations) : [],
      ...structureOverlays(scan.structure, text, this.workspace.theorems, aux, homework)
    ];
    scan.overlays = { generation: this.aux.generation, list, boxes: homework ? solutionBoxes(scan.structure) : [] };
    return scan.overlays;
  }

  /**
   * How homework.sty numbers the document: the Homework panel's settings file beside the document
   * or above it, then whatever the document sets after loading that file, as the template allows.
   */
  private homeworkFor(document: vscode.TextDocument, text: string, source: string): HomeworkSettings | undefined {
    if (!this.workspace.homeworkPackage && !HOMEWORK_PACKAGE.test(text)) return undefined;
    let settings = defaultHomeworkSettings();
    if (document.uri.scheme === 'file') {
      for (let dir = path.dirname(document.uri.fsPath); ; dir = path.dirname(dir)) {
        const generated = this.workspace.homeworkFiles.get(dir);
        if (generated !== undefined) {
          settings = parseHomeworkSettings(generated);
          break;
        }
        if (path.dirname(dir) === dir) break;
      }
    }
    const hook = source.indexOf(HOMEWORK_SETTINGS_FILE);
    return parseHomeworkSettings(hook === -1 ? source : source.slice(hook), settings);
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
    this.plans.delete(editor);
    this.tasks = this.tasks.filter(task => task.editor !== editor);
    editor.setDecorations(this.hidden, []);
    editor.setDecorations(this.inlineImages, []);
    editor.setDecorations(this.blockImages, []);
    editor.setDecorations(this.blockBackgrounds, []);
    editor.setDecorations(this.solutionTitles, []);
    editor.setDecorations(this.solutionBodies, []);
    editor.setDecorations(this.solutionBlockBackgrounds, []);
    editor.setDecorations(this.errors, []);
    editor.setDecorations(this.insertions, []);
    for (const type of this.rangeStyles.values()) editor.setDecorations(type, []);
  }

  /** Parsing an image's URI is not free, so each image keeps its Uri for as long as the renderer keeps the image. */
  private uriFor(image: { uri: string }): vscode.Uri {
    let uri = this.uris.get(image);
    if (!uri) {
      uri = vscode.Uri.parse(image.uri);
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
  /**
   * Collects what every .tex and .sty file in the workspace sets: macros, cleveref and theorem
   * settings, homework.sty and its settings files. A file is read again only once it changes, and
   * documents are scanned again only if what the files set did, so saving one costs little.
   */
  private async scanWorkspaceMacros(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.{tex,sty}', '**/{.git,.overleaf-codex,node_modules}/**', MAX_MACRO_FILES);
    files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const parts: WorkspaceSettings[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const stat = await vscode.workspace.fs.stat(file).then(value => value, () => undefined);
      if (!stat || stat.size > MAX_MACRO_FILE_BYTES) continue;
      let known = this.fileSettings.get(file.fsPath);
      if (!known || known.mtime !== stat.mtime || known.size !== stat.size) {
        const bytes = await vscode.workspace.fs.readFile(file).then(value => value, () => undefined);
        if (!bytes) continue;
        known = { mtime: stat.mtime, size: stat.size, settings: readFileSettings(file.fsPath, Buffer.from(bytes).toString('utf8')) };
        this.fileSettings.set(file.fsPath, known);
      }
      seen.add(file.fsPath);
      parts.push(known.settings);
    }
    for (const file of this.fileSettings.keys()) if (!seen.has(file)) this.fileSettings.delete(file);
    const workspace = mergeSettings(parts);
    const fingerprint = settingsFingerprint(workspace);
    if (fingerprint === this.workspaceFingerprint) return;
    this.workspace = workspace;
    this.workspaceFingerprint = fingerprint;
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

type ParsedDocument = Pick<DocumentScan, 'regions' | 'references' | 'citations' | 'structure' | 'source' | 'root'>;

/** What a document's text holds for the preview, read in one pass over its TeX. */
function parseDocument(text: string, languageId: string): ParsedDocument {
  const source = previewSource(text, languageId);
  const regions = findMathRegions(text, languageId, source);
  return {
    regions,
    references: findReferences(text, regions, languageId, source),
    citations: findCitations(text, regions, languageId, source),
    structure: findStructure(text, regions, languageId, source),
    source,
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
