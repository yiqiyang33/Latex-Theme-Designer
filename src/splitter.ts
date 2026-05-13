import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RenumberResult, SplitResult, SplitUnit, UnsplitResult } from "./types";
import { StateService } from "./state";
import {
  defaultCompileTarget,
  escapeRegExp,
  exists,
  extractDocumentclassDeclaration,
  isChapterCapableClass,
  isSubpath,
  normalizeCompileTarget,
  safeWorkspaceRel,
  slugify,
  stripTexComments,
  toPosixPath,
  workspaceRel
} from "./utils";

const BEGIN_DOCUMENT_PATTERN = /\\begin\s*\{document\}/;
const END_DOCUMENT_PATTERN = /\\end\s*\{document\}/;
const TOP_LEVEL_REFERENCE_PATTERN = /\\(subfile|input|include)(?:\[[^\]]*\])?\{([^}]+)\}/g;
const APPENDIX_PATTERN = /\\appendix\b/g;
const NUMERIC_PREFIX_PATTERN = /^(\d+)-(.+)$/;

interface BodyBounds {
  bodyStart: number;
  bodyEnd: number;
  beginEnd: number;
}

interface Anchor {
  start: number;
  end: number;
  title: string;
  raw: string;
}

interface Chunk {
  anchor: Anchor;
  end: number;
}

interface RootReference {
  macro: string;
  ref: string;
  start: number;
  end: number;
  path: string;
}

export class SplitterService {
  constructor(private readonly rootDir: string, private readonly stateService: StateService) {}

  async splitCompileTarget(compileTarget: string, dryRun = false, sectionsDir = "Sections"): Promise<{ response: unknown; split: SplitResult }> {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.splitTexFile(path.resolve(this.rootDir, target), sectionsDir, dryRun);
    return { response: await this.stateService.buildResponseState(), split: result };
  }

  async renumberCompileTarget(compileTarget: string, mode: string, dryRun = false): Promise<{ response: unknown; renumber: RenumberResult }> {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.renumberReferences(path.resolve(this.rootDir, target), mode, dryRun);
    return { response: await this.stateService.buildResponseState(), renumber: result };
  }

  async unsplitCompileTarget(compileTarget: string, dryRun = false, deleteSource = true): Promise<{ response: unknown; unsplit: UnsplitResult }> {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.unsplitOneUnit(path.resolve(this.rootDir, target), dryRun, deleteSource);
    return { response: await this.stateService.buildResponseState(), unsplit: result };
  }

  async splitTexFile(rootTexPath: string, sectionsDirRaw = "Sections", dryRun = false): Promise<SplitResult> {
    const rootAbs = path.resolve(rootTexPath);
    if (!isSubpath(rootAbs, this.rootDir)) throw new Error("Split target is outside workspace.");
    const originalText = await fs.readFile(rootAbs, "utf8");
    const declaration = extractDocumentclassDeclaration(originalText);
    if (!declaration) throw new Error("Split source must contain a \\documentclass declaration.");
    if (declaration.className === "subfiles") throw new Error("Split source must be a root target, not a subfiles unit.");
    const splitCommand = isChapterCapableClass(declaration.className) ? "chapter" : "section";
    const bounds = this.findBodyBounds(originalText);
    const body = originalText.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path.dirname(rootAbs), body);
    const anchors = this.findTopLevelAnchors(body, splitCommand);
    const chunks = this.computeChunks(body, anchors, refs);
    const appendixStart = this.firstAppendixStart(body);

    const existingPrefixMax = this.highestExistingPrefix(refs);
    const mutableChunks = chunks
      .filter((chunk) => appendixStart === -1 || chunk.anchor.start < appendixStart)
      .map((chunk) => ({
        ...chunk,
        end: appendixStart !== -1 && chunk.end > appendixStart ? appendixStart : chunk.end
      }));
    const newChunks = mutableChunks.filter((chunk) => !this.chunkOverlapsRefs(chunk, refs));
    const warnings: string[] = [];
    if (newChunks.length === 0) {
      return {
        success: true,
        dry_run: dryRun,
        already_split: refs.length > 0,
        document_class: declaration.className,
        split_command: splitCommand,
        standalone_mode: "subfiles",
        include_macro: "\\subfile",
        subfiles_package_injected: false,
        backup_path: "",
        generated_subfile_targets: [],
        updated_files: [],
        units: [],
        warnings: refs.length > 0 ? ["No new top-level anchors found outside existing references."] : ["No split anchors found."]
      };
    }

    const sectionsRel = this.normalizeSectionsDir(sectionsDirRaw);
    const sectionsAbs = path.resolve(path.dirname(rootAbs), sectionsRel);
    if (!isSubpath(sectionsAbs, this.rootDir)) throw new Error("Sections directory is outside workspace.");
    const seenSlugs = new Map<string, number>();
    const units: SplitUnit[] = [];
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    let index = existingPrefixMax + 1;
    for (const chunk of newChunks) {
      const slug = this.stableSlug(chunk.anchor.title, seenSlugs);
      let unitPath: string;
      do {
        unitPath = path.join(sectionsAbs, `${String(index).padStart(2, "0")}-${slug}.tex`);
        index += 1;
      } while (await exists(unitPath));
      const ref = this.relativeTexReference(path.dirname(rootAbs), unitPath);
      units.push({ path: workspaceRel(this.rootDir, unitPath), title: chunk.anchor.title, reference: ref });
      replacements.push({ start: chunk.anchor.start, end: chunk.end, text: `\\subfile{${ref.replace(/\.tex$/i, "")}}\n` });
    }

    const preamblePlusBegin = originalText.slice(0, bounds.bodyStart);
    const injectResult = this.injectSubfilesPackage(preamblePlusBegin);
    const newBody = this.applyReplacements(body, replacements);
    const rewritten = `${injectResult.text}${newBody}${originalText.slice(bounds.bodyEnd)}`;
    const backupPath = await this.nextBackupPath(rootAbs);
    const updatedFiles = [workspaceRel(this.rootDir, rootAbs), ...units.map((unit) => unit.path)];
    if (!dryRun) {
      await fs.mkdir(sectionsAbs, { recursive: true });
      await fs.copyFile(rootAbs, backupPath);
      await fs.writeFile(rootAbs, rewritten, "utf8");
      for (const unit of units) {
        const unitAbs = path.resolve(this.rootDir, unit.path);
        const chunk = newChunks[units.indexOf(unit)];
        await fs.writeFile(unitAbs, this.buildSubfileUnitText(rootAbs, unitAbs, body.slice(chunk.anchor.start, chunk.end)), "utf8");
      }
    }
    return {
      success: true,
      dry_run: dryRun,
      already_split: false,
      document_class: declaration.className,
      split_command: splitCommand,
      standalone_mode: "subfiles",
      include_macro: "\\subfile",
      subfiles_package_injected: injectResult.injected,
      backup_path: dryRun ? "" : workspaceRel(this.rootDir, backupPath),
      generated_subfile_targets: units.map((unit) => unit.path),
      updated_files: dryRun ? [] : updatedFiles,
      units,
      warnings
    };
  }

  async renumberReferences(rootTexPath: string, modeRaw: string, dryRun = false): Promise<RenumberResult> {
    const mode = modeRaw === "remove" ? "remove" : "add";
    const rootAbs = path.resolve(rootTexPath);
    const text = await fs.readFile(rootAbs, "utf8");
    const bounds = this.findBodyBounds(text);
    const body = text.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path.dirname(rootAbs), body);
    const renameMap = new Map<string, string>();
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    const warnings: string[] = [];
    let counter = 1;
    for (const ref of refs) {
      const ext = path.extname(ref.path);
      const dir = path.dirname(ref.path);
      const stem = path.basename(ref.path, ext);
      const match = NUMERIC_PREFIX_PATTERN.exec(stem);
      let newStem: string;
      if (mode === "add") {
        newStem = match ? stem : `${String(counter).padStart(2, "0")}-${stem}`;
        counter += 1;
      } else {
        newStem = match ? match[2] : stem;
      }
      const newPath = path.join(dir, `${newStem}${ext || ".tex"}`);
      if (newPath !== ref.path) {
        if (await exists(newPath)) {
          warnings.push(`Skipped rename because target exists: ${workspaceRel(this.rootDir, newPath)}`);
          continue;
        }
        renameMap.set(ref.path, newPath);
        const newRef = this.relativeTexReference(path.dirname(rootAbs), newPath).replace(/\.tex$/i, "");
        replacements.push({ start: ref.start, end: ref.end, text: `\\${ref.macro}{${newRef}}` });
      }
    }
    const rewritten = `${text.slice(0, bounds.bodyStart)}${this.applyReplacements(body, replacements)}${text.slice(bounds.bodyEnd)}`;
    if (!dryRun) {
      for (const [from, to] of renameMap) await fs.rename(from, to);
      if (replacements.length > 0) await fs.writeFile(rootAbs, rewritten, "utf8");
    }
    return {
      success: true,
      dry_run: dryRun,
      mode,
      root_target: workspaceRel(this.rootDir, rootAbs),
      renamed: Object.fromEntries(Array.from(renameMap.entries()).map(([from, to]) => [workspaceRel(this.rootDir, from), workspaceRel(this.rootDir, to)])),
      updated_files: dryRun || replacements.length === 0 ? [] : [workspaceRel(this.rootDir, rootAbs)],
      warnings
    };
  }

  async unsplitOneUnit(unitPath: string, dryRun = false, deleteSource = true): Promise<UnsplitResult> {
    const unitAbs = path.resolve(unitPath);
    const unitText = await fs.readFile(unitAbs, "utf8");
    const declaration = extractDocumentclassDeclaration(unitText);
    if (!declaration || declaration.className !== "subfiles") throw new Error("Selected target is not a subfiles unit.");
    const parentRef = declaration.options.split(",")[0]?.trim();
    if (!parentRef) throw new Error("Subfiles unit is missing parent root reference.");
    const rootAbs = path.resolve(path.dirname(unitAbs), parentRef);
    if (!isSubpath(rootAbs, this.rootDir)) throw new Error("Parent root is outside workspace.");
    const rootText = await fs.readFile(rootAbs, "utf8");
    const bounds = this.findBodyBounds(rootText);
    const body = rootText.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path.dirname(rootAbs), body);
    const matching = refs.find((ref) => path.resolve(ref.path) === unitAbs);
    if (!matching) throw new Error("Could not find matching \\subfile reference in parent root.");
    const unitBody = this.extractUnitBody(unitText);
    const replacement = unitBody.endsWith("\n") ? unitBody : `${unitBody}\n`;
    const newBody = `${body.slice(0, matching.start)}${replacement}${body.slice(matching.end)}`;
    const updated = [workspaceRel(this.rootDir, rootAbs)];
    if (!dryRun) {
      await fs.writeFile(rootAbs, `${rootText.slice(0, bounds.bodyStart)}${newBody}${rootText.slice(bounds.bodyEnd)}`, "utf8");
      if (deleteSource) {
        await fs.unlink(unitAbs);
        updated.push(workspaceRel(this.rootDir, unitAbs));
      }
    }
    return {
      success: true,
      dry_run: dryRun,
      root_target: workspaceRel(this.rootDir, rootAbs),
      source_target: workspaceRel(this.rootDir, unitAbs),
      delete_source: deleteSource,
      updated_files: dryRun ? [] : updated,
      warnings: []
    };
  }

  private findBodyBounds(texText: string): BodyBounds {
    const begin = BEGIN_DOCUMENT_PATTERN.exec(texText);
    const end = END_DOCUMENT_PATTERN.exec(texText);
    if (!begin || !end || begin.index > end.index) throw new Error("Could not find a valid document body.");
    return { bodyStart: begin.index + begin[0].length, bodyEnd: end.index, beginEnd: begin.index + begin[0].length };
  }

  private findTopLevelAnchors(body: string, command: string): Anchor[] {
    const anchors: Anchor[] = [];
    const pattern = new RegExp(`\\\\${escapeRegExp(command)}(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const groupStart = pattern.lastIndex - 1;
      const parsed = this.parseBalancedGroup(body, groupStart);
      if (!parsed) continue;
      anchors.push({ start: match.index, end: parsed.end, title: parsed.content.trim(), raw: body.slice(match.index, parsed.end) });
      pattern.lastIndex = parsed.end;
    }
    return anchors;
  }

  private computeChunks(body: string, anchors: Anchor[], refs: RootReference[]): Chunk[] {
    return anchors.map((anchor, index) => {
      let end = index + 1 < anchors.length ? anchors[index + 1].start : body.length;
      const nextRef = refs.filter((ref) => ref.start > anchor.start).sort((a, b) => a.start - b.start)[0];
      if (nextRef && nextRef.start < end) end = nextRef.start;
      return { anchor, end };
    });
  }

  private firstAppendixStart(body: string): number {
    const match = APPENDIX_PATTERN.exec(body);
    APPENDIX_PATTERN.lastIndex = 0;
    return match?.index ?? -1;
  }

  private extractTopLevelReferences(baseDir: string, body: string): RootReference[] {
    const refs: RootReference[] = [];
    for (const match of body.matchAll(TOP_LEVEL_REFERENCE_PATTERN)) {
      const macro = match[1];
      const ref = match[2].trim();
      let target = ref.endsWith(".tex") ? ref : `${ref}.tex`;
      target = path.isAbsolute(target) ? target : path.resolve(baseDir, target);
      refs.push({ macro, ref, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, path: target });
    }
    return refs;
  }

  private chunkOverlapsRefs(chunk: Chunk, refs: RootReference[]): boolean {
    return refs.some((ref) => ref.start >= chunk.anchor.start && ref.start < chunk.end);
  }

  private highestExistingPrefix(refs: RootReference[]): number {
    let highest = 0;
    for (const ref of refs) {
      const stem = path.basename(ref.path, path.extname(ref.path));
      const match = NUMERIC_PREFIX_PATTERN.exec(stem);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    return highest;
  }

  private parseBalancedGroup(text: string, openIndex: number): { content: string; end: number } | null {
    if (text[openIndex] !== "{") return null;
    let depth = 0;
    let escaped = false;
    for (let i = openIndex; i < text.length; i += 1) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return { content: text.slice(openIndex + 1, i), end: i + 1 };
      }
    }
    return null;
  }

  private stableSlug(title: string, seen: Map<string, number>): string {
    const base = slugify(title.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "").replace(/[{}]/g, " ")) || "section";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }

  private async nextBackupPath(rootAbs: string): Promise<string> {
    let candidate = `${rootAbs}.bak`;
    let index = 1;
    while (await exists(candidate)) {
      candidate = `${rootAbs}.bak.${index}`;
      index += 1;
    }
    return candidate;
  }

  private normalizeSectionsDir(raw: string): string {
    const value = toPosixPath(String(raw || "Sections")).replace(/^\/+/, "").replace(/\/+$/, "") || "Sections";
    if (value.split("/").some((part) => part === ".." || part === "")) throw new Error("Invalid sections directory.");
    return value;
  }

  private relativeTexReference(rootDir: string, targetTexPath: string): string {
    return toPosixPath(path.relative(rootDir, targetTexPath)).replace(/\.tex$/i, "");
  }

  private injectSubfilesPackage(preamblePlusBegin: string): { text: string; injected: boolean } {
    if (/\\usepackage(?:\[[^\]]*\])?\{subfiles\}/.test(preamblePlusBegin)) {
      return { text: preamblePlusBegin, injected: false };
    }
    const begin = BEGIN_DOCUMENT_PATTERN.exec(preamblePlusBegin);
    if (!begin) return { text: preamblePlusBegin, injected: false };
    const insertAt = begin.index;
    const injected = `${preamblePlusBegin.slice(0, insertAt)}\\usepackage{subfiles}\n${preamblePlusBegin.slice(insertAt)}`;
    return { text: injected, injected: true };
  }

  private applyReplacements(text: string, replacements: Array<{ start: number; end: number; text: string }>): string {
    let result = text;
    for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
      result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`;
    }
    return result;
  }

  private buildSubfileUnitText(rootAbs: string, unitAbs: string, content: string): string {
    const rootRel = toPosixPath(path.relative(path.dirname(unitAbs), rootAbs));
    const body = content.trimStart();
    return `\\documentclass[${rootRel}]{subfiles}\n\\begin{document}\n${body.trimEnd()}\n\\end{document}\n`;
  }

  private extractUnitBody(unitText: string): string {
    const bounds = this.findBodyBounds(unitText);
    return unitText.slice(bounds.bodyStart, bounds.bodyEnd).trim();
  }
}
