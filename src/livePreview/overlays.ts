/** Styles a stretch of source can be drawn in while its commands are hidden. */
export type RangeStyle = 'bold' | 'italic' | 'underline' | 'smallCaps' | 'dim' | 'chapter' | 'section' | 'subsection';

/** Text drawn in place of hidden source, or between visible parts of it. */
export interface Insertion {
  /** Offset the text is drawn before. */
  at: number;
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Size relative to the editor font. */
  size?: number;
  color?: 'link' | 'warning';
}

/**
 * How the preview draws one piece of markup while the cursor is elsewhere: what it hides, the text it
 * draws instead and the styles it gives the source left visible.
 */
export interface Overlay {
  /** The source the cursor shows again by touching it. */
  start: number;
  end: number;
  hide: Array<[number, number]>;
  insert: Insertion[];
  style: Array<{ start: number; end: number; style: RangeStyle }>;
  /** Lines shown on hover over the first insertion. */
  hover?: string[];
}

export function overlay(start: number, end: number, parts: Partial<Omit<Overlay, 'start' | 'end'>> = {}): Overlay {
  return { start, end, hide: parts.hide ?? [], insert: parts.insert ?? [], style: parts.style ?? [], hover: parts.hover };
}
