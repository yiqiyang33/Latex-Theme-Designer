import type { LiteElement, LiteNode } from 'mathjax-full/js/adaptors/lite/Element.js';
import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';
import { findMatchingBrace } from '../snippets/engine/latexContext';
import type { EquationTag } from './references';

/** MathJax's macro table: a body, or a body with an argument count and an optional default first argument. */
export type MathJaxMacros = Record<string, string | [string, number] | [string, number, string]>;

export interface MathRenderOptions {
  macros: MathJaxMacros;
  /** CSS colour the formula is drawn in. An image cannot inherit the editor's text colour. */
  color: string;
  fontSizePx: number;
  /** Height of an editor line. Formulas are scaled down to fit their lines rather than overlap others. */
  lineHeightPx: number;
}

export interface RenderedMath {
  /** Where the image is: a file the image store wrote, or a data URI. */
  uri: string;
  widthPx: number;
  heightPx: number;
  /** CSS vertical-align for the image, so the formula's baseline sits on the text's. */
  verticalAlignPx: number;
}

export interface BlockSlice {
  /** Line within the block this strip is drawn on. */
  row: number;
  /** A line-tall image of this part of the formula. */
  uri: string;
}

/** A display formula cut into line-tall strips, one for each line of its block that it reaches. */
export interface RenderedBlock {
  widthPx: number;
  /** Width of the formula itself, without the numbers set after it. */
  formulaWidthPx: number;
  slices: BlockSlice[];
}

/** A formula's SVG sized for the editor, before it is stored. */
export type SizedMath = Omit<RenderedMath, 'uri'> & { svg: string };
export type SlicedBlock = Omit<RenderedBlock, 'slices'> & { slices: Array<{ row: number; svg: string }> };

/** Keeps an image somewhere a decoration can show it from, and says where. */
export type ImageWriter = (svg: string) => string;

export type RenderResult<T> = { ok: true; image: T } | { ok: false; error: string };
export type MathRenderResult = RenderResult<RenderedMath>;
export type BlockRenderResult = RenderResult<RenderedBlock>;

type SizingOptions = Pick<MathRenderOptions, 'color' | 'fontSizePx' | 'lineHeightPx'>;

/**
 * Size of MathJax's output `ex` relative to the editor's em. MathJax sizes math to the x-height of
 * the text around it, and a monospace editor font's x-height is about 0.55em.
 */
const EX_PER_EM = 0.55;
/** Renderings are kept up to this many characters of image reference, so scrolling back does not re-render. */
const CACHE_BUDGET = 8 * 1024 * 1024;
/** What a kept rendering costs besides its image reference. */
const ENTRY_COST = 256;
/** Macro tables remembered by their text, so a table rebuilt with the same macros keeps its renderings. */
const MACRO_TABLE_LIMIT = 16;
const ENGINE_LIMIT = 4;
// These turn errors into rendered output; without them a bad formula throws, so it can stay as source.
const EXCLUDED_PACKAGES = new Set(['noerrors', 'noundefined']);
/** Layout commands MathJax does not know but formulas carry. They draw nothing, so they render as nothing. */
const DEFAULT_MACROS: MathJaxMacros = { qedhere: '' };
const SVG_NAMESPACES = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
/** Space between a formula and its numbers, in editor ems. */
const TAG_GAP_EM = 2;
const NO_FIXED_SIZE = 'MathJax gave this formula no fixed size.';

interface Engine {
  tex: InstanceType<MathJaxModules['TeX']>;
  document: MathDocument<unknown, unknown, unknown>;
  adaptor: LiteAdaptor;
}

interface MathJaxModules {
  mathjax: typeof import('mathjax-full/js/mathjax.js').mathjax;
  TeX: typeof import('mathjax-full/js/input/tex.js').TeX;
  SVG: typeof import('mathjax-full/js/output/svg.js').SVG;
  adaptor: LiteAdaptor;
  packages: string[];
}

let modules: Promise<MathJaxModules> | undefined;

/** Loads MathJax on first use, so it costs nothing until a preview is actually shown. */
function loadMathJax(): Promise<MathJaxModules> {
  modules ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js')
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    return { mathjax, TeX, SVG, adaptor, packages: AllPackages.filter(name => !EXCLUDED_PACKAGES.has(name)) };
  })();
  return modules;
}

/** Renders TeX to standalone SVG images sized for the editor, caching both engines and images. */
export class MathRenderer {
  private readonly engines = new Map<number, Engine>();
  private readonly cache = new Map<string, { result: RenderResult<RenderedMath | RenderedBlock>; size: number }>();
  // Cache keys name a macro table by a small id rather than by its text, which can run to many
  // kilobytes and would otherwise be copied and hashed for every formula on every update.
  private readonly macroIds = new WeakMap<MathJaxMacros, number>();
  private readonly idsByTable = new Map<string, number>();
  private nextMacroId = 0;
  private cacheSize = 0;
  private loaded?: MathJaxModules;

  constructor(private readonly store: ImageWriter = svgDataUri) {}

  get isReady(): boolean {
    return this.loaded !== undefined;
  }

  /** Resolves once MathJax is loaded; rendering is synchronous after that. */
  async load(): Promise<void> {
    this.loaded = await loadMathJax();
  }

  /** An inline formula, scaled down if needed to fit one line. */
  render(tex: string, options: MathRenderOptions): MathRenderResult {
    return this.cached(inlineKey(tex), options, engine => {
      const formula = typeset(engine, tex, false);
      if (!formula.ok) return formula;
      const sized = sizeForEditor(formula.image.svg, options);
      if (!sized) return { ok: false, error: NO_FIXED_SIZE };
      const { svg, ...size } = sized;
      return { ok: true, image: { ...size, uri: this.store(svg) } };
    });
  }

  /**
   * A formula at the size it is set, in display style or inline, for the preview shown while it is
   * edited. That preview changes with every move of the cursor, so its images are not kept as files.
   */
  renderUnscaled(tex: string, display: boolean, options: MathRenderOptions): MathRenderResult {
    return this.cached(unscaledKey(tex, display), options, engine => {
      const formula = typeset(engine, display ? withoutTags(tex) : tex, display);
      if (!formula.ok) return formula;
      const sized = sizeForEditor(formula.image.svg, options, false);
      if (!sized) return { ok: false, error: NO_FIXED_SIZE };
      const { svg, ...size } = sized;
      return { ok: true, image: { ...size, uri: svgDataUri(svg) } };
    });
  }

  /** An inline formula's rendering if it has one already, without rendering it. */
  peek(tex: string, options: MathRenderOptions): MathRenderResult | undefined {
    return this.lookup(inlineKey(tex), options) as MathRenderResult | undefined;
  }

  /** A display formula laid out over the `rows` lines of its block, with its numbers on the right. */
  renderBlock(tex: string, rows: number, options: MathRenderOptions, tags: readonly EquationTag[] = []): BlockRenderResult {
    return this.cached(blockKey(tex, rows, tags), options, engine => {
      // Display style is too tall for a single line, so a one-line block is set like inline math.
      const formula = typeset(engine, withoutTags(tex), rows > 1);
      if (!formula.ok) return formula;
      const { baselines } = formula.image;
      const numbers: TagImage[] = [];
      for (const tag of tags) {
        // A row MathJax laid out differently has nowhere to go, unless it is the only number.
        if (tag.row !== undefined && tag.row >= baselines.length && tags.length > 1) continue;
        const number = typeset(engine, tag.tex, false);
        // A number MathJax cannot set is left out rather than costing the formula its rendering.
        if (number.ok) numbers.push({ svg: number.image.svg, baseline: tag.row === undefined ? undefined : baselines[tag.row] });
      }
      const sliced = sliceForLines(formula.image.svg, rows, options, numbers);
      if (!sliced) return { ok: false, error: NO_FIXED_SIZE };
      const { slices, ...size } = sliced;
      return { ok: true, image: { ...size, slices: slices.map(slice => ({ row: slice.row, uri: this.store(slice.svg) })) } };
    });
  }

  /** A display formula's rendering if it has one already, without rendering it. */
  peekBlock(tex: string, rows: number, options: MathRenderOptions, tags: readonly EquationTag[] = []): BlockRenderResult | undefined {
    return this.lookup(blockKey(tex, rows, tags), options) as BlockRenderResult | undefined;
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheSize = 0;
  }

  private cached<T extends RenderedMath | RenderedBlock>(
    formula: string,
    options: MathRenderOptions,
    build: (engine: Engine) => RenderResult<T>
  ): RenderResult<T> {
    if (!this.loaded) throw new Error('MathRenderer.load() must finish before rendering.');
    const existing = this.lookup(formula, options);
    if (existing) return existing as RenderResult<T>;
    const macroId = this.macroId(options.macros);
    const key = cacheKey(macroId, formula, options);
    const result = build(this.engineFor(macroId, options.macros));
    const size = ENTRY_COST + (result.ok ? imageSize(result.image) : result.error.length);
    this.cache.set(key, { result, size });
    this.cacheSize += size;
    for (const [oldKey, old] of this.cache) {
      if (this.cacheSize <= CACHE_BUDGET || oldKey === key) break;
      this.cache.delete(oldKey);
      this.cacheSize -= old.size;
    }
    return result;
  }

  private lookup(formula: string, options: MathRenderOptions): RenderResult<RenderedMath | RenderedBlock> | undefined {
    const key = cacheKey(this.macroId(options.macros), formula, options);
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    // Re-insert so the Map's insertion order doubles as recency for eviction.
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached.result;
  }

  private macroId(macros: MathJaxMacros): number {
    let id = this.macroIds.get(macros);
    if (id !== undefined) return id;
    const table = JSON.stringify(macros);
    id = this.idsByTable.get(table);
    if (id === undefined) {
      id = this.nextMacroId++;
      this.idsByTable.set(table, id);
      if (this.idsByTable.size > MACRO_TABLE_LIMIT) this.idsByTable.delete(this.idsByTable.keys().next().value!);
    }
    this.macroIds.set(macros, id);
    return id;
  }

  private engineFor(macroId: number, macros: MathJaxMacros): Engine {
    const existing = this.engines.get(macroId);
    if (existing) return existing;
    const { mathjax, TeX, SVG, adaptor, packages } = this.loaded!;
    const tex = new TeX({
      packages,
      macros: { ...DEFAULT_MACROS, ...macros },
      formatError: (_jax: unknown, error: Error) => { throw error; }
    });
    // A local font cache defines each glyph once per image instead of at every use.
    const document = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'local' }) });
    const engine = { tex, document, adaptor };
    this.engines.set(macroId, engine);
    if (this.engines.size > ENGINE_LIMIT) this.engines.delete(this.engines.keys().next().value!);
    return engine;
  }
}

interface Typeset {
  svg: string;
  /** Baselines of the formula's rows, in its SVG's units. */
  baselines: number[];
}

function typeset(engine: Engine, tex: string, display: boolean): RenderResult<Typeset> {
  try {
    // MathJax remembers labels across formulas, so a labelled one would fail every render after its first.
    engine.tex.parseOptions.tags.reset();
    const container = engine.document.convert(tex, { display }) as LiteElement;
    const baselines = rowBaselines(engine.adaptor, container);
    // The data attributes only serve MathJax's own tools and make up a good part of the markup.
    const svg = engine.adaptor.innerHTML(container).replace(/\sdata-(?:mml-node|c|mjx-texclass)="[^"]*"/g, '');
    return { ok: true, image: { svg, baselines } };
  } catch (error) {
    // MathJax's TexError carries a message but is not an Error.
    const message = (error as { message?: unknown } | undefined)?.message;
    return { ok: false, error: typeof message === 'string' ? message : String(error) };
  }
}

/**
 * Where the rows of a formula sit, in its SVG's units, where y points down: the rows of a table at
 * the top of the formula, as align makes, or else the one baseline MathJax puts at 0.
 */
function rowBaselines(adaptor: LiteAdaptor, container: LiteElement): number[] {
  const role = (node: LiteElement) => adaptor.getAttribute(node, 'data-mml-node') as string | undefined;
  const elements = (node: LiteElement) => adaptor.childNodes(node).filter((child: LiteNode): child is LiteElement => adaptor.kind(child) !== '#text' && adaptor.kind(child) !== '#comment');
  const find = (node: LiteElement): LiteElement | undefined => role(node) === 'math' ? node : elements(node).map(find).find(Boolean);
  // Inside the root MathJax flips y to point up, so a row at offset y has its baseline at -y.
  let offset = 0;
  for (let node = find(container); node;) {
    offset += translateY(adaptor.getAttribute(node, 'transform'));
    const children = elements(node);
    if (role(node) === 'mtable') {
      return children
        .filter(row => role(row) === 'mtr' || role(row) === 'mlabeledtr')
        .map(row => -(offset + translateY(adaptor.getAttribute(row, 'transform'))));
    }
    node = children.length === 1 ? children[0] : undefined;
  }
  return [0];
}

function translateY(transform: string | undefined): number {
  let y = 0;
  for (const match of (transform ?? '').matchAll(/translate\(\s*[-\d.e]+(?:[\s,]+([-\d.e]+))?\s*\)/g)) y += Number(match[1] ?? 0);
  return y;
}

function inlineKey(tex: string): string {
  return `inline\u0000${tex}`;
}

function unscaledKey(tex: string, display: boolean): string {
  return `${display ? 'display' : 'text'}\u0000${tex}`;
}

function blockKey(tex: string, rows: number, tags: readonly EquationTag[]): string {
  return ['block', String(rows), tex, tags.map(tag => `${tag.row ?? ''}:${tag.tex}`).join('\u0001')].join('\u0000');
}

function cacheKey(macroId: number, formula: string, options: MathRenderOptions): string {
  return `${macroId}\u0000${options.color}\u0000${options.fontSizePx}\u0000${options.lineHeightPx}\u0000${formula}`;
}

function imageSize(image: RenderedMath | RenderedBlock): number {
  return 'slices' in image ? image.slices.reduce((total, slice) => total + slice.uri.length, 0) : image.uri.length;
}

/**
 * Drops `\tag`s: MathJax lays a tagged equation out across the full container width, which an
 * image does not have. Equation numbers are not shown either, so the formula loses nothing else.
 */
function withoutTags(tex: string): string {
  const pattern = /\\tag\*?\s*\{/g;
  let result = '';
  let copied = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tex)) !== null) {
    const close = findMatchingBrace(tex, match.index + match[0].length - 1);
    if (close === -1) break;
    result += tex.slice(copied, match.index);
    copied = close + 1;
    pattern.lastIndex = copied;
  }
  return result + tex.slice(copied);
}

interface ExSize {
  root: string;
  width: number;
  height: number;
  verticalAlign: number;
}

/** The root element and its size in ex, unless MathJax sized it some other way, as a percentage. */
function exSize(svg: string): ExSize | undefined {
  const root = /^<svg[^>]*>/.exec(svg)?.[0] ?? '';
  const width = /\swidth="([\d.]+)ex"/.exec(root)?.[1];
  const height = /\sheight="([\d.]+)ex"/.exec(root)?.[1];
  if (width === undefined || height === undefined) return undefined;
  const verticalAlign = Number(/vertical-align:\s*(-?[\d.]+)ex/.exec(root)?.[1] ?? 0);
  return { root, width: Number(width), height: Number(height), verticalAlign };
}

/** An image as a data URI, which needs nowhere to keep it. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

const px = (value: number) => value.toFixed(2);

/**
 * Turns MathJax's ex-sized SVG into a px-sized image, scaled down to fit a line unless `fitLine` is
 * false. The image is shown through CSS `content`, which ignores CSS width and height, so the size
 * has to live in the SVG itself.
 */
export function sizeForEditor(svg: string, options: SizingOptions, fitLine = true): SizedMath | undefined {
  const size = exSize(svg);
  if (!size) return undefined;
  const exPx = options.fontSizePx * EX_PER_EM;
  const scale = fitLine ? Math.min(1, options.lineHeightPx / (size.height * exPx)) : 1;
  const widthPx = size.width * exPx * scale;
  const heightPx = size.height * exPx * scale;
  const root = size.root
    .replace(/\swidth="[^"]*"/, ` width="${px(widthPx)}px"`)
    .replace(/\sheight="[^"]*"/, ` height="${px(heightPx)}px"`)
    .replace(/\sstyle="[^"]*"/, '')
    .replace(/^<svg/, `<svg style="color:${options.color}"`);
  const withNamespace = root.includes('xmlns=') ? root : root.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return {
    svg: withNamespace + svg.slice(size.root.length),
    widthPx,
    heightPx,
    verticalAlignPx: size.verticalAlign * exPx * scale
  };
}

/** A number to set beside a display formula. */
export interface TagImage {
  /** MathJax's SVG of the number. */
  svg: string;
  /** Baseline of the row it numbers, in the formula's SVG units; undefined centres it on the formula. */
  baseline?: number;
}

interface Piece {
  width: number;
  height: number;
  verticalAlign: number;
  viewBox: string;
  minY: number;
  viewHeight: number;
  content: string;
}

/** An ex-sized MathJax SVG, ready to be placed inside another one. */
function piece(svg: string): Piece | undefined {
  const size = exSize(svg);
  const viewBox = size && /\sviewBox="([^"]*)"/.exec(size.root)?.[1];
  if (!size || !viewBox) return undefined;
  const [, minY, , viewHeight] = viewBox.trim().split(/[\s,]+/).map(Number);
  if (!Number.isFinite(minY) || !(viewHeight > 0)) return undefined;
  const content = svg.slice(size.root.length, svg.lastIndexOf('</svg>'));
  return { width: size.width, height: size.height, verticalAlign: size.verticalAlign, viewBox, minY, viewHeight, content };
}

function place(part: Piece, x: number, y: number, width: number, height: number): string {
  return `<svg x="${px(x)}" y="${px(y)}" width="${px(width)}" height="${px(height)}" viewBox="${part.viewBox}" overflow="visible">${part.content}</svg>`;
}

/**
 * Lays a display formula out over the `rows` lines of its block, centred and scaled down if it is
 * taller, with its numbers right-aligned beside it as LaTeX sets them against the margin. It is
 * then cut into one strip per line: the editor only draws the lines on screen, so one tall image
 * hung from the first line would vanish as soon as that line scrolled away.
 */
export function sliceForLines(svg: string, rows: number, options: SizingOptions, tags: readonly TagImage[] = []): SlicedBlock | undefined {
  const formula = piece(svg);
  if (!formula) return undefined;
  const numbers = tags.flatMap(tag => {
    const part = piece(tag.svg);
    return part ? [{ part, baseline: tag.baseline }] : [];
  });
  const lineHeight = options.lineHeightPx;
  const boxHeight = rows * lineHeight;
  const exPx = options.fontSizePx * EX_PER_EM;
  // px per ex once a formula taller than its block is scaled down; its numbers scale with it.
  const unit = exPx * Math.min(1, boxHeight / (formula.height * exPx));
  const height = formula.height * unit;
  const top = (boxHeight - height) / 2;
  const numbersWidth = Math.max(0, ...numbers.map(number => number.part.width * unit));
  const width = formula.width * unit + (numbers.length ? TAG_GAP_EM * options.fontSizePx * unit / exPx + numbersWidth : 0);
  let content = place(formula, 0, top, formula.width * unit, height);
  let inkTop = top;
  let inkBottom = top + height;
  for (const { part, baseline } of numbers) {
    const numberWidth = part.width * unit;
    const numberHeight = part.height * unit;
    // A number's vertical-align is its depth below the baseline, negated.
    const y = baseline === undefined
      ? top + (height - numberHeight) / 2
      : top + (baseline - formula.minY) / formula.viewHeight * height - numberHeight - part.verticalAlign * unit;
    content += place(part, width - numberWidth, y, numberWidth, numberHeight);
    inkTop = Math.min(inkTop, y);
    inkBottom = Math.max(inkBottom, y + numberHeight);
  }
  const slices: SlicedBlock['slices'] = [];
  for (let row = 0; row < rows; row++) {
    const y = row * lineHeight;
    if (inkTop >= y + lineHeight || inkBottom <= y) continue;
    const slice = `<svg ${SVG_NAMESPACES} width="${px(width)}px" height="${px(lineHeight)}px" `
      + `viewBox="0 ${px(y)} ${px(width)} ${px(lineHeight)}" style="color:${options.color}">${content}</svg>`;
    slices.push({ row, svg: slice });
  }
  return { widthPx: width, formulaWidthPx: formula.width * unit, slices };
}
