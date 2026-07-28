import { promises as fs } from "node:fs";
import * as path from "node:path";
import { BEAMER_DEFAULT_SETTINGS, STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import type { BeamerSettings, DocumentKind, WorkspaceTemplateState } from "./types";
import { exists, extractDocumentclassDeclaration, isChapterCapableClass, isSubpath, stripTexComments, workspaceRel } from "./utils";

export const TEMPLATE_METADATA_REL = ".latex-editing-toolkit/template.json";
export const BEAMER_CONFIG_DIR = ".latex-editing-toolkit";
export const BEAMER_CLASS_OPTIONS_FILE = `${BEAMER_CONFIG_DIR}/beamer-class-options.tex`;
export const BEAMER_SETTINGS_FILE = `${BEAMER_CONFIG_DIR}/beamer-settings.tex`;

const BEAMER_TEMPLATE_IDS = new Set(["beamer-uchicago", "beamer-blei", "beamer-gotham"]);

export interface TemplateMetadata {
  version: 1;
  kind: Exclude<DocumentKind, "unknown">;
  templateId: string;
  target: string;
  assetVersion: "bundled";
}

export function templateMetadataPath(rootDir: string): string {
  return path.join(rootDir, TEMPLATE_METADATA_REL);
}

export function beamerConfigPaths(rootDir: string, targetRel: string): { dir: string; classOptions: string; settings: string } {
  const targetDir = path.dirname(path.resolve(rootDir, targetRel));
  const dir = path.join(targetDir, BEAMER_CONFIG_DIR);
  return {
    dir,
    classOptions: path.join(dir, path.basename(BEAMER_CLASS_OPTIONS_FILE)),
    settings: path.join(dir, path.basename(BEAMER_SETTINGS_FILE))
  };
}

export async function readTemplateMetadata(rootDir: string): Promise<TemplateMetadata | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(templateMetadataPath(rootDir), "utf8")) as Partial<TemplateMetadata>;
    if (parsed.version !== 1 || typeof parsed.kind !== "string" || typeof parsed.templateId !== "string" || typeof parsed.target !== "string") return null;
    if (parsed.kind !== "book" && parsed.kind !== "article" && parsed.kind !== "beamer") return null;
    return {
      version: 1,
      kind: parsed.kind,
      templateId: parsed.templateId,
      target: parsed.target,
      assetVersion: "bundled"
    };
  } catch {
    return null;
  }
}

export async function writeTemplateMetadata(rootDir: string, metadata: Omit<TemplateMetadata, "version" | "assetVersion">): Promise<void> {
  const target = templateMetadataPath(rootDir);
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify({ version: 1, ...metadata, assetVersion: "bundled" }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export function starterTemplate(templateId: string) {
  return STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === templateId);
}

export function detectTemplateFromSource(text: string): WorkspaceTemplateState {
  const clean = stripTexComments(text);
  const declaration = extractDocumentclassDeclaration(clean);
  const className = declaration?.className || "";
  if (className === "beamer") {
    if (/\\usetheme\s*\{\s*blei\s*\}/i.test(clean)) return exactBeamer("beamer-blei");
    if (/\\usetheme\s*\{\s*gotham\s*\}/i.test(clean)) return exactBeamer("beamer-gotham");
    if (/\\usepackage(?:\[[^\]]*\])?\s*\{\s*Ritsumeikan\s*\}/i.test(clean)) return exactBeamer("beamer-uchicago");
    return {
      kind: "beamer",
      templateId: "beamer-generic",
      detectionSource: "source",
      confidence: "probable",
      warning: "Beamer document detected, but no bundled child theme was identified."
    };
  }
  if (isChapterCapableClass(className)) return { kind: "book", templateId: "book-minimal", detectionSource: "source", confidence: "probable" };
  if (className) return { kind: "article", templateId: "article-minimal", detectionSource: "source", confidence: "probable" };
  return { kind: "unknown", templateId: "unknown", detectionSource: "unknown", confidence: "unknown" };
}

export async function detectWorkspaceTemplate(rootDir: string, targetRel: string): Promise<WorkspaceTemplateState> {
  const metadata = await readTemplateMetadata(rootDir);
  let sourceState: WorkspaceTemplateState = { kind: "unknown", templateId: "unknown", detectionSource: "unknown", confidence: "unknown" };
  try {
    sourceState = detectTemplateFromSource(await fs.readFile(path.resolve(rootDir, targetRel), "utf8"));
  } catch {
    // A missing target is handled by the normal compile diagnostics.
  }
  if (!metadata) return withBeamerAssetDiagnostics(rootDir, targetRel, sourceState);
  const metadataTarget = path.resolve(rootDir, metadata.target);
  const currentTarget = path.resolve(rootDir, targetRel);
  if (!isSubpath(metadataTarget, rootDir) || metadataTarget !== currentTarget) {
    return withBeamerAssetDiagnostics(rootDir, targetRel, sourceState);
  }

  const metadataState: WorkspaceTemplateState = {
    kind: metadata.kind,
    templateId: metadata.templateId,
    detectionSource: "metadata",
    confidence: BEAMER_TEMPLATE_IDS.has(metadata.templateId) || metadata.kind !== "beamer" ? "exact" : "probable"
  };
  if (sourceState.kind !== "unknown" && sourceState.kind !== metadata.kind) {
    metadataState.warning = `Template metadata says ${metadata.kind}, but the target uses ${sourceState.kind}.`;
  } else if (metadata.kind === "beamer" && sourceState.kind === "beamer" && sourceState.templateId !== "beamer-generic" && sourceState.templateId !== metadata.templateId) {
    metadataState.warning = `Template metadata says ${metadata.templateId}, but the source appears to use ${sourceState.templateId}.`;
  }
  return withBeamerAssetDiagnostics(rootDir, targetRel, metadataState);
}

async function withBeamerAssetDiagnostics(rootDir: string, targetRel: string, state: WorkspaceTemplateState): Promise<WorkspaceTemplateState> {
  if (state.kind !== "beamer") return state;
  const definition = starterTemplate(state.templateId);
  if (!definition || definition.kind !== "beamer") return state;
  const targetDir = path.dirname(path.resolve(rootDir, targetRel));
  const missingAssets: string[] = [];
  for (const asset of definition.assetManifest) {
    if (!(await exists(path.join(targetDir, asset)))) missingAssets.push(asset);
  }
  if (missingAssets.length === 0) return { ...state, assetsComplete: true, missingAssets: [] };
  const resourceWarning = `Bundled theme resources are missing: ${missingAssets.join(", ")}.`;
  return {
    ...state,
    assetsComplete: false,
    missingAssets,
    warning: state.warning ? `${state.warning} ${resourceWarning}` : resourceWarning
  };
}

export function defaultBeamerSettings(): BeamerSettings {
  return { ...BEAMER_DEFAULT_SETTINGS };
}

export function normalizeBeamerSettings(raw: unknown, base: BeamerSettings = defaultBeamerSettings()): BeamerSettings {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const aspectRatio = value.aspectRatio === "43" || value.aspectRatio === "169" ? value.aspectRatio : base.aspectRatio;
  const notesMode = value.notesMode === "show-notes" || value.notesMode === "only-notes" || value.notesMode === "hide" ? value.notesMode : base.notesMode;
  return {
    title: typeof value.title === "string" ? value.title.trim() || base.title : base.title,
    author: typeof value.author === "string" ? value.author.trim() || base.author : base.author,
    institute: typeof value.institute === "string" ? value.institute.trim() || base.institute : base.institute,
    date: typeof value.date === "string" ? value.date.trim() || base.date : base.date,
    aspectRatio,
    notesMode,
    sectionOutline: typeof value.sectionOutline === "boolean" ? value.sectionOutline : base.sectionOutline
  };
}

export async function readBeamerSettings(rootDir: string, targetRel: string, sourceText = ""): Promise<BeamerSettings> {
  const settings = defaultBeamerSettings();
  const paths = beamerConfigPaths(rootDir, targetRel);
  const classOptions = await fs.readFile(paths.classOptions, "utf8").catch(() => "");
  const runtime = await fs.readFile(paths.settings, "utf8").catch(() => "");
  const source = stripTexComments(sourceText);
  const aspect = /(aspectratio\s*=\s*(169|43)|aspectratio\s*=\s*(43|169))/i.exec(`${classOptions}\n${source}`)?.[2] || /(aspectratio\s*=\s*(43|169))/i.exec(`${classOptions}\n${source}`)?.[2];
  if (aspect === "43" || aspect === "169") settings.aspectRatio = aspect;
  settings.title = texMacro(runtime, "ToolkitBeamerTitle") || texCommand(source, "title") || settings.title;
  settings.author = texMacro(runtime, "ToolkitBeamerAuthor") || texCommand(source, "author") || settings.author;
  settings.institute = texMacro(runtime, "ToolkitBeamerInstitute") || texCommand(source, "institute") || settings.institute;
  settings.date = texMacro(runtime, "ToolkitBeamerDate") || texCommand(source, "date") || settings.date;
  if (/\\setbeameroption\s*\{\s*show\s+notes\s+on\s+second\s+screen/i.test(runtime)) settings.notesMode = "show-notes";
  else if (/\\setbeameroption\s*\{\s*show\s+only\s+notes/i.test(runtime)) settings.notesMode = "only-notes";
  settings.sectionOutline = /\\ToolkitBeamerSectionOutlinetrue/.test(runtime);
  return settings;
}

export async function writeBeamerSettings(rootDir: string, targetRel: string, settings: BeamerSettings): Promise<string[]> {
  const paths = beamerConfigPaths(rootDir, targetRel);
  await fs.mkdir(paths.dir, { recursive: true });
  await writeAtomic(paths.classOptions, renderBeamerClassOptions(settings));
  await writeAtomic(paths.settings, renderBeamerRuntimeSettings(settings));
  return [workspaceRel(rootDir, paths.classOptions), workspaceRel(rootDir, paths.settings)];
}

export function beamerHooksEnabled(sourceText: string): boolean {
  return sourceText.includes(BEAMER_CLASS_OPTIONS_FILE) && sourceText.includes(BEAMER_SETTINGS_FILE);
}

export async function enableBeamerHooks(rootDir: string, targetRel: string): Promise<void> {
  const target = path.resolve(rootDir, targetRel);
  const source = await fs.readFile(target, "utf8");
  if (beamerHooksEnabled(source)) return;
  const classHook = `\\IfFileExists{${BEAMER_CLASS_OPTIONS_FILE}}{\\input{${BEAMER_CLASS_OPTIONS_FILE}}}{}`;
  const runtimeHook = [
    `\\IfFileExists{${BEAMER_SETTINGS_FILE}}{\\input{${BEAMER_SETTINGS_FILE}}}{}`,
    "\\title{\\ToolkitBeamerTitle}",
    "\\author{\\ToolkitBeamerAuthor}",
    "\\institute{\\ToolkitBeamerInstitute}",
    "\\date{\\ToolkitBeamerDate}"
  ].join("\n");
  let updated = source;
  if (!updated.includes(BEAMER_CLASS_OPTIONS_FILE)) {
    const documentClass = /\\documentclass(?:\[[^\]]*\])?\{\s*beamer\s*\}/i.exec(updated);
    if (documentClass?.index !== undefined) updated = `${updated.slice(0, documentClass.index)}${classHook}\n${updated.slice(documentClass.index)}`;
  }
  if (!updated.includes(BEAMER_SETTINGS_FILE)) {
    const beginDocument = /\\begin\s*\{document\}/i.exec(updated);
    if (beginDocument?.index !== undefined) updated = `${updated.slice(0, beginDocument.index)}${runtimeHook}\n\n${updated.slice(beginDocument.index)}`;
  }
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temporary, updated, "utf8");
  await fs.rename(temporary, target);
}

export function renderBeamerClassOptions(settings: BeamerSettings): string {
  return [
    "% Generated by LaTeX Editing Toolkit. Edit Presentation settings in Toolkit.",
    `\\PassOptionsToClass{aspectratio=${settings.aspectRatio}}{beamer}`,
    ""
  ].join("\n");
}

export function renderBeamerRuntimeSettings(settings: BeamerSettings): string {
  const notes = settings.notesMode === "show-notes"
    ? "\\setbeameroption{show notes on second screen=right}"
    : settings.notesMode === "only-notes"
      ? "\\setbeameroption{show only notes}"
      : "\\setbeameroption{hide notes}";
  const outline = settings.sectionOutline
    ? [
      "\\ToolkitBeamerSectionOutlinetrue",
      "\\AtBeginSection[]{",
      "  \\begin{frame}{Outline}",
      "    \\tableofcontents[currentsection]",
      "  \\end{frame}",
      "}"
    ]
    : ["\\ToolkitBeamerSectionOutlinefalse"];
  return [
    "% Generated by LaTeX Editing Toolkit. Edit Presentation settings in Toolkit.",
    `\\def\\ToolkitBeamerTitle{${escapeTexValue(settings.title)}}`,
    `\\def\\ToolkitBeamerAuthor{${escapeTexValue(settings.author)}}`,
    `\\def\\ToolkitBeamerInstitute{${escapeTexValue(settings.institute)}}`,
    `\\def\\ToolkitBeamerDate{${escapeTexValue(settings.date)}}`,
    "\\newif\\ifToolkitBeamerSectionOutline",
    ...outline,
    notes,
    ""
  ].join("\n");
}

function exactBeamer(templateId: string): WorkspaceTemplateState {
  return { kind: "beamer", templateId, detectionSource: "source", confidence: "exact" };
}

function texMacro(text: string, name: string): string {
  return new RegExp(`\\\\def\\\\${name}\\{([^}]*)\\}`, "i").exec(text)?.[1]?.trim() || "";
}

function texCommand(text: string, name: string): string {
  return new RegExp(`\\\\${name}\\s*\\{([^}]*)\\}`, "i").exec(text)?.[1]?.trim() || "";
}

function escapeTexValue(value: string): string {
  return String(value || "").replace(/[\r\n{}]/g, " ").replace(/(?<!\\)%/g, "\\%");
}

async function writeAtomic(target: string, text: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temporary, text, "utf8");
  await fs.rename(temporary, target);
}
