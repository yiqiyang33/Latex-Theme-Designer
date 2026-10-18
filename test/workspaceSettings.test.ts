import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeSettings, readFileSettings, settingsFingerprint } from '../src/livePreview/workspaceSettings';

describe('workspace settings', () => {
  const files: Array<[string, string]> = [
    [path.join('/p', 'a.sty'), '\\newcommand{\\R}{\\mathbb{R}}\n\\usepackage[capitalise]{cleveref}\n\\newtheorem{lemma}{Lemma}\n% \\newcommand{\\gone}{x}'],
    [path.join('/p', 'main.tex'), '\\renewcommand{\\R}{\\mathbf{R}}\n\\crefname{lemma}{lem.}{lems.}\n\\newtheorem{lemma}[theorem]{Lemma}\n\\usepackage{homework}'],
    [path.join('/p', '.latex-editing-toolkit', 'homework-settings.tex'), '\\renewcommand{\\homeworkProblemName}{Question}']
  ];

  it('reads each file on its own and combines them in order, a later file overriding an earlier one', () => {
    const merged = mergeSettings(files.map(([file, text]) => readFileSettings(file, text)));
    expect(merged.macros).toEqual({ R: '\\mathbf{R}', homeworkProblemName: 'Question' });
    expect(merged.cref).toEqual({ capitalise: true, noabbrev: false, names: { lemma: ['lem.', 'lems.'] }, capitalNames: {} });
    expect(merged.theorems.environments.get('lemma')).toMatchObject({ counter: 'theorem' });
    expect(merged.homeworkPackage).toBe(true);
    expect([...merged.homeworkFiles]).toEqual([[path.join('/p'), files[2][1]]]);
  });

  it('fingerprints what the preview reads, so a change elsewhere in a file changes nothing', () => {
    const settings = (main: string) => mergeSettings([readFileSettings(files[0][0], files[0][1]), readFileSettings(files[1][0], main)]);
    const before = settingsFingerprint(settings(files[1][1]));
    expect(settingsFingerprint(settings(`${files[1][1]}\nSome text with $x$ in it.`))).toBe(before);
    expect(settingsFingerprint(settings(`${files[1][1]}\n\\newcommand{\\N}{\\mathbb{N}}`))).not.toBe(before);
  });
});
