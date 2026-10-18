import { beforeAll, describe, expect, it } from 'vitest';
import { parseMacroDefinitions } from '../src/livePreview/macros';
import { findMathRegions, previewSource, regionIsActive } from '../src/livePreview/mathRegions';
import { MathRenderer, sizeForEditor, sliceForLines, type MathRenderOptions } from '../src/livePreview/mathRenderer';

const tex = (text: string) => findMathRegions(text, 'latex').inline.map(region => region.tex);
const displayTex = (text: string) => findMathRegions(text, 'latex').display.map(region => region.tex);

describe('findMathRegions: inline', () => {
  it('finds $...$ and \\(...\\) with the offsets of their delimiters', () => {
    const text = 'Let $x$ and \\(y^2\\) be.';
    expect(findMathRegions(text, 'latex').inline).toEqual([
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

  it('finds formulas in tables, which are text with math in their cells', () => {
    expect(tex('\\begin{tabular}{cc}\n $a$ & $b$ \\\\\n\\end{tabular}')).toEqual(['a', 'b']);
  });
});

describe('findMathRegions: display', () => {
  it('finds display delimiters and environments, with the lines they take', () => {
    const text = 'Text\n\\[\n  x\n\\]\n$$ y $$\n  \\begin{align*}\n a &= b\n  \\end{align*} % note\nMore';
    const at = (needle: string) => text.indexOf(needle);
    expect(findMathRegions(text, 'latex').display).toEqual([
      { start: at('\\['), end: at('\\]') + 2, tex: '\n  x\n', rows: 3, linesStart: at('\\['), linesEnd: at('\\]') + 2 },
      { start: at('$$'), end: at('\n  \\begin'), tex: ' y ', rows: 1, linesStart: at('$$'), linesEnd: at('\n  \\begin') },
      {
        start: at('\\begin'),
        end: at(' % note'),
        tex: '\\begin{align*}\n a &= b\n  \\end{align*}',
        rows: 3,
        linesStart: at('  \\begin'),
        linesEnd: at('\nMore')
      }
    ]);
  });

  it('gives MathJax the body of displaymath, which it does not know', () => {
    expect(displayTex('\\begin{displaymath}\n x\n\\end{displaymath}')).toEqual(['\n x\n']);
  });

  it('leaves blocks that share a line with text, and empty ones', () => {
    expect(displayTex('so \\[ x \\]\n\\[\n y\n\\] and\n\\begin{equation}\n\\end{equation}')).toEqual([]);
  });

  it('keeps rendering the blocks below one still being typed', () => {
    expect(displayTex('\\begin{equation}\n x\n\n\\begin{align}\n a &= b\n\\end{align}')).toEqual(['\\begin{align}\n a &= b\n\\end{align}']);
    expect(tex('\\begin{verbatim}\n\\begin{lstlisting}\n$a$\n\\end{verbatim}\n$b$')).toEqual(['b']);
  });

  it('skips blocks in verbatim and comments, and the inline math nested in them', () => {
    expect(displayTex('\\begin{verbatim}\n\\[ x \\]\n\\end{verbatim}\n% \\[ y \\]')).toEqual([]);
    expect(findMathRegions('\\begin{equation}\n x \\text{if $c$}\n\\end{equation}', 'latex').inline).toEqual([]);
  });
});

describe('previewSource', () => {
  it('blanks comments and verbatim, keeping every offset and line break, CRLF ones too', () => {
    const text = 'a $x$ % note\r\n\\% kept\r\n\\begin{verbatim}\r\n$y$\r\n\\end{verbatim}';
    const source = previewSource(text, 'latex');
    // A comment keeps its line's \r; a verbatim body is blanked to its line breaks alone.
    expect(source).toBe('a $x$       \r\n\\% kept\r\n\\begin{verbatim} \n    \n\\end{verbatim}');
    expect(source).toHaveLength(text.length);
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
    macros: {}, color: '#cccccc', fontSizePx: 14, lineHeightPx: 21, ...overrides
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
    expect(renderer.renderBlock('\\R', 3, options({ macros }))).toBe(renderer.renderBlock('\\R', 3, options({ macros })));
  });

  it('cuts a display formula into line-tall strips for the lines it reaches', () => {
    const result = renderer.renderBlock('\\begin{equation}\n x = 1\n\\end{equation}', 3, options());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One line of math, centred in three lines, stays within the middle one.
    expect(result.image.slices.map(slice => slice.row)).toEqual([1]);
    const svg = decode(result.image.slices[0].dataUri);
    expect(svg).toContain(`viewBox="0 21.00 ${result.image.widthPx.toFixed(2)} 21.00"`);
    expect(svg).toContain('style="color:#cccccc"');
  });

  it('sets a one-line block like inline math, so it stays legible at a line\'s height', () => {
    const sum = '\\sum_{i=1}^n x_i';
    const oneLine = renderer.renderBlock(sum, 1, options());
    const twoLines = renderer.renderBlock(sum, 2, options());
    expect(oneLine.ok && twoLines.ok && oneLine.image.widthPx > twoLines.image.widthPx).toBe(true);
  });

  it('renders tagged equations without their tag, and lets equation-only commands through', () => {
    expect(renderer.renderBlock('x = 1 \\tag{$\\star$}', 3, options()).ok).toBe(true);
    expect(renderer.renderBlock('\\begin{equation}\n x \\qedhere\n\\end{equation}', 3, options()).ok).toBe(true);
    expect(renderer.renderBlock('\\begin{align}\n a &= \\frac{1}{\n\\end{align}', 3, options())).toMatchObject({ ok: false });
  });

  it('renders a labelled equation again, as after an edit or a theme change', () => {
    const labelled = '\\begin{equation}\n x = 1 \\label{eq:x}\n\\end{equation}';
    expect(renderer.renderBlock(labelled, 3, options()).ok).toBe(true);
    expect(renderer.renderBlock(labelled, 3, options({ color: '#000000' })).ok).toBe(true);
  });
});

describe('sizeForEditor', () => {
  it('converts MathJax ex sizes to px and keeps the baseline offset', () => {
    const svg = '<svg style="vertical-align: -0.5ex;" xmlns="http://www.w3.org/2000/svg" width="4ex" height="2ex" viewBox="0 0 1 1"></svg>';
    const image = sizeForEditor(svg, { color: '#000', fontSizePx: 20, lineHeightPx: 100 });
    expect(image).toMatchObject({ widthPx: 44, heightPx: 22, verticalAlignPx: -5.5 });
  });

  it('refuses an SVG MathJax did not give a fixed size', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="2ex" viewBox="0 0 1 1"></svg>';
    expect(sizeForEditor(svg, { color: '#000', fontSizePx: 20, lineHeightPx: 100 })).toBeUndefined();
    expect(sliceForLines(svg, 3, { color: '#000', fontSizePx: 20, lineHeightPx: 100 })).toBeUndefined();
  });
});

describe('sliceForLines', () => {
  const sizing = { color: '#000', fontSizePx: 20, lineHeightPx: 10 };
  // 2ex at 20px is 22px tall: centred in 30px it spans 4px to 26px.
  const svg = '<svg style="vertical-align: -0.5ex;" xmlns="http://www.w3.org/2000/svg" width="4ex" height="2ex" viewBox="0 -500 1000 1000"><g></g></svg>';

  it('skips the lines the formula does not reach, and centres it in the block', () => {
    expect(sliceForLines(svg, 5, sizing)?.slices.map(slice => slice.row)).toEqual([1, 2, 3]);
    const middle = Buffer.from(sliceForLines(svg, 3, sizing)!.slices[1].dataUri.split(',')[1], 'base64').toString('utf8');
    expect(middle).toContain('viewBox="0 10.00 44.00 10.00"');
    expect(middle).toContain('<svg x="0.00" y="4.00" width="44.00" height="22.00" viewBox="0 -500 1000 1000" overflow="visible"><g></g></svg>');
  });

  it('scales a formula taller than its block down to fit', () => {
    expect(sliceForLines(svg, 1, sizing)).toMatchObject({ widthPx: 20, slices: [{ row: 0 }] });
  });
});
