import { findMatchingBrace, sanitizeLatexForParsing } from '../snippets/engine/latexContext';
import type { MathJaxMacros } from './mathRenderer';

const DEFINITION = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def)(\*?)(?![A-Za-z])/g;

/**
 * Reads the macros a project defines, in the form MathJax takes them, so formulas using a
 * project's own notation render instead of failing. Covers \newcommand and its siblings,
 * \DeclareMathOperator and simple \def; anything else is skipped rather than guessed at.
 */
export function parseMacroDefinitions(text: string, source = sanitizeLatexForParsing(text, undefined, false)): MathJaxMacros {
  const macros: MathJaxMacros = {};
  let match: RegExpExecArray | null;
  DEFINITION.lastIndex = 0;
  while ((match = DEFINITION.exec(source)) !== null) {
    const [whole, command, star] = match;
    const named = readName(source, match.index + whole.length);
    if (!named) continue;
    const definition = command === 'def'
      ? readDefBody(source, named.next)
      : command === 'DeclareMathOperator'
        ? readOperatorBody(source, named.next, star === '*')
        : readCommandBody(source, named.next);
    if (!definition) continue;
    macros[named.name] = definition.value;
    DEFINITION.lastIndex = definition.next;
  }
  return macros;
}

interface Read<T> {
  value: T;
  next: number;
}

function skipSpaces(source: string, index: number): number {
  while (index < source.length && /\s/.test(source[index])) index++;
  return index;
}

/** `\name` or `{\name}`. Only letter names, which are what user macros are in practice. */
function readName(source: string, index: number): { name: string; next: number } | undefined {
  index = skipSpaces(source, index);
  let raw: string;
  let next: number;
  if (source[index] === '{') {
    const close = findMatchingBrace(source, index);
    if (close === -1) return undefined;
    raw = source.slice(index + 1, close).trim();
    next = close + 1;
  } else {
    raw = /^\\[A-Za-z]+/.exec(source.slice(index))?.[0] ?? '';
    next = index + raw.length;
  }
  const name = /^\\([A-Za-z]+)$/.exec(raw)?.[1];
  return name ? { name, next } : undefined;
}

function readGroup(source: string, index: number): Read<string> | undefined {
  index = skipSpaces(source, index);
  if (source[index] !== '{') return undefined;
  const close = findMatchingBrace(source, index);
  return close === -1 ? undefined : { value: source.slice(index + 1, close), next: close + 1 };
}

function readOptional(source: string, index: number): Read<string> | undefined {
  index = skipSpaces(source, index);
  if (source[index] !== '[') return undefined;
  const close = source.indexOf(']', index);
  return close === -1 ? undefined : { value: source.slice(index + 1, close), next: close + 1 };
}

/** `[n][default]{body}` after \newcommand, \renewcommand or \providecommand. */
function readCommandBody(source: string, index: number): Read<MathJaxMacros[string]> | undefined {
  const count = readOptional(source, index);
  const args = count ? Number(count.value.trim()) : 0;
  if (!Number.isInteger(args) || args < 0 || args > 9) return undefined;
  const fallback = count ? readOptional(source, count.next) : undefined;
  const body = readGroup(source, (fallback ?? count)?.next ?? index);
  if (!body) return undefined;
  const value: MathJaxMacros[string] = args === 0
    ? body.value
    : fallback ? [body.value, args, fallback.value] : [body.value, args];
  return { value, next: body.next };
}

function readOperatorBody(source: string, index: number, limits: boolean): Read<string> | undefined {
  const body = readGroup(source, index);
  return body && { value: `\\operatorname${limits ? '*' : ''}{${body.value}}`, next: body.next };
}

/** `\def\name#1#2{body}`: the parameter text is only counted, so delimited parameters are skipped. */
function readDefBody(source: string, index: number): Read<MathJaxMacros[string]> | undefined {
  const open = source.indexOf('{', index);
  if (open === -1) return undefined;
  const parameters = source.slice(index, open);
  if (!/^(\s*#[1-9])*\s*$/.test(parameters)) return undefined;
  const body = readGroup(source, open);
  if (!body) return undefined;
  const args = (parameters.match(/#/g) ?? []).length;
  return { value: args ? [body.value, args] : body.value, next: body.next };
}
