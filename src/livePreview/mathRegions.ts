import {
  MATH_ENVIRONMENTS,
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
  /** The TeX between the delimiters. */
  tex: string;
}

const INLINE_DELIMITER_LENGTH = { inlineDollar: 1, paren: 2 } as const;

/**
 * Finds the inline formulas worth rendering: `$...$` and `\(...\)` that close on the line they
 * open, outside comments, verbatim-like environments and display math. A `$` inside display math
 * belongs to text nested in that formula, so it is not a formula of its own.
 */
export function findInlineMathRegions(text: string, languageId?: string): MathRegion[] {
  let sanitized = sanitizeLatexForParsing(text, undefined, masksInlineCodeSpans(languageId));
  sanitized = maskEnvironmentBodies(sanitized, [...VERBATIM_LIKE_ENVIRONMENTS, ...MATH_ENVIRONMENTS]);
  const regions: MathRegion[] = [];
  walkMathDelimiters(sanitized, (frame, end, depth) => {
    if (depth !== 0 || (frame.kind !== 'inlineDollar' && frame.kind !== 'paren')) return;
    const delimiter = INLINE_DELIMITER_LENGTH[frame.kind];
    const tex = text.slice(frame.start + delimiter, end - delimiter);
    if (!tex.trim() || tex.includes('\n')) return;
    regions.push({ start: frame.start, end, tex });
  });
  return regions;
}

/**
 * Blanks the bodies of the given environments, keeping offsets. Verbatim text is not TeX at all,
 * and math environments are display math whose inner `$` signs belong to nested text.
 */
function maskEnvironmentBodies(sanitized: string, environments: readonly string[]): string {
  const names = new Set(environments);
  const chars = sanitized.split('');
  const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;
  const open: Array<{ name: string; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitized)) !== null) {
    const [whole, kind, name] = match;
    if (!names.has(name)) continue;
    if (kind === 'begin') {
      open.push({ name, bodyStart: match.index + whole.length });
      continue;
    }
    const index = open.map(frame => frame.name).lastIndexOf(name);
    if (index === -1) continue;
    const [frame] = open.splice(index);
    // Only the outermost frame decides what is blanked; nested ones lie inside it anyway.
    if (open.length === 0) {
      for (let i = frame.bodyStart; i < match.index; i++) if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  // An environment still open is being typed. Blanking to the end of the file would turn every
  // formula below it back into source on each keystroke, so it is left alone until it closes.
  return chars.join('');
}

/**
 * Whether the user is at a formula, so its source should show: a selection overlaps it or a
 * cursor touches either delimiter, as in Obsidian.
 */
export function regionIsActive(region: Pick<MathRegion, 'start' | 'end'>, selections: ReadonlyArray<{ start: number; end: number }>): boolean {
  return selections.some(selection => selection.start <= region.end && region.start <= selection.end);
}
