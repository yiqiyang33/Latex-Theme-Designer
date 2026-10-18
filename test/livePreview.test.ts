import { beforeAll, describe, expect, it } from 'vitest';
import { parseMacroDefinitions } from '../src/livePreview/macros';
import { findInlineMathRegions, regionIsActive } from '../src/livePreview/mathRegions';
import { MathRenderer, sizeForEditor, type MathRenderOptions } from '../src/livePreview/mathRenderer';

const tex = (text: string) => findInlineMathRegions(text, 'latex').map(region => region.tex);

describe('findInlineMathRegions', () => {
  it('finds $...$ and \\(...\\) with the offsets of their delimiters', () => {
    const text = 'Let $x$ and \\(y^2\\) be.';
    expect(findInlineMathRegions(text, 'latex')).toEqual([
      { start: 4, end: 7, tex: 'x' },
      { start: 12, end: 19, tex: 'y^2' }
    ]);
  });

  it('skips escaped dollars, comments and verbatim text', () => {
    expect(tex('It costs \\$5 or $a$. % but not $b$')).toEqual(['a']);
    expect(tex('\\begin{verbatim}\n$c$\n\\end{verbatim}\nthen $d$')).toEqual(['d']);
  });

  it('leaves dollars nested in display math alone', () => {
    expect(tex('$$ a \\text{if $b$} $$')).toEqual([]);
    expect(tex('\\[ \\text{if $c$} \\]')).toEqual([]);
    expect(tex('\\begin{align}\n x &= 1 \\text{ for $d$}\n\\end{align}\nafter $e$')).toEqual(['e']);
  });

  it('pairs back-to-back formulas and ignores empty or multi-line ones', () => {
    expect(tex('$a$$b$')).toEqual(['a', 'b']);
    expect(tex('$ $ and $a\nb$')).toEqual([]);
  });

  it('does not blank the rest of the file while an environment is still being typed', () => {
    expect(tex('\\begin{equation}\n x\n\nLater $f$ appears.')).toEqual(['f']);
  });
});

describe('regionIsActive', () => {
  const region = { start: 10, end: 15 };
  it('shows the source when a cursor touches either delimiter or a selection overlaps', () => {
    expect(regionIsActive(region, [{ start: 10, end: 10 }])).toBe(true);
    expect(regionIsActive(region, [{ start: 15, end: 15 }])).toBe(true);
    expect(regionIsActive(region, [{ start: 0, end: 12 }])).toBe(true);
    expect(regionIsActive(region, [{ start: 9, end: 9 }, { start: 16, end: 20 }])).toBe(false);
  });
});

describe('parseMacroDefinitions', () => {
  it('reads \\newcommand and its siblings, with argument counts and defaults', () => {
    expect(parseMacroDefinitions([
      '\\newcommand{\\R}{\\mathbb{R}}',
      '\\newcommand\\norm[1]{\\left\\|#1\\right\\|}',
      '\\newcommand{\\pair}[2][x]{(#1,#2)}',
      '\\renewcommand*{\\vec}[1]{\\mathbf{#1}}',
      '\\providecommand{\\set}[1]{\\left\\{#1\\right\\}}'
    ].join('\n'))).toEqual({
      R: '\\mathbb{R}',
      norm: ['\\left\\|#1\\right\\|', 1],
      pair: ['(#1,#2)', 2, 'x'],
      vec: ['\\mathbf{#1}', 1],
      set: ['\\left\\{#1\\right\\}', 1]
    });
  });

  it('reads operators and simple \\def', () => {
    expect(parseMacroDefinitions('\\DeclareMathOperator{\\Tr}{Tr}\n\\DeclareMathOperator*{\\argmax}{arg\\,max}')).toEqual({
      Tr: '\\operatorname{Tr}',
      argmax: '\\operatorname*{arg\\,max}'
    });
    expect(parseMacroDefinitions('\\def\\eps{\\varepsilon}\n\\def\\inner#1#2{\\langle #1,#2\\rangle}')).toEqual({
      eps: '\\varepsilon',
      inner: ['\\langle #1,#2\\rangle', 2]
    });
  });

  it('skips commented-out definitions, internal names and delimited \\def parameters', () => {
    expect(parseMacroDefinitions('% \\newcommand{\\X}{1}\n\\newcommand{\\@foo}{2}\n\\def\\pt(#1,#2){#1}')).toEqual({});
  });

  it('does not read definitions out of another definition body', () => {
    expect(parseMacroDefinitions('\\newcommand{\\outer}{\\newcommand{\\inner}{1}}')).toEqual({
      outer: '\\newcommand{\\inner}{1}'
    });
  });
});

describe('MathRenderer', () => {
  const renderer = new MathRenderer();
  const options = (overrides: Partial<MathRenderOptions> = {}): MathRenderOptions => ({
    macros: {}, color: '#cccccc', fontSizePx: 14, maxHeightPx: 21, ...overrides
  });
  const decode = (dataUri: string) => Buffer.from(dataUri.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');

  beforeAll(() => renderer.load());

  it('renders a formula to a px-sized SVG drawn in the given colour', () => {
    const result = renderer.render('x^2', options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = decode(result.image.dataUri);
    expect(svg).toContain(`width="${result.image.widthPx.toFixed(2)}px"`);
    expect(svg).toContain('style="color:#cccccc"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('uses the project macros, and reports what it cannot render instead of drawing it', () => {
    expect(renderer.render('\\R^n', options({ macros: { R: '\\mathbb{R}' } })).ok).toBe(true);
    const undefinedMacro = renderer.render('\\R^n', options());
    expect(undefinedMacro).toMatchObject({ ok: false });
    expect(renderer.render('\\frac{a}{', options())).toEqual({ ok: false, error: expect.stringMatching(/brace/i) });
  });

  it('shrinks a formula taller than the line to fit it', () => {
    const result = renderer.render('\\frac{\\frac{a}{b}}{\\frac{c}{d}}', options());
    expect(result.ok && result.image.heightPx).toBeCloseTo(21, 5);
  });

  it('returns the cached image for the same formula and settings', () => {
    const macros = { R: '\\mathbb{R}' };
    expect(renderer.render('\\R', options({ macros }))).toBe(renderer.render('\\R', options({ macros })));
  });
});

describe('sizeForEditor', () => {
  it('converts MathJax ex sizes to px and keeps the baseline offset', () => {
    const svg = '<svg style="vertical-align: -0.5ex;" xmlns="http://www.w3.org/2000/svg" width="4ex" height="2ex" viewBox="0 0 1 1"></svg>';
    const image = sizeForEditor(svg, { color: '#000', fontSizePx: 20, maxHeightPx: 100 });
    expect(image).toMatchObject({ widthPx: 44, heightPx: 22, verticalAlignPx: -5.5 });
  });
});
