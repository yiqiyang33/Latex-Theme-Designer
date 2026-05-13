import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CleanResult } from "./types";
import { cleanPatternsFromVscodeSettings } from "./vscodeSettings";
import { exists, extractDocumentclassDeclaration, isSubpath, matchesGlob, safeWorkspaceRel, workspaceRel } from "./utils";

const ROOT_SCOPE_DIRS = ["."];
const ROOT_PROTECTED_PATTERNS = ["*.pdf", "*.synctex.gz"];
const SUBFILE_DELETE_PATTERNS = ["*"];
const SUBFILE_KEEP_PATTERNS = ["*.tex", "*.pdf"];
const FALLBACK_FILE_TYPES = [
  "*.aux", "*.bbl", "*.bcf", "*.blg", "*.fdb_latexmk", "*.fls", "*.lof", "*.log", "*.lot", "*.out", "*.run.xml",
  "*.toc", "*.xdv", "*.nav", "*.snm", "*.vrb", "*.acn", "*.acr", "*.alg", "*.glg", "*.glo", "*.gls", "*.ist",
  "*.idx", "*.ilg", "*.ind", "*.loa", "*.lol", "*.maf", "*.mtc*", "*.pyg", "*.thm"
];

export class CleanupService {
  constructor(private readonly rootDir: string) {}

  async clean(dryRun = false): Promise<CleanResult> {
    const rootPatterns = await cleanPatternsFromVscodeSettings(this.rootDir, FALLBACK_FILE_TYPES);
    const { scopeDirs: subfileScope, errors: discoverErrors } = await this.discoverSubfileScopeDirs();
    const rootResult = await this.cleanBuildArtifacts(ROOT_SCOPE_DIRS, rootPatterns, ROOT_PROTECTED_PATTERNS, dryRun, false);
    const subfileResult = subfileScope.length > 0
      ? await this.cleanBuildArtifacts(subfileScope, SUBFILE_DELETE_PATTERNS, SUBFILE_KEEP_PATTERNS, dryRun, true)
      : { scope: [], deleted: [], skipped: [], errors: [] };
    const emptyDirs = subfileScope.length > 0 ? await this.pruneEmptyDirectories(subfileScope, dryRun) : { removed: [], errors: [] };
    const deleted = Array.from(new Set([...rootResult.deleted, ...subfileResult.deleted])).sort();
    const skipped = Array.from(new Set([...rootResult.skipped, ...subfileResult.skipped])).sort();
    const errors = Array.from(new Set([...discoverErrors, ...rootResult.errors, ...subfileResult.errors, ...emptyDirs.errors])).sort();
    return {
      success: errors.length === 0,
      dry_run: dryRun,
      scope: Array.from(new Set([...rootResult.scope, ...subfileResult.scope])).sort(),
      patterns: rootPatterns,
      protected_patterns: ROOT_PROTECTED_PATTERNS,
      deleted_files: deleted,
      deleted_count: deleted.length,
      skipped_protected_files: skipped,
      skipped_protected_count: skipped.length,
      errors,
      root_scope: rootResult.scope,
      subfile_scope: subfileResult.scope,
      root_patterns: rootPatterns,
      root_protected_patterns: ROOT_PROTECTED_PATTERNS,
      subfile_keep_patterns: SUBFILE_KEEP_PATTERNS,
      removed_empty_dirs: emptyDirs.removed,
      removed_empty_dir_count: emptyDirs.removed.length
    };
  }

  private async discoverSubfileScopeDirs(): Promise<{ scopeDirs: string[]; errors: string[] }> {
    const scope = new Set<string>();
    const errors: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "__pycache__"].includes(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile() && entry.name.endsWith(".tex")) {
          try {
            const text = await fs.readFile(abs, "utf8");
            const declaration = extractDocumentclassDeclaration(text);
            if (declaration?.className === "subfiles" && path.dirname(abs) !== this.rootDir) {
              scope.add(workspaceRel(this.rootDir, path.dirname(abs)));
            }
          } catch (err) {
            errors.push(`Failed to inspect documentclass for ${safeWorkspaceRel(this.rootDir, abs)}: ${(err as Error).message}`);
          }
        }
      }
    };
    await walk(this.rootDir);
    return { scopeDirs: Array.from(scope).sort(), errors };
  }

  private async cleanBuildArtifacts(scopeDirs: string[], patterns: string[], protectedPatterns: string[], dryRun: boolean, recursiveAll: boolean): Promise<{ scope: string[]; deleted: string[]; skipped: string[]; errors: string[] }> {
    const deleted: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];
    const normalizedScope = scopeDirs.map((scope) => scope || ".").filter(Boolean);
    for (const scope of normalizedScope) {
      const scopeAbs = path.resolve(this.rootDir, scope);
      if (!isSubpath(scopeAbs, this.rootDir) || !(await exists(scopeAbs))) continue;
      const files = await this.listScopeFiles(scopeAbs, recursiveAll);
      for (const abs of files) {
        const relToScope = safeWorkspaceRel(scopeAbs, abs) || path.basename(abs);
        const workspaceRelative = workspaceRel(this.rootDir, abs);
        const basename = path.basename(abs);
        if (!patterns.some((pattern) => matchesGlob(relToScope, basename, pattern))) continue;
        if (protectedPatterns.some((pattern) => matchesGlob(relToScope, basename, pattern))) {
          skipped.push(workspaceRelative);
          continue;
        }
        try {
          if (!dryRun) await fs.unlink(abs);
          deleted.push(workspaceRelative);
        } catch (err) {
          errors.push(`Failed to delete ${workspaceRelative}: ${(err as Error).message}`);
        }
      }
    }
    return { scope: normalizedScope, deleted, skipped, errors };
  }

  private async listScopeFiles(scopeAbs: string, recursive: boolean): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || ["node_modules", ".git"].includes(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (recursive) await walk(abs);
        } else if (entry.isFile()) {
          out.push(abs);
        }
      }
    };
    await walk(scopeAbs);
    return out;
  }

  private async pruneEmptyDirectories(scopeDirs: string[], dryRun: boolean): Promise<{ removed: string[]; errors: string[] }> {
    const removed: string[] = [];
    const errors: string[] = [];
    for (const scope of scopeDirs) {
      const scopeAbs = path.resolve(this.rootDir, scope);
      const dirs: string[] = [];
      const collect = async (dir: string): Promise<void> => {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const abs = path.join(dir, entry.name);
            dirs.push(abs);
            await collect(abs);
          }
        }
      };
      if (await exists(scopeAbs)) await collect(scopeAbs);
      dirs.sort((a, b) => b.length - a.length);
      for (const dir of dirs) {
        try {
          const entries = await fs.readdir(dir);
          if (entries.length === 0) {
            if (!dryRun) await fs.rmdir(dir);
            removed.push(workspaceRel(this.rootDir, dir));
          }
        } catch (err) {
          errors.push(`Failed to prune ${safeWorkspaceRel(this.rootDir, dir)}: ${(err as Error).message}`);
        }
      }
    }
    return { removed, errors };
  }
}
