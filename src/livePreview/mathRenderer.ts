import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';

/** MathJax's macro table: a body, or a body with an argument count and an optional default first argument. */
export type MathJaxMacros = Record<string, string | [string, number] | [string, number, string]>;

export interface MathRenderOptions {
  macros: MathJaxMacros;
  /** CSS colour the formula is drawn in. An image cannot inherit the editor's text colour. */
  color: string;
  fontSizePx: number;
  /** Inline formulas are scaled down to fit the line rather than overlap the next one. */
  maxHeightPx: number;
}

export interface RenderedMath {
  dataUri: string;
  widthPx: number;
  heightPx: number;
  /** CSS vertical-align for the image, so the formula's baseline sits on the text's. */
  verticalAlignPx: number;
}

export type MathRenderResult = { ok: true; image: RenderedMath } | { ok: false; error: string };

/**
 * Size of MathJax's output `ex` relative to the editor's em. MathJax sizes math to the x-height of
 * the text around it, and a monospace editor font's x-height is about 0.55em.
 */
const EX_PER_EM = 0.55;
const CACHE_LIMIT = 500;
const ENGINE_LIMIT = 4;
// These turn errors into rendered output; without them a bad formula throws, so it can stay as source.
const EXCLUDED_PACKAGES = new Set(['noerrors', 'noundefined']);

interface Engine {
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
  private readonly cache = new Map<string, MathRenderResult>();
  private readonly macroKeys = new WeakMap<MathJaxMacros, string>();
  private loaded?: MathJaxModules;

  get isReady(): boolean {
    return this.loaded !== undefined;
  }

  /** Resolves once MathJax is loaded; render() is synchronous after that. */
  async load(): Promise<void> {
    this.loaded = await loadMathJax();
  }

  render(tex: string, options: MathRenderOptions): MathRenderResult {
    if (!this.loaded) throw new Error('MathRenderer.load() must finish before render().');
    let macroKey = this.macroKeys.get(options.macros);
    if (macroKey === undefined) {
      macroKey = JSON.stringify(options.macros);
      this.macroKeys.set(options.macros, macroKey);
    }
    const key = [macroKey, tex, options.color, options.fontSizePx, options.maxHeightPx].join('\u0000');
    const cached = this.cache.get(key);
    if (cached) {
      // Re-insert so the Map's insertion order doubles as recency for eviction.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const result = this.renderUncached(this.engineFor(macroKey, options.macros), tex, options);
    this.cache.set(key, result);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private engineFor(macroKey: string, macros: MathJaxMacros): Engine {
    const existing = this.engines.get(macroKey);
    if (existing) return existing;
    const { mathjax, TeX, SVG, adaptor, packages } = this.loaded!;
    const tex = new TeX({
      packages,
      macros,
      formatError: (_jax: unknown, error: Error) => { throw error; }
    });
    const document = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'none' }) });
    const engine = { document, adaptor };
    this.engines.set(macroKey, engine);
    if (this.engines.size > ENGINE_LIMIT) this.engines.delete(this.engines.keys().next().value!);
    return engine;
  }

  private renderUncached(engine: Engine, tex: string, options: MathRenderOptions): MathRenderResult {
    let svg: string;
    try {
      const container = engine.document.convert(tex, { display: false }) as never;
      svg = engine.adaptor.innerHTML(container);
    } catch (error) {
      // MathJax's TexError carries a message but is not an Error.
      const message = (error as { message?: unknown } | undefined)?.message;
      return { ok: false, error: typeof message === 'string' ? message : String(error) };
    }
    return { ok: true, image: sizeForEditor(svg, options) };
  }
}

/**
 * Turns MathJax's ex-sized SVG into a px-sized image. The image is shown through CSS `content`,
 * which ignores CSS width and height, so the size has to live in the SVG itself.
 */
export function sizeForEditor(svg: string, options: Pick<MathRenderOptions, 'color' | 'fontSizePx' | 'maxHeightPx'>): RenderedMath {
  const exPx = options.fontSizePx * EX_PER_EM;
  const exAttr = (name: string) => Number(new RegExp(`\\s${name}="(-?[\\d.]+)ex"`).exec(svg)?.[1] ?? 0);
  const valign = Number(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg)?.[1] ?? 0);
  let widthPx = exAttr('width') * exPx;
  let heightPx = exAttr('height') * exPx;
  let verticalAlignPx = valign * exPx;
  if (heightPx > options.maxHeightPx && heightPx > 0) {
    const scale = options.maxHeightPx / heightPx;
    widthPx *= scale;
    heightPx *= scale;
    verticalAlignPx *= scale;
  }
  const sized = svg
    .replace(/\swidth="[^"]*ex"/, ` width="${widthPx.toFixed(2)}px"`)
    .replace(/\sheight="[^"]*ex"/, ` height="${heightPx.toFixed(2)}px"`)
    .replace(/\sstyle="[^"]*"/, '')
    .replace(/^<svg/, `<svg style="color:${options.color}"`);
  const withNamespace = sized.includes('xmlns=') ? sized : sized.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return {
    dataUri: `data:image/svg+xml;base64,${Buffer.from(withNamespace, 'utf8').toString('base64')}`,
    widthPx,
    heightPx,
    verticalAlignPx
  };
}
