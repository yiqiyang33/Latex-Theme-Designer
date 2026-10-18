import { findMatchingBrace, isEscaped } from '../snippets/engine/latexContext';
import type { HomeworkSettings } from '../types';
import { previewSource, type MathRegions } from './mathRegions';
import { overlay, type Insertion, type Overlay, type RangeStyle } from './overlays';
import { plainText, type ContentsEntry, type LabelInfo, type TheoremEntry } from './references';

export type TheoremStyle = 'plain' | 'definition' | 'remark';

/** A theorem-like environment as amsthm or thmtools declares it. */
export interface TheoremKind {
  name: string;
  style: TheoremStyle;
  /** The counter it numbers with: its own, or the one it shares. */
  counter: string;
  numbered: boolean;
}

export interface TheoremSettings {
  /** Theorem-like environments by name. */
  environments: Map<string, TheoremKind>;
  /** Whether the project uses this toolkit's theme, whose \thm{title}{label}{body} and siblings stand for theorems. */
  themeCommands: boolean;
}

export function emptyTheoremSettings(): TheoremSettings {
  return { environments: new Map(), themeCommands: false };
}

/**
 * Adds the theorem-like environments a file declares with \newtheorem or thmtools' \declaretheorem,
 * and notes the theme's theorem commands, which its theorems.tex defines with three arguments.
 */
export function readTheoremSettings(text: string, settings: TheoremSettings, source = previewSource(text, 'latex')): void {
  if (/\\NewDocumentCommand\s*\{?\s*\\thm\s*\}?\s*\{\s*mm\+m\s*\}/.test(source)) settings.themeCommands = true;
  let style: TheoremStyle = 'plain';
  const asStyle = (value: string | undefined): TheoremStyle => value === 'definition' || value === 'remark' ? value : 'plain';
  for (const match of source.matchAll(/\\(theoremstyle|newtheorem|declaretheorem)(\*?)(?![A-Za-z])/g)) {
    let index = match.index! + match[0].length;
    if (match[1] === 'theoremstyle') {
      const value = readBraces(source, index);
      if (value) style = asStyle(source.slice(value.start, value.end).trim());
      continue;
    }
    if (match[1] === 'newtheorem') {
      // \newtheorem{env}[shared counter]{Name}[parent counter]
      const env = readBraces(source, index);
      if (!env) continue;
      const shared = readBrackets(source, env.next);
      const name = readBraces(source, shared?.next ?? env.next);
      if (!name) continue;
      const environment = source.slice(env.start, env.end).trim();
      settings.environments.set(environment, {
        name: plainText(source.slice(name.start, name.end)),
        style,
        counter: (shared && source.slice(shared.start, shared.end).trim()) || environment,
        numbered: match[2] !== '*'
      });
      continue;
    }
    const options = readBrackets(source, index);
    if (options) index = options.next;
    const envs = readBraces(source, index);
    if (!envs) continue;
    const values = keyValues(options ? source.slice(options.start, options.end) : '');
    for (const environment of source.slice(envs.start, envs.end).split(',').map(name => name.trim()).filter(Boolean)) {
      settings.environments.set(environment, {
        name: values.name ? plainText(values.name) : capitalised(environment),
        style: asStyle(values.style),
        counter: values.sibling || values.numberlike || values.sharenumber || environment,
        numbered: !/^(no|false)$/.test(values.numbered ?? '')
      });
    }
  }
}

export interface HeadingMark {
  start: number;
  end: number;
  titleStart: number;
  titleEnd: number;
  level: string;
  starred: boolean;
  /** The title the table of contents shows: the optional short one, or the title. */
  tocTitle: string;
}

export interface EnvironmentMark {
  begin: boolean;
  name: string;
  start: number;
  /** End of the mark, past any optional argument of a begin. */
  end: number;
  /** The optional argument of a begin, inside its brackets, when on the same line. */
  argument?: { start: number; end: number };
  /** homework.sty's problems and parts: their second optional argument, and their heading word in <...>. */
  second?: { start: number; end: number };
  word?: { start: number; end: number };
}

export interface ItemMark {
  start: number;
  end: number;
  /** An \item's own label, inside its brackets. */
  label?: { start: number; end: number };
}

/** A command with one braced argument on its line, such as \label or \textbf. */
export interface CommandMark {
  name: string;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
}

/** One of the theme's theorem commands, such as \thm{title}{label}{body}, with its arguments. */
export interface ShorthandMark {
  command: string;
  start: number;
  end: number;
  /** \question's optional title, inside its brackets. */
  option?: { start: number; end: number };
  /** The braced arguments, inside their braces. */
  args: Array<{ start: number; end: number }>;
}

export interface Structure {
  headings: HeadingMark[];
  environments: EnvironmentMark[];
  items: ItemMark[];
  labels: CommandMark[];
  formats: CommandMark[];
  shorthands: ShorthandMark[];
}

const HEADING = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)(?![A-Za-z])/g;
const ENVIRONMENT = /\\(begin|end)\s*\{([^{}\n]*)\}/g;
const ITEM = /\\item(?![A-Za-z])/g;
/** homework.sty's environments that take [number][name]<word>, as problems and their parts. */
const HOMEWORK_HEADINGS = new Set(['homeworkProblem', 'homeworkSection']);
const LABEL = /\\(label)\s*(?=\{)/g;
const FORMAT = /\\(textbf|textit|emph|textsl|underline|texttt|textsc|textrm|textsf|textup|textnormal)\s*(?=\{)/g;
/** The theme's commands and how many braced arguments each takes. */
const THEME_ARGUMENTS: Record<string, number> = {
  defn: 3, thm: 3, lem: 3, cor: 3, prop: 3, clm: 3, fact: 3, assumption: 3, axiom: 3, lemp: 3, corp: 3,
  pf: 1, ex: 1, rmk: 1, rmkb: 1, question: 1
};
const THEME_COMMAND = new RegExp(`\\\\(${Object.keys(THEME_ARGUMENTS).join('|')})(?![A-Za-z@])`, 'g');

/** The document's structural markup outside formulas, with arguments that stay on their line. */
export function findStructure(text: string, math: MathRegions, languageId?: string, source = previewSource(text, languageId)): Structure {
  const formulas = [...math.inline, ...math.display].sort((a, b) => a.start - b.start);
  const inFormula = (offset: number) => {
    let low = 0;
    let high = formulas.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (formulas[middle].end <= offset) low = middle + 1;
      else if (formulas[middle].start > offset) high = middle - 1;
      else return true;
    }
    return false;
  };
  const marks = (pattern: RegExp) => [...source.matchAll(pattern)].filter(match => !isEscaped(source, match.index!) && !inFormula(match.index!));

  const headings: HeadingMark[] = [];
  for (const match of marks(HEADING)) {
    const short = readBrackets(source, match.index! + match[0].length);
    const title = readBraces(source, short?.next ?? match.index! + match[0].length);
    if (!title) continue;
    headings.push({
      start: match.index!,
      end: title.next,
      titleStart: title.start,
      titleEnd: title.end,
      level: match[1],
      starred: match[2] === '*',
      tocTitle: text.slice(short?.start ?? title.start, short?.end ?? title.end)
    });
  }

  const environments: EnvironmentMark[] = marks(ENVIRONMENT).map(match => {
    const begin = match[1] === 'begin';
    const name = match[2].trim();
    const argument = begin ? readBrackets(source, match.index! + match[0].length) : undefined;
    const headed = begin && HOMEWORK_HEADINGS.has(name);
    const second = headed && argument ? readBrackets(source, argument.next) : undefined;
    const word = headed ? readBrackets(source, second?.next ?? argument?.next ?? match.index! + match[0].length, '<', '>') : undefined;
    return {
      begin,
      name,
      start: match.index!,
      end: word?.next ?? second?.next ?? argument?.next ?? match.index! + match[0].length,
      argument: argument && { start: argument.start, end: argument.end },
      second: second && { start: second.start, end: second.end },
      word: word && { start: word.start, end: word.end }
    };
  });

  const items: ItemMark[] = marks(ITEM).map(match => {
    const end = match.index! + match[0].length;
    const label = readBrackets(source, end);
    return { start: match.index!, end: label?.next ?? end, label: label && { start: label.start, end: label.end } };
  });

  const commands = (pattern: RegExp) => marks(pattern).flatMap(match => {
    const argument = readBraces(source, match.index! + match[0].length);
    return argument
      ? [{ name: match[1], start: match.index!, end: argument.next, contentStart: argument.start, contentEnd: argument.end }]
      : [];
  });

  const shorthands: ShorthandMark[] = [];
  for (const match of marks(THEME_COMMAND)) {
    let next = match.index! + match[0].length;
    const option = match[1] === 'question' ? readBrackets(source, next) : undefined;
    if (option) next = option.next;
    const args: ShorthandMark['args'] = [];
    while (args.length < THEME_ARGUMENTS[match[1]]) {
      // Arguments may follow each other across one line break, as TeX allows.
      const argument = readBraces(source, next + (/^[ \t]*\n/.exec(source.slice(next, next + 80))?.[0].length ?? 0), true);
      if (!argument) break;
      args.push({ start: argument.start, end: argument.end });
      next = argument.next;
    }
    // In the theme's own definitions the arguments are macro parameters such as #1.
    if (args.length < THEME_ARGUMENTS[match[1]] || /#\d/.test(source.slice(match.index!, next))) continue;
    shorthands.push({ command: match[1], start: match.index!, end: next, option: option && { start: option.start, end: option.end }, args });
  }

  return { headings, environments, items, labels: commands(LABEL), formats: commands(FORMAT), shorthands };
}

/** What a root's compile recorded, as far as the structure is concerned. */
export interface StructureNumbers {
  labels?: ReadonlyMap<string, LabelInfo>;
  contents?: readonly ContentsEntry[];
  theorems?: readonly TheoremEntry[];
}

const NUMBERED_HEADINGS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection']);
const HEADING_STYLES: Record<string, RangeStyle> = {
  part: 'chapter', chapter: 'chapter', section: 'section', subsection: 'subsection', subsubsection: 'bold', paragraph: 'bold', subparagraph: 'bold'
};
const HEADING_SIZES: Record<string, number | undefined> = { part: 1.3, chapter: 1.3, section: 1.2, subsection: 1.1 };
const LISTS = new Set(['itemize', 'enumerate', 'description']);
const HOMEWORK_ENVIRONMENTS = new Set([...HOMEWORK_HEADINGS, 'solution']);
/** LaTeX's itemize labels, by depth. */
const BULLETS = ['•', '–', '∗', '·'];
const FORMAT_STYLES: Record<string, RangeStyle | undefined> = {
  textbf: 'bold', textit: 'italic', emph: 'italic', textsl: 'italic', underline: 'underline', textsc: 'smallCaps'
};

/**
 * Headings with their numbers, theorem heads, proofs and lists as they print, labels and the lines
 * that only open or close an environment dimmed, and text formatting without its commands. With
 * homework.sty's settings, its problems, parts and solutions too.
 */
export function structureOverlays(
  structure: Structure,
  text: string,
  theorems: TheoremSettings,
  numbers: StructureNumbers = {},
  homework?: HomeworkSettings
): Overlay[] {
  const overlays: Overlay[] = [];
  const homeworkMark = homework && homeworkMarks(homework, text);
  const listed = listedNumbers(structure, text, theorems, numbers.theorems ?? []);
  const headingNumbers = numberHeadings(structure.headings, numbers.contents ?? []);
  structure.headings.forEach((heading, index) => {
    const number = headingNumbers[index];
    overlays.push(overlay(heading.start, heading.end, {
      hide: [[heading.start, heading.titleStart], [heading.titleEnd, heading.end]],
      insert: number ? [{ at: heading.start, text: `${number} `, bold: true, size: HEADING_SIZES[heading.level] }] : [],
      style: [{ start: heading.titleStart, end: heading.titleEnd, style: HEADING_STYLES[heading.level] }]
    }));
  });

  const lists: Array<{ kind: string; depth: number; count: number; template?: string }> = [];
  const lastCounts = new Map<number, number>();
  const marks = [
    ...structure.environments.map(environment => ({ at: environment.start, environment })),
    ...structure.items.map(item => ({ at: item.start, item }))
  ].sort((a, b) => a.at - b.at);
  for (const mark of marks) {
    if ('item' in mark) {
      const list = lists[lists.length - 1];
      if (list) overlays.push(itemOverlay(mark.item, list));
      continue;
    }
    const environment = mark.environment;
    if (homeworkMark && HOMEWORK_ENVIRONMENTS.has(environment.name)) {
      overlays.push(homeworkMark(environment));
    } else if (LISTS.has(environment.name)) {
      if (environment.begin) {
        const options = keyValues(environment.argument ? text.slice(environment.argument.start, environment.argument.end) : '');
        const depth = lists.filter(list => list.kind === environment.name).length + 1;
        const start = options.start !== undefined ? Number(options.start) || 1 : 'resume' in options ? (lastCounts.get(depth) ?? 0) + 1 : 1;
        lists.push({ kind: environment.name, depth, count: start - 1, template: options.label });
      } else {
        const index = lists.map(list => list.kind).lastIndexOf(environment.name);
        const [list] = index === -1 ? [] : lists.splice(index);
        if (list?.kind === 'enumerate') lastCounts.set(list.depth, list.count);
      }
      overlays.push(dimmed(environment.start, environment.end));
    } else if (environment.name === 'proof') {
      overlays.push(environment.begin ? proofHead(environment) : overlay(environment.start, environment.end, {
        hide: [[environment.start, environment.end]],
        insert: [{ at: environment.start, text: '□' }]
      }));
    } else {
      const kind = theorems.environments.get(environment.name);
      if (!kind) continue;
      overlays.push(environment.begin
        ? theoremHead(environment, kind, theoremNumber(environment, kind, structure, text, theorems, numbers.labels) ?? listed.get(environment.start))
        : dimmed(environment.start, environment.end));
    }
  }

  if (theorems.themeCommands) {
    for (const mark of structure.shorthands) overlays.push(...themeCommandOverlays(mark, text, numbers.labels, listed.get(mark.start)));
  }
  for (const label of structure.labels) overlays.push(dimmed(label.start, label.end));
  for (const format of structure.formats) {
    const style = FORMAT_STYLES[format.name];
    overlays.push(overlay(format.start, format.end, {
      hide: [[format.start, format.contentStart], [format.contentEnd, format.end]],
      style: style ? [{ start: format.contentStart, end: format.contentEnd, style }] : []
    }));
  }
  return overlays;
}

/** The theme's theorem commands: names and label prefixes as its theorems.tex defines them. */
const THEME_THEOREMS: Record<string, { name: string; prefix?: string; style: TheoremStyle }> = {
  defn: { name: 'Definition', prefix: 'defn', style: 'definition' },
  thm: { name: 'Theorem', prefix: 'thm', style: 'plain' },
  lem: { name: 'Lemma', prefix: 'lem', style: 'plain' },
  cor: { name: 'Corollary', prefix: 'cor', style: 'plain' },
  prop: { name: 'Proposition', prefix: 'prop', style: 'plain' },
  clm: { name: 'Claim', prefix: 'clm', style: 'plain' },
  fact: { name: 'Fact', prefix: 'fact', style: 'plain' },
  assumption: { name: 'Assumption', prefix: 'assump', style: 'plain' },
  axiom: { name: 'Axiom', prefix: 'axiom', style: 'plain' },
  // A lemma or corollary followed by its proof, without a label.
  lemp: { name: 'Lemma', style: 'plain' },
  corp: { name: 'Corollary', style: 'plain' }
};

/**
 * How the compile records the theme's commands: in its plain amsthm mode, thmtools lists them by
 * environment; in its styled mode, tcolorbox labels each with the prefix, \lemp and \corp as lem: and cor:.
 */
const LISTED_AS: Record<string, { type: string; prefix?: string }> = {
  defn: { type: 'definition', prefix: 'defn' }, thm: { type: 'theorem', prefix: 'thm' }, lem: { type: 'lemma', prefix: 'lem' },
  cor: { type: 'corollary', prefix: 'cor' }, prop: { type: 'proposition', prefix: 'prop' }, clm: { type: 'claim', prefix: 'clm' },
  fact: { type: 'fact', prefix: 'fact' }, assumption: { type: 'assumption', prefix: 'assump' }, axiom: { type: 'axiom', prefix: 'axiom' },
  lemp: { type: 'lemma', prefix: 'lem' }, corp: { type: 'corollary', prefix: 'cor' }, rmkb: { type: 'remark' }
};

/**
 * Theorem numbers from what the compile recorded of every theorem, unlabelled ones too, by where
 * each theorem starts. When the document has as many theorems of a kind as the compile recorded,
 * titled where those are, they correspond in order. Otherwise, as in one part of a larger document
 * or after an edit not yet compiled, a theorem takes a number only by its title.
 */
function listedNumbers(structure: Structure, text: string, theorems: TheoremSettings, entries: readonly TheoremEntry[]): Map<number, string> {
  const numbers = new Map<number, string>();
  if (!entries.length) return numbers;
  const listed = new Map<string, TheoremEntry[]>();
  for (const entry of entries) listed.set(entry.type, [...listed.get(entry.type) ?? [], entry]);
  const items: Array<{ start: number; type: string; title: string }> = [];
  for (const mark of structure.environments) {
    if (!mark.begin || !theorems.environments.get(mark.name)?.numbered) continue;
    items.push({ start: mark.start, type: mark.name, title: mark.argument ? text.slice(mark.argument.start, mark.argument.end) : '' });
  }
  for (const mark of theorems.themeCommands ? structure.shorthands : []) {
    const as = LISTED_AS[mark.command];
    if (!as) continue;
    // Recorded by its label prefix when the theme draws it as a tcolorbox, else as an environment.
    const type = as.prefix && listed.has(as.prefix) ? as.prefix : as.type;
    items.push({ start: mark.start, type, title: mark.command === 'rmkb' ? '' : text.slice(mark.args[0].start, mark.args[0].end) });
  }
  items.sort((a, b) => a.start - b.start);
  const aligned = new Set<string>();
  for (const [type, list] of listed) {
    const own = items.filter(item => item.type === type);
    if (own.length === list.length && own.every((item, at) => titleKey(item.title) === titleKey(list[at].title ?? ''))) aligned.add(type);
  }
  // Per kind: how many theorems came before, and the first entry a title may still match.
  const seen = new Map<string, number>();
  const next = new Map<string, number>();
  for (const item of items) {
    const list = listed.get(item.type) ?? [];
    const position = seen.get(item.type) ?? 0;
    seen.set(item.type, position + 1);
    const key = titleKey(item.title);
    const from = next.get(item.type) ?? 0;
    const index = aligned.has(item.type)
      ? position
      : key ? list.findIndex((entry, at) => at >= from && titleKey(entry.title ?? '') === key) : -1;
    if (index === -1) continue;
    next.set(item.type, index + 1);
    if (list[index].number) numbers.set(item.start, list[index].number);
  }
  return numbers;
}

/**
 * The theme's commands drawn as the environments they stand for: \thm{title}{label}{body} as
 * "Theorem 2.1 (Title).", numbered by the label the theme writes, prefix:label, or else by what the
 * compile recorded of every theorem; \pf{...} as a proof; \ex, \rmkb and \question with their heads,
 * and \rmk in italics.
 */
function themeCommandOverlays(
  mark: ShorthandMark,
  text: string,
  labels: ReadonlyMap<string, LabelInfo> | undefined,
  listed: string | undefined
): Overlay[] {
  const { args } = mark;
  const last = args[args.length - 1];
  // Heads end in a space, as the text after them may follow on the same line.
  const bold = (at: number, label: string): Insertion => ({ at, text: `${label}\u00a0`, bold: true });
  const closing = dimmed(last.end, mark.end);
  switch (mark.command) {
    case 'pf':
      return [headOnly(mark.start, last.start, bold(mark.start, 'Proof.')), qed(last.end, mark.end)];
    case 'ex':
      return [headOnly(mark.start, last.start, bold(mark.start, 'Example.')), closing];
    case 'rmkb':
      return [headOnly(mark.start, last.start, { at: mark.start, text: `Remark${listed ? `\u00a0${listed}` : ''}.\u00a0`, italic: true }), closing];
    case 'rmk':
      return [overlay(mark.start, mark.end, {
        hide: [[mark.start, last.start], [last.end, mark.end]],
        style: [{ start: last.start, end: last.end, style: 'italic' }]
      })];
    case 'question':
      return [mark.option
        ? overlay(mark.start, last.start, {
          hide: [[mark.start, mark.option.start], [mark.option.end, last.start]],
          insert: [bold(mark.option.end, '.')],
          style: [{ start: mark.option.start, end: mark.option.end, style: 'bold' }]
        })
        : headOnly(mark.start, last.start, bold(mark.start, 'Question.')), closing];
  }
  const kind = THEME_THEOREMS[mark.command];
  const [title, second, third] = args;
  const titled = text.slice(title.start, title.end).trim() !== '';
  const label = kind.prefix ? text.slice(second.start, second.end).trim() : '';
  const key = label && (label.startsWith(`${kind.prefix}:`) ? label : `${kind.prefix}:${label}`);
  const number = (key ? labels?.get(key)?.number : undefined) ?? listed;
  const head: Insertion = {
    at: mark.start,
    text: `${kind.name}${number ? `\u00a0${number}` : ''}${titled ? '' : '.\u00a0'}`,
    ...kind.style === 'remark' ? { italic: true } : { bold: true }
  };
  // Up to the body: the title stays source between "(" and ")."; a label is dimmed as \label is.
  const headEnd = kind.prefix ? third.start : second.start;
  const hide: Array<[number, number]> = titled ? [[mark.start, title.start], [title.end, second.start]] : [[mark.start, second.start]];
  if (kind.prefix) hide.push([second.end, third.start]);
  const overlays = [overlay(mark.start, headEnd, {
    hide,
    insert: titled ? [head, { at: title.start, text: '\u00a0(' }, { at: title.end, text: ').\u00a0' }] : [head],
    style: label ? [{ start: second.start, end: second.end, style: 'dim' }] : []
  })];
  if (kind.prefix) return [...overlays, closing];
  // \lemp and \corp: the statement, then its proof.
  return [...overlays, headOnly(second.end, third.start, bold(second.end, 'Proof.')), qed(third.end, mark.end)];
}

function headOnly(start: number, end: number, head: Insertion): Overlay {
  return overlay(start, end, { hide: [[start, end]], insert: [head] });
}

/** The end of a proof, drawn as amsthm's box. */
function qed(start: number, end: number): Overlay {
  return overlay(start, end, { hide: [[start, end]], insert: [{ at: start, text: '\u25a1' }] });
}

function dimmed(start: number, end: number): Overlay {
  return overlay(start, end, { style: [{ start, end, style: 'dim' }] });
}

/** "Lemma 3 (Note).", with the note left as source so its formulas and references render. */
function theoremHead(environment: EnvironmentMark, kind: TheoremKind, number: string | undefined): Overlay {
  const head: Insertion = {
    at: environment.start,
    text: `${kind.name}${number ? ` ${number}` : ''}${environment.argument ? '' : '.'}`,
    ...kind.style === 'remark' ? { italic: true } : { bold: true }
  };
  const { argument } = environment;
  if (!argument) return overlay(environment.start, environment.end, { hide: [[environment.start, environment.end]], insert: [head] });
  return overlay(environment.start, environment.end, {
    hide: [[environment.start, argument.start], [argument.end, environment.end]],
    insert: [head, { at: argument.start, text: ' (' }, { at: argument.end, text: ').' }]
  });
}

/** "Proof.", or the proof's own heading, such as "Proof of Lemma 3.", in italics. */
function proofHead(environment: EnvironmentMark): Overlay {
  const { argument } = environment;
  if (!argument) {
    return overlay(environment.start, environment.end, {
      hide: [[environment.start, environment.end]],
      insert: [{ at: environment.start, text: 'Proof.', italic: true }]
    });
  }
  return overlay(environment.start, environment.end, {
    hide: [[environment.start, argument.start], [argument.end, environment.end]],
    insert: [{ at: argument.end, text: '.', italic: true }],
    style: [{ start: argument.start, end: argument.end, style: 'italic' }]
  });
}

/**
 * Draws homework.sty's environments in document order, numbering problems and parts as the package
 * does: a part's counter restarts with each problem, and an explicit [number][name] sets the
 * counter, a dotted one also the prefix, for good on a problem and until the next problem on a part.
 */
function homeworkMarks(settings: HomeworkSettings, text: string): (mark: EnvironmentMark) => Overlay {
  let problemPrefix = settings.problemPrefix ? `${settings.problemPrefix}.` : '';
  let problem = 0;
  let part = 0;
  let partPrefix: string | undefined;
  const nested = settings.sectionMode === 'nested';
  const problemNumber = () => `${problemPrefix}${counterText(settings.problemStyle, problem)}`;
  return mark => {
    if (!mark.begin) return dimmed(mark.start, mark.end);
    if (mark.name === 'solution') return solutionTitle(mark);
    const [number, name] = mark.second ? [mark.argument, mark.second] : [undefined, mark.argument];
    const value = number && text.slice(number.start, number.end).trim();
    const parts = value && /^-?\d+(\.\d+)*$/.test(value) ? value.split('.') : undefined;
    const explicit = parts && Number(parts.pop());
    const prefix = parts?.length ? `${parts.join('.')}.` : undefined;
    const problemHead = mark.name === 'homeworkProblem';
    const word = plainText(mark.word ? text.slice(mark.word.start, mark.word.end) : problemHead ? settings.problemWord : settings.sectionWord);
    const lead = word ? `${word}\u00a0` : '';
    if (problemHead) {
      problem = explicit ?? problem + 1;
      if (prefix !== undefined) problemPrefix = prefix;
      part = 0;
      partPrefix = undefined;
      // Problem~1\ --- Name
      return homeworkHeading(mark, name, text, `${lead}${problemNumber()}`, ' \u2014\u00a0', 'section', 1.2);
    }
    part = explicit ?? part + 1;
    if (prefix !== undefined) partPrefix = prefix;
    const label = `${partPrefix ?? (nested ? `${problemNumber()}.` : '')}${counterText(settings.sectionStyle, part)}`;
    // (a)\ Name, or 1.1\ Name when parts are numbered within their problem.
    return homeworkHeading(mark, name, text, `${lead}${nested ? label : `(${label})`}`, '\u00a0', 'subsection', 1.1);
  };
}

/** A problem's or part's heading: its word and number, then its name, left as source so its formulas render. */
function homeworkHeading(
  mark: EnvironmentMark,
  name: { start: number; end: number } | undefined,
  text: string,
  head: string,
  joiner: string,
  style: RangeStyle,
  size: number
): Overlay {
  if (!name || !text.slice(name.start, name.end).trim()) {
    return overlay(mark.start, mark.end, { hide: [[mark.start, mark.end]], insert: [{ at: mark.start, text: head, bold: true, size }] });
  }
  return overlay(mark.start, mark.end, {
    hide: [[mark.start, name.start], [name.end, mark.end]],
    insert: [{ at: mark.start, text: `${head}${joiner}`, bold: true, size }],
    style: [{ start: name.start, end: name.end, style }]
  });
}

/** A solution's title, as its box shows it: Solution, or the title it is given. */
function solutionTitle(mark: EnvironmentMark): Overlay {
  const { argument } = mark;
  if (!argument) return headOnly(mark.start, mark.end, { at: mark.start, text: 'Solution', bold: true });
  return overlay(mark.start, mark.end, {
    hide: [[mark.start, argument.start], [argument.end, mark.end]],
    style: [{ start: argument.start, end: argument.end, style: 'bold' }]
  });
}

/** Each solution from its \begin to its \end, which the preview draws in a box as homework.sty does. */
export function solutionBoxes(structure: Structure): Array<{ start: number; end: number }> {
  const boxes: Array<{ start: number; end: number }> = [];
  const open: number[] = [];
  for (const mark of structure.environments) {
    if (mark.name !== 'solution') continue;
    if (mark.begin) open.push(mark.start);
    else if (open.length) boxes.push({ start: open.pop()!, end: mark.end });
  }
  return boxes.sort((a, b) => a.start - b.start);
}

/**
 * The number of the label inside a theorem that belongs to it: the aux file has to record it with a
 * theorem counter, so an equation or item labelled inside does not number the theorem. Any theorem
 * counter will do, since which ones share is up to declarations the compile may have chosen between.
 */
function theoremNumber(
  begin: EnvironmentMark,
  kind: TheoremKind,
  structure: Structure,
  text: string,
  theorems: TheoremSettings,
  labels: ReadonlyMap<string, LabelInfo> | undefined
): string | undefined {
  if (!kind.numbered || !labels) return undefined;
  const end = structure.environments.find(mark => !mark.begin && mark.name === begin.name && mark.start > begin.end);
  for (const label of structure.labels) {
    if (label.start < begin.end) continue;
    if (end && label.start > end.start) break;
    const info = labels.get(text.slice(label.contentStart, label.contentEnd).trim());
    if (info?.type && (info.type === begin.name || info.type === kind.counter || theorems.environments.has(info.type))) return info.number;
  }
  return undefined;
}

function itemOverlay(item: ItemMark, list: { kind: string; depth: number; count: number; template?: string }): Overlay {
  if (item.label) {
    // An item's own label is source the preview keeps; description lists set it in bold.
    return overlay(item.start, item.end, {
      hide: [[item.start, item.label.start], [item.label.end, item.end]],
      style: list.kind === 'description' ? [{ start: item.label.start, end: item.label.end, style: 'bold' }] : []
    });
  }
  if (list.kind === 'description') return overlay(item.start, item.end, { hide: [[item.start, item.end]] });
  const label = list.kind === 'itemize'
    ? BULLETS[(list.depth - 1) % BULLETS.length]
    : enumerateLabel(list.template, list.depth, ++list.count);
  return overlay(item.start, item.end, { hide: [[item.start, item.end]], insert: [{ at: item.start, text: label }] });
}

/** An enumerate label: from enumitem's label template, or LaTeX's 1. (a) i. A. by depth. */
export function enumerateLabel(template: string | undefined, depth: number, count: number): string {
  if (template) {
    const filled = template.replace(/\\(arabic|alph|Alph|roman|Roman)\*/g, (_, style: string) => counterText(style, count));
    return plainText(filled);
  }
  return [`${count}.`, `(${counterText('alph', count)})`, `${counterText('roman', count)}.`, `${counterText('Alph', count)}.`][(depth - 1) % 4];
}

function counterText(style: string, count: number): string {
  switch (style) {
    case 'alph': return letters(count);
    case 'Alph': return letters(count).toUpperCase();
    case 'roman': return roman(count);
    case 'Roman': return roman(count).toUpperCase();
    default: return String(count);
  }
}

function letters(count: number): string {
  let text = '';
  for (let n = count; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(97 + ((n - 1) % 26)) + text;
  return text;
}

function roman(count: number): string {
  const numerals: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let text = '';
  let rest = count;
  for (const [value, numeral] of numerals) for (; rest >= value; rest -= value) text += numeral;
  return text;
}

/**
 * The numbers of the headings, from the table of contents: each takes the next entry along with its
 * level and title. A title the aux file wrote differently, say with a macro expanded, takes the
 * entry after the last heading matched.
 */
export function numberHeadings(headings: readonly HeadingMark[], contents: readonly ContentsEntry[]): Array<string | undefined> {
  const key = (level: string, title: string) => `${level}\u0000${titleKey(title)}`;
  const entries = new Map<string, number[]>();
  contents.forEach((entry, index) => {
    const entryKey = key(entry.level, entry.title);
    entries.set(entryKey, [...entries.get(entryKey) ?? [], index]);
  });
  let previous = -1;
  return headings.map(heading => {
    if (heading.starred || !NUMBERED_HEADINGS.has(heading.level)) return undefined;
    let index = entries.get(key(heading.level, heading.tocTitle))?.find(candidate => candidate > previous) ?? -1;
    if (index === -1 && contents[previous + 1]?.level === heading.level) index = previous + 1;
    if (index === -1) return undefined;
    previous = index;
    return contents[index].number;
  });
}

/** A title reduced to its letters and digits, with \texorpdfstring{TeX}{PDF} read as its TeX. */
function titleKey(title: string): string {
  let tex = title;
  for (let at = tex.search(/\\texorpdfstring\s*\{/); at !== -1; at = tex.search(/\\texorpdfstring\s*\{/)) {
    const first = readBraces(tex, at + '\\texorpdfstring'.length, true);
    const second = first && readBraces(tex, first.next, true);
    if (!first || !second) break;
    tex = tex.slice(0, at) + tex.slice(first.start, first.end) + tex.slice(second.next);
  }
  return tex.replace(/\\[A-Za-z@]+\s*/g, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

/** A braced argument starting at `index` after spaces, on the same line unless `anyLine`. */
function readBraces(source: string, index: number, anyLine = false): { start: number; end: number; next: number } | undefined {
  let at = index;
  while (source[at] === ' ' || source[at] === '\t') at++;
  if (source[at] !== '{') return undefined;
  const close = findMatchingBrace(source, at);
  if (close === -1 || (!anyLine && source.slice(at, close).includes('\n'))) return undefined;
  return { start: at + 1, end: close, next: close + 1 };
}

/** A bracketed optional argument starting at `index` after spaces, on the same line; xparse's <...> with other delimiters. */
function readBrackets(source: string, index: number, open = '[', close = ']'): { start: number; end: number; next: number } | undefined {
  let at = index;
  while (source[at] === ' ' || source[at] === '\t') at++;
  if (source[at] !== open) return undefined;
  let depth = 0;
  for (let i = at + 1; i < source.length && source[i] !== '\n'; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    else if (source[i] === close && depth === 0) return { start: at + 1, end: i, next: i + 1 };
  }
  return undefined;
}

/** key=value options, split at the commas outside braces, with braces around a value dropped. */
function keyValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    else if ((text[i] === ',' && depth === 0) || i === text.length) {
      const [key, ...value] = text.slice(start, i).split('=');
      if (key.trim()) values[key.trim()] = value.join('=').trim().replace(/^\{([\s\S]*)\}$/, '$1');
      start = i + 1;
    }
  }
  return values;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
