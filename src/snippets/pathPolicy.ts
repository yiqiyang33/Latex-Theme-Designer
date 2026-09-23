import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function canonicalSnippetPath(candidate: string, mustExist: boolean): Promise<string> {
  const resolved = path.resolve(candidate);
  try {
    return await fs.realpath(resolved);
  } catch (error) {
    if (mustExist) throw error;
    try {
      return path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
}

const CASE_INSENSITIVE_FILESYSTEM = process.platform === "win32" || process.platform === "darwin";

/** Compares two already-canonical paths the way the host filesystem would. */
export function samePath(left: string, right: string): boolean {
  return CASE_INSENSITIVE_FILESYSTEM
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
}

function isInsidePath(candidate: string, root: string): boolean {
  return samePath(candidate, root) || samePath(candidate.slice(0, root.length + 1), `${root}${path.sep}`);
}

export async function assertSnippetPathAllowed(filePath: string, allowedRoots: string[], mustExist: boolean): Promise<void> {
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== ".hsnips") throw new Error("Only .hsnips files can be managed.");
  const candidate = await canonicalSnippetPath(resolved, mustExist);
  const roots = await Promise.all(allowedRoots.map((root) => canonicalSnippetPath(root, false)));
  if (!roots.some((root) => isInsidePath(candidate, root))) {
    throw new Error("Snippet path is outside the configured snippet directories.");
  }
}
