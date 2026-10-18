import * as path from 'node:path';
import { findMatchingBrace, isEscaped } from '../snippets/engine/latexContext';
import { previewSource, type MathRegions } from './mathRegions';

/** What the last compile recorded about a label. */
export interface LabelInfo {
  /** What \ref prints, such as "3" or "A.1". */
  number: string;
  page?: string;
  /** The heading hyperref records with the label, which \nameref prints. */
  title?: string;
  /** The counter the label numbers, such as equation, section or theorem. */
  type?: string;
}

export interface AuxFile {
  labels: Map<string, LabelInfo>;
  /** Aux files of \include'd parts, as the aux file names them. */
  inputs: string[];
}

/** Reads the labels a LaTeX run wrote, in hyperref's five-part form or LaTeX's own two-part one. */
export function parseAux(text: string): AuxFile {
  const labels = new Map<string, LabelInfo>();
  const crefTypes = new Map<string, string>();
  const inputs: string[] = [];
  const pattern = /\\(newlabel|@input)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = readGroup(text, match.index + match[0].length - 1);
    if (!name) continue;
    pattern.lastIndex = name.next;
    if (match[1] === '@input') {
      inputs.push(name.value.trim());
      continue;
    }
    const value = readGroup(text, name.next);
    if (!value) continue;
    pattern.lastIndex = value.next;
    const fields = readGroups(value.value);
    const crefKey = /^(.*)@cref$/.exec(name.value)?.[1];
    if (crefKey !== undefined) {
      // cleveref's copy of the label starts with the counter: {[type][value][prefix]number}{...}.
      const type = /^\[([^\]]*)\]/.exec(fields[0] ?? '')?.[1];
      if (type) crefTypes.set(crefKey, type);
      continue;
    }
    const [number = '', page, title, anchor] = fields;
    labels.set(name.value, {
      number: plainText(number),
      page: page === undefined ? undefined : plainText(page),
      title: title ? plainText(title) : undefined,
      type: anchorType(anchor)
    });
  }
  for (const [key, type] of crefTypes) {
    const label = labels.get(key);
    if (label) label.type = type;
  }
  return { labels, inputs };
}

function readGroup(text: string, index: number): { value: string; next: number } | undefined {
  while (index < text.length && /\s/.test(text[index])) index++;
  if (text[index] !== '{') return undefined;
  const close = findMatchingBrace(text, index);
  return close === -1 ? undefined : { value: text.slice(index + 1, close), next: close + 1 };
}

function readGroups(text: string): string[] {
  const groups: string[] = [];
  for (let group = readGroup(text, 0); group; group = readGroup(text, group.next)) groups.push(group.value);
  return groups;
}

/** The counter in a hyperref anchor such as equation.3 or subsection.A.1. */
function anchorType(anchor: string | undefined): string | undefined {
  const name = anchor?.split('.')[0];
  if (!name) return undefined;
  // amsmath's \tag gives its equations AMS anchors, and enumerate items are Item ones.
  return ({ AMS: 'equation', Item: 'enumi' } as Record<string, string>)[name] ?? name;
}

/** TeX as plain text, for the numbers and titles an aux file records. */
function plainText(tex: string): string {
  return tex
    .replace(/\\['`^"~=.](?:\{([A-Za-z])\}|([A-Za-z]))/g, '$1$2')
    .replace(/\\(?:protect|relax|ignorespaces|leavevmode|unskip)(?![A-Za-z])\s*/g, '')
    .replace(/\\nobreakspace\s*(?:\{\})?|~/g, '\u00a0')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\[A-Za-z@]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a document says about its root: one it names, or that it is one. */
export interface RootHint {
  /** A root named by a `%!TEX root` comment or the subfiles class, relative to the document's folder. */
  root?: string;
  isRoot: boolean;
}

export function rootHint(text: string, source = previewSource(text)): RootHint {
  const magic = /^\s*%\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$/im.exec(text)?.[1];
  if (magic) return { root: magic, isRoot: false };
  const subfiles = /\\documentclass\s*\[([^\]]*)\]\s*\{\s*subfiles\s*\}/.exec(source)?.[1].trim();
  if (subfiles) return { root: subfiles, isRoot: false };
  return { isRoot: /\\documentclass/.test(source) && /\\begin\s*\{\s*document\s*\}/.test(source) };
}

/**
 * Where LaTeX Workshop writes a root's output, from its latex.outDir setting: placeholders expanded,
 * relative paths taken from the root's folder. Undefined for folders it picks at build time.
 */
export function expandOutDir(setting: string, places: { rootDir: string; workspaceFolder?: string }): string | undefined {
  let dir = (setting.trim() || '%DIR%').replace(/%DIR(?:_W32)?%/g, places.rootDir);
  if (dir.includes('%WORKSPACE_FOLDER%')) {
    if (!places.workspaceFolder) return undefined;
    dir = dir.replace(/%WORKSPACE_FOLDER%/g, places.workspaceFolder);
  }
  if (/%[A-Z0-9_]+%/.test(dir)) return undefined;
  return path.resolve(places.rootDir, dir);
}

export type ReferenceCommand = 'ref' | 'eqref' | 'cref' | 'Cref' | 'labelcref' | 'autoref' | 'pageref' | 'nameref';

export interface ReferenceRegion {
  /** Offset of the command, or of the tie before it. */
  start: number;
  end: number;
  command: ReferenceCommand;
  keys: string[];
  /** Whether a `~` before the command belongs to the region; it shows as the space it prints. */
  tie: boolean;
}

const REFERENCE = /\\(ref|eqref|cref|Cref|labelcref|autoref|pageref|nameref)\*?\s*\{([^{}\n]*)\}/g;
const MULTI_KEY = new Set<ReferenceCommand>(['cref', 'Cref', 'labelcref']);

function splitKeys(command: ReferenceCommand, keys: string): string[] {
  return (MULTI_KEY.has(command) ? keys.split(',') : [keys]).map(key => key.trim()).filter(Boolean);
}

/** References in the text outside formulas; those inside a formula are typeset with it. */
export function findReferences(text: string, math: MathRegions, languageId?: string, source = previewSource(text, languageId)): ReferenceRegion[] {
  const formulas = [...math.inline, ...math.display].sort((a, b) => a.start - b.start);
  const regions: ReferenceRegion[] = [];
  let formula = 0;
  for (const match of source.matchAll(REFERENCE)) {
    const start = match.index!;
    if (isEscaped(source, start)) continue;
    while (formula < formulas.length && formulas[formula].end <= start) formula++;
    if (formula < formulas.length && formulas[formula].start <= start) continue;
    const command = match[1] as ReferenceCommand;
    const keys = splitKeys(command, match[2]);
    if (!keys.length) continue;
    const tie = source[start - 1] === '~' && !isEscaped(source, start - 1);
    regions.push({ start: tie ? start - 1 : start, end: start + match[0].length, command, keys, tie });
  }
  return regions;
}

/** How cleveref names counters, from its package options and the project's \crefname and \Crefname. */
export interface CrefSettings {
  capitalise: boolean;
  noabbrev: boolean;
  /** Singular and plural names by counter. */
  names: Record<string, [string, string]>;
  /** The names a reference starting a sentence uses. */
  capitalNames: Record<string, [string, string]>;
}

export function emptyCrefSettings(): CrefSettings {
  return { capitalise: false, noabbrev: false, names: {}, capitalNames: {} };
}

/** Adds what a file sets for cleveref to `settings`. */
export function readCrefSettings(text: string, settings: CrefSettings): void {
  const source = previewSource(text);
  for (const match of source.matchAll(/\\usepackage\s*\[([^\]]*)\]\s*\{([^}]*)\}/g)) {
    if (!match[2].split(',').some(name => name.trim() === 'cleveref')) continue;
    const options = match[1].split(',').map(option => option.trim());
    settings.capitalise ||= options.includes('capitalise') || options.includes('capitalize');
    settings.noabbrev ||= options.includes('noabbrev');
  }
  for (const match of source.matchAll(/\\(crefname|Crefname)\s*\{([^{}]*)\}\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g)) {
    const names = match[1] === 'crefname' ? settings.names : settings.capitalNames;
    names[match[2].trim()] = [plainText(match[3]), plainText(match[4])];
  }
}

/** cleveref's English names by counter, with the abbreviations \cref uses for the long ones. */
const CREF_NAMES: Record<string, { name: [string, string]; short?: [string, string] }> = {
  equation: { name: ['equation', 'equations'], short: ['eq.', 'eqs.'] },
  figure: { name: ['figure', 'figures'], short: ['fig.', 'figs.'] },
  table: { name: ['table', 'tables'] },
  page: { name: ['page', 'pages'] },
  part: { name: ['part', 'parts'] },
  chapter: { name: ['chapter', 'chapters'] },
  section: { name: ['section', 'sections'] },
  appendix: { name: ['appendix', 'appendices'] },
  enumi: { name: ['item', 'items'] },
  footnote: { name: ['footnote', 'footnotes'] },
  theorem: { name: ['theorem', 'theorems'] },
  lemma: { name: ['lemma', 'lemmas'] },
  corollary: { name: ['corollary', 'corollaries'] },
  proposition: { name: ['proposition', 'propositions'] },
  definition: { name: ['definition', 'definitions'] },
  result: { name: ['result', 'results'] },
  example: { name: ['example', 'examples'] },
  remark: { name: ['remark', 'remarks'] },
  note: { name: ['note', 'notes'] },
  algorithm: { name: ['algorithm', 'algorithms'] },
  listing: { name: ['listing', 'listings'] },
  line: { name: ['line', 'lines'] }
};
/** Counters cleveref names after another one. */
const CREF_ALIASES: Record<string, string> = {
  subsection: 'section', subsubsection: 'section', subappendix: 'appendix', subsubappendix: 'appendix',
  enumii: 'enumi', enumiii: 'enumi', enumiv: 'enumi'
};
const MISSING = '??';

export interface FormattedReference {
  text: string;
  /** The labels it names, in order; undefined for one the last compile did not record. */
  labels: Array<LabelInfo | undefined>;
}

/** What a reference prints, given the labels of the last compile. */
export function formatReference(
  reference: Pick<ReferenceRegion, 'command' | 'keys'>,
  labels: ReadonlyMap<string, LabelInfo>,
  cref: CrefSettings = emptyCrefSettings()
): FormattedReference {
  const found = reference.keys.map(key => labels.get(key));
  const label = found[0];
  switch (reference.command) {
    case 'ref': return { text: label?.number ?? MISSING, labels: found };
    case 'eqref': return { text: `(${label?.number ?? MISSING})`, labels: found };
    case 'pageref': return { text: label?.page ?? MISSING, labels: found };
    case 'nameref': return { text: label ? label.title || label.number : MISSING, labels: found };
    case 'autoref': {
      const counter = label?.type && (CREF_ALIASES[label.type] ?? label.type);
      const name = counter && capitalised(CREF_NAMES[counter]?.name[0] ?? counter);
      return { text: label ? [name, label.number].filter(Boolean).join('\u00a0') : MISSING, labels: found };
    }
    default: return { text: formatCref(reference.command, found, cref), labels: found };
  }
}

function formatCref(command: ReferenceCommand, found: Array<LabelInfo | undefined>, settings: CrefSettings): string {
  const parts = found.map(label => ({
    type: label?.type,
    text: !label ? MISSING : (CREF_ALIASES[label.type ?? ''] ?? label.type) === 'equation' ? `(${label.number})` : label.number
  }));
  if (command === 'labelcref') return joinList(parts.map(part => part.text));
  // Consecutive labels of one counter share its name in the plural, as in "eqs. (3) and (4)".
  const groups: Array<{ type?: string; texts: string[] }> = [];
  for (const part of parts) {
    const last = groups[groups.length - 1];
    if (last && part.type && last.type === part.type) last.texts.push(part.text);
    else groups.push({ type: part.type, texts: [part.text] });
  }
  return joinList(groups.map((group, index) => {
    const list = joinList(group.texts);
    if (!group.type) return list;
    return `${crefName(group.type, group.texts.length > 1, command === 'Cref' && index === 0, settings)}\u00a0${list}`;
  }));
}

function crefName(type: string, plural: boolean, sentenceStart: boolean, settings: CrefSettings): string {
  const counter = CREF_ALIASES[type] ?? type;
  const index = plural ? 1 : 0;
  if (sentenceStart) {
    if (settings.capitalNames[counter]) return settings.capitalNames[counter][index];
    if (settings.names[counter]) return capitalised(settings.names[counter][index]);
  } else if (settings.names[counter]) {
    return settings.names[counter][index];
  }
  const capital = sentenceStart || settings.capitalise;
  const known = CREF_NAMES[counter];
  // A counter cleveref has no name for prints as ?? in LaTeX; its own name says more.
  if (!known) return capital ? capitalised(counter) : counter;
  // \Cref spells names out at the start of a sentence; \cref abbreviates the long ones unless told not to.
  const name = !sentenceStart && !settings.noabbrev && known.short ? known.short[index] : known.name[index];
  return capital ? capitalised(name) : name;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Text that is safe inside \text{...}. */
function escapeText(text: string): string {
  return text.replace(/[\\^]/g, '').replace(/([#$%&_{}])/g, '\\$1').replace(/~/g, '\u00a0');
}

/**
 * Replaces the references in a formula with what they print: MathJax would show "(???)" for every
 * label it has not seen defined in the same formula. In math the text needs \text around it, which
 * MathJax refuses inside text such as the argument of \text itself.
 */
export function substituteReferences(tex: string, print: (reference: Pick<ReferenceRegion, 'command' | 'keys'>) => string): string {
  return tex.replace(REFERENCE, (whole: string, command: ReferenceCommand, keys: string, offset: number) => {
    if (isEscaped(tex, offset)) return whole;
    const printed = escapeText(print({ command, keys: splitKeys(command, keys) }));
    return inTextMode(tex, offset) ? printed : `\\text{${printed}}`;
  });
}

/** Commands whose argument MathJax sets as text. */
const TEXT_ARGUMENT = new Set([
  'text', 'textrm', 'textnormal', 'textit', 'textbf', 'textsf', 'texttt', 'textup', 'textsl', 'textsc', 'emph',
  'mbox', 'hbox', 'fbox', 'intertext', 'shortintertext', 'tag'
]);

/** Whether `offset` in a formula falls in text, such as the argument of \text, rather than in math. */
function inTextMode(tex: string, offset: number): boolean {
  // One entry per brace group, and per $...$ that returns to math inside text.
  const modes: Array<{ text: boolean; dollar: boolean }> = [{ text: false, dollar: false }];
  let textArgument = false;
  for (let i = 0; i < offset; i++) {
    const char = tex[i];
    const mode = modes[modes.length - 1];
    if (char === '\\') {
      const name = /^[A-Za-z]+/.exec(tex.slice(i + 1, i + 32))?.[0];
      textArgument = !!name && TEXT_ARGUMENT.has(name);
      i += name ? name.length : 1;
    } else if (char === '{') {
      modes.push({ text: textArgument || mode.text, dollar: false });
      textArgument = false;
    } else if (char === '}') {
      while (modes.length > 1 && modes[modes.length - 1].dollar) modes.pop();
      if (modes.length > 1) modes.pop();
    } else if (char === '$') {
      if (mode.dollar) modes.pop();
      else if (mode.text) modes.push({ text: false, dollar: true });
    } else if (!/\s/.test(char)) {
      textArgument = false;
    }
  }
  return modes[modes.length - 1].text;
}

/** A number LaTeX sets beside a display formula. */
export interface EquationTag {
  /** TeX for MathJax to set the number with. */
  tex: string;
  /** Row of the formula the number sits on, from 0; undefined centres it on the formula. */
  row?: number;
}

const ONE_NUMBER = new Set(['equation', 'multline']);
const NUMBER_PER_ROW = new Set(['align', 'gather', 'flalign', 'alignat', 'eqnarray']);
/** Environments that lay one equation out over several rows, whose number LaTeX centres on them. */
const SPLIT_ROWS = /\\begin\s*\{\s*(?:split|aligned|alignedat|gathered|multlined)\s*\}/;

/**
 * The numbers of a display formula: an explicit \tag, or the compiled number of its \label. A
 * numbered equation without a label gets none, since the aux file does not record its number.
 */
export function equationTags(tex: string, labels: ReadonlyMap<string, LabelInfo> | undefined): EquationTag[] {
  const begin = /^\s*\\begin\s*\{([^}]*)\}/.exec(tex);
  const environment = begin?.[1].trim() ?? '';
  const base = environment.replace(/\*$/, '');
  const numbered = environment === base && (ONE_NUMBER.has(base) || NUMBER_PER_ROW.has(base));
  let body = begin ? tex.slice(begin[0].length, tex.lastIndexOf('\\end')) : tex;
  if (base === 'alignat') body = body.replace(/^\s*\{[^{}]*\}/, '');
  const rows = splitRows(body);
  if (NUMBER_PER_ROW.has(base)) {
    return rows.flatMap((row, index) => {
      const number = rowNumber(row, numbered, labels);
      return number === undefined ? [] : [{ tex: number, row: index }];
    });
  }
  const number = rowNumber(body, numbered, labels);
  if (number === undefined) return [];
  // multline numbers its last line; a one-row formula keeps its number on its baseline.
  const row = base === 'multline' ? rows.length - 1 : rows.length > 1 || SPLIT_ROWS.test(body) ? undefined : 0;
  return [{ tex: number, row }];
}

function rowNumber(row: string, numbered: boolean, labels: ReadonlyMap<string, LabelInfo> | undefined): string | undefined {
  const code = row.replace(/(^|[^\\])%.*$/gm, '$1');
  const tag = /\\tag(\*?)\s*\{/.exec(code);
  const close = tag ? findMatchingBrace(code, tag.index + tag[0].length - 1) : -1;
  if (tag && close !== -1) {
    const content = code.slice(tag.index + tag[0].length, close);
    return tag[1] ? `\\text{${content}}` : `\\text{(${content})}`;
  }
  if (!numbered || /\\(?:nonumber|notag)(?![A-Za-z])/.test(code)) return undefined;
  const key = /\\label\s*\{([^{}]*)\}/.exec(code)?.[1].trim();
  if (!key || !labels) return undefined;
  return `\\text{(${escapeText(labels.get(key)?.number ?? MISSING)})}`;
}

/** Splits a table body at its row breaks, skipping those in braces, nested environments and comments. */
function splitRows(body: string): string[] {
  const rows: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '%') {
      const newline = body.indexOf('\n', i);
      i = newline === -1 ? body.length : newline;
    } else if (char === '{') {
      const close = findMatchingBrace(body, i);
      if (close !== -1) i = close;
    } else if (char === '\\') {
      if (/^\\begin(?![A-Za-z])/.test(body.slice(i, i + 7))) depth++;
      else if (/^\\end(?![A-Za-z])/.test(body.slice(i, i + 5))) depth--;
      else if (body[i + 1] === '\\' && depth === 0) {
        rows.push(body.slice(start, i));
        start = i + 2;
      }
      i++;
    }
  }
  rows.push(body.slice(start));
  // A row break after the last row leaves an empty one, which MathJax drops as well.
  if (rows.length > 1 && !rows[rows.length - 1].replace(/(^|[^\\])%.*$/gm, '$1').trim()) rows.pop();
  return rows;
}
