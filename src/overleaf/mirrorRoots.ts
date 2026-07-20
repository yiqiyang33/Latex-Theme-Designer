import * as path from 'path';

export type ManifestExists = (root: string) => boolean;

export function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function firstWorkspaceMirrorRoot(workspaceRoots: Iterable<string>, hasManifest: ManifestExists): string | undefined {
  for (const workspaceRoot of workspaceRoots) {
    const root = path.resolve(workspaceRoot);
    if (hasManifest(root)) return root;
  }
  return undefined;
}

export function resolveMirrorRootForPath(candidate: string, workspaceRoots: Iterable<string>, hasManifest: ManifestExists): string | undefined {
  const resolved = path.resolve(candidate);
  if (hasManifest(resolved)) return resolved;
  for (const workspaceRoot of workspaceRoots) {
    const root = path.resolve(workspaceRoot);
    if (pathIsWithin(root, resolved) && hasManifest(root)) return root;
  }
  return undefined;
}

export function workspaceContainsPath(candidate: string, workspaceRoots: Iterable<string>): boolean {
  return [...workspaceRoots].some(workspaceRoot => pathIsWithin(workspaceRoot, candidate));
}
