import { promises as fs } from "node:fs";
import * as path from "node:path";
import { HOMEWORK_DEFAULT_SETTINGS } from "./schema";
import type { HomeworkNumberStyle, HomeworkSettings } from "./types";
import { escapeTexValue, texArgument, texMacro, unescapeTexValue, writeAtomic } from "./texValue";
import { stripTexComments, TOOLKIT_CONFIG_DIR, workspaceRel } from "./utils";

export const HOMEWORK_SETTINGS_FILE = `${TOOLKIT_CONFIG_DIR}/homework-settings.tex`;

export const HOMEWORK_NUMBER_STYLES: HomeworkNumberStyle[] = ["arabic", "alph", "Alph", "roman", "Roman"];

/**
 * Same rule the LaTeX side enforces (see the bad-number regex in homework.sty): an
 * explicit number or prefix is an integer or a dotted run of integers. Validating here
 * as well is what stops the panel from writing a value that only fails at compile time.
 */
const DOTTED_INTEGER = /^-?\d+(\.\d+)*$/;

export function isHomeworkNumberPrefix(value: unknown): value is string {
  return typeof value === "string" && (value.trim() === "" || DOTTED_INTEGER.test(value.trim()));
}

export function isHomeworkNumberStyle(value: unknown): value is HomeworkNumberStyle {
  return typeof value === "string" && (HOMEWORK_NUMBER_STYLES as string[]).includes(value);
}

export function homeworkSettingsPath(rootDir: string, targetRel: string): string {
  const targetDir = path.dirname(path.resolve(rootDir, targetRel));
  return path.join(targetDir, TOOLKIT_CONFIG_DIR, path.basename(HOMEWORK_SETTINGS_FILE));
}

export function defaultHomeworkSettings(): HomeworkSettings {
  return { ...HOMEWORK_DEFAULT_SETTINGS };
}

export function normalizeHomeworkSettings(raw: unknown, base: HomeworkSettings = defaultHomeworkSettings()): HomeworkSettings {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const text = (key: string, fallback: string): string => (typeof value[key] === "string" ? (value[key] as string).trim() || fallback : fallback);
  return {
    course: text("course", base.course),
    title: text("title", base.title),
    author: text("author", base.author),
    instructor: text("instructor", base.instructor),
    dueDate: text("dueDate", base.dueDate),
    // An empty heading word is meaningful: it prints the bare number.
    problemWord: typeof value.problemWord === "string" ? value.problemWord.trim() : base.problemWord,
    sectionWord: typeof value.sectionWord === "string" ? value.sectionWord.trim() : base.sectionWord,
    problemStyle: isHomeworkNumberStyle(value.problemStyle) ? value.problemStyle : base.problemStyle,
    sectionStyle: isHomeworkNumberStyle(value.sectionStyle) ? value.sectionStyle : base.sectionStyle,
    problemPrefix: isHomeworkNumberPrefix(value.problemPrefix) ? (value.problemPrefix as string).trim() : base.problemPrefix,
    sectionMode: value.sectionMode === "nested" || value.sectionMode === "standalone" ? value.sectionMode : base.sectionMode
  };
}

export async function readHomeworkSettings(rootDir: string, targetRel: string): Promise<HomeworkSettings> {
  const settings = defaultHomeworkSettings();
  const generated = await fs.readFile(homeworkSettingsPath(rootDir, targetRel), "utf8").catch(() => "");
  if (!generated) return settings;
  const metadata = (macro: string, fallback: string): string => unescapeTexValue(texMacro(generated, macro)) || fallback;
  settings.course = metadata("ToolkitHomeworkCourse", settings.course);
  settings.title = metadata("ToolkitHomeworkTitle", settings.title);
  settings.author = metadata("ToolkitHomeworkAuthor", settings.author);
  settings.instructor = metadata("ToolkitHomeworkInstructor", settings.instructor);
  settings.dueDate = metadata("ToolkitHomeworkDueDate", settings.dueDate);

  // \renewcommand{\homeworkProblemName}{...} — an empty body is a real choice, so the
  // match has to be distinguished from "not present at all" rather than coalesced away.
  const word = (name: string, fallback: string): string => {
    const match = new RegExp(`\\\\renewcommand\\s*\\{\\\\${name}\\}\\s*\\{([^}]*)\\}`).exec(generated);
    return match ? unescapeTexValue(match[1].trim()) : fallback;
  };
  settings.problemWord = word("homeworkProblemName", settings.problemWord);
  settings.sectionWord = word("homeworkSectionName", settings.sectionWord);

  const problemStyle = texArgument(generated, "homeworkProblemNumbering");
  if (isHomeworkNumberStyle(problemStyle)) settings.problemStyle = problemStyle;
  const sectionStyle = texArgument(generated, "homeworkSectionNumbering");
  if (isHomeworkNumberStyle(sectionStyle)) settings.sectionStyle = sectionStyle;

  const prefix = texArgument(generated, "homeworkProblemPrefix");
  if (isHomeworkNumberPrefix(prefix)) settings.problemPrefix = prefix;

  settings.sectionMode = /\\homeworkSectionNested\b/.test(generated) ? "nested" : "standalone";
  return settings;
}

export async function writeHomeworkSettings(rootDir: string, targetRel: string, settings: HomeworkSettings): Promise<string[]> {
  const target = homeworkSettingsPath(rootDir, targetRel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeAtomic(target, renderHomeworkSettings(settings));
  return [workspaceRel(rootDir, target)];
}

export function renderHomeworkSettings(settings: HomeworkSettings): string {
  return [
    "% Generated by LaTeX Editing Toolkit. Edit Homework settings in Toolkit.",
    `\\def\\ToolkitHomeworkCourse{${escapeTexValue(settings.course)}}`,
    `\\def\\ToolkitHomeworkTitle{${escapeTexValue(settings.title)}}`,
    `\\def\\ToolkitHomeworkAuthor{${escapeTexValue(settings.author)}}`,
    `\\def\\ToolkitHomeworkInstructor{${escapeTexValue(settings.instructor)}}`,
    `\\def\\ToolkitHomeworkDueDate{${escapeTexValue(settings.dueDate)}}`,
    `\\renewcommand{\\homeworkProblemName}{${escapeTexValue(settings.problemWord)}}`,
    `\\renewcommand{\\homeworkSectionName}{${escapeTexValue(settings.sectionWord)}}`,
    `\\homeworkProblemNumbering{${settings.problemStyle}}`,
    `\\homeworkSectionNumbering{${settings.sectionStyle}}`,
    `\\homeworkProblemPrefix{${settings.problemPrefix}}`,
    settings.sectionMode === "nested" ? "\\homeworkSectionNested" : "\\homeworkSectionStandalone",
    ""
  ].join("\n");
}

/**
 * True when the target carries its own copy of the machinery, from a starter generated
 * before homework.sty existed. The package cannot load alongside it — \NewDocumentEnvironment
 * and \newcommand both refuse to redefine — so retrofitting the hooks would produce a
 * document that no longer compiles.
 */
export function homeworkMachineryIsInline(sourceText: string): boolean {
  const clean = stripTexComments(sourceText);
  if (/\\usepackage\s*\{\s*homework\s*\}/.test(clean)) return false;
  return [
    /\\NewDocumentEnvironment\s*\{\s*homeworkProblem\s*\}/,
    /\\newcommand\s*\{\s*\\makehomeworktitle\s*\}/,
    /\\newcounter\s*\{\s*homeworkProblemCounter\s*\}/
  ].some((pattern) => pattern.test(clean));
}

export function homeworkHooksEnabled(sourceText: string): boolean {
  // Commented-out hooks are not hooks; without stripping, a user who comments them out
  // while debugging gets a UI that claims the hooks are on and a save that does nothing.
  const clean = stripTexComments(sourceText);
  return /\\usepackage\s*\{\s*homework\s*\}/.test(clean) && clean.includes(HOMEWORK_SETTINGS_FILE);
}

export async function enableHomeworkHooks(rootDir: string, targetRel: string): Promise<void> {
  const target = path.resolve(rootDir, targetRel);
  const source = await fs.readFile(target, "utf8");
  if (homeworkHooksEnabled(source)) return;
  if (homeworkMachineryIsInline(source)) {
    throw new Error(
      `${targetRel} carries its own copy of the homework environments from an older starter, and the homework package cannot load alongside them. ` +
      "Regenerate the target from Project Setup with overwrite enabled, or delete the inline definitions first."
    );
  }
  let updated = source;
  const clean = () => stripTexComments(updated);
  if (!/\\usepackage\s*\{\s*homework\s*\}/.test(clean())) {
    // After commands.tex when it is present, so the package sits with the other Toolkit
    // includes; otherwise immediately before \begin{document}.
    const anchor = /\\input\s*\{\s*commands\.tex\s*\}/.exec(updated);
    const insertAt = anchor?.index !== undefined ? anchor.index + anchor[0].length : /\\begin\s*\{document\}/i.exec(updated)?.index;
    if (insertAt === undefined) throw new Error("Could not find a place to load the homework package in the target.");
    const text = anchor ? "\n\\usepackage{homework}" : "\\usepackage{homework}\n";
    updated = `${updated.slice(0, insertAt)}${text}${updated.slice(insertAt)}`;
  }
  if (!clean().includes(HOMEWORK_SETTINGS_FILE)) {
    const beginDocument = /\\begin\s*\{document\}/i.exec(updated);
    if (beginDocument?.index === undefined) throw new Error("Could not find \\begin{document} in the target.");
    const hook = `\\InputIfFileExists{${HOMEWORK_SETTINGS_FILE}}{}{}\n\n`;
    updated = `${updated.slice(0, beginDocument.index)}${hook}${updated.slice(beginDocument.index)}`;
  }
  await writeAtomic(target, updated);
}
