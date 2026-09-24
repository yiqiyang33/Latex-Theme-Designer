import { promises as fs } from "node:fs";

/**
 * Helpers shared by the generated-settings files (Beamer, Homework). They used to be
 * private to src/beamer.ts; homework.ts needs the same behaviour, and re-deriving
 * escapeTexValue in particular is how the `\today` double-escaping bug got introduced
 * the first time.
 */

export function escapeTexValue(value: string): string {
  // Newlines and braces cannot survive inside a \def body; the rest are TeX specials that
  // would otherwise break the document (# is a hard error at definition time) or typeset
  // as something else. A backslash is deliberately left alone: the default date is
  // \today, and escaping it would break every command a user legitimately puts here.
  // The lookbehind keeps an already-escaped special from being escaped twice.
  return String(value || "")
    .replace(/[\r\n{}]/g, " ")
    .replace(/(?<!\\)[#$%&_^~]/g, (character) => (character === "^" || character === "~" ? `\\${character}{}` : `\\${character}`));
}

export function unescapeTexValue(value: string): string {
  // Inverse of escapeTexValue, so a round trip through the generated file gives the user
  // back what they typed instead of accumulating backslashes.
  return String(value || "")
    .replace(/\\([\^~])\{\}/g, "$1")
    .replace(/\\([#$%&_])/g, "$1");
}

/** Reads back a `\def\<name>{...}` body from a generated settings file. */
export function texMacro(text: string, name: string): string {
  return new RegExp(`\\\\def\\\\${name}\\{([^}]*)\\}`, "i").exec(text)?.[1]?.trim() || "";
}

/** Reads back the single argument of a `\<name>{...}` call from a generated file. */
export function texArgument(text: string, name: string): string {
  return new RegExp(`\\\\${name}\\s*\\{([^}]*)\\}`).exec(text)?.[1]?.trim() ?? "";
}

export async function writeAtomic(target: string, text: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temporary, text, "utf8");
  await fs.rename(temporary, target);
}
