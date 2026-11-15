/**
 * Text Overleaf cannot store. Its document updater replaces every UTF-16 surrogate in inserted text
 * with U+FFFD (UpdateManager._sanitizeUpdate), so a character outside the Basic Multilingual Plane -
 * a mathematical letter such as 𝓘, or an emoji - never survives an upload: an update sent with a
 * hash of the intended text is rejected as 'Invalid hash', and one sent without is stored mangled.
 */

export interface UnsupportedCharacter {
  character: string;
  /** 1-based. */
  line: number;
}

// A whole astral character, or a lone surrogate, which Overleaf replaces just the same.
const UNSUPPORTED = /[\u{10000}-\u{10FFFF}]|[\uD800-\uDFFF]/gu;

/** Every character in `text` that Overleaf cannot store, in order. */
export function findUnsupportedCharacters(text: string): UnsupportedCharacter[] {
  const found: UnsupportedCharacter[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(UNSUPPORTED)) found.push({ character: match[0], line: index + 1 });
  }
  return found;
}

/**
 * Why `relPath` cannot be uploaded, naming each character with its lines and a replacement Overleaf
 * can store; undefined when the text has nothing Overleaf would change.
 */
export function unsupportedCharactersMessage(relPath: string, text: string): string | undefined {
  const found = findUnsupportedCharacters(text);
  if (found.length === 0) return undefined;
  const lines = new Map<string, number[]>();
  for (const { character, line } of found) {
    const seen = lines.get(character) ?? [];
    if (!seen.includes(line)) seen.push(line);
    lines.set(character, seen);
  }
  const listed = [...lines].slice(0, 4).map(([character, at]) => `${display(character)} (line${at.length === 1 ? '' : 's'} ${listLines(at)})`);
  const more = lines.size > 4 ? `, and ${lines.size - 4} other${lines.size === 5 ? '' : 's'}` : '';
  const suggestions = [...lines.keys()].flatMap((character) => {
    const replacement = replacementFor(character);
    return replacement ? [`${character} with ${replacement}`] : [];
  }).slice(0, 4);
  return `${relPath} contains characters Overleaf cannot store: ${listed.join(', ')}${more}. `
    + 'Overleaf replaces characters outside Unicode\'s Basic Multilingual Plane, such as mathematical letters and emoji, '
    + 'so it would reject the upload. '
    + (suggestions.length > 0 ? `Replace them, for example ${suggestions.join('; ')}.` : 'Replace or remove them.');
}

function display(character: string): string {
  const code = character.codePointAt(0)!;
  return `${code >= 0xD800 && code <= 0xDFFF ? 'a broken character' : character} U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

function listLines(lines: number[]): string {
  const shown = lines.slice(0, 3).join(', ');
  return lines.length > 3 ? `${shown} and ${lines.length - 3} more` : shown;
}

/** The letterlike characters Unicode encodes for these styles instead of a mathematical letter. */
const SCRIPT_LETTERLIKE: Record<string, string> = { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' };
const FRAKTUR_LETTERLIKE: Record<string, string> = { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' };
const DOUBLE_STRUCK_LETTERLIKE: Record<string, string> = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };

/** The Latin alphabets of Mathematical Alphanumeric Symbols: 26 capitals, then 26 small letters. */
const MATH_ALPHABETS: ReadonlyArray<{ start: number; command: string; letterlike?: Record<string, string> }> = [
  { start: 0x1D400, command: 'mathbf' },
  { start: 0x1D434, command: 'mathit', letterlike: { h: 'ℎ' } },
  { start: 0x1D468, command: 'boldsymbol' },
  { start: 0x1D49C, command: 'mathcal', letterlike: SCRIPT_LETTERLIKE },
  { start: 0x1D4D0, command: 'mathcal', letterlike: SCRIPT_LETTERLIKE },
  { start: 0x1D504, command: 'mathfrak', letterlike: FRAKTUR_LETTERLIKE },
  { start: 0x1D538, command: 'mathbb', letterlike: DOUBLE_STRUCK_LETTERLIKE },
  { start: 0x1D56C, command: 'mathfrak', letterlike: FRAKTUR_LETTERLIKE },
  { start: 0x1D5A0, command: 'mathsf' },
  { start: 0x1D5D4, command: 'mathsf' },
  { start: 0x1D608, command: 'mathsf' },
  { start: 0x1D63C, command: 'mathsf' },
  { start: 0x1D670, command: 'mathtt' }
];

/**
 * A stand-in for a mathematical letter or digit: the look-alike Unicode encodes in the Basic
 * Multilingual Plane when there is one, and the LaTeX command for the letter.
 */
function replacementFor(character: string): string | undefined {
  const code = character.codePointAt(0)!;
  // Mathematical digits come in five styles of ten, from bold to monospace.
  if (code >= 0x1D7CE && code <= 0x1D7FF) return String((code - 0x1D7CE) % 10);
  const alphabet = MATH_ALPHABETS.find(({ start }) => code >= start && code < start + 52);
  if (!alphabet) return undefined;
  const offset = code - alphabet.start;
  const letter = String.fromCharCode(offset < 26 ? 0x41 + offset : 0x61 + offset - 26);
  const lookalike = alphabet.letterlike?.[letter];
  const command = `\\${alphabet.command}{${letter}}`;
  return lookalike ? `${lookalike} or ${command}` : command;
}
