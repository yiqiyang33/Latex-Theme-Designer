import { isEscaped } from '../snippets/engine/latexContext';
import { previewSource, type MathRegions } from './mathRegions';
import { overlay, type Overlay } from './overlays';
import { plainText, type CitationInfo } from './references';

export type CitationCommand = 'cite' | 'citet' | 'citep' | 'citealt' | 'citealp' | 'citeauthor' | 'citeyear' | 'citeyearpar';

export interface CitationRegion {
  /** Offset of the command, or of the tie before it. */
  start: number;
  end: number;
  command: CitationCommand;
  /** Whether the first name is capitalised, as \Citet does. */
  capital: boolean;
  /** Whether every author is named, as \citet* does. */
  starred: boolean;
  pre?: string;
  post?: string;
  keys: string[];
  tie: boolean;
}

const CITATION = /\\(cite|citet|citep|citealt|citealp|citeauthor|citeyearpar|citeyear|Cite|Citet|Citep|Citealt|Citealp|Citeauthor)(\*?)\s*(?:\[([^\]\n]*)\])?\s*(?:\[([^\]\n]*)\])?\s*\{([^{}\n]*)\}/g;

/** natbib citations in the text outside formulas. */
export function findCitations(text: string, math: MathRegions, languageId?: string, source = previewSource(text, languageId)): CitationRegion[] {
  const formulas = [...math.inline, ...math.display].sort((a, b) => a.start - b.start);
  const regions: CitationRegion[] = [];
  let formula = 0;
  for (const match of source.matchAll(CITATION)) {
    const start = match.index!;
    if (isEscaped(source, start)) continue;
    while (formula < formulas.length && formulas[formula].end <= start) formula++;
    if (formula < formulas.length && formulas[formula].start <= start) continue;
    const keys = match[5].split(',').map(key => key.trim()).filter(Boolean);
    if (!keys.length) continue;
    // With one optional argument natbib takes it as the note after the citation.
    const [pre, post] = match[4] === undefined ? [undefined, match[3]] : [match[3], match[4]];
    const tie = source[start - 1] === '~' && !isEscaped(source, start - 1);
    regions.push({
      start: tie ? start - 1 : start,
      end: start + match[0].length,
      command: match[1].toLowerCase() as CitationCommand,
      capital: /^[A-Z]/.test(match[1]),
      starred: match[2] === '*',
      pre: pre?.trim() ? pre : undefined,
      post: post?.trim() ? post : undefined,
      keys,
      tie
    });
  }
  return regions;
}

/**
 * What a citation prints under natbib's defaults: round brackets, works separated by semicolons,
 * and the years of consecutive works by the same authors sharing their names. A work the last
 * compile did not record prints as ?.
 */
export function formatCitation(region: CitationRegion, citations: ReadonlyMap<string, CitationInfo>, authorYear: boolean): string {
  const found = region.keys.map(key => citations.get(key));
  const pre = region.pre ? `${plainText(region.pre)} ` : '';
  const post = region.post ? `, ${plainText(region.post)}` : '';
  if (!authorYear) {
    const numbers = found.map(work => work?.number ?? '?').join(', ');
    if (region.command === 'citeauthor') return found.map(work => work?.authors ?? '?').join('; ');
    const cited = `[${pre}${numbers}${post}]`;
    return region.command === 'citet' && found[0]?.authors ? `${found[0].authors} ${cited}` : cited;
  }
  const groups: Array<{ authors: string; years: string[] }> = [];
  for (const work of found) {
    const named = work && (region.starred ? work.fullAuthors || work.authors : work.authors);
    const authors = named ? (region.capital ? named.charAt(0).toUpperCase() + named.slice(1) : named) : '?';
    const last = groups[groups.length - 1];
    if (work && last && last.authors === authors && last.years.length) last.years.push(work.year ?? '?');
    else groups.push({ authors, years: work ? [work.year ?? '?'] : [] });
  }
  const yearsOf = (group: { years: string[] }) => group.years.join(', ');
  switch (region.command) {
    case 'citep':
      return `(${pre}${groups.map(group => group.years.length ? `${group.authors}, ${yearsOf(group)}` : group.authors).join('; ')}${post})`;
    case 'citealp':
      return `${pre}${groups.map(group => group.years.length ? `${group.authors}, ${yearsOf(group)}` : group.authors).join('; ')}${post}`;
    case 'citealt':
      return `${pre}${groups.map(group => [group.authors, yearsOf(group)].filter(Boolean).join(' ')).join('; ')}${post}`;
    case 'citeauthor':
      return groups.map(group => group.authors).join('; ');
    case 'citeyear':
      return found.map(work => work?.year ?? '?').join(', ');
    case 'citeyearpar':
      return `(${pre}${found.map(work => work?.year ?? '?').join(', ')}${post})`;
    default:
      // \citet, and \cite, which natbib sets the same way in author-year styles.
      return groups.map((group, index) => {
        if (!group.years.length) return group.authors;
        const notes = `${index === 0 ? pre : ''}${yearsOf(group)}${index === groups.length - 1 ? post : ''}`;
        return `${group.authors} (${notes})`;
      }).join('; ');
  }
}

/** Citations shown as they print, with the works' full author lists on hover. */
export function citationOverlays(regions: readonly CitationRegion[], citations: ReadonlyMap<string, CitationInfo>): Overlay[] {
  if (!citations.size) return [];
  // An author-year style records names with every work; a numeric one only numbers.
  const authorYear = [...citations.values()].some(work => work.authors);
  return regions.map(region => {
    const missing = region.keys.some(key => !citations.has(key));
    return overlay(region.start, region.end, {
      hide: [[region.start, region.end]],
      insert: [{
        at: region.start,
        text: `${region.tie ? ' ' : ''}${formatCitation(region, citations, authorYear)}`,
        color: missing ? 'warning' : 'link',
        bold: missing
      }],
      hover: region.keys.map(key => {
        const work = citations.get(key);
        if (!work) return `${key}: not in the last compile; run BibTeX and compile again to cite it`;
        const names = work.fullAuthors || work.authors;
        return `${key}: ${[names, work.year && `(${work.year})`].filter(Boolean).join(' ') || `[${work.number}]`}`;
      })
    });
  });
}
