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
  /** Offset of `tex` in the text. */
  texStart: number;
  /** Offset of the closing delimiter. */
  closeStart: number;
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
 * The text with comments and verbatim bodies blanked, offsets kept: what the preview reads as TeX.
 * Scanning a document once and passing the result to the finders saves each of them the work.
 */
export function previewSource(text: string, languageId?: string): string {
  const sanitized = sanitizeLatexForParsing(text, undefined, masksInlineCodeSpans(languageId));
  return blankRanges(sanitized, closedEnvironments(sanitized, VERBATIM_ENVIRONMENTS, 'literal').map(frame => [frame.bodyStart, frame.bodyEnd]));
}

/**
 * Finds the formulas worth rendering, outside comments and verbatim-like environments:
 * - inline: `$...$` and `\(...\)` that close on the line they open;
 * - display: `\[...\]`, `$$...$$` and display environments that have their lines to themselves.
 *   A display block sharing a line with text is left as source, since its rendering covers whole lines.
 */
export function findMathRegions(text: string, languageId?: string, source = previewSource(text, languageId)): MathRegions {
  const blocks: MathRegion[] = [];
  for (const frame of closedEnvironments(source, DISPLAY_ENVIRONMENTS, 'restarts')) {
    if (!source.slice(frame.bodyStart, frame.bodyEnd).trim()) continue;
    // MathJax takes the environments themselves, except displaymath, which it does not know.
    const texStart = frame.name === 'displaymath' ? frame.bodyStart : frame.start;
    const tex = text.slice(texStart, frame.name === 'displaymath' ? frame.bodyEnd : frame.end);
    blocks.push({ start: frame.start, end: frame.end, tex, texStart, closeStart: frame.bodyEnd });
  }
  const inline: MathRegion[] = [];
  // A `$` in a display environment belongs to text nested in the formula, not to a formula of its own.
  walkMathDelimiters(blankRanges(source, blocks.map(block => [block.start, block.end])), (frame, end, depth) => {
    if (depth !== 0) return;
    const delimiter = DELIMITER_LENGTH[frame.kind];
    const region = { start: frame.start, end, tex: text.slice(frame.start + delimiter, end - delimiter), texStart: frame.start + delimiter, closeStart: end - delimiter };
    if (!region.tex.trim()) return;
    if (frame.kind === 'displayDollar' || frame.kind === 'bracket') blocks.push(region);
    else if (!region.tex.includes('\n')) inline.push(region);
  });
  const display = blocks
    .map(block => onOwnLines(block, text, source))
    .filter((block): block is DisplayMathRegion => block !== undefined)
    .sort((a, b) => a.start - b.start);
  return { inline, display };
}

/** The block with the lines it spans, if nothing but blanks and comments shares them. */
function onOwnLines(block: MathRegion, text: string, source: string): DisplayMathRegion | undefined {
  const linesStart = text.lastIndexOf('\n', block.start - 1) + 1;
  const newline = text.indexOf('\n', block.end);
  const linesEnd = newline === -1 ? text.length : newline;
  if (source.slice(linesStart, block.start).trim() || source.slice(block.end, linesEnd).trim()) return undefined;
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

/**
 * The closed environments named in `names`, in order. Neither kind nests: inside a verbatim one
 * everything is text until its end, while display math cannot hold more display math, so a begin
 * inside one means that one was never closed.
 */
function closedEnvironments(source: string, names: ReadonlySet<string>, inner: 'literal' | 'restarts'): EnvironmentFrame[] {
  const frames: EnvironmentFrame[] = [];
  let open: { name: string; start: number; bodyStart: number } | undefined;
  const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const [whole, kind] = match;
    const name = match[2].trim();
    if (!names.has(name)) continue;
    if (kind === 'begin') {
      if (!open || inner === 'restarts') open = { name, start: match.index, bodyStart: match.index + whole.length };
    } else if (open?.name === name) {
      frames.push({ ...open, bodyEnd: match.index, end: match.index + whole.length });
      open = undefined;
    }
  }
  // One still open is being typed. Treating it as running to the end of the file would turn every
  // formula below it back into source on each keystroke, so it waits until it closes.
  return frames;
}

/** The text with the ranges, which are in order and apart, blanked, keeping offsets and line breaks. */
function blankRanges(text: string, ranges: Array<[number, number]>): string {
  if (!ranges.length) return text;
  let blanked = '';
  let copied = 0;
  for (const [start, end] of ranges) {
    blanked += text.slice(copied, start) + text.slice(start, end).replace(/[^\n]/g, ' ');
    copied = end;
  }
  return blanked + text.slice(copied);
}

/** The formula's TeX with `marker` at the cursor, if the cursor is in the TeX rather than on a delimiter. */
export function texWithCursor(region: MathRegion, cursor: number, marker: string): string | undefined {
  const at = cursor - region.texStart;
  if (at < 0 || at > region.tex.length) return undefined;
  return region.tex.slice(0, at) + marker + region.tex.slice(at);
}

/**
 * Whether the user is at a formula, so its source should show: a selection overlaps it or a
 * cursor touches either end, as in Obsidian.
 */
export function regionIsActive(region: Pick<MathRegion, 'start' | 'end'>, selections: ReadonlyArray<{ start: number; end: number }>): boolean {
  return selections.some(selection => selection.start <= region.end && region.start <= selection.end);
}
