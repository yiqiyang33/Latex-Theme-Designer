import { describe, expect, it } from 'vitest';
import { defaultHomeworkSettings } from '../src/homework';
import { findMathRegions } from '../src/livePreview/mathRegions';
import type { ContentsEntry, LabelInfo, TheoremEntry } from '../src/livePreview/references';
import {
  emptyTheoremSettings,
  enumerateLabel,
  findStructure,
  numberHeadings,
  readTheoremSettings,
  solutionBoxes,
  structureOverlays,
  type HeadingMark
} from '../src/livePreview/structure';
import type { HomeworkSettings } from '../src/types';
import { drawn } from './support/drawn';

const theorems = emptyTheoremSettings();
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
    expect(theorems.themeCommands).toBe(false);
    expect(Object.fromEntries(theorems.environments)).toEqual({
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

describe('theme commands', () => {
  const theme = emptyTheoremSettings();
  readTheoremSettings([
    '\\NewDocumentCommand{\\thm}{mm+m}{', '  \\ThemeRunTcbTheorem{mytheorem}{thm}{#1}{#2}{#3}', '}',
    '\\NewDocumentCommand{\\lemp}{m+m+m}{', '  \\lem{#1}{}{#2}', '  \\pf{#3}', '}'
  ].join('\n'), theme);
  const labels = new Map<string, LabelInfo>([
    ['thm:general', { number: '2.1', type: 'tcb@cnt@mydefinition' }],
    ['defn:def:sample', { number: '1', type: 'tcb@cnt@mydefinition' }]
  ]);
  const show = (text: string, settings = theme) =>
    drawn(text, structureOverlays(findStructure(text, findMathRegions(text, 'latex'), 'latex'), text, settings, { labels }));

  it('recognises the theme by its three-argument theorem commands, and leaves its own definitions alone', () => {
    expect(theme.themeCommands).toBe(true);
    expect(show('\\lem{#1}{}{#2}')).toBe('\\lem{#1}{}{#2}');
    expect(show('\\thm{A}{general}{B}', emptyTheoremSettings())).toBe('\\thm{A}{general}{B}');
  });

  it('draws \\thm{title}{label}{body} as its theorem, numbered by the label with the theme\'s prefix', () => {
    expect(show('\\thm{Generalization}{general}{\nLet $x$ be.\n}'))
      .toBe('**Theorem\u00a02.1**\u00a0(Generalization).\u00a0<dim>general</dim>\nLet $x$ be.\n<dim>}</dim>');
    expect(show('\\defn{Sample}{def:sample}{Body}')).toBe('**Definition\u00a01**\u00a0(Sample).\u00a0<dim>def:sample</dim>Body<dim>}</dim>');
    expect(show('\\thm{}{thm:general}\n{Body}')).toBe('**Theorem\u00a02.1.\u00a0**<dim>thm:general</dim>Body<dim>}</dim>');
    expect(show('\\lem{}{}{Body}')).toBe('**Lemma.\u00a0**Body<dim>}</dim>');
  });

  it('numbers unlabelled theorems by what the compile recorded of every theorem, in order', () => {
    const text = '\\lem{}{}{A}\n\\thm{Three Series}{}{B}\n\\rmkb{C}\n\\begin{lemma}[Own]\n\\end{lemma}\n\\lemp{}{S}{P}';
    // thmtools' list, in the theme's plain amsthm mode.
    const plain: TheoremEntry[] = [
      { type: 'lemma', number: '3.1' }, { type: 'theorem', number: '3.1', title: 'Three Series' }, { type: 'remark', number: '3.1' },
      { type: 'lemma', number: '3.2', title: 'Own' }, { type: 'lemma', number: '3.3' }
    ];
    const settings = emptyTheoremSettings();
    readTheoremSettings('\\NewDocumentCommand{\\thm}{mm+m}{}\n\\newtheorem{lemma}{Lemma}[chapter]', settings);
    const numbered = (theorems: TheoremEntry[]) => drawn(text, structureOverlays(findStructure(text, findMathRegions(text, 'latex'), 'latex'), text, settings, { labels, theorems }));
    expect(numbered(plain)).toBe([
      '**Lemma\u00a03.1.\u00a0**A<dim>}</dim>', '**Theorem\u00a03.1**\u00a0(Three Series).\u00a0B<dim>}</dim>', '*Remark\u00a03.1.\u00a0*C<dim>}</dim>',
      '**Lemma\u00a03.2**\u00a0(Own).', '<dim>\\end{lemma}</dim>', '**Lemma.\u00a0**S**Proof.\u00a0**P\u25a1'
    ].join('\n').replace('**Lemma.\u00a0**S', '**Lemma\u00a03.3.\u00a0**S'));
    // tcolorbox's labels, in the styled mode, where remarks go unrecorded.
    const styled: TheoremEntry[] = [{ type: 'lem', number: '4' }, { type: 'thm', number: '5', title: 'Three Series' }, { type: 'lem', number: '6' }];
    const drawnStyled = numbered([...styled, { type: 'lemma', number: '7', title: 'Own' }]);
    expect(drawnStyled).toContain('**Lemma\u00a04.\u00a0**A');
    expect(drawnStyled).toContain('**Theorem\u00a05**');
    expect(drawnStyled).toContain('*Remark.\u00a0*C');
    expect(drawnStyled).toContain('**Lemma\u00a07**\u00a0(Own).');
    expect(drawnStyled).toContain('**Lemma\u00a06.\u00a0**S');
  });

  it('takes only titled theorems from a record that does not match the document', () => {
    const text = '\\lem{}{}{New}\n\\lem{Known}{}{A}\n\\thm{}{general}{B}';
    // One lemma short, as after adding one without compiling, and not every theorem: a part of a larger document.
    const theorems: TheoremEntry[] = [{ type: 'lemma', number: '1.1', title: 'Other' }, { type: 'lemma', number: '1.2', title: 'Known' }, { type: 'theorem', number: '9.9' }, { type: 'theorem', number: '9.8' }];
    const out = drawn(text, structureOverlays(findStructure(text, findMathRegions(text, 'latex'), 'latex'), text, theme, { labels, theorems }));
    expect(out.split('\n')).toEqual([
      '**Lemma.\u00a0**New<dim>}</dim>', '**Lemma\u00a01.2**\u00a0(Known).\u00a0A<dim>}</dim>',
      // A label still numbers its theorem.
      '**Theorem\u00a02.1.\u00a0**<dim>general</dim>B<dim>}</dim>'
    ]);
    // A repeated title takes the next entry along.
    const twice = '\\lem{Fubini}{}{A}\n\\lem{Fubini}{}{B}';
    expect(drawn(twice, structureOverlays(findStructure(twice, findMathRegions(twice, 'latex'), 'latex'), twice, theme, {
      theorems: [{ type: 'lemma', number: '1.1', title: 'Fubini' }, { type: 'lemma', number: '1.2' }, { type: 'lemma', number: '2.5', title: 'Fubini' }]
    }))).toBe('**Lemma\u00a01.1**\u00a0(Fubini).\u00a0A<dim>}</dim>\n**Lemma\u00a02.5**\u00a0(Fubini).\u00a0B<dim>}</dim>');
  });

  it('draws proofs, examples, remarks and questions as the theme sets them', () => {
    expect(show('\\pf{Done.}')).toBe('**Proof.\u00a0**Done.\u25a1');
    expect(show('\\lemp{Bound}{Stmt}{\nPf\n}')).toBe('**Lemma**\u00a0(Bound).\u00a0Stmt**Proof.\u00a0**\nPf\n\u25a1');
    expect(show('\\ex{E} \\rmk{R} \\rmkb{B}')).toBe('**Example.\u00a0**E<dim>}</dim> <italic>R</italic> *Remark.\u00a0*B<dim>}</dim>');
    expect(show('\\question{Q} \\question[Warm-up]{W}')).toBe('**Question.\u00a0**Q<dim>}</dim> <bold>Warm-up</bold>**.\u00a0**W<dim>}</dim>');
  });
});

describe('homework', () => {
  const homework = defaultHomeworkSettings();
  const show = (text: string, settings = homework) =>
    drawn(text, structureOverlays(findStructure(text, findMathRegions(text, 'latex'), 'latex'), text, theorems, {}, settings));

  it('heads problems and parts as homework.sty numbers them, keeping their names as source', () => {
    const text = [
      '\\begin{homeworkProblem}[Sample $n$]', '\\begin{solution}', 'Solve.', '\\end{solution}', '\\end{homeworkProblem}',
      '\\begin{homeworkProblem}[5][Renumbered]\\label{prob:five}',
      '  \\begin{homeworkSection}[First Part]', '  \\end{homeworkSection}',
      '  \\begin{homeworkSection}[2.3][]', '  \\end{homeworkSection}',
      '  \\begin{homeworkSection}<Step>', '  \\end{homeworkSection}',
      '\\end{homeworkProblem}',
      '\\begin{homeworkProblem}[1.1][]<Bonus>', '  \\begin{homeworkSection}', '  \\end{homeworkSection}', '\\end{homeworkProblem}',
      '\\begin{homeworkProblem}[][Blank number]', '\\end{homeworkProblem}'
    ].join('\n');
    expect(show(text)).toBe([
      '**Problem\u00a01 \u2014\u00a0**<section>Sample $n$</section>', '**Solution**', 'Solve.', '<dim>\\end{solution}</dim>', '<dim>\\end{homeworkProblem}</dim>',
      '**Problem\u00a05 \u2014\u00a0**<section>Renumbered</section><dim>\\label{prob:five}</dim>',
      '  **(a)\u00a0**<subsection>First Part</subsection>', '  <dim>\\end{homeworkSection}</dim>',
      // A dotted number prefixes the part's later siblings too, until the next problem.
      '  **(2.c)**', '  <dim>\\end{homeworkSection}</dim>',
      '  **Step\u00a0(2.d)**', '  <dim>\\end{homeworkSection}</dim>',
      '<dim>\\end{homeworkProblem}</dim>',
      '**Bonus\u00a01.1**', '  **(a)**', '  <dim>\\end{homeworkSection}</dim>', '<dim>\\end{homeworkProblem}</dim>',
      // ...and a problem's prefix stays.
      '**Problem\u00a01.2 \u2014\u00a0**<section>Blank number</section>', '<dim>\\end{homeworkProblem}</dim>'
    ].join('\n'));
  });

  it('follows the Homework panel\'s words, styles, prefix and nested parts', () => {
    const text = '\\begin{homeworkProblem}\n\\begin{homeworkSection}[Name]\\end{homeworkSection}\n\\end{homeworkProblem}\n\\begin{homeworkProblem}[0][]';
    const nested: HomeworkSettings = {
      ...homework, problemWord: 'Question', sectionWord: 'Part', problemStyle: 'Roman', sectionStyle: 'arabic', problemPrefix: '2', sectionMode: 'nested'
    };
    expect(show(text, nested)).toBe([
      '**Question\u00a02.I**', '**Part\u00a02.I.1\u00a0**<subsection>Name</subsection><dim>\\end{homeworkSection}</dim>', '<dim>\\end{homeworkProblem}</dim>',
      '**Question\u00a02.**'
    ].join('\n'));
    // An empty heading word prints the bare number.
    expect(show(text, { ...homework, problemWord: '' })).toBe([
      '**1**', '**(a)\u00a0**<subsection>Name</subsection><dim>\\end{homeworkSection}</dim>', '<dim>\\end{homeworkProblem}</dim>', '**0**'
    ].join('\n'));
  });

  it('titles solutions, boxes each from its begin to its end, and leaves all of it alone without homework.sty', () => {
    const text = '\\begin{solution}[Sketch]\nA\n\\begin{solution}\nB\n\\end{solution}\n\\end{solution}\n\\begin{solution}';
    expect(show(text)).toBe('<bold>Sketch</bold>\nA\n**Solution**\nB\n<dim>\\end{solution}</dim>\n<dim>\\end{solution}</dim>\n**Solution**');
    const structure = findStructure(text, findMathRegions(text, 'latex'), 'latex');
    expect(solutionBoxes(structure).map(box => text.slice(box.start, box.end))).toEqual([
      text.slice(0, text.lastIndexOf('\\begin') - 1), '\\begin{solution}\nB\n\\end{solution}'
    ]);
    expect(render('\\begin{homeworkProblem}[A]\n\\begin{solution}')).toBe('\\begin{homeworkProblem}[A]\n\\begin{solution}');
  });
});

describe('text formatting', () => {
  it('hides formatting commands and styles their text, outside formulas and comments', () => {
    expect(render('\\textbf{A} \\textsc{B} \\texttt{C} \\underline{D}')).toBe('<bold>A</bold> <smallCaps>B</smallCaps> C <underline>D</underline>');
    expect(render('$\\textbf{x}$ % \\section{No}')).toBe('$\\textbf{x}$ % \\section{No}');
  });
});
