import {
  masksInlineCodeSpans,
  sanitizeLatexForParsing,
  VERBATIM_LIKE_ENVIRONMENTS,
  walkMathDelimiters
} from '../snippets/engine/latexContext';

export interface MathRegion {
  /** Offset of the opening delimiter. */
  start: number;
  /** Offset just past the closing delimiter. */
  end: number;
  /** The TeX to typeset. */
  tex: string;
}

/** A display formula with its lines to itself, so its rendering can take their whole height. */
export interface DisplayMathRegion extends MathRegion {
  /** How many lines the block spans. */
  rows: number;
  /** Offset of the start of the block's first line. */
  linesStart: number;
  /** Offset of the end of the block's last line. */
  linesEnd: number;
}

export interface MathRegions {
  inline: MathRegion[];
  display: DisplayMathRegion[];
}

/**
 * Environments that are display math by themselves. Those that only occur inside math, such as
 * `aligned` or `cases`, are part of the formula around them.
 */
const DISPLAY_ENVIRONMENTS = new Set([
  'displaymath', 'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*'
]);
const VERBATIM_ENVIRONMENTS = new Set(VERBATIM_LIKE_ENVIRONMENTS);
const DELIMITER_LENGTH = { inlineDollar: 1, paren: 2, displayDollar: 2, bracket: 2 } as const;

/**
 * Finds the formulas worth rendering, outside comments and verbatim-like environments:
 * - inline: `$...$` and `\(...\)` that close on the line they open;
 * - display: `\[...\]`, `$$...$$` and display environments that have their lines to themselves.
 *   A display block sharing a line with text is left as source, since its rendering covers whole lines.
 */
export function findMathRegions(text: string, languageId?: string): MathRegions {
  const sanitized = sanitizeLatexForParsing(text, undefined, masksInlineCodeSpans(languageId));
  const chars = sanitized.split('');
  for (const frame of outermostEnvironments(sanitized, VERBATIM_ENVIRONMENTS)) blank(chars, frame.bodyStart, frame.bodyEnd);
  const blocks: MathRegion[] = [];
  for (const frame of outermostEnvironments(chars.join(''), DISPLAY_ENVIRONMENTS)) {
    if (!chars.slice(frame.bodyStart, frame.bodyEnd).join('').trim()) continue;
    // MathJax takes the environments themselves, except displaymath, which it does not know.
    const tex = frame.name === 'displaymath' ? text.slice(frame.bodyStart, frame.bodyEnd) : text.slice(frame.start, frame.end);
    blocks.push({ start: frame.start, end: frame.end, tex });
    // A `$` in here belongs to text nested in the formula, not to a formula of its own.
    blank(chars, frame.start, frame.end);
  }
  const inline: MathRegion[] = [];
  walkMathDelimiters(chars.join(''), (frame, end, depth) => {
    if (depth !== 0) return;
    const delimiter = DELIMITER_LENGTH[frame.kind];
    const tex = text.slice(frame.start + delimiter, end - delimiter);
    if (!tex.trim()) return;
    if (frame.kind === 'displayDollar' || frame.kind === 'bracket') blocks.push({ start: frame.start, end, tex });
    else if (!tex.includes('\n')) inline.push({ start: frame.start, end, tex });
  });
  const display = blocks
    .map(block => onOwnLines(block, text, sanitized))
    .filter((block): block is DisplayMathRegion => block !== undefined)
    .sort((a, b) => a.start - b.start);
  return { inline, display };
}

/** The block with the lines it spans, if nothing but blanks and comments shares them. */
function onOwnLines(block: MathRegion, text: string, sanitized: string): DisplayMathRegion | undefined {
  const linesStart = text.lastIndexOf('\n', block.start - 1) + 1;
  const newline = text.indexOf('\n', block.end);
  const linesEnd = newline === -1 ? text.length : newline;
  if (sanitized.slice(linesStart, block.start).trim() || sanitized.slice(block.end, linesEnd).trim()) return undefined;
  let rows = 1;
  for (let index = text.indexOf('\n', linesStart); index !== -1 && index < linesEnd; index = text.indexOf('\n', index + 1)) rows++;
  return { ...block, rows, linesStart, linesEnd };
}

interface EnvironmentFrame {
  name: string;
  start: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
}

/** The closed environments named in `names` that no other of them encloses, in order. */
function outermostEnvironments(sanitized: string, names: ReadonlySet<string>): EnvironmentFrame[] {
  const frames: EnvironmentFrame[] = [];
  const open: Array<{ name: string; start: number; bodyStart: number }> = [];
  const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitized)) !== null) {
    const [whole, kind] = match;
    const name = match[2].trim();
    if (!names.has(name)) continue;
    if (kind === 'begin') {
      open.push({ name, start: match.index, bodyStart: match.index + whole.length });
      continue;
    }
    const index = open.map(frame => frame.name).lastIndexOf(name);
    if (index === -1) continue;
    const [frame] = open.splice(index);
    if (open.length === 0) frames.push({ ...frame, bodyEnd: match.index, end: match.index + whole.length });
  }
  // An environment still open is being typed. Treating it as running to the end of the file would
  // turn every formula below it back into source on each keystroke, so it waits until it closes.
  return frames;
}

/** Blanks a range, keeping offsets and line breaks. */
function blank(chars: string[], start: number, end: number): void {
  for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
}

/**
 * Whether the user is at a formula, so its source should show: a selection overlaps it or a
 * cursor touches either end, as in Obsidian.
 */
export function regionIsActive(region: Pick<MathRegion, 'start' | 'end'>, selections: ReadonlyArray<{ start: number; end: number }>): boolean {
  return selections.some(selection => selection.start <= region.end && region.start <= selection.end);
}
