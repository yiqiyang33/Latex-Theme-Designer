import { findMatchingBrace, isEscaped } from '../snippets/engine/latexContext';
import { previewSource, type MathRegions } from './mathRegions';
import { overlay, type Insertion, type Overlay, type RangeStyle } from './overlays';
import { plainText, type ContentsEntry, type LabelInfo } from './references';

export type TheoremStyle = 'plain' | 'definition' | 'remark';

/** A theorem-like environment as amsthm or thmtools declares it. */
export interface TheoremKind {
  name: string;
  style: TheoremStyle;
  /** The counter it numbers with: its own, or the one it shares. */
  counter: string;
  numbered: boolean;
}

export type TheoremSettings = Map<string, TheoremKind>;

/** Adds the theorem-like environments a file declares with \newtheorem or thmtools' \declaretheorem. */
export function readTheoremSettings(text: string, settings: TheoremSettings): void {
  const source = previewSource(text, 'latex');
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
      settings.set(environment, {
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
      settings.set(environment, {
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

export interface Structure {
  headings: HeadingMark[];
  environments: EnvironmentMark[];
  items: ItemMark[];
  labels: CommandMark[];
  formats: CommandMark[];
}

const HEADING = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)(?![A-Za-z])/g;
const ENVIRONMENT = /\\(begin|end)\s*\{([^{}\n]*)\}/g;
const ITEM = /\\item(?![A-Za-z])/g;
const LABEL = /\\(label)\s*(?=\{)/g;
const FORMAT = /\\(textbf|textit|emph|textsl|underline|texttt|textsc|textrm|textsf|textup|textnormal)\s*(?=\{)/g;

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
    const end = match.index! + match[0].length;
    const argument = begin ? readBrackets(source, end) : undefined;
    return {
      begin,
      name: match[2].trim(),
      start: match.index!,
      end: argument?.next ?? end,
      argument: argument && { start: argument.start, end: argument.end }
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

  return { headings, environments, items, labels: commands(LABEL), formats: commands(FORMAT) };
}

/** What a root's compile recorded, as far as the structure is concerned. */
export interface StructureNumbers {
  labels?: ReadonlyMap<string, LabelInfo>;
  contents?: readonly ContentsEntry[];
}

const NUMBERED_HEADINGS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection']);
const HEADING_STYLES: Record<string, RangeStyle> = {
  part: 'chapter', chapter: 'chapter', section: 'section', subsection: 'subsection', subsubsection: 'bold', paragraph: 'bold', subparagraph: 'bold'
};
const HEADING_SIZES: Record<string, number | undefined> = { part: 1.3, chapter: 1.3, section: 1.2, subsection: 1.1 };
const LISTS = new Set(['itemize', 'enumerate', 'description']);
/** LaTeX's itemize labels, by depth. */
const BULLETS = ['•', '–', '∗', '·'];
const FORMAT_STYLES: Record<string, RangeStyle | undefined> = {
  textbf: 'bold', textit: 'italic', emph: 'italic', textsl: 'italic', underline: 'underline', textsc: 'smallCaps'
};

/**
 * Headings with their numbers, theorem heads, proofs and lists as they print, labels and the lines
 * that only open or close an environment dimmed, and text formatting without its commands.
 */
export function structureOverlays(structure: Structure, text: string, theorems: TheoremSettings, numbers: StructureNumbers = {}): Overlay[] {
  const overlays: Overlay[] = [];
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
    if (LISTS.has(environment.name)) {
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
      const kind = theorems.get(environment.name);
      if (!kind) continue;
      overlays.push(environment.begin
        ? theoremHead(environment, kind, theoremNumber(environment, kind, structure, text, theorems, numbers.labels))
        : dimmed(environment.start, environment.end));
    }
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
    if (info?.type && (info.type === begin.name || info.type === kind.counter || theorems.has(info.type))) return info.number;
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

/** A bracketed optional argument starting at `index` after spaces, on the same line. */
function readBrackets(source: string, index: number): { start: number; end: number; next: number } | undefined {
  let at = index;
  while (source[at] === ' ' || source[at] === '\t') at++;
  if (source[at] !== '[') return undefined;
  let depth = 0;
  for (let i = at + 1; i < source.length && source[i] !== '\n'; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    else if (source[i] === ']' && depth === 0) return { start: at + 1, end: i, next: i + 1 };
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
