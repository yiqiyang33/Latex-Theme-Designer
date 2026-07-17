import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'fs';
import * as path from 'path';

export const PROFILE_ROOT_DIR = 'profiles';
export const WORKSPACE_SNIPPET_DIR = path.join('.vscode', 'hsnips');

export interface SnippetFileEntry {
  filePath: string;
  language: string;
  profile: string;
  scope: 'base' | 'profile' | 'workspace';
  workspaceFolder?: string;
}

export function normalizeProfileName(profile: string | undefined) {
  let normalized = (profile || '').trim();
  if (!normalized || normalized == '.' || normalized == '..' || normalized.includes('\0') || normalized.includes('/') || normalized.includes('\\')) {
    return '';
  }
  return normalized;
}

export function getProfilesDir(snippetDir: string) {
  return path.join(snippetDir, PROFILE_ROOT_DIR);
}

export function getProfileDir(snippetDir: string, profile: string) {
  return path.join(getProfilesDir(snippetDir), profile);
}

export function getWorkspaceSnippetDir(workspaceFolder: string) {
  return path.join(workspaceFolder, WORKSPACE_SNIPPET_DIR);
}

function isHsnipsFile(filePath: string) {
  return path.extname(filePath).toLowerCase() == '.hsnips';
}

function readSnippetFileEntries(
  directory: string,
  scope: SnippetFileEntry['scope'],
  profile = '',
  workspaceFolder?: string
) {
  if (!existsSync(directory)) {
    return [];
  }

  let canonicalDirectory = canonicalPath(directory);
  return readdirSync(directory)
    .filter((file) => isHsnipsFile(file))
    .filter((file) => isInside(canonicalPath(path.join(directory, file)), canonicalDirectory))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      let filePath = path.join(directory, file);
      return {
        filePath,
        language: path.basename(file, '.hsnips').toLowerCase(),
        profile,
        scope,
        workspaceFolder,
      };
    });
}

export function discoverSnippetProfiles(snippetDir: string) {
  let profilesDir = getProfilesDir(snippetDir);
  if (!existsSync(profilesDir)) {
    return [];
  }

  let canonicalProfilesDir = canonicalPath(profilesDir);
  return readdirSync(profilesDir)
    .filter((name) => {
      let filePath = path.join(profilesDir, name);
      return normalizeProfileName(name) == name && statSync(filePath).isDirectory() && isInside(canonicalPath(filePath), canonicalProfilesDir);
    })
    .sort((a, b) => a.localeCompare(b));
}

export function getSnippetFilesForProfile(snippetDir: string, activeProfile = '') {
  let profile = normalizeProfileName(activeProfile);
  let files = readSnippetFileEntries(snippetDir, 'base');
  if (profile) {
    files.push(...readSnippetFileEntries(getProfileDir(snippetDir, profile), 'profile', profile));
  }
  return files;
}

export function getSnippetFiles(
  snippetDir: string,
  activeProfile = '',
  workspaceSnippetDir?: string,
  workspaceFolder?: string
) {
  let files = getSnippetFilesForProfile(snippetDir, activeProfile);
  if (workspaceSnippetDir) {
    files.push(...readSnippetFileEntries(workspaceSnippetDir, 'workspace', '', workspaceFolder));
  }
  return files;
}

export function getWorkspaceSnippetFiles(workspaceFolder: string) {
  return readSnippetFileEntries(
    getWorkspaceSnippetDir(workspaceFolder),
    'workspace',
    '',
    workspaceFolder
  );
}

export function ensureProfileDir(snippetDir: string, profile: string) {
  let normalized = normalizeProfileName(profile);
  if (!normalized) throw new Error('Snippet profile name is invalid.');
  let profileDir = getProfileDir(snippetDir, normalized);
  mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

function canonicalPath(candidate: string) {
  try {
    return realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function isInside(candidate: string, root: string) {
  let caseInsensitive = process.platform == 'win32' || process.platform == 'darwin';
  let normalizedCandidate = caseInsensitive ? candidate.toLocaleLowerCase() : candidate;
  let normalizedRoot = caseInsensitive ? root.toLocaleLowerCase() : root;
  return normalizedCandidate == normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}
