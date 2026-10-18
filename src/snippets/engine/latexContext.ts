export const ROW_BREAK_ENVIRONMENTS = [
  'align',
  'align*',
  'aligned',
  'alignedat',
  'alignedat*',
  'gather',
  'gather*',
  'gathered',
  'split',
  'multline',
  'multline*',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'cases',
  'array',
  'tabular',
  'tabular*',
  'tabularx',
  'longtable',
];

export const ALIGNMENT_SEPARATOR_ENVIRONMENTS = [
  'align',
  'align*',
  'aligned',
  'alignedat',
  'alignedat*',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'cases',
  'array',
  'tabular',
  'tabular*',
  'tabularx',
  'longtable',
];

export const MATH_ENVIRONMENTS = [
  'math',
  'displaymath',
  'equation',
  'equation*',
  ...ROW_BREAK_ENVIRONMENTS,
];

export const TEXT_LIKE_COMMANDS = [
  'text',
  'textrm',
  'textnormal',
  'mbox',
  'operatorname',
  'mathrm',
  'label',
  'tag',
];

export const VERBATIM_LIKE_ENVIRONMENTS = [
  'verbatim',
  'verbatim*',
  'Verbatim',
  'lstlisting',
  'minted',
  'comment',
];

export type LatexMathKind =
  | 'none'
  | 'inlineDollar'
  | 'displayDollar'
  | 'paren'
  | 'bracket'
  | 'environment';

export interface LatexContextOptions {
  extraMathEnvironments?: string[];
  extraRowBreakEnvironments?: string[];
  extraAlignmentEnvironments?: string[];
  extraTextLikeCommands?: string[];
  /** Document language id; decides whether backtick code spans are masked. */
  languageId?: string;
}

export interface ResolvedLatexContextOptions {
  mathEnvironments: string[];
  rowBreakEnvironments: string[];
  alignmentEnvironments: string[];
  textLikeCommands: string[];
  verbatimLikeEnvironments: string[];
}

export interface LatexEnvironmentFrame {
  name: string;
  beginStart: number;
  beginEnd: number;
  nameStart: number;
  nameEnd: number;
}

export interface LatexEditorContext {
  environmentStack: string[];
  environmentFrames: LatexEnvironmentFrame[];
  currentEnvironment: string | undefined;
  currentEnvironmentFrame: LatexEnvironmentFrame | undefined;
  inComment: boolean;
  inMarkdownCode: boolean;
  inTextLikeCommand: boolean;
  inVerbatimLikeEnvironment: boolean;
  inMath: boolean;
  mathKind: LatexMathKind;
  canSmartEnter: boolean;
  canSmartTab: boolean;
  canInsertAlignmentSeparator: boolean;
  canExpandMathSnippet: boolean;
}

export interface MathDelimiterFrame {
  kind: Exclude<LatexMathKind, 'none' | 'environment'>;
  start: number;
}

interface SourceRange {
  start: number;
  end: number;
}

interface LatexParsingPrefix {
  original: string;
  sanitized: string;
  markdownFenceRanges: SourceRange[];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

// getLatexContext runs on every keystroke, and resolving the options rebuilds five deduped
// arrays each time from configuration that changes at most when settings do. One slot is
// enough: the key is stable for the whole session in practice.
let resolvedOptionsCache: { key: string; resolved: ResolvedLatexContextOptions } | undefined;

export function resolveLatexContextOptions(
  options: LatexContextOptions = {}
): ResolvedLatexContextOptions {
  let key = JSON.stringify([
    options.extraMathEnvironments || [],
    options.extraRowBreakEnvironments || [],
    options.extraAlignmentEnvironments || [],
    options.extraTextLikeCommands || [],
  ]);
  if (resolvedOptionsCache?.key === key) return resolvedOptionsCache.resolved;
  let resolved = computeLatexContextOptions(options);
  resolvedOptionsCache = { key, resolved };
  return resolved;
}

function computeLatexContextOptions(options: LatexContextOptions): ResolvedLatexContextOptions {
  let rowBreakEnvironments = unique([
    ...ROW_BREAK_ENVIRONMENTS,
    ...(options.extraRowBreakEnvironments || []),
  ]);
  let alignmentEnvironments = unique([
    ...ALIGNMENT_SEPARATOR_ENVIRONMENTS,
    ...(options.extraAlignmentEnvironments || []),
  ]);

  return {
    rowBreakEnvironments,
    alignmentEnvironments,
    mathEnvironments: unique([
      ...MATH_ENVIRONMENTS,
      ...rowBreakEnvironments,
      ...alignmentEnvironments,
      ...(options.extraMathEnvironments || []),
    ]),
    textLikeCommands: unique([
      ...TEXT_LIKE_COMMANDS,
      ...(options.extraTextLikeCommands || []),
    ]),
    verbatimLikeEnvironments: VERBATIM_LIKE_ENVIRONMENTS,
  };
}

export function isEscaped(text: string, index: number) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] == '\\'; i--) {
    slashCount++;
  }
  return slashCount % 2 == 1;
}

export function findLatexCommentStart(line: string) {
  for (let index = 0; index < line.length; index++) {
    if (line[index] == '%' && !isEscaped(line, index)) {
      return index;
    }
  }

  return -1;
}

function getMarkdownFenceRanges(text: string) {
  let ranges: SourceRange[] = [];
  let open: { start: number; marker: string; length: number } | undefined;
  let lineStart = 0;

  while (lineStart <= text.length) {
    let newline = text.indexOf('\n', lineStart);
    let lineEnd = newline == -1 ? text.length : newline;
    let nextLineStart = newline == -1 ? text.length + 1 : newline + 1;
    let line = text.substring(lineStart, lineEnd);
    let match = /^ {0,3}(`{3,}|~{3,})/.exec(line);

    if (match) {
      let marker = match[1][0];
      let length = match[1].length;
      if (!open) {
        open = { start: lineStart, marker, length };
      } else if (marker == open.marker && length >= open.length) {
        ranges.push({ start: open.start, end: nextLineStart - 1 });
        open = undefined;
      }
    }

    lineStart = nextLineStart;
  }

  if (open) {
    ranges.push({ start: open.start, end: text.length });
  }

  return ranges;
}

function regexRanges(text: string, regexp: RegExp): Array<[number, number]> {
  let ranges: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  while ((match = regexp.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** The text with the ranges blanked, line breaks kept, built from slices rather than one string per character. */
function maskRanges(text: string, ranges: Array<[number, number]>) {
  ranges.sort((a, b) => a[0] - b[0]);
  let masked = '';
  let copied = 0;
  for (let [rangeStart, rangeEnd] of ranges) {
    let start = Math.max(rangeStart, copied, 0);
    let end = Math.min(rangeEnd, text.length);
    if (end <= start) continue;
    masked += text.slice(copied, start) + text.slice(start, end).replace(/[^\n\r]/g, ' ');
    copied = end;
  }
  return masked + text.slice(copied);
}

export function sanitizeLatexForParsing(
  text: string,
  markdownFenceRanges = getMarkdownFenceRanges(text),
  maskInlineCodeSpans = true
) {
  let ranges: Array<[number, number]> = markdownFenceRanges.map((range): [number, number] => [range.start, range.end]);
  ranges.push(...regexRanges(text, /<!--[\s\S]*?-->/g));
  // Backtick code spans are a Markdown construct. In LaTeX a backtick is an opening
  // quote, so two ordinary quotes on one line would be paired into a bogus span and
  // everything between them — including real math — would be masked out.
  if (maskInlineCodeSpans) ranges.push(...regexRanges(text, /`[^`\n]*`/g));
  let masked = ranges.length ? maskRanges(text, ranges) : text;

  // Comments are looked for in what is left, and only on lines with a % at all.
  let comments: Array<[number, number]> = [];
  for (let percent = masked.indexOf('%'); percent != -1;) {
    let lineStart = masked.lastIndexOf('\n', percent - 1) + 1;
    let newline = masked.indexOf('\n', percent);
    let lineEnd = newline == -1 ? masked.length : newline;
    let commentStart = findLatexCommentStart(masked.slice(lineStart, lineEnd));
    if (commentStart != -1) {
      comments.push([lineStart + commentStart, lineEnd]);
    }
    percent = newline == -1 ? -1 : masked.indexOf('%', newline);
  }

  return comments.length ? maskRanges(masked, comments) : masked;
}

function createLatexParsingPrefix(
  text: string,
  offset: number,
  maskInlineCodeSpans = true
): LatexParsingPrefix {
  let original = text.substring(0, offset);
  let markdownFenceRanges = getMarkdownFenceRanges(original);
  return {
    original,
    markdownFenceRanges,
    sanitized: sanitizeLatexForParsing(original, markdownFenceRanges, maskInlineCodeSpans),
  };
}

const TEX_LANGUAGE_IDS = new Set(['latex', 'tex', 'latex-expl3', 'doctex', 'rsweave', 'jlweave']);

export function masksInlineCodeSpans(languageId?: string): boolean {
  return !languageId || !TEX_LANGUAGE_IDS.has(languageId.toLowerCase());
}

function getOpenLatexEnvironmentFramesFromSanitized(
  beforeCursor: string,
  resolved: ResolvedLatexContextOptions
) {
  let verbatimEnvironments = new Set(resolved.verbatimLikeEnvironments);
  const stack: LatexEnvironmentFrame[] = [];
  const environmentReg = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = environmentReg.exec(beforeCursor)) !== null) {
    let kind = match[1];
    let rawEnvironment = match[2];
    let environment = rawEnvironment.trim();
    let rawNameStart = match.index + match[0].indexOf('{') + 1;
    let leadingWhitespace = rawEnvironment.search(/\S/);
    let nameStart = rawNameStart + (leadingWhitespace == -1 ? 0 : leadingWhitespace);
    let nameEnd = nameStart + environment.length;
    let currentVerbatimIndex = -1;

    for (let index = stack.length - 1; index >= 0; index--) {
      if (verbatimEnvironments.has(stack[index].name)) {
        currentVerbatimIndex = index;
        break;
      }
    }

    if (currentVerbatimIndex != -1) {
      if (kind == 'end' && environment == stack[currentVerbatimIndex].name) {
        stack.splice(currentVerbatimIndex, 1);
      }
      continue;
    }

    if (kind == 'begin') {
      stack.push({
        name: environment,
        beginStart: match.index,
        beginEnd: environmentReg.lastIndex,
        nameStart,
        nameEnd,
      });
      continue;
    }

    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index].name == environment) {
        stack.splice(index, 1);
        break;
      }
    }
  }

  return stack;
}

export function getOpenLatexEnvironmentFrames(
  text: string,
  offset: number,
  options: LatexContextOptions = {}
) {
  let resolved = resolveLatexContextOptions(options);
  let beforeCursor = sanitizeLatexForParsing(text.substring(0, offset));
  return getOpenLatexEnvironmentFramesFromSanitized(beforeCursor, resolved);
}

export function getOpenLatexEnvironmentStack(
  text: string,
  offset: number,
  options: LatexContextOptions = {}
) {
  return getOpenLatexEnvironmentFrames(text, offset, options).map((frame) => frame.name);
}

function isInAnyEnvironment(stack: string[], environments: Set<string>) {
  return stack.some((environment) => environments.has(environment));
}

export function isInsideLatexLineComment(text: string, offset: number) {
  let lineStart = text.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1;
  let lineBeforeCursor = text.substring(lineStart, offset);
  return findLatexCommentStart(lineBeforeCursor) != -1;
}

export function isInsideMarkdownCode(text: string, offset: number) {
  let beforeCursor = text.substring(0, offset);
  return isInsideMarkdownCodeInPrefix(beforeCursor, getMarkdownFenceRanges(beforeCursor));
}

function isInsideMarkdownCodeInPrefix(
  beforeCursor: string,
  markdownFenceRanges: SourceRange[],
  countInlineBackticks = true
) {
  if (markdownFenceRanges.some((range) => range.end == beforeCursor.length)) {
    return true;
  }

  // Fences are unambiguous in any language, but a lone backtick is an opening quote in
  // LaTeX, so counting them there reports text as code and suppresses math detection.
  if (!countInlineBackticks) return false;
  let lineStart = beforeCursor.lastIndexOf('\n') + 1;
  let lineBeforeCursor = beforeCursor.substring(lineStart);
  let inlineBackticks = lineBeforeCursor.match(/`/g);
  return inlineBackticks ? inlineBackticks.length % 2 == 1 : false;
}

export function findMatchingBrace(text: string, openBrace: number, limit = text.length) {
  let depth = 0;
  for (let index = openBrace; index < limit; index++) {
    if (isEscaped(text, index)) {
      continue;
    }

    if (text[index] == '{') {
      depth++;
      continue;
    }

    if (text[index] == '}') {
      depth--;
      if (depth == 0) {
        return index;
      }
    }
  }

  return -1;
}

export function isInsideTextLikeCommand(
  text: string,
  offset: number,
  options: LatexContextOptions = {}
) {
  let resolved = resolveLatexContextOptions(options);
  let sanitized = sanitizeLatexForParsing(text.substring(0, offset));
  return isInsideTextLikeCommandInSanitized(sanitized, resolved);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keyed on the resolved options object, which resolveLatexContextOptions now memoizes, so
// the pattern is compiled once per configuration instead of once per keystroke.
const textLikeCommandRegExpCache = new WeakMap<ResolvedLatexContextOptions, RegExp>();

function textLikeCommandRegExp(resolved: ResolvedLatexContextOptions): RegExp {
  let cached = textLikeCommandRegExpCache.get(resolved);
  if (!cached) {
    cached = new RegExp(
      '\\\\(' + resolved.textLikeCommands.map(escapeRegExp).join('|') + ')\\s*\\{',
      'g'
    );
    textLikeCommandRegExpCache.set(resolved, cached);
  }
  return cached;
}

function isInsideTextLikeCommandInSanitized(
  sanitized: string,
  resolved: ResolvedLatexContextOptions
) {
  if (resolved.textLikeCommands.length == 0) {
    return false;
  }

  const commandReg = textLikeCommandRegExp(resolved);
  // Shared /g regex: reset explicitly so a previous call's lastIndex cannot skip the
  // beginning of this document.
  commandReg.lastIndex = 0;

  while (commandReg.exec(sanitized) !== null) {
    let openBrace = commandReg.lastIndex - 1;
    let closeBrace = findMatchingBrace(sanitized, openBrace, sanitized.length);
    if (closeBrace == -1 || closeBrace >= sanitized.length) {
      return true;
    }
  }

  return false;
}

export function getMathDelimiterStack(text: string, offset: number) {
  return getMathDelimiterStackFromSanitized(sanitizeLatexForParsing(text.substring(0, offset)));
}

function getMathDelimiterStackFromSanitized(beforeCursor: string) {
  return walkMathDelimiters(beforeCursor);
}

/**
 * Pairs math delimiters in sanitized text and returns the frames still open at the end. `onClose`
 * hears each frame as it closes, with the offset just past its closing delimiter and how many
 * frames remain open around it. The snippet engine's math-mode check and the live preview's
 * formula finder both walk text through here, so they agree on what counts as math.
 */
export function walkMathDelimiters(
  sanitized: string,
  onClose?: (frame: MathDelimiterFrame, end: number, depth: number) => void
) {
  let stack: MathDelimiterFrame[] = [];
  let close = (end: number) => {
    let frame = stack.pop()!;
    onClose?.(frame, end, stack.length);
  };

  for (let index = 0; index < sanitized.length; index++) {
    let char = sanitized[index];

    if (char == '\\') {
      let next = sanitized[index + 1];
      if (next == '(' || next == '[') {
        stack.push({ kind: next == '(' ? 'paren' : 'bracket', start: index });
        index++;
        continue;
      }
      if (next == ')' && stack[stack.length - 1]?.kind == 'paren') {
        close(index + 2);
        index++;
        continue;
      }
      if (next == ']' && stack[stack.length - 1]?.kind == 'bracket') {
        close(index + 2);
        index++;
        continue;
      }

      index++;
      continue;
    }

    if (char == '$' && !isEscaped(sanitized, index)) {
      // `$$` only opens display math when no inline `$` is currently open. Inside inline
      // math it is a close immediately followed by an open, and treating it as display
      // math would strand an inline frame on the stack and report math mode forever.
      let insideInline = stack[stack.length - 1]?.kind == 'inlineDollar';
      let delimiter = sanitized[index + 1] == '$' && !insideInline ? '$$' : '$';
      let kind: MathDelimiterFrame['kind'] = delimiter == '$$' ? 'displayDollar' : 'inlineDollar';
      if (stack[stack.length - 1]?.kind == kind) {
        close(index + delimiter.length);
      } else {
        stack.push({ kind, start: index });
      }
      if (delimiter == '$$') {
        index++;
      }
    }
  }

  return stack;
}

export function getLatexContext(
  text: string,
  offset: number,
  options: LatexContextOptions = {}
): LatexEditorContext {
  let resolved = resolveLatexContextOptions(options);
  let inlineCodeSpans = masksInlineCodeSpans(options.languageId);
  let parsedPrefix = createLatexParsingPrefix(text, offset, inlineCodeSpans);
  let environmentFrames = getOpenLatexEnvironmentFramesFromSanitized(
    parsedPrefix.sanitized,
    resolved
  );
  let environmentStack = environmentFrames.map((frame) => frame.name);
  let currentEnvironmentFrame = environmentFrames[environmentFrames.length - 1];
  let currentEnvironment = currentEnvironmentFrame?.name;
  let inComment = isInsideLatexLineComment(text, offset);
  let inMarkdownCode = isInsideMarkdownCodeInPrefix(
    parsedPrefix.original,
    parsedPrefix.markdownFenceRanges,
    inlineCodeSpans
  );
  let inTextLikeCommand = isInsideTextLikeCommandInSanitized(parsedPrefix.sanitized, resolved);
  let verbatimEnvironments = new Set(resolved.verbatimLikeEnvironments);
  let rowBreakEnvironments = new Set(resolved.rowBreakEnvironments);
  let alignmentEnvironments = new Set(resolved.alignmentEnvironments);
  let mathEnvironments = new Set(resolved.mathEnvironments);
  let inVerbatimLikeEnvironment = isInAnyEnvironment(environmentStack, verbatimEnvironments);
  let delimiterStack = getMathDelimiterStackFromSanitized(parsedPrefix.sanitized);
  let delimiterMathKind = delimiterStack[delimiterStack.length - 1]?.kind;
  let inRowBreakEnvironment = isInAnyEnvironment(environmentStack, rowBreakEnvironments);
  let inAlignmentEnvironment = isInAnyEnvironment(environmentStack, alignmentEnvironments);
  let inMathEnvironment = isInAnyEnvironment(environmentStack, mathEnvironments);
  let blocked = inComment || inMarkdownCode || inTextLikeCommand || inVerbatimLikeEnvironment;
  let inMath = (Boolean(delimiterMathKind) || inMathEnvironment) && !blocked;
  let mathKind: LatexMathKind = 'none';

  if (inMath) {
    mathKind = delimiterMathKind || 'environment';
  }

  return {
    environmentStack,
    environmentFrames,
    currentEnvironment,
    currentEnvironmentFrame,
    inComment,
    inMarkdownCode,
    inTextLikeCommand,
    inVerbatimLikeEnvironment,
    inMath,
    mathKind,
    canSmartEnter: inRowBreakEnvironment && !blocked,
    canSmartTab: inAlignmentEnvironment && !blocked,
    canInsertAlignmentSeparator: inAlignmentEnvironment && !blocked,
    canExpandMathSnippet: inMath && !blocked,
  };
}
