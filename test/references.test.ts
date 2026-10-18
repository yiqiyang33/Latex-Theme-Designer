import { beforeAll, describe, expect, it } from 'vitest';
import { findMathRegions } from '../src/livePreview/mathRegions';
import { MathRenderer, sliceForLines } from '../src/livePreview/mathRenderer';
import {
  emptyCrefSettings,
  equationTags,
  expandOutDir,
  findReferences,
  formatReference,
  parseAux,
  readCrefSettings,
  rootHint,
  substituteReferences,
  type ReferenceCommand
} from '../src/livePreview/references';

const AUX = [
  '\\relax',
  '\\newlabel{eq:loss}{{3}{6}{Fitting the choice model}{equation.3}{}}',
  '\\newlabel{eq:loss@cref}{{[equation][3][]3}{[1][6][]6}{}{}{}}',
  '\\newlabel{sec:model}{{1}{1}{Model and {\\em Problem}}{section.1}{}}',
  '\\newlabel{app:proof}{{A.1}{20}{Score covariance}{subsection.A.1}{}}',
  '\\newlabel{app:proof@cref}{{[subsection][1][1]A.1}{[1][20][]20}{}{}{}}',
  '\\newlabel{thm:main}{{2}{8}{Lower bound}{theorem.2}{}}',
  '\\newlabel{plain}{{4}{9}}',
  // A lemma numbered with theorems: hyperref's anchor names the shared counter, cleveref the lemma.
  '\\newlabel{lem:bound}{{3}{9}{Bound}{theorem.3}{}}',
  '\\newlabel{lem:bound@cref}{{[lemma][3][]3}{[1][9][]9}{}{}{}}',
  '\\@input{chapters/one.aux}'
].join('\n');
const { labels } = parseAux(AUX);
const decode = (dataUri: string) => Buffer.from(dataUri.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');

describe('parseAux', () => {
  it('reads hyperref and plain labels, taking the counter from cleveref over the anchor', () => {
    const aux = parseAux(AUX);
    expect(aux.labels.get('eq:loss')).toEqual({ number: '3', page: '6', title: 'Fitting the choice model', type: 'equation' });
    expect(aux.labels.get('sec:model')).toMatchObject({ number: '1', title: 'Model and Problem', type: 'section' });
    expect(aux.labels.get('app:proof')).toMatchObject({ number: 'A.1', type: 'subsection' });
    expect(aux.labels.get('plain')).toEqual({ number: '4', page: '9', title: undefined, type: undefined });
    expect(aux.labels.has('eq:loss@cref')).toBe(false);
    expect(aux.inputs).toEqual(['chapters/one.aux']);
  });
});

describe('rootHint', () => {
  it('follows a magic comment or the subfiles class, and knows a root by its document body', () => {
    expect(rootHint('% !TEX root = ../main.tex\n\\section{A}')).toEqual({ root: '../main.tex', isRoot: false });
    expect(rootHint('\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\end{document}')).toEqual({ root: '../main.tex', isRoot: false });
    expect(rootHint('\\documentclass{article}\n\\begin{document}\nx\n\\end{document}')).toEqual({ isRoot: true });
    expect(rootHint('% \\documentclass{article}\n% \\begin{document}\n\\section{A}')).toEqual({ isRoot: false });
  });
});

describe('expandOutDir', () => {
  const places = { rootDir: '/p/paper', workspaceFolder: '/p' };
  it('expands LaTeX Workshop placeholders and resolves relative folders from the root', () => {
    expect(expandOutDir('%WORKSPACE_FOLDER%/.overleaf-codex/local-build', places)).toBe('/p/.overleaf-codex/local-build');
    expect(expandOutDir('%DIR%', places)).toBe('/p/paper');
    expect(expandOutDir('./out', places)).toBe('/p/paper/out');
    expect(expandOutDir('%TMPDIR%', places)).toBeUndefined();
    expect(expandOutDir('%WORKSPACE_FOLDER%/build', { rootDir: '/p/paper' })).toBeUndefined();
  });
});

describe('findReferences', () => {
  const references = (text: string) => findReferences(text, findMathRegions(text, 'latex'), 'latex');

  it('finds reference commands in the text, with the tie before them', () => {
    const text = 'See Section~\\ref{sec:model}, \\eqref{eq:loss} and \\Cref*{a, b}.';
    expect(references(text)).toEqual([
      { start: text.indexOf('~'), end: text.indexOf(','), command: 'ref', keys: ['sec:model'], tie: true },
      { start: text.indexOf('\\eqref'), end: text.indexOf(' and'), command: 'eqref', keys: ['eq:loss'], tie: false },
      { start: text.indexOf('\\Cref'), end: text.indexOf('.'), command: 'Cref', keys: ['a', 'b'], tie: false }
    ]);
  });

  it('skips comments, verbatim, formulas, escaped backslashes and look-alike commands', () => {
    const text = [
      '% \\ref{a}', '\\begin{verbatim}', '\\ref{b}', '\\end{verbatim}', '$x \\eqref{c}$', '\\[', ' \\ref{d}', '\\]',
      '\\refstepcounter{e} \\\\ref{f} \\~\\ref{g}'
    ].join('\n');
    expect(references(text)).toEqual([expect.objectContaining({ keys: ['g'], tie: false })]);
  });
});

describe('formatReference', () => {
  const text = (command: ReferenceCommand, keys: string[], cref = emptyCrefSettings()) =>
    formatReference({ command, keys }, labels, cref).text;

  it('prints what LaTeX prints for each command, and ?? for a label the compile did not record', () => {
    expect(text('ref', ['app:proof'])).toBe('A.1');
    expect(text('eqref', ['eq:loss'])).toBe('(3)');
    expect(text('pageref', ['thm:main'])).toBe('8');
    expect(text('nameref', ['thm:main'])).toBe('Lower bound');
    expect(text('autoref', ['thm:main'])).toBe('Theorem\u00a02');
    expect(text('ref', ['missing'])).toBe('??');
    expect(text('eqref', ['missing'])).toBe('(??)');
  });

  it('names counters as cleveref does', () => {
    expect(text('cref', ['eq:loss'])).toBe('eq.\u00a0(3)');
    expect(text('Cref', ['eq:loss'])).toBe('Equation\u00a0(3)');
    expect(text('cref', ['app:proof'])).toBe('section\u00a0A.1');
    expect(text('cref', ['eq:loss', 'eq:loss'])).toBe('eqs.\u00a0(3) and (3)');
    expect(text('cref', ['eq:loss', 'thm:main', 'sec:model'])).toBe('eq.\u00a0(3), theorem\u00a02 and section\u00a01');
    expect(text('labelcref', ['eq:loss', 'sec:model'])).toBe('(3) and 1');
    expect(text('cref', ['missing'])).toBe('??');
    expect(text('Cref', ['lem:bound'])).toBe('Lemma\u00a03');
  });

  it('follows cleveref options and the names a project sets', () => {
    const spelledOut = emptyCrefSettings();
    readCrefSettings('\\usepackage[capitalise,noabbrev]{cleveref}\n\\crefname{theorem}{result}{results}', spelledOut);
    expect(text('cref', ['eq:loss'], spelledOut)).toBe('Equation\u00a0(3)');
    expect(text('cref', ['thm:main'], spelledOut)).toBe('result\u00a02');
    expect(text('Cref', ['thm:main'], spelledOut)).toBe('Result\u00a02');
    const capitalised = emptyCrefSettings();
    readCrefSettings('\\usepackage[capitalise]{hyperref,cleveref}', capitalised);
    expect(text('cref', ['eq:loss'], capitalised)).toBe('Eq.\u00a0(3)');
  });
});

describe('substituteReferences', () => {
  it('replaces the references in a formula with text MathJax can set, leaving escaped ones', () => {
    expect(substituteReferences('a \\eqref{eq:loss} \\\\ref{x}', reference => reference.command === 'eqref' ? '(3)' : '??'))
      .toBe('a \\text{(3)} \\\\ref{x}');
    expect(substituteReferences('\\ref{x}', () => '50% & more')).toBe('\\text{50\\% \\& more}');
  });

  it('prints plain text where the formula is already text, and \\text in math nested there', () => {
    const tex = '\\quad\\text{see~\\eqref{a}.} + \\ref{b} \\mbox{if $\\ref{c}$ or \\textbf{\\ref{d}}}';
    expect(substituteReferences(tex, reference => reference.keys[0].toUpperCase()))
      .toBe('\\quad\\text{see~A.} + \\text{B} \\mbox{if $\\text{C}$ or \\textbf{D}}');
  });
});

describe('equationTags', () => {
  it('numbers a labelled equation on its baseline, and centres the number of a split one', () => {
    expect(equationTags('\\begin{equation}\n x \\label{eq:loss}\n\\end{equation}', labels)).toEqual([{ tex: '\\text{(3)}', row: 0 }]);
    expect(equationTags('\\begin{equation}\\label{eq:loss}\n\\begin{split} a &= b \\\\ &= c \\end{split}\n\\end{equation}', labels))
      .toEqual([{ tex: '\\text{(3)}', row: undefined }]);
  });

  it('leaves out what LaTeX does not number or the compile did not record', () => {
    expect(equationTags('\\begin{equation}\n x\n\\end{equation}', labels)).toEqual([]);
    expect(equationTags('\\begin{equation}\n x \\label{eq:loss} \\nonumber\n\\end{equation}', labels)).toEqual([]);
    expect(equationTags('\\begin{equation*}\n x \\label{eq:loss}\n\\end{equation*}', labels)).toEqual([]);
    expect(equationTags('\\begin{equation}\n x \\label{eq:loss}\n\\end{equation}', undefined)).toEqual([]);
    expect(equationTags('\\begin{equation}\n x \\label{eq:new}\n\\end{equation}', labels)).toEqual([{ tex: '\\text{(??)}', row: 0 }]);
  });

  it('numbers the last line of a multline, even after a final row break', () => {
    expect(equationTags('\\begin{multline}\n a \\\\\n b \\label{eq:loss} \\\\\n\\end{multline}', labels)).toEqual([{ tex: '\\text{(3)}', row: 1 }]);
  });

  it('shows explicit tags, also in unnumbered environments', () => {
    expect(equationTags('\\begin{equation*}\n x \\tag{$\\star$}\n\\end{equation*}', undefined)).toEqual([{ tex: '\\text{($\\star$)}', row: 0 }]);
    expect(equationTags(' x \\tag*{A}', undefined)).toEqual([{ tex: '\\text{A}', row: 0 }]);
  });

  it('numbers each row of an align, skipping breaks inside braces, nested environments and comments', () => {
    const tex = [
      '\\begin{align}',
      ' a &= \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\label{eq:loss} \\\\',
      ' % c &= d \\\\',
      ' e &= \\text{f \\\\ g} \\nonumber \\\\',
      ' h &= i \\label{thm:main} \\\\',
      '\\end{align}'
    ].join('\n');
    expect(equationTags(tex, labels)).toEqual([{ tex: '\\text{(3)}', row: 0 }, { tex: '\\text{(2)}', row: 2 }]);
  });
});

describe('sliceForLines with numbers', () => {
  const sizing = { color: '#000', fontSizePx: 20, lineHeightPx: 10 };
  // 44 by 22 px, its baseline halfway down; the number is 22 by 11 px, 2.75 px of it below its baseline.
  const formula = '<svg style="vertical-align: -0.5ex;" xmlns="http://www.w3.org/2000/svg" width="4ex" height="2ex" viewBox="0 -500 1000 1000"><g></g></svg>';
  const number = '<svg style="vertical-align: -0.25ex;" xmlns="http://www.w3.org/2000/svg" width="2ex" height="1ex" viewBox="0 -750 500 1000"><i></i></svg>';
  const strip = (tags: Parameters<typeof sliceForLines>[3]) => decode(sliceForLines(formula, 3, sizing, tags)!.slices[0].dataUri);

  it('right-aligns a number two ems from the formula, on the baseline of its row', () => {
    expect(sliceForLines(formula, 3, sizing, [{ svg: number, baseline: 0 }])?.widthPx).toBeCloseTo(106, 5);
    expect(strip([{ svg: number, baseline: 0 }])).toContain('<svg x="84.00" y="6.75" width="22.00" height="11.00" viewBox="0 -750 500 1000" overflow="visible"><i></i></svg>');
  });

  it('centres a number given no row', () => {
    expect(strip([{ svg: number }])).toContain('<svg x="84.00" y="9.50" width="22.00" height="11.00"');
  });

  it('lines numbers of different widths up on their right edges', () => {
    const wide = number.replace('width="2ex"', 'width="3ex"');
    expect(strip([{ svg: number, baseline: 0 }, { svg: wide, baseline: 0 }])).toContain('<svg x="95.00" y="6.75" width="22.00"');
  });
});

describe('MathRenderer numbers', () => {
  const renderer = new MathRenderer();
  const options = { macros: {}, color: '#cccccc', fontSizePx: 14, lineHeightPx: 21 };
  const tex = '\\begin{align}\n a &= b \\\\\n c &= d\n\\end{align}';

  beforeAll(() => renderer.load());

  it('sets each number on the row of the formula it numbers', () => {
    const plain = renderer.renderBlock(tex, 4, options);
    const numbered = renderer.renderBlock(tex, 4, options, [{ tex: '\\text{(1)}', row: 0 }, { tex: '\\text{(2)}', row: 1 }]);
    expect(plain.ok && numbered.ok).toBe(true);
    if (!plain.ok || !numbered.ok) return;
    expect(numbered.image.widthPx).toBeGreaterThan(plain.image.widthPx + 2 * options.fontSizePx);
    const pieces = [...decode(numbered.image.slices[0].dataUri).matchAll(/<svg x="([\d.]+)" y="([-\d.]+)"/g)].map(match => match.slice(1).map(Number));
    expect(pieces).toHaveLength(3);
    const [, first, second] = pieces;
    expect(first[0]).toBeCloseTo(second[0], 1);
    // The rows are about one line of math apart.
    expect(second[1] - first[1]).toBeGreaterThan(options.fontSizePx);
  });

  it('keeps a number for a row MathJax did not make only when it is the formula\'s one number', () => {
    const single = renderer.renderBlock('x = 1', 3, options, [{ tex: '\\text{(1)}', row: 5 }]);
    const several = renderer.renderBlock('x = 1', 3, options, [{ tex: '\\text{(1)}', row: 5 }, { tex: '\\text{(2)}', row: 6 }]);
    const plain = renderer.renderBlock('x = 1', 3, options);
    expect(single.ok && plain.ok && single.image.widthPx > plain.image.widthPx).toBe(true);
    expect(several.ok && plain.ok && several.image.widthPx).toBeCloseTo(plain.ok ? plain.image.widthPx : 0, 5);
  });
});
