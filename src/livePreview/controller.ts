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
import { findMathRegions, moveRegion, previewSource, regionIsActive, texWithCursor, type MathRegion, type MathRegions } from './mathRegions';
import { MathRenderer, type MathJaxMacros, type MathRenderOptions, type RenderedMath } from './mathRenderer';
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
import { SentDecorations, type SentItem, type Span } from './sentDecorations';
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
/**
 * Lines beyond the decorated ones rendered in the background too, nearest first, so that scrolling
 * or jumping there finds them ready: the whole of most documents, a few seconds' work at most.
 */
const PREFETCH_LINES = 4000;
/** Longest stretch of background rendering before other events get their turn. */
const SLICE_MS = 8;
/** How often formulas rendered in the background are shown while more are still coming. */
const SHOW_EVERY_MS = 100;
/**
 * Each decoration type is split into slots, given to markup by the block of lines it sits in, so
 * that a change to one formula sends VS Code only the decorations sharing its slot.
 */
const SLOT_LINES = 16;
const SLOT_COUNT = 24;
/**
 * VS Code applies decorations to the text as it is when they arrive, so an edit made while they
 * were on their way leaves them misplaced. One that reaches the extension this soon after a send
 * may have been, and what was sent is sent again; once edits stop for a while, everything is sent
 * again, which mends whatever that missed.
 */
const SEND_SETTLE_MS = 20;
const RESEND_AFTER_EDITS_MS = 1000;
/** Marks the cursor in the preview shown while a formula is edited, as Latex Suite does in Obsidian. */
const CURSOR_MARKER = '\u25B6';
/** Space around the formula in that preview, inside its border, and between it and the formula's line. */
const EDIT_PREVIEW_PADDING = { x: 8, y: 4 };
const EDIT_PREVIEW_BORDER = 1;
const EDIT_PREVIEW_GAP = 2;
/**
 * Name the first characters of the formula being edited and of its closing delimiter, which that
 * preview is placed against with CSS anchor positioning. They are drawn as backgrounds: the preview
 * cannot reach an anchor in the text of a line.
 */
const FORMULA_START_ANCHOR = '--latex-toolkit-formula-start';
const FORMULA_END_ANCHOR = '--latex-toolkit-formula-end';
/** Space a display formula keeps from its numbers, in editor ems, and they from the editor's right edge, in columns. */
const NUMBER_GAP_EM = 2;
const NUMBER_MARGIN_CH = 1;
/**
 * Names the backgrounds laid under display formulas, which span their lines as wide as VS Code lays
 * the lines out: a formula is centred against one with CSS anchor positioning. Unlike the lines'
 * text, VS Code does not measure them, so their width follows the editor's as it is resized.
 */
const PAGE_ANCHOR = '--latex-toolkit-page';
/** A theme colour faded into the background, `percent` of it showing. */
const tinted = (color: string, percent: number) => `color-mix(in srgb, var(--vscode-${color.replace(/\./g, '-')}) ${percent}%, transparent)`;
/** homework.sty's solution box, tinted from the link colour as a callout is, and its title bar more strongly. */
const SOLUTION_TINT = tinted('textLink.foreground', 6);
const SOLUTION_TITLE_TINT = tinted('textLink.foreground', 14);

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
  subsection: { ...CHANGES_WIDTH, fontWeight: 'bold', textDecoration: 'none; font-size: 1.1em;' },
  key: { fontWeight: 'bold', color: new vscode.ThemeColor('textLink.foreground'), backgroundColor: tinted('textLink.foreground', 16), borderRadius: '3px' },
  term: { color: new vscode.ThemeColor('textLink.foreground'), backgroundColor: tinted('textLink.foreground', 12), borderRadius: '3px' },
  warn: { fontWeight: 'bold', color: new vscode.ThemeColor('editorWarning.foreground'), backgroundColor: tinted('editorWarning.foreground', 16), borderRadius: '3px' }
};

/**
 * Shows formulas rendered in place while the cursor is elsewhere, Obsidian-style. Leaving the
 * editor's text untouched is the point: the source is only hidden by decorations, so every
 * editing feature keeps working on it, and moving onto a formula shows it again.
 *
 * Display formulas are drawn over the lines their source takes, since an extension cannot change
 * line heights. The source keeps its lines when shown again, so nothing below it moves. For the
 * same reason the rendering of a formula being edited floats over the lines above it.
 */
export class LiveMathPreview implements vscode.Disposable {
  // Hiding works by injecting CSS through textDecoration, which VS Code emits verbatim.
  private readonly hidden = new SlottedType({ ...CHANGES_WIDTH, textDecoration: 'none; display: none;' });
  private readonly inlineImages = new SlottedType({});
  // Display images are large; keeping them apart means moving through inline math does not resend them.
  private readonly blockImages = new SlottedType({});
  // The editor still draws indent guides for a block's hidden source, and on lines carrying an image
  // it measures them from the image's right edge. Painting the lines in the editor's background
  // covers them; rulers are drawn above this layer, so they stay.
  private readonly blockBackgrounds = new SlottedType({
    isWholeLine: true,
    backgroundColor: `var(--vscode-editor-background); anchor-name: ${PAGE_ANCHOR};`
  });
  // Translucent, as decorations are drawn above the selection.
  private readonly solutionTitles = new SlottedType({ isWholeLine: true, backgroundColor: SOLUTION_TITLE_TINT });
  private readonly solutionBodies = new SlottedType({ isWholeLine: true, backgroundColor: SOLUTION_TINT });
  // A formula's lines in a solution take the box over the editor's background, which covers their
  // indent guides as blockBackgrounds does; two separate types could be drawn in either order.
  private readonly solutionBlockBackgrounds = new SlottedType({
    isWholeLine: true,
    backgroundColor: `var(--vscode-editor-background); background-image: linear-gradient(${SOLUTION_TINT}, ${SOLUTION_TINT}); anchor-name: ${PAGE_ANCHOR};`
  });
  private readonly errors = new SlottedType({
    textDecoration: 'underline wavy var(--vscode-editorError-foreground)'
  });
  /** Text drawn in place of markup: numbers, citations, theorem heads and list labels. */
  private readonly insertions = new SlottedType({});
  // There is one formula being edited, so these need no slots.
  private readonly editPreview = new SlottedType({}, 1);
  private readonly formulaStart = new SlottedType({ backgroundColor: `transparent; anchor-name: ${FORMULA_START_ANCHOR};` }, 1);
  private readonly formulaEnd = new SlottedType({ backgroundColor: `transparent; anchor-name: ${FORMULA_END_ANCHOR};` }, 1);
  // The edited formula's lines report the editor's width, as the backgrounds under display formulas do.
  private readonly formulaLines = new SlottedType({ isWholeLine: true, backgroundColor: `transparent; anchor-name: ${PAGE_ANCHOR};` }, 1);
  private readonly rangeStyles = new Map(Object.entries(RANGE_STYLES).map(([style, options]) =>
    [style as RangeStyle, new SlottedType(options)]));
  private readonly images: ImageStore | undefined;
  private readonly renderer: MathRenderer;
  private readonly aux: AuxIndex;
  private readonly scans = new WeakMap<vscode.TextDocument, DocumentScan>();
  /** What each editor's decoration types hold, so that what VS Code holds already is not sent again. */
  private readonly sent = new WeakMap<vscode.TextEditor, SentDecorations<vscode.TextEditorDecorationType>>();
  /** The formula each editor previews while it is edited, followed through the edits made since the document was read. */
  private readonly editing = new WeakMap<vscode.TextEditor, EditedFormula>();
  /** The last rendering of the formula being edited, kept while an edit leaves it unrenderable. */
  private readonly lastEditPreview = new WeakMap<vscode.TextDocument, { start: number; image: RenderedMath }>();
  private readonly rescanTimers = new Map<string, NodeJS.Timeout>();
  private readonly resendTimers = new Map<string, NodeJS.Timeout>();
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
      this.editPreview,
      this.formulaStart,
      this.formulaEnd,
      this.formulaLines,
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
      vscode.workspace.onDidChangeTextDocument(event => {
        this.moveSent(event);
        this.scheduleRescan(event.document);
      }),
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
    for (const timer of this.resendTimers.values()) clearTimeout(timer);
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
      // MathJax loads while the workspace is read; neither needs the other.
      await Promise.all([this.renderer.load(), this.scanWorkspaceMacros()]);
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

  /** Moves what each editor of the document holds through the edit, as VS Code moves the decorations. */
  private moveSent(event: vscode.TextDocumentChangeEvent): void {
    if (!event.contentChanges.length) return;
    const edits = event.contentChanges.map(change => ({ offset: change.rangeOffset, length: change.rangeLength, inserted: change.text.length }));
    const now = performance.now();
    const text = event.document.getText();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document !== event.document) continue;
      this.sent.get(editor)?.move(edits, now);
      const edited = this.editing.get(editor);
      const region = edited && moveRegion(edited.region, edits, text);
      if (edited && region) this.editing.set(editor, { ...edited, region });
      else this.editing.delete(editor);
    }
    const key = event.document.uri.toString();
    clearTimeout(this.resendTimers.get(key));
    this.resendTimers.set(key, setTimeout(() => {
      this.resendTimers.delete(key);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document !== event.document) continue;
        this.sent.get(editor)?.unsettle();
        this.update(editor);
      }
    }, RESEND_AFTER_EDITS_MS));
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
    if (cached && cached.version !== document.version && this.rescanTimers.has(document.uri.toString())) {
      // The formula being edited still follows each keystroke.
      this.followEditedFormula(editor, cached);
      return;
    }

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
    const withNumbers = this.numbering(labels);

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
    const range = (start: number, end: number) => new vscode.Range(document.positionAt(start), document.positionAt(end));
    const lineStart = (line: number) => document.offsetAt(new vscode.Position(line, 0));
    // A whole-line decoration, which VS Code tracks from the start of its first line to that of its last.
    const wholeLines = (first: number, last: number): [number, number, vscode.Range] => [lineStart(first), lineStart(last), new vscode.Range(first, 0, last, 0)];

    for (const region of scan.regions.inline) {
      if (!isVisible(region.start, region.end) || regionIsActive(region, selections)) continue;
      const tex = withNumbers(region.tex);
      // The rest render in the background and show once they have.
      const result = isNear(region.start, region.end) ? this.renderer.render(tex, options) : this.renderer.peek(tex, options);
      if (!result) continue;
      const whole = range(region.start, region.end);
      if (!result.ok) {
        errors.add(region, region.start, region.end, { range: whole, hoverMessage: `Live math preview: ${result.error}` }, result.error);
        continue;
      }
      const { widthPx, heightPx, verticalAlignPx } = result.image;
      hidden.add(region, region.start, region.end, whole);
      inlineImages.add(region, region.start, region.start, {
        range: new vscode.Range(whole.start, whole.start),
        renderOptions: {
          before: {
            contentIconPath: this.uriFor(result.image),
            width: `${widthPx.toFixed(2)}px`,
            height: `${heightPx.toFixed(2)}px`,
            // The public options have no vertical-align; textDecoration carries it into the CSS.
            textDecoration: `none; vertical-align: ${verticalAlignPx.toFixed(2)}px;`
          }
        }
      }, result.image.uri);
    }

    const markup = this.markupFor(document, scan, aux);
    // A solution nested in another lies in its box already.
    const boxes: Array<Span & { first: number; last: number; formulas: Array<{ first: number; last: number }> }> = [];
    for (const box of markup.boxes) {
      if (!isVisible(box.start, box.end)) continue;
      const first = document.positionAt(box.start).line;
      if (boxes.length && first <= boxes[boxes.length - 1].last) continue;
      boxes.push({ ...box, first, last: document.positionAt(box.end).line, formulas: [] });
    }

    for (const region of scan.regions.display) {
      if (!isVisible(region.linesStart, region.linesEnd)) continue;
      if (regionIsActive({ start: region.linesStart, end: region.linesEnd }, selections)) continue;
      const owner: Span = { start: region.linesStart, end: region.linesEnd };
      const firstLine = document.positionAt(region.start).line;
      const tex = withNumbers(region.tex);
      const tags = equationTags(region.tex, labels);
      const result = isNear(region.linesStart, region.linesEnd)
        ? this.renderer.renderBlock(tex, region.rows, options, tags)
        : this.renderer.peekBlock(tex, region.rows, options, tags);
      if (!result) continue;
      if (!result.ok) {
        const openingEnd = document.offsetAt(document.lineAt(firstLine).range.end);
        errors.add(owner, region.start, openingEnd, { range: range(region.start, openingEnd), hoverMessage: `Live math preview: ${result.error}` }, result.error);
        continue;
      }
      for (let row = 0; row < region.rows; row++) {
        const line = document.lineAt(firstLine + row);
        const at = lineStart(firstLine + row);
        if (!line.range.isEmpty) hidden.add(owner, at, at + line.text.length, line.range);
      }
      const lastLine = firstLine + region.rows - 1;
      const box = boxes.find(item => item.first < firstLine && lastLine <= item.last);
      box?.formulas.push({ first: firstLine, last: lastLine });
      (box ? solutionBlockBackgrounds : blockBackgrounds).add(owner, ...wholeLines(firstLine, lastLine));
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
      const half = (result.image.widthPx / 2).toFixed(2);
      const page = pageColumns === undefined ? undefined : `${pageColumns / 2}ch`;
      const lines = `anchor(${PAGE_ANCHOR} center, ${page ?? `calc(${indent}ch + ${half}px)`})`;
      const centre = wrapMode === 'wordWrapColumn' ? page : wrapMode === 'bounded' ? `min(${lines}, ${page})` : lines;
      const left = `max(0px, ${centre} - ${half}px)`;
      for (const slice of result.image.slices) {
        const line = firstLine + (wraps ? anchor : slice.row);
        const at = lineStart(line);
        const placement = wraps
          ? { textDecoration: `none; position: fixed; margin-top: ${(slice.row - anchor) * options.lineHeightPx}px; left: ${left};` }
          // Each strip fills its line exactly, so the strips join into one formula.
          : { margin: `0 0 0 ${indent}ch`, textDecoration: 'none; vertical-align: top;' };
        blockImages.add(owner, at, at, {
          range: new vscode.Range(line, 0, line, 0),
          renderOptions: {
            before: {
              contentIconPath: this.uriFor(slice),
              width: `${result.image.widthPx.toFixed(2)}px`,
              height: `${options.lineHeightPx}px`,
              ...placement
            }
          }
        }, `${slice.uri}|${placement.margin ?? ''}|${placement.textDecoration}`);
      }
      // Numbers are set against the right edge of the lines, or of the page where the settings fix
      // one, as LaTeX sets them against its margin, but stop short of a formula too wide for that.
      const formulaRight = `calc(${wraps ? left : `${indent}ch`} + ${result.image.widthPx.toFixed(2)}px)`;
      const gap = `${NUMBER_GAP_EM * options.fontSizePx}px`;
      for (const number of result.image.numbers) {
        const width = `${number.widthPx.toFixed(2)}px`;
        const lineRight = `anchor(${PAGE_ANCHOR} right, calc(${formulaRight} + ${gap} + ${width} + ${NUMBER_MARGIN_CH}ch))`;
        const right = wrapMode === 'wordWrapColumn' ? `${pageColumns}ch` : wrapMode === 'bounded' ? `min(${lineRight}, ${pageColumns}ch)` : lineRight;
        // On the line its top falls on, or with word wrap hung from the block's last line as the strips are.
        const row = wraps ? anchor : Math.min(region.rows - 1, Math.max(0, Math.floor(number.topPx / options.lineHeightPx)));
        const line = firstLine + row;
        const at = lineStart(line);
        // Its size given here, not through the options: those make it inline-block, whose line box
        // would push an image shorter than a line down. Inline still, so that it starts on its line.
        const css = `none; position: fixed; display: inline-flex; width: ${width}; height: ${number.heightPx.toFixed(2)}px; `
          + `margin-top: ${(number.topPx - row * options.lineHeightPx).toFixed(2)}px; `
          + `left: max(calc(${right} - ${width} - ${NUMBER_MARGIN_CH}ch), calc(${formulaRight} + ${gap}));`;
        blockImages.add(owner, at, at, {
          range: new vscode.Range(line, 0, line, 0),
          renderOptions: { before: { contentIconPath: this.uriFor(number), textDecoration: css } }
        }, `${number.uri}|${css}`);
      }
    }

    // The first line as the box's title bar, the rest as its body around the formulas drawn over theirs.
    for (const box of boxes) {
      solutionTitles.add(box, ...wholeLines(box.first, box.first));
      let from = box.first + 1;
      for (const formula of box.formulas) {
        if (formula.first > from) solutionBodies.add(box, ...wholeLines(from, formula.first - 1));
        from = formula.last + 1;
      }
      if (from <= box.last) solutionBodies.add(box, ...wholeLines(from, box.last));
    }

    for (const item of markup.list) {
      if (!isVisible(item.start, item.end) || regionIsActive(item, selections)) continue;
      for (const [start, end] of item.hide) hidden.add(item, start, end, range(start, end));
      for (const part of item.style) styled.get(part.style)?.add(item, part.start, part.end, range(part.start, part.end));
      item.insert.forEach((insertion, position) => {
        // The hover goes on the whole markup, so pointing at the drawn text finds it.
        const hover = position === 0 && item.hover ? item.hover : undefined;
        const [start, end] = hover ? [item.start, item.end] : [insertion.at, insertion.at];
        insertions.add(item, start, end, {
          range: range(start, end),
          hoverMessage: hover && hoverText(hover),
          renderOptions: { before: insertionStyle(insertion) }
        }, [insertion.text, insertion.color, insertion.bold, insertion.italic, insertion.size, hover?.join('\n')].join('\u0000'));
      });
    }

    const editPreview = new Decorations<vscode.DecorationOptions>();
    const formulaStart = new Decorations<vscode.Range>();
    const formulaEnd = new Decorations<vscode.Range>();
    const formulaLines = new Decorations<vscode.Range>();
    const cursor = document.offsetAt(editor.selection.active);
    const edited = editedFormula(scan.regions, { start: document.offsetAt(editor.selection.start), end: document.offsetAt(editor.selection.end) });
    const preview = edited && this.previewWhileEditing(document, edited, cursor, { top, bottom }, options, withNumbers);
    if (edited && preview) this.editing.set(editor, edited);
    else this.editing.delete(editor);
    if (edited && preview) {
      const { region } = edited;
      editPreview.add(region, preview.at, preview.at, preview.decoration, preview.shows);
      formulaStart.add(region, region.start, region.start + 1, range(region.start, region.start + 1));
      formulaEnd.add(region, region.closeStart, region.closeStart + 1, range(region.closeStart, region.closeStart + 1));
      for (const line of new Set([region.start, region.closeStart].map(offset => document.positionAt(offset).line))) {
        formulaLines.add(region, ...wholeLines(line, line));
      }
    }

    const sent = this.sentFor(editor);
    this.apply(editor, this.hidden, hidden);
    this.apply(editor, this.inlineImages, inlineImages);
    this.apply(editor, this.blockImages, blockImages);
    this.apply(editor, this.blockBackgrounds, blockBackgrounds);
    this.apply(editor, this.solutionTitles, solutionTitles);
    this.apply(editor, this.solutionBodies, solutionBodies);
    this.apply(editor, this.solutionBlockBackgrounds, solutionBlockBackgrounds);
    this.apply(editor, this.errors, errors);
    this.apply(editor, this.insertions, insertions);
    this.apply(editor, this.editPreview, editPreview);
    this.apply(editor, this.formulaStart, formulaStart);
    this.apply(editor, this.formulaEnd, formulaEnd);
    this.apply(editor, this.formulaLines, formulaLines);
    for (const [style, type] of this.rangeStyles) this.apply(editor, type, styled.get(style)!);
    sent.settle();
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

  /** Puts the numbers of the last compile in place of the references in a formula. */
  private numbering(labels: AuxData['labels'] | undefined): (tex: string) => string {
    return tex => labels
      ? substituteReferences(tex, reference => formatReference(reference, labels, this.workspace.cref).text)
      : tex;
  }

  /**
   * Draws the formula being edited again from the text as it is now, while the rest of the document
   * waits for the pause in typing that has it read again.
   */
  private followEditedFormula(editor: vscode.TextEditor, scan: DocumentScan): void {
    const edited = this.editing.get(editor);
    if (!edited) return;
    const document = editor.document;
    const selection = { start: document.offsetAt(editor.selection.start), end: document.offsetAt(editor.selection.end) };
    if (!regionIsActive(edited.region, [selection])) return;
    const viewport = editor.visibleRanges;
    const top = viewport.length ? Math.min(...viewport.map(range => range.start.line)) : 0;
    const bottom = viewport.length ? Math.max(...viewport.map(range => range.end.line)) : 0;
    const options: MathRenderOptions = { ...this.renderSizing(document), macros: scan.macros };
    const withNumbers = this.numbering(this.aux.auxFor(document, scan.root)?.labels);
    const cursor = document.offsetAt(editor.selection.active);
    const preview = this.previewWhileEditing(document, edited, cursor, { top, bottom }, options, withNumbers);
    const decorations = new Decorations<vscode.DecorationOptions>();
    if (preview) decorations.add(edited.region, preview.at, preview.at, preview.decoration, preview.shows);
    this.apply(editor, this.editPreview, decorations);
  }

  /**
   * While a formula is edited its rendering shows above it, over the lines there, as Latex Suite
   * shows it in Obsidian, with the cursor marked: an extension cannot make room between lines. It
   * goes below instead where the top of the editor leaves no room above, and stays within the
   * editor's width. An edit that leaves the formula unrenderable keeps its last rendering.
   */
  private previewWhileEditing(
    document: vscode.TextDocument,
    edited: EditedFormula,
    cursor: number,
    viewport: { top: number; bottom: number },
    options: MathRenderOptions,
    withNumbers: (tex: string) => string
  ): { decoration: vscode.DecorationOptions; at: number; shows: string; below: boolean } | undefined {
    const { region, display } = edited;
    const marked = texWithCursor(region, cursor, CURSOR_MARKER);
    const markedTex = marked === undefined ? undefined : withNumbers(marked);
    // A marker in a label would leave its reference unresolved, and one in a command breaks it.
    let result = markedTex?.includes(CURSOR_MARKER) ? this.renderer.renderUnscaled(markedTex, display, options) : undefined;
    if (!result?.ok) result = this.renderer.renderUnscaled(withNumbers(region.tex), display, options);
    const last = this.lastEditPreview.get(document);
    const image = result.ok ? result.image : last?.start === region.start ? last.image : undefined;
    if (!image) return undefined;
    if (result.ok) this.lastEditPreview.set(document, { start: region.start, image });

    const chrome = (padding: number) => 2 * (padding + EDIT_PREVIEW_BORDER);
    const rows = Math.ceil((image.heightPx + chrome(EDIT_PREVIEW_PADDING.y) + EDIT_PREVIEW_GAP) / options.lineHeightPx);
    // Counted in lines, which word wrap may make several rows each, so this errs towards below.
    const below = document.positionAt(region.start).line - viewport.top < rows
      && viewport.bottom - document.positionAt(region.closeStart).line >= rows;
    // It hangs from a character on the line it is placed against, so it shows while that line does.
    const at = below ? region.closeStart : region.start;
    const position = document.positionAt(at);
    const outerWidth = image.widthPx + chrome(EDIT_PREVIEW_PADDING.x);
    // At the formula's start, or at its end's where the start is off screen, and further left if it
    // would run past the editor's right edge.
    const from = `anchor(${FORMULA_START_ANCHOR} left, anchor(${FORMULA_END_ANCHOR} left))`;
    const left = `max(0px, min(${from}, anchor(${PAGE_ANCHOR} right, 100%) - ${outerWidth.toFixed(2)}px))`;
    const vertical = below
      ? `top: anchor(${FORMULA_END_ANCHOR} bottom); margin-top: ${EDIT_PREVIEW_GAP}px;`
      : `bottom: anchor(${FORMULA_START_ANCHOR} top); margin-bottom: ${EDIT_PREVIEW_GAP}px;`;
    const css = `none; position: fixed; z-index: 1; pointer-events: none; `
      + `padding: ${EDIT_PREVIEW_PADDING.y}px ${EDIT_PREVIEW_PADDING.x}px; border-radius: 4px; `
      + `box-shadow: 0 2px 8px var(--vscode-widget-shadow); font-size: 0; line-height: 0; left: ${left}; ${vertical}`;
    return {
      below,
      at,
      shows: `${image.uri}|${css}`,
      decoration: {
        range: new vscode.Range(position, position),
        renderOptions: {
          before: {
            contentIconPath: this.uriFor(image),
            width: `${image.widthPx.toFixed(2)}px`,
            height: `${image.heightPx.toFixed(2)}px`,
            backgroundColor: new vscode.ThemeColor('editorHoverWidget.background'),
            border: `${EDIT_PREVIEW_BORDER}px solid`,
            borderColor: new vscode.ThemeColor('editorHoverWidget.border'),
            // Fixed, as the anchors are only within reach of that; above the lines after it; and
            // clicks go through to the text it covers. No font size, so no line box pads the image.
            textDecoration: css
          }
        }
      }
    };
  }

  private sentFor(editor: vscode.TextEditor): SentDecorations<vscode.TextEditorDecorationType> {
    let sent = this.sent.get(editor);
    if (!sent) this.sent.set(editor, sent = new SentDecorations(SEND_SETTLE_MS));
    return sent;
  }

  /** Sends each slot of `type` what it is to show, unless VS Code holds exactly that already. */
  private apply<T extends vscode.Range | vscode.DecorationOptions>(editor: vscode.TextEditor, type: SlottedType, decorations: Decorations<T>): void {
    const sent = this.sentFor(editor);
    const slots: Array<Array<Placed<T>>> = [];
    for (const placed of decorations.items) {
      const slot = type.count === 1 ? 0 : sent.slotOf(placed.owner, () => Math.floor(editor.document.positionAt(placed.owner.start).line / SLOT_LINES) % type.count);
      (slots[slot] ??= []).push(placed);
    }
    const now = performance.now();
    for (let slot = 0; slot < type.count; slot++) {
      const items = slots[slot] ?? [];
      const slotType = items.length ? type.slot(slot) : type.existing(slot);
      if (!slotType || !sent.differs(slotType, items)) continue;
      editor.setDecorations(slotType, items.map(placed => placed.item) as vscode.Range[] | vscode.DecorationOptions[]);
      sent.record(slotType, items, now);
    }
  }

  private clear(editor: vscode.TextEditor): void {
    this.sent.delete(editor);
    this.editing.delete(editor);
    this.plans.delete(editor);
    this.tasks = this.tasks.filter(task => task.editor !== editor);
    for (const type of this.slottedTypes()) for (const slot of type.created()) editor.setDecorations(slot, []);
  }

  private slottedTypes(): SlottedType[] {
    return [
      this.hidden, this.inlineImages, this.blockImages, this.blockBackgrounds, this.solutionTitles, this.solutionBodies,
      this.solutionBlockBackgrounds, this.errors, this.insertions, this.editPreview, this.formulaStart, this.formulaEnd,
      this.formulaLines, ...this.rangeStyles.values()
    ];
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

/** A decoration, with the markup it belongs to, which picks its slot, and everything it shows besides its range. */
interface Placed<T> extends SentItem {
  owner: Span;
  item: T;
}

/** The decorations of one type. */
class Decorations<T> {
  readonly items: Array<Placed<T>> = [];

  add(owner: Span, start: number, end: number, item: T, shows = ''): void {
    this.items.push({ owner, start, end, shows, item });
  }
}

/** A decoration type split into slots, each a decoration type of its own, made when first needed. */
class SlottedType implements vscode.Disposable {
  private readonly types: Array<vscode.TextEditorDecorationType | undefined> = [];

  constructor(private readonly options: vscode.DecorationRenderOptions, readonly count = SLOT_COUNT) {}

  slot(index: number): vscode.TextEditorDecorationType {
    return this.types[index] ??= vscode.window.createTextEditorDecorationType(this.options);
  }

  existing(index: number): vscode.TextEditorDecorationType | undefined {
    return this.types[index];
  }

  created(): vscode.TextEditorDecorationType[] {
    return this.types.filter((type): type is vscode.TextEditorDecorationType => type !== undefined);
  }

  dispose(): void {
    for (const type of this.types) type?.dispose();
  }
}

/** The formula a selection is at. */
interface EditedFormula {
  region: MathRegion;
  display: boolean;
}

function editedFormula(regions: MathRegions, selection: { start: number; end: number }): EditedFormula | undefined {
  const display = regions.display.find(region => regionIsActive({ start: region.linesStart, end: region.linesEnd }, [selection]));
  if (display) return { region: display, display: true };
  const inline = regions.inline.find(region => regionIsActive(region, [selection]));
  return inline && { region: inline, display: false };
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
