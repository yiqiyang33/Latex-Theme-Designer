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

export async function assertSnippetPathAllowed(filePath: string, allowedRoots: string[], mustExist: boolean): Promise<void> {
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== ".hsnips") throw new Error("Only .hsnips files can be managed.");
  const candidate = await canonicalSnippetPath(resolved, mustExist);
  const roots = await Promise.all(allowedRoots.map((root) => canonicalSnippetPath(root, false)));
  if (!roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))) {
    throw new Error("Snippet path is outside the configured snippet directories.");
  }
}
