import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';
import { findMatchingBrace } from '../snippets/engine/latexContext';

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
  dataUri: string;
  widthPx: number;
  heightPx: number;
  /** CSS vertical-align for the image, so the formula's baseline sits on the text's. */
  verticalAlignPx: number;
}

export interface BlockSlice {
  /** Line within the block this strip is drawn on. */
  row: number;
  /** A line-tall image of this part of the formula. */
  dataUri: string;
}

/** A display formula cut into line-tall strips, one for each line of its block that it reaches. */
export interface RenderedBlock {
  widthPx: number;
  slices: BlockSlice[];
}

export type RenderResult<T> = { ok: true; image: T } | { ok: false; error: string };
export type MathRenderResult = RenderResult<RenderedMath>;
export type BlockRenderResult = RenderResult<RenderedBlock>;

type SizingOptions = Pick<MathRenderOptions, 'color' | 'fontSizePx' | 'lineHeightPx'>;

/**
 * Size of MathJax's output `ex` relative to the editor's em. MathJax sizes math to the x-height of
 * the text around it, and a monospace editor font's x-height is about 0.55em.
 */
const EX_PER_EM = 0.55;
/** Images are kept up to this many characters of data URI, so scrolling back does not re-render. */
const CACHE_BUDGET = 8 * 1024 * 1024;
const ENGINE_LIMIT = 4;
// These turn errors into rendered output; without them a bad formula throws, so it can stay as source.
const EXCLUDED_PACKAGES = new Set(['noerrors', 'noundefined']);
/** Layout commands MathJax does not know but formulas carry. They draw nothing, so they render as nothing. */
const DEFAULT_MACROS: MathJaxMacros = { qedhere: '' };
const SVG_NAMESPACES = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

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
  private readonly engines = new Map<string, Engine>();
  private readonly cache = new Map<string, { result: RenderResult<RenderedMath | RenderedBlock>; size: number }>();
  private readonly macroKeys = new WeakMap<MathJaxMacros, string>();
  private cacheSize = 0;
  private loaded?: MathJaxModules;

  get isReady(): boolean {
    return this.loaded !== undefined;
  }

  /** Resolves once MathJax is loaded; rendering is synchronous after that. */
  async load(): Promise<void> {
    this.loaded = await loadMathJax();
  }

  /** An inline formula, scaled down if needed to fit one line. */
  render(tex: string, options: MathRenderOptions): MathRenderResult {
    return this.cached(['inline', tex], options, engine => {
      const svg = typeset(engine, tex, false);
      if (!svg.ok) return svg;
      const image = sizeForEditor(svg.image, options);
      return image ? { ok: true, image } : { ok: false, error: 'MathJax gave this formula no fixed size.' };
    });
  }

  /** A display formula laid out over the `rows` lines of its block. */
  renderBlock(tex: string, rows: number, options: MathRenderOptions): BlockRenderResult {
    return this.cached(['block', String(rows), tex], options, engine => {
      // Display style is too tall for a single line, so a one-line block is set like inline math.
      const svg = typeset(engine, withoutTags(tex), rows > 1);
      if (!svg.ok) return svg;
      const image = sliceForLines(svg.image, rows, options);
      return image ? { ok: true, image } : { ok: false, error: 'MathJax gave this formula no fixed size.' };
    });
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheSize = 0;
  }

  private cached<T extends RenderedMath | RenderedBlock>(
    parts: string[],
    options: MathRenderOptions,
    build: (engine: Engine) => RenderResult<T>
  ): RenderResult<T> {
    if (!this.loaded) throw new Error('MathRenderer.load() must finish before rendering.');
    let macroKey = this.macroKeys.get(options.macros);
    if (macroKey === undefined) {
      macroKey = JSON.stringify(options.macros);
      this.macroKeys.set(options.macros, macroKey);
    }
    const key = [macroKey, ...parts, options.color, options.fontSizePx, options.lineHeightPx].join('\u0000');
    const cached = this.cache.get(key);
    if (cached) {
      // Re-insert so the Map's insertion order doubles as recency for eviction.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.result as RenderResult<T>;
    }
    const result = build(this.engineFor(macroKey, options.macros));
    const size = result.ok ? imageSize(result.image) : result.error.length;
    this.cache.set(key, { result, size });
    this.cacheSize += size;
    for (const [oldKey, old] of this.cache) {
      if (this.cacheSize <= CACHE_BUDGET || oldKey === key) break;
      this.cache.delete(oldKey);
      this.cacheSize -= old.size;
    }
    return result;
  }

  private engineFor(macroKey: string, macros: MathJaxMacros): Engine {
    const existing = this.engines.get(macroKey);
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
    this.engines.set(macroKey, engine);
    if (this.engines.size > ENGINE_LIMIT) this.engines.delete(this.engines.keys().next().value!);
    return engine;
  }
}

function typeset(engine: Engine, tex: string, display: boolean): RenderResult<string> {
  try {
    // MathJax remembers labels across formulas, so a labelled one would fail every render after its first.
    engine.tex.parseOptions.tags.reset();
    const container = engine.document.convert(tex, { display }) as never;
    // The data attributes only serve MathJax's own tools and make up a good part of the markup.
    const svg = engine.adaptor.innerHTML(container).replace(/\sdata-(?:mml-node|c|mjx-texclass)="[^"]*"/g, '');
    return { ok: true, image: svg };
  } catch (error) {
    // MathJax's TexError carries a message but is not an Error.
    const message = (error as { message?: unknown } | undefined)?.message;
    return { ok: false, error: typeof message === 'string' ? message : String(error) };
  }
}

function imageSize(image: RenderedMath | RenderedBlock): number {
  return 'slices' in image ? image.slices.reduce((total, slice) => total + slice.dataUri.length, 0) : image.dataUri.length;
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

function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

const px = (value: number) => value.toFixed(2);

/**
 * Turns MathJax's ex-sized SVG into a px-sized image. The image is shown through CSS `content`,
 * which ignores CSS width and height, so the size has to live in the SVG itself.
 */
export function sizeForEditor(svg: string, options: SizingOptions): RenderedMath | undefined {
  const size = exSize(svg);
  if (!size) return undefined;
  const exPx = options.fontSizePx * EX_PER_EM;
  const scale = Math.min(1, options.lineHeightPx / (size.height * exPx));
  const widthPx = size.width * exPx * scale;
  const heightPx = size.height * exPx * scale;
  const root = size.root
    .replace(/\swidth="[^"]*"/, ` width="${px(widthPx)}px"`)
    .replace(/\sheight="[^"]*"/, ` height="${px(heightPx)}px"`)
    .replace(/\sstyle="[^"]*"/, '')
    .replace(/^<svg/, `<svg style="color:${options.color}"`);
  const withNamespace = root.includes('xmlns=') ? root : root.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return {
    dataUri: toDataUri(withNamespace + svg.slice(size.root.length)),
    widthPx,
    heightPx,
    verticalAlignPx: size.verticalAlign * exPx * scale
  };
}

/**
 * Lays a display formula out over the `rows` lines of its block, centred and scaled down if it is
 * taller, then cuts it into one strip per line. The editor only draws the lines on screen, so one
 * tall image hung from the first line would vanish as soon as that line scrolled away.
 */
export function sliceForLines(svg: string, rows: number, options: SizingOptions): RenderedBlock | undefined {
  const size = exSize(svg);
  const viewBox = size && /\sviewBox="([^"]*)"/.exec(size.root)?.[1];
  if (!size || !viewBox) return undefined;
  const exPx = options.fontSizePx * EX_PER_EM;
  const lineHeight = options.lineHeightPx;
  const boxHeight = rows * lineHeight;
  const scale = Math.min(1, boxHeight / (size.height * exPx));
  const width = size.width * exPx * scale;
  const height = size.height * exPx * scale;
  const top = (boxHeight - height) / 2;
  const content = svg.slice(size.root.length, svg.lastIndexOf('</svg>'));
  const formula = `<svg x="0" y="${px(top)}" width="${px(width)}" height="${px(height)}" viewBox="${viewBox}" overflow="visible">${content}</svg>`;
  const slices: BlockSlice[] = [];
  for (let row = 0; row < rows; row++) {
    const y = row * lineHeight;
    if (top >= y + lineHeight || top + height <= y) continue;
    const slice = `<svg ${SVG_NAMESPACES} width="${px(width)}px" height="${px(lineHeight)}px" `
      + `viewBox="0 ${px(y)} ${px(width)} ${px(lineHeight)}" style="color:${options.color}">${formula}</svg>`;
    slices.push({ row, dataUri: toDataUri(slice) });
  }
  return { widthPx: width, slices };
}
