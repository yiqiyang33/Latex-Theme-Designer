import { isEscaped, sanitizeLatexForParsing } from './latexContext';
import type { TextEdit } from './latexEdit';

/**
 * TeX stops with "Double superscript" when a second superscript is attached to an atom that
 * already has one, as in a^{*}^{\top}. Given the offset of a `^` just added, this finds the atom
 * before it, scripts included, and returns the edits that brace it: {a^{*}}^{\top}, where the new
 * superscript applies to the whole of a^{*}.
 *
 * Returns undefined, leaving the text alone, when the atom has no superscript yet; when a prime
 * comes right before the new `^`, since TeX takes that `^` into the prime's superscript (x'^2 is
 * fine); and when the atom cannot be read with certainty, such as a `)` whose `(` is not in the
 * formula.
 *
 * `mathStart` is where the formula's content begins. The atom is never looked for before it.
 */
export function planSuperscriptWrap(text: string, superscriptOffset: number, mathStart: number): TextEdit[] | undefined {
  if (mathStart < 0 || mathStart > superscriptOffset) return undefined;
  // Comments become spaces, so a commented line inside a display formula reads as white space.
  const source = sanitizeLatexForParsing(text.slice(mathStart, superscriptOffset), [], false);
  // The closing brace goes before any white space, so `a^{*} ^` becomes `{a^{*}} ^`.
  const end = skipSpaces(source, source.length);
  const atom = atomBefore(source, end);
  if (!atom?.superscripted) return undefined;
  if (atom.primeLast && end == source.length) return undefined;
  return [
    { start: mathStart + atom.start, end: mathStart + atom.start, text: '{' },
    // TeX dissolves a group that holds nothing but an accent into the accent itself, scripts
    // and all, so {\hat{x}^{*}}^{\top} is still a double superscript. A second atom in the
    // group, even an empty one, keeps it whole.
    { start: mathStart + end, end: mathStart + end, text: atom.accent ? '{}}' : '}' },
  ];
}

interface Token {
  start: number;
  end: number;
  /**
   * `symbol` is a control symbol such as \{ or \|, `word` a control word such as \alpha, `group`
   * a whole {...}, and `command` a control word together with the arguments written after it.
   */
  kind: 'char' | 'symbol' | 'word' | 'group' | 'command';
  /** The character, or the control sequence's name without its backslash. */
  name: string;
}

interface Atom {
  start: number;
  /** Whether any of its scripts is a superscript; a prime is one. */
  superscripted: boolean;
  /** Whether its last script is a prime. */
  primeLast: boolean;
  /** Whether TeX makes it an accent, which a group around it does not stay around. */
  accent: boolean;
}

// Closing delimiters and the opening ones they pair with.
const OPENER_OF: Record<string, string> = {
  ')': '(',
  ']': '[',
  '\\}': '\\{',
  '\\rbrace': '\\lbrace',
  '\\rbrack': '\\lbrack',
  '\\rangle': '\\langle',
  '\\rvert': '\\lvert',
  '\\rVert': '\\lVert',
  '\\rfloor': '\\lfloor',
  '\\rceil': '\\lceil',
};
// Delimiters that open and close alike, as in |x| and \|x\|.
const SYMMETRIC = new Set(['|', '\\|', '\\vert', '\\Vert']);
const SIZE = /^[Bb]igg?[lrm]?$/;
// Control words that are part of the formula's layout rather than an atom a script could follow.
const STRUCTURE = new Set(['left', 'right', 'middle', 'begin', 'end', 'label', 'tag', 'nonumber', 'notag', 'hline']);
const ACCENTS = new Set([
  'hat', 'widehat', 'check', 'widecheck', 'tilde', 'widetilde', 'acute', 'grave',
  'dot', 'ddot', 'breve', 'bar', 'vec', 'mathring',
]);
// Font and bold commands: they set their argument in a group, so an accent inside stays one.
const FONTS = new Set([
  'mathbf', 'mathrm', 'mathit', 'mathsf', 'mathtt', 'mathnormal', 'mathcal', 'mathscr',
  'mathfrak', 'mathbb', 'boldsymbol', 'bm',
]);
// Commands whose one argument may be written without braces, as in \hat x or \boldsymbol\mu.
const ONE_ARGUMENT = new Set([...ACCENTS, ...FONTS, 'overline', 'underline']);

/** The atom ending at `end`, read back through its scripts to its nucleus. */
function atomBefore(source: string, end: number): Atom | undefined {
  let at = end;
  let superscripted = false;
  let primeLast = false;
  for (;;) {
    if (source[at - 1] == "'") {
      primeLast ||= at == end;
      while (source[at - 1] == "'") at--;
      superscripted = true;
      at = skipSpaces(source, at);
      continue;
    }
    const unit = unitBefore(source, at);
    if (!unit || (unit.kind == 'char' && (unit.name == '^' || unit.name == '_'))) return undefined;
    const markerEnd = skipSpaces(source, unit.start);
    const marker = source[markerEnd - 1];
    if ((marker == '^' || marker == '_') && !isEscaped(source, markerEnd - 1)) {
      if (marker == '^') superscripted = true;
      at = skipSpaces(source, markerEnd - 1);
      continue;
    }
    const nucleus = nucleusOf(source, unit);
    return nucleus && { ...nucleus, superscripted, primeLast };
  }
}

/** The nucleus whose last unit is `unit`, or undefined when it is not one that can be braced. */
function nucleusOf(source: string, unit: Token): { start: number; accent: boolean } | undefined {
  if (unit.kind == 'word' && /^(no|display)?limits$/.test(unit.name)) {
    // \sum\limits_{i}^{n}: the limits switch belongs to the operator before it.
    const operator = unitBefore(source, skipSpaces(source, unit.start));
    return operator && nucleusOf(source, operator);
  }
  if (unit.kind == 'char' || unit.kind == 'symbol' || unit.kind == 'word') {
    const before = tokenBefore(source, skipSpaces(source, unit.start));
    if (before?.kind == 'word' && before.name == 'right') {
      const left = matchingLeft(source, before.start);
      return left < 0 ? undefined : { start: left, accent: false };
    }
    const text = tokenText(unit);
    if (text in OPENER_OF || SYMMETRIC.has(text)) {
      const start = delimitedStart(source, unit);
      return start < 0 ? undefined : { start, accent: false };
    }
  }
  if (unit.kind == 'char') {
    if (/[0-9]/.test(unit.name)) {
      // 10^{3} reads as one number, though TeX attaches the script to the last digit.
      let start = unit.start;
      while (start > 0 && /[0-9.]/.test(source[start - 1])) start--;
      return { start, accent: false };
    }
    if (/[&{$#~]/.test(unit.name)) return undefined;
  }
  if (unit.kind == 'symbol' && unit.name == '\\') return undefined;
  if (unit.kind == 'word' && STRUCTURE.has(unit.name)) return undefined;
  if (unit.kind == 'command') return { start: unit.start, accent: isAccentCommand(source, unit) };
  let start = unit.start;
  let accent = unit.kind == 'group' && isAccentField(source.slice(unit.start + 1, unit.end - 1));
  // A bare argument takes the command before it along: \hat x^{*} is braced from the \hat.
  for (;;) {
    const command = tokenBefore(source, skipSpaces(source, start));
    if (command?.kind != 'word' || !ONE_ARGUMENT.has(command.name)) break;
    accent = ACCENTS.has(command.name) || (FONTS.has(command.name) && accent);
    start = command.start;
  }
  return { start, accent };
}

function isAccentCommand(source: string, command: Token) {
  if (ACCENTS.has(command.name)) return true;
  if (!FONTS.has(command.name)) return false;
  const open = openingBrace(source, command.end - 1);
  return open >= 0 && isAccentField(source.slice(open + 1, command.end - 1));
}

/** Whether a whole math field, such as a group's content, is one accent, with or without scripts. */
function isAccentField(field: string) {
  const atom = atomBefore(field, skipSpaces(field, field.length));
  return Boolean(atom?.accent) && field.slice(0, atom!.start).trim() == '';
}

/** Where the delimited expression closed by `close` starts, its size command included, or -1. */
function delimitedStart(source: string, close: Token) {
  const open = matchingOpener(source, close);
  // A lone | is more likely a bar of its own (a conditional, a divides) than half of a pair.
  if (open < 0) return SYMMETRIC.has(tokenText(close)) ? close.start : -1;
  const before = tokenBefore(source, skipSpaces(source, open));
  if (before?.kind != 'word') return open;
  // \Bigl( ... \Bigr) is braced from the size; a \left( closed by a plain ) is broken already.
  if (SIZE.test(before.name)) return before.start;
  return before.name == 'left' || before.name == 'right' || before.name == 'middle' ? -1 : open;
}

/**
 * The token ending at `end`, taking a brace group together with the command it is an argument
 * of: \mathbf{x}, \frac{a}{b}, \sqrt[3]{x} and \operatorname*{tr} are each one unit. A group with
 * no command right before it is a unit of its own.
 */
function unitBefore(source: string, end: number): Token | undefined {
  const token = tokenBefore(source, end);
  if (token?.kind != 'group') return token;
  let previous = tokenBefore(source, token.start);
  while (previous?.kind == 'group') previous = tokenBefore(source, previous.start);
  if (previous?.kind == 'char' && (previous.name == ']' || previous.name == '*')) {
    const open = previous.name == ']' ? openingBracket(source, previous.start) : previous.start;
    previous = open < 0 ? undefined : tokenBefore(source, open);
  }
  return previous?.kind == 'word' ? { start: previous.start, end, kind: 'command', name: previous.name } : token;
}

/** The token ending at `end`: a character, a control sequence, or a whole brace group. */
function tokenBefore(source: string, end: number): Token | undefined {
  if (end <= 0) return undefined;
  const last = end - 1;
  const char = source[last];
  if (isLetter(char)) {
    let start = last;
    while (start > 0 && isLetter(source[start - 1])) start--;
    if (start > 0 && source[start - 1] == '\\' && !isEscaped(source, start - 1)) {
      return { start: start - 1, end, kind: 'word', name: source.slice(start, end) };
    }
    return { start: last, end, kind: 'char', name: char };
  }
  if (isEscaped(source, last)) return { start: last - 1, end, kind: 'symbol', name: char };
  if (char == '}') {
    const open = openingBrace(source, last);
    return open < 0 ? undefined : { start: open, end, kind: 'group', name: '' };
  }
  return { start: last, end, kind: 'char', name: char };
}

function tokenText(token: Token) {
  if (token.kind == 'char') return token.name;
  return token.kind == 'group' ? '{}' : `\\${token.name}`;
}

/** Where the group closed at `close` opens, or -1. */
function openingBrace(source: string, close: number) {
  let depth = 0;
  for (let index = close; index >= 0; index--) {
    const char = source[index];
    if ((char != '{' && char != '}') || isEscaped(source, index)) continue;
    depth += char == '}' ? 1 : -1;
    if (depth == 0) return index;
  }
  return -1;
}

// The walks below go back token by token, so a brace group is passed over whole, and reaching
// the `{` that opens the group they started in means the pair is not at this level.

/** Where the `[` of the optional argument closed at `close` is, or -1. */
function openingBracket(source: string, close: number) {
  let depth = 1;
  for (let token = tokenBefore(source, close); token; token = tokenBefore(source, token.start)) {
    if (token.kind != 'char') continue;
    if (token.name == '{') return -1;
    if (token.name == ']') depth++;
    else if (token.name == '[' && --depth == 0) return token.start;
  }
  return -1;
}

/** Where the delimiter that `close` closes is opened, or -1. */
function matchingOpener(source: string, close: Token) {
  const closing = tokenText(close);
  const opening = OPENER_OF[closing] ?? closing;
  let depth = 1;
  for (let token = tokenBefore(source, close.start); token; token = tokenBefore(source, token.start)) {
    if (token.kind == 'char' && token.name == '{') return -1;
    const text = tokenText(token);
    if (text == opening) {
      if (--depth == 0) return token.start;
    } else if (text == closing) {
      depth++;
    }
  }
  return -1;
}

/** Where the \left paired with the \right at `right` is, or -1. */
function matchingLeft(source: string, right: number) {
  let depth = 1;
  for (let token = tokenBefore(source, right); token; token = tokenBefore(source, token.start)) {
    if (token.kind == 'char' && token.name == '{') return -1;
    if (token.kind != 'word') continue;
    if (token.name == 'right') depth++;
    else if (token.name == 'left' && --depth == 0) return token.start;
  }
  return -1;
}

function skipSpaces(source: string, end: number) {
  while (end > 0 && /\s/.test(source[end - 1])) end--;
  return end;
}

function isLetter(char: string | undefined) {
  return char !== undefined && /[A-Za-z]/.test(char);
}
