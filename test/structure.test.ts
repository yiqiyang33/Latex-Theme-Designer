import { describe, expect, it } from 'vitest';
import { findMathRegions } from '../src/livePreview/mathRegions';
import type { ContentsEntry, LabelInfo } from '../src/livePreview/references';
import {
  enumerateLabel,
  findStructure,
  numberHeadings,
  readTheoremSettings,
  structureOverlays,
  type HeadingMark,
  type TheoremSettings
} from '../src/livePreview/structure';
import { drawn } from './support/drawn';

const theorems: TheoremSettings = new Map();
readTheoremSettings([
  '\\theoremstyle{plain}',
  '\\newtheorem{theorem}{Theorem}[section]',
  '\\newtheorem{lemma}[theorem]{Lemma}',
  '\\newtheorem{proposition}{Proposition}',
  '\\theoremstyle{remark}',
  '\\newtheorem{remark}{Remark}',
  '\\newtheorem*{note}{Note}',
  '\\declaretheorem[name=Claim, style=definition, sibling=theorem]{claim}'
].join('\n'), theorems);

const render = (text: string, numbers: { labels?: Map<string, LabelInfo>; contents?: ContentsEntry[] } = {}) =>
  drawn(text, structureOverlays(findStructure(text, findMathRegions(text, 'latex'), 'latex'), text, theorems, numbers));

describe('readTheoremSettings', () => {
  it('reads names, styles, shared counters and unnumbered environments', () => {
    expect(Object.fromEntries(theorems)).toEqual({
      theorem: { name: 'Theorem', style: 'plain', counter: 'theorem', numbered: true },
      lemma: { name: 'Lemma', style: 'plain', counter: 'theorem', numbered: true },
      proposition: { name: 'Proposition', style: 'plain', counter: 'proposition', numbered: true },
      remark: { name: 'Remark', style: 'remark', counter: 'remark', numbered: true },
      note: { name: 'Note', style: 'remark', counter: 'note', numbered: false },
      claim: { name: 'Claim', style: 'definition', counter: 'theorem', numbered: true }
    });
  });
});

describe('headings', () => {
  it('numbers headings from the table of contents and styles their titles', () => {
    const text = '\\section{Model}\\label{sec:model}\nText\n\\subsection*{Aside}\n\\subsection[Short]{A long \\emph{title}}\n\\paragraph{Fitting.} More';
    const contents = [{ level: 'section', number: '2', title: 'Model' }, { level: 'subsection', number: '2.1', title: 'Short' }];
    expect(render(text, { contents })).toBe([
      '**2\u2002**<section>Model</section><dim>\\label{sec:model}</dim>',
      'Text',
      '<subsection>Aside</subsection>',
      '**2.1\u2002**<subsection>A long <italic>title</italic></subsection>',
      '<bold>Fitting.</bold> More'
    ].join('\n'));
  });

  it('gives a repeated title the next entry along, and a title written differently the entry after the last match', () => {
    const contents: ContentsEntry[] = [
      { level: 'section', number: '1', title: 'Intro' },
      { level: 'subsection', number: '1.1', title: 'Proofs' },
      { level: 'section', number: '2', title: 'Main' },
      { level: 'subsection', number: '2.1', title: 'Proofs' },
      { level: 'section', number: '3', title: 'The \\mathcal {N} model' },
      { level: 'section', number: '4', title: 'Root-$N$ regret' }
    ];
    const heading = (level: string, tocTitle: string) => ({ level, tocTitle, starred: false }) as HeadingMark;
    expect(numberHeadings([
      heading('section', 'Main'), heading('subsection', 'Proofs'), heading('section', 'The \\cN model'),
      heading('section', '\\texorpdfstring{Root-$N$}{Root-N} regret'), heading('section', 'Not in the contents')
    ], contents)).toEqual(['2', '2.1', '3', '4', undefined]);
    // The TeX of \texorpdfstring is what the aux file records, not the PDF text.
    expect(numberHeadings([heading('section', '\\texorpdfstring{$\\alpha$-stable}{Alpha-stable} laws')], [
      { level: 'section', number: '1', title: 'Intro' }, { level: 'section', number: '2', title: '$\\alpha $-stable laws' }
    ])).toEqual(['2']);
  });
});

describe('theorems and proofs', () => {
  const labels = new Map<string, LabelInfo>([
    ['lem:loc', { number: '3', type: 'lemma' }],
    ['thm:main', { number: '2.1', type: 'theorem' }],
    ['eq:inner', { number: '7', type: 'equation' }],
    ['note:aside', { number: '5', type: 'note' }]
  ]);

  it('sets theorem heads with the number of their own label, keeping the note as source', () => {
    const text = [
      '\\begin{lemma}[Anytime localization]', '\\label{lem:loc}', 'Body.', '\\end{lemma}',
      '\\begin{remark}', 'Aside.', '\\end{remark}'
    ].join('\n');
    expect(render(text, { labels })).toBe([
      '**Lemma\u00a03**\u00a0(Anytime localization).', '<dim>\\label{lem:loc}</dim>', 'Body.', '<dim>\\end{lemma}</dim>',
      '*Remark.*', 'Aside.', '<dim>\\end{remark}</dim>'
    ].join('\n'));
  });

  it('takes a label numbered with a shared counter, but not one of something else inside', () => {
    expect(render('\\begin{lemma}\\label{thm:main}\n\\end{lemma}', { labels })).toContain('**Lemma\u00a02.1.**');
    // Declared with its own counter, but compiled sharing the theorem one, as the aux file says.
    expect(render('\\begin{proposition}\n\\label{thm:main}\n\\end{proposition}', { labels })).toContain('**Proposition\u00a02.1.**');
    expect(render('\\begin{claim}\nSee \\label{eq:inner}.\n\\end{claim}', { labels })).toContain('**Claim.**');
    expect(render('\\begin{note}\\label{note:aside}\n\\end{note}', { labels })).toContain('*Note.*');
  });

  it('sets proofs in italics, with their own heading, and ends them with a box', () => {
    const text = '\\begin{proof}[Proof of Lemma~\\ref{lem:loc}]\nDone.\n\\end{proof}\n\\begin{proof}\n\\end{proof}';
    expect(render(text)).toBe('<italic>Proof of Lemma~\\ref{lem:loc}</italic>*.*\nDone.\n\u25a1\n*Proof.*\n\u25a1');
  });
});

describe('lists', () => {
  it('labels items by list kind and depth, following enumitem labels and leaving own labels as source', () => {
    const text = [
      '\\begin{enumerate}[label=(\\alph*)]', '\\item First', '\\item Second',
      '  \\begin{itemize}', '  \\item Inner', '  \\end{itemize}',
      '\\item[(x)] Own label', '\\item Third', '\\end{enumerate}',
      '\\begin{enumerate}[start=4]', '\\item Four', '\\end{enumerate}',
      '\\begin{description}', '\\item[Term] Meaning', '\\item Plain', '\\end{description}'
    ].join('\n');
    expect(render(text)).toBe([
      '<dim>\\begin{enumerate}[label=(\\alph*)]</dim>', '(a) First', '(b) Second',
      '  <dim>\\begin{itemize}</dim>', '  \u2022 Inner', '  <dim>\\end{itemize}</dim>',
      '(x) Own label', '(c) Third', '<dim>\\end{enumerate}</dim>',
      '<dim>\\begin{enumerate}[start=4]</dim>', '4. Four', '<dim>\\end{enumerate}</dim>',
      '<dim>\\begin{description}</dim>', '<bold>Term</bold> Meaning', ' Plain', '<dim>\\end{description}</dim>'
    ].join('\n'));
  });

  it('fills label templates and LaTeX\'s labels by depth', () => {
    expect(enumerateLabel('\\textbf{(\\roman*)}', 1, 4)).toBe('(iv)');
    expect(enumerateLabel('\\Alph*)', 1, 28)).toBe('AB)');
    expect([1, 2, 3, 4].map(depth => enumerateLabel(undefined, depth, 2))).toEqual(['2.', '(b)', 'ii.', 'B.']);
  });
});

describe('text formatting', () => {
  it('hides formatting commands and styles their text, outside formulas and comments', () => {
    expect(render('\\textbf{A} \\textsc{B} \\texttt{C} \\underline{D}')).toBe('<bold>A</bold> <smallCaps>B</smallCaps> C <underline>D</underline>');
    expect(render('$\\textbf{x}$ % \\section{No}')).toBe('$\\textbf{x}$ % \\section{No}');
  });
});
