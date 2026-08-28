import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { CHAPTER_CLASS_NAMES } from "./schema";

export const IGNORE_TEX_FILENAMES = new Set(["theme.colors.tex", "theme.overrides.tex"]);
export const IGNORE_DIR_NAMES = new Set([".git", ".vscode", "__pycache__", "build", "dist", "out", ".venv", "venv", "node_modules"]);

const BASE_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  violet: [238, 130, 238],
  pink: [255, 192, 203],
  purple: [128, 0, 128],
  midnightblue: [25, 25, 112],
  navyblue: [0, 0, 128],
  royalblue: [65, 105, 225]
};

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function statOrNull(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isSubpath(child: string, parent: string): boolean {
  const childResolved = path.resolve(child);
  const parentResolved = path.resolve(parent);
  const relative = path.relative(parentResolved, childResolved);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function workspaceRel(rootDir: string, absolutePath: string): string {
  if (!isSubpath(absolutePath, rootDir)) {
    throw new Error(`Path is outside workspace: ${absolutePath}`);
  }
  return toPosixPath(path.relative(rootDir, absolutePath));
}

export function resolveWorkspacePath(rootDir: string, relPath: string, mustStayInside = true): string {
  if (path.isAbsolute(relPath)) {
    if (mustStayInside && !isSubpath(relPath, rootDir)) {
      throw new Error(`Path is outside workspace: ${relPath}`);
    }
    return path.resolve(relPath);
  }
  const resolved = path.resolve(rootDir, relPath);
  if (mustStayInside && !isSubpath(resolved, rootDir)) {
    throw new Error(`Path is outside workspace: ${relPath}`);
  }
  return resolved;
}

/** Reject symlinked components before a workspace file is read or replaced. */
export async function assertWorkspacePathSafe(rootDir: string, candidate: string): Promise<string> {
  const root = path.resolve(rootDir);
  const absolute = path.resolve(candidate);
  if (!isSubpath(absolute, root)) throw new Error(`Path is outside workspace: ${candidate}`);
  if (absolute === root) return absolute;
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error(`Refusing to access symlinked workspace path: ${candidate}`);
    if (!stat.isDirectory() && current !== absolute) throw new Error(`Workspace path component is not a directory: ${candidate}`);
  }
  return absolute;
}

export function safeWorkspaceRel(rootDir: string, maybePath: unknown): string {
  if (typeof maybePath !== "string" || !maybePath.trim()) return "";
  try {
    const resolved = resolveWorkspacePath(rootDir, maybePath.trim(), true);
    return workspaceRel(rootDir, resolved);
  } catch {
    return "";
  }
}

export function parseHexColor(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}

export function hexFromRgb(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function blend(left: [number, number, number], right: [number, number, number], leftWeight: number): [number, number, number] {
  const lw = Math.max(0, Math.min(1, leftWeight));
  const rw = 1 - lw;
  return [
    left[0] * lw + right[0] * rw,
    left[1] * lw + right[1] * rw,
    left[2] * lw + right[2] * rw
  ];
}

export function boolFromTex(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off", ""].includes(value)) return false;
  return null;
}

export function formatBodyFontSize(value: number): string {
  return value.toFixed(1);
}

export function normalizeBodyFontSize(raw: unknown, defaultValue = 10.0): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  const clamped = Math.min(14.0, Math.max(9.0, parsed));
  return Number((9.0 + Math.round((clamped - 9.0) / 0.5) * 0.5).toFixed(1));
}

export function assertValidBodyFontSize(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 9.0 || parsed > 14.0) {
    throw new Error(`Invalid value for body_font_size_pt: ${raw}. Expected 9.0 to 14.0.`);
  }
  const normalized = normalizeBodyFontSize(parsed);
  if (Math.abs(normalized - parsed) > 1e-9) {
    throw new Error(`Invalid value for body_font_size_pt: ${raw}. Expected increments of 0.5.`);
  }
  return normalized;
}

export function slugify(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}

export function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripTexComments(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/(?<!\\)%.*/, "")).join("\n");
}

export function extractDocumentclassDeclaration(text: string): { className: string; options: string } | null {
  const match = /\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/i.exec(text);
  if (!match) return null;
  const rawClass = (match[2] ?? "").split(",", 1)[0].trim().toLowerCase();
  return { className: rawClass, options: (match[1] ?? "").trim() };
}

export async function extractDocumentclassName(texPath: string, rootDir: string, visited = new Set<string>()): Promise<string> {
  const resolved = path.resolve(texPath);
  if (visited.has(resolved)) return "";
  visited.add(resolved);
  const text = await fs.readFile(resolved, "utf8");
  const declaration = extractDocumentclassDeclaration(text);
  if (!declaration) return "";
  if (declaration.className !== "subfiles") return declaration.className;
  const parentRef = declaration.options.split(",")[0]?.trim();
  if (!parentRef) return declaration.className;
  const parent = path.resolve(path.dirname(resolved), parentRef);
  if (!isSubpath(parent, rootDir) || !(await exists(parent))) return declaration.className;
  return extractDocumentclassName(parent, rootDir, visited);
}

export function isChapterCapableClass(className: string): boolean {
  const name = className.trim().toLowerCase();
  return CHAPTER_CLASS_NAMES.has(name) || name.endsWith("book") || name.endsWith("report");
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = toPosixPath(pattern);
  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  source += "$";
  return new RegExp(source);
}

export function matchesGlob(relPath: string, basename: string, pattern: string): boolean {
  const normalized = toPosixPath(relPath);
  if (!pattern.includes("/")) {
    return globToRegExp(pattern).test(basename);
  }
  return globToRegExp(pattern).test(normalized);
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORE_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await walk(rootDir);
  return out.sort();
}

export async function listTexCandidates(rootDir: string): Promise<string[]> {
  const candidates: string[] = [];
  const all = await listFilesRecursive(rootDir);
  for (const abs of all) {
    if (!abs.endsWith(".tex")) continue;
    if (IGNORE_TEX_FILENAMES.has(path.basename(abs))) continue;
    try {
      const text = await fs.readFile(abs, "utf8");
      if (extractDocumentclassDeclaration(text)) {
        candidates.push(workspaceRel(rootDir, abs));
      }
    } catch {
      // Ignore unreadable candidates; they are not useful compile targets.
    }
  }
  candidates.sort((a, b) => {
    if (a === "main.tex") return -1;
    if (b === "main.tex") return 1;
    return a.localeCompare(b);
  });
  return candidates;
}

export function defaultCompileTarget(candidates: string[]): string {
  return candidates.includes("main.tex") ? "main.tex" : candidates[0] ?? "";
}

export function normalizeCompileTarget(rootDir: string, rawTarget: unknown, candidates: string[]): string {
  if (candidates.length === 0) return "";
  const raw = String(rawTarget ?? "").trim();
  if (!raw) return defaultCompileTarget(candidates);
  const normalized = toPosixPath(raw);
  if (candidates.includes(normalized)) return normalized;
  const resolved = resolveWorkspacePath(rootDir, normalized, true);
  const rel = workspaceRel(rootDir, resolved);
  if (candidates.includes(rel)) return rel;
  throw new Error(`Unknown compile target: ${raw}`);
}

export function compileOutputPdfRelpath(compileTarget: string): string {
  if (!compileTarget) return "main.pdf";
  return toPosixPath(compileTarget).replace(/\.tex$/i, ".pdf");
}

export async function parseThemeColorDefaults(themePath: string, colorOrder: string[]): Promise<Record<string, string>> {
  const text = await fs.readFile(themePath, "utf8");
  const defines: Record<string, string> = {};
  for (const match of text.matchAll(/\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
    defines[match[1]] = `#${match[2].toUpperCase()}`;
  }
  const colorlets: Array<{ token: string; expr: string }> = [];
  for (const match of text.matchAll(/\\colorlet\{([^}]+)\}\{([^}]+)\}/g)) {
    colorlets.push({ token: match[1], expr: match[2] });
  }

  const resolved: Record<string, string> = {};
  const resolveExpr = (expr: string, depth = 0): [number, number, number] => {
    if (depth > 20) return [128, 128, 128];
    const hex = parseHexColor(expr);
    if (hex) {
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    }
    const lowered = expr.trim().toLowerCase();
    if (BASE_COLORS[lowered]) return BASE_COLORS[lowered];
    if (defines[expr]) return resolveExpr(defines[expr], depth + 1);
    if (resolved[expr]) return resolveExpr(resolved[expr], depth + 1);
    if (expr.includes("!")) {
      const parts = expr.split("!");
      let current = resolveExpr(parts[0], depth + 1);
      for (let i = 1; i < parts.length; i += 2) {
        const pct = Number(parts[i]);
        const right = resolveExpr(parts[i + 1] || "white", depth + 1);
        current = blend(current, right, Number.isFinite(pct) ? pct / 100 : 0.5);
      }
      return current;
    }
    return [128, 128, 128];
  };

  for (const { token, expr } of colorlets) {
    if (colorOrder.includes(token)) {
      resolved[token] = hexFromRgb(resolveExpr(expr));
    }
  }
  const out: Record<string, string> = {};
  for (const token of colorOrder) out[token] = resolved[token] ?? "#808080";
  return out;
}

export function fileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString();
}
