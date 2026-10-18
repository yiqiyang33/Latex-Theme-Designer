import * as path from 'node:path';
import { HOMEWORK_SETTINGS_FILE } from '../homework';
import { parseMacroDefinitions } from './macros';
import { previewSource } from './mathRegions';
import type { MathJaxMacros } from './mathRenderer';
import { emptyCrefSettings, readCrefSettings, type CrefSettings } from './references';
import { emptyTheoremSettings, readTheoremSettings, type TheoremSettings } from './structure';

/** What says a project numbers its homework with homework.sty: the package itself, an older inline copy, or loading it. */
export const HOMEWORK_PACKAGE = /\\NewDocumentEnvironment\s*\{\s*homeworkProblem\s*\}|\\usepackage\s*(?:\[[^\]]*\])?\s*\{\s*homework\s*\}/;
const SETTINGS_FILE = path.join(...HOMEWORK_SETTINGS_FILE.split('/'));

/** What the preview reads from a workspace's files, or from one of them. */
export interface WorkspaceSettings {
  macros: MathJaxMacros;
  cref: CrefSettings;
  theorems: TheoremSettings;
  /** Whether a file defines or loads homework.sty. */
  homeworkPackage: boolean;
  /** The Homework panel's settings files, by the folder whose documents they number. */
  homeworkFiles: Map<string, string>;
}

export function emptyWorkspaceSettings(): WorkspaceSettings {
  return { macros: {}, cref: emptyCrefSettings(), theorems: emptyTheoremSettings(), homeworkPackage: false, homeworkFiles: new Map() };
}

/** What one file sets, which the workspace scan keeps until the file changes. */
export function readFileSettings(file: string, text: string): WorkspaceSettings {
  const settings = emptyWorkspaceSettings();
  // One pass blanks the comments and verbatim for all three readers.
  const source = previewSource(text, 'latex');
  settings.macros = parseMacroDefinitions(text, source);
  readCrefSettings(text, settings.cref, source);
  readTheoremSettings(text, settings.theorems, source);
  settings.homeworkPackage = HOMEWORK_PACKAGE.test(text);
  if (file.endsWith(`${path.sep}${SETTINGS_FILE}`)) settings.homeworkFiles.set(file.slice(0, -SETTINGS_FILE.length - 1), text);
  return settings;
}

/** Files' settings combined in order, a later file's overriding an earlier one's as when they are read in one pass. */
export function mergeSettings(parts: Iterable<WorkspaceSettings>): WorkspaceSettings {
  const merged = emptyWorkspaceSettings();
  for (const part of parts) {
    Object.assign(merged.macros, part.macros);
    merged.cref.capitalise ||= part.cref.capitalise;
    merged.cref.noabbrev ||= part.cref.noabbrev;
    Object.assign(merged.cref.names, part.cref.names);
    Object.assign(merged.cref.capitalNames, part.cref.capitalNames);
    for (const [name, kind] of part.theorems.environments) merged.theorems.environments.set(name, kind);
    merged.theorems.themeCommands ||= part.theorems.themeCommands;
    merged.homeworkPackage ||= part.homeworkPackage;
    for (const [dir, text] of part.homeworkFiles) merged.homeworkFiles.set(dir, text);
  }
  return merged;
}

/** Changes whenever anything the preview reads from the settings does. */
export function settingsFingerprint(settings: WorkspaceSettings): string {
  const { macros, cref, theorems, homeworkPackage, homeworkFiles } = settings;
  return JSON.stringify([macros, cref, [...theorems.environments], theorems.themeCommands, homeworkPackage, [...homeworkFiles]]);
}
