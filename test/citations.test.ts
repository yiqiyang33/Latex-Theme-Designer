import { describe, expect, it } from 'vitest';
import { citationOverlays, findCitations, formatCitation } from '../src/livePreview/citations';
import { findMathRegions } from '../src/livePreview/mathRegions';
import type { CitationInfo } from '../src/livePreview/references';
import { drawn } from './support/drawn';

const citations = new Map<string, CitationInfo>([
  ['agrawal2019', { number: '1', year: '2019', authors: 'Agrawal et al.', fullAuthors: 'Agrawal, Avadhanula, Goyal, and Zeevi' }],
  ['agrawal2020', { number: '2', year: '2020', authors: 'Agrawal et al.', fullAuthors: 'Agrawal and Goyal' }],
  ['armstrong2018', { number: '3', year: '2018', authors: 'Armstrong and Kolesár' }],
  ['van2010', { number: '4', year: '2010', authors: 'van der Vaart' }]
]);
const find = (text: string) => findCitations(text, findMathRegions(text, 'latex'), 'latex');
const format = (text: string, authorYear = true) => find(text).map(region => formatCitation(region, citations, authorYear));

describe('findCitations', () => {
  it('reads natbib commands with their notes and the tie before them', () => {
    const text = 'As in~\\citet{agrawal2019} and \\citep[see][p.~3]{agrawal2019, armstrong2018} or \\Citeauthor*{van2010}.';
    expect(find(text)).toEqual([
      expect.objectContaining({ start: text.indexOf('~'), command: 'citet', keys: ['agrawal2019'], tie: true, pre: undefined, post: undefined }),
      expect.objectContaining({ command: 'citep', keys: ['agrawal2019', 'armstrong2018'], pre: 'see', post: 'p.~3', tie: false }),
      expect.objectContaining({ command: 'citeauthor', capital: true, starred: true, end: text.length - 1 })
    ]);
  });

  it('takes a single note as the one after the citation, and skips comments, formulas and escapes', () => {
    expect(find('\\citep[ch.~2]{van2010}')).toEqual([expect.objectContaining({ pre: undefined, post: 'ch.~2' })]);
    expect(find('% \\citep{a}\n$\\citep{b}$ \\\\citep{c} \\citetitle{d}')).toEqual([]);
  });
});

describe('formatCitation', () => {
  it('prints author-year citations as natbib does by default', () => {
    expect(format('\\citet{agrawal2019} \\citep{armstrong2018} \\citealt{van2010} \\citealp{van2010} \\citeyear{van2010} \\citeyearpar{van2010}'))
      .toEqual(['Agrawal et al. (2019)', '(Armstrong and Kolesár, 2018)', 'van der Vaart 2010', 'van der Vaart, 2010', '2010', '(2010)']);
  });

  it('places notes, separates works and merges the years of consecutive works by the same authors', () => {
    expect(format('\\citep[see][p.~3]{agrawal2019,armstrong2018}')).toEqual(['(see Agrawal et al., 2019; Armstrong and Kolesár, 2018, p. 3)']);
    expect(format('\\citep{agrawal2019,agrawal2020}')).toEqual(['(Agrawal et al., 2019, 2020)']);
    expect(format('\\citet[ch.~1]{agrawal2019,van2010}')).toEqual(['Agrawal et al. (2019); van der Vaart (2010, ch. 1)']);
  });

  it('names every author when starred, capitalises when asked, and prints ? for a work the compile did not record', () => {
    expect(format('\\citet*{agrawal2019} \\Citet{van2010} \\citep{agrawal2019,missing}'))
      .toEqual(['Agrawal, Avadhanula, Goyal, and Zeevi (2019)', 'Van der Vaart (2010)', '(Agrawal et al., 2019; ?)']);
  });

  it('numbers citations in numeric styles', () => {
    expect(format('\\citep[p.~3]{agrawal2019,armstrong2018} \\cite{missing}', false)).toEqual(['[1, 3, p. 3]', '[?]']);
  });
});

describe('citationOverlays', () => {
  it('draws citations in the link colour, missing ones as warnings, with the authors on hover', () => {
    const text = 'See~\\citet{agrawal2019} and \\citep{missing}.';
    const overlays = citationOverlays(find(text), citations);
    expect(drawn(text, overlays)).toBe('See[\u00a0Agrawal et al. (2019)] and !**(?)**!.');
    expect(overlays[0].hover).toEqual(['agrawal2019: Agrawal, Avadhanula, Goyal, and Zeevi (2019)']);
    expect(overlays[1].hover?.[0]).toMatch(/^missing: not in the last compile/);
  });

  it('tells a numeric style from the citations the compile recorded', () => {
    const numeric = new Map([['agrawal2019', { number: '7' }]]);
    expect(drawn('\\citep{agrawal2019}', citationOverlays(find('\\citep{agrawal2019}'), numeric))).toBe('[[7]]');
  });

  it('leaves citations as source when the compile recorded none', () => {
    expect(citationOverlays(find('\\citep{agrawal2019}'), new Map())).toEqual([]);
  });
});
