import * as fs from 'fs/promises';
import { Buffer } from 'buffer';
import * as path from 'path';
import { minimatch } from 'minimatch';
import createIgnore, { Ignore } from 'ignore';
import {
  ManifestFile,
  ManifestFolder,
  OverleafCodexManifest,
  SyncStatusReport
} from './types';
import { sha1, toPosixPath } from './util';
import { assertValidManifest, assertValidSyncStatus, validateManifest, validateSyncStatus } from './metadataValidation';

export const METADATA_DIR = '.overleaf-codex';
export const MANIFEST_NAME = 'manifest.json';
export const OUTPUT_DIR = 'output';
export const CONFLICT_DIR = 'conflicts';
export const BASE_DIR = 'base';
export const TRASH_DIR = 'trash';
export const SYNC_STATUS_NAME = 'sync-status.json';
export const TRANSACTIONS_NAME = 'transactions.json';
export const CONFLICT_INDEX_NAME = 'conflicts.json';
export const LOCAL_IGNORE_NAME = '.overleaf-codexignore';
export const MAX_MANIFEST_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_METADATA_JSON_BYTES = 8 * 1024 * 1024;

export const DEFAULT_IGNORE_PATTERNS = [
  '.overleaf-codex/**',
  '.vscode/**',
  '**/.vscode/**',
  '.git',
  '.git/**',
  '**/.git',
  '**/.git/**',
  '.gitignore',
  '**/.gitignore',
  '.latexmkrc',
  '**/.latexmkrc',
  LOCAL_IGNORE_NAME,
  'AGENTS.md',
  '**/.DS_Store'
];

export const TOOLKIT_CONFIG_ALLOWLIST = [
  '**/*.tex', '**/*.bib', '**/*.sty', '**/*.cls', '**/*.bst',
  'commands.tex', 'theorems.tex', 'theme.sty', 'theme.colors.tex',
  'theme.ui.json', 'theme.overrides.tex'
];

export const TOOLKIT_OVERRIDE_PATHS = new Set([
  'commands.tex', 'theorems.tex', 'theme.sty', 'theme.colors.tex',
  'theme.ui.json', 'theme.overrides.tex'
]);

export function isToolkitOverridePath(relPath: string): boolean {
  return TOOLKIT_OVERRIDE_PATHS.has(toPosixPath(relPath));
}

export const TOOLKIT_SYNC_EXCLUDE_PATTERNS = [
  '.overleaf-codex/**', '.vscode/**', '**/.vscode/**', '.git', '.git/**', '**/.git', '**/.git/**',
  '.latexmkrc', '**/.latexmkrc',
  'AGENTS.md', '**/AGENTS.md', '**/*.aux', '**/*.log', '**/*.fls',
  '**/*.fdb_latexmk', '**/*.synctex.gz', 'build/**', 'out/**', 'dist/**',
  'node_modules/**', 'conflicts/**', 'trash/**', 'base/**', 'cache/**'
];

const LEGACY_CONFIGURABLE_IGNORE_PATTERNS = [
  '**/*.aux',
  '**/*.bbl',
  '**/*.bcf',
  '**/*.bcf-*',
  '**/*.blg',
  '**/*.fdb_latexmk',
  '**/*.fls',
  '**/*.lof',
  '**/*.log',
  '**/*.lot',
  '**/*.out',
  '**/*.run.xml',
  '**/*.synctex',
  '**/*.synctex.gz',
  '**/*.synctex(busy)',
  '**/*.toc',
  '**/*.xdv',
  '**/*-SAVE-ERROR',
  '**/main.pdf',
  '**/output.pdf'
];

export const DEFAULT_LOCAL_IGNORE_CONTENT = `# Overleaf Codex local-only paths.
# Syntax is gitignore-like: blank lines and # comments are ignored; ! re-includes a path.
# These rules apply to untracked local paths. Files already tracked by Overleaf still sync.

# Local temporary directories and editor files
tmp/
.tmp/
*.tmp
*.swp
*.swo
*~
.#*

# Generated LaTeX outputs
*.aux
*.bbl
*.bcf
*.bcf-*
*.blg
*.fdb_latexmk
*.fls
*.lof
*.log
*.lot
*.out
*.run.xml
*.synctex
*.synctex.gz
*.synctex(busy)
*.toc
*.xdv
*-SAVE-ERROR
main.pdf
output.pdf
`;

export interface LocalIgnoreRule {
  raw: string;
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
}

const localIgnoreRules = new WeakMap<OverleafCodexManifest, Ignore>();
interface ManifestEntityIndex {
  files: Map<string, string>;
  folders: Map<string, string>;
}
const manifestEntityIndexes = new WeakMap<OverleafCodexManifest, ManifestEntityIndex>();

export function manifestPath(root: string): string {
  return path.join(root, METADATA_DIR, MANIFEST_NAME);
}

export function metadataPath(root: string, ...parts: string[]): string {
  return path.join(root, METADATA_DIR, ...parts);
}

export async function readManifest(root: string): Promise<OverleafCodexManifest> {
  const target = manifestPath(root);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFileBounded(target, MAX_MANIFEST_JSON_BYTES));
  } catch (error) {
    await quarantineCorruptFile(target);
    throw new Error(`Overleaf manifest could not be read safely and was quarantined at ${target}.`, { cause: error });
  }
  const validationError = validateManifest(parsed);
  if (validationError) {
    await quarantineCorruptFile(target);
    throw new Error(`Overleaf manifest failed schema validation at ${validationError} and was quarantined at ${target}.`);
  }
  const manifest = migrateManifest(parsed as OverleafCodexManifest);
  const ignoreContent = await ensureLocalIgnoreFile(root);
  localIgnoreRules.set(manifest, createIgnore().add(ignoreContent));
  return manifest;
}

export async function ensureLocalIgnoreFile(root: string): Promise<string> {
  const target = path.join(root, LOCAL_IGNORE_NAME);
  const existing = await fs.readFile(target, 'utf8').catch(() => undefined);
  if (existing !== undefined) {
    return existing;
  }
  await fs.writeFile(target, DEFAULT_LOCAL_IGNORE_CONTENT, { encoding: 'utf8', flag: 'wx' }).catch(() => undefined);
  return fs.readFile(target, 'utf8').catch(() => DEFAULT_LOCAL_IGNORE_CONTENT);
}

export async function writeManifest(root: string, manifest: OverleafCodexManifest): Promise<void> {
  manifest.schemaVersion = 3;
  manifest.lastSyncAt = new Date().toISOString();
  assertValidManifest(manifest);
  manifestEntityIndexes.delete(manifest);
  await atomicWriteText(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function migrateManifest(manifest: OverleafCodexManifest): OverleafCodexManifest {
  if (!manifest.schemaVersion || manifest.schemaVersion < 3) {
    manifest.schemaVersion = 3;
  }
  const legacy = new Set(LEGACY_CONFIGURABLE_IGNORE_PATTERNS);
  manifest.ignore = manifest.ignore.filter(pattern => !legacy.has(pattern));
  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (!manifest.ignore.includes(pattern)) {
      manifest.ignore.push(pattern);
    }
  }
  return manifest;
}

export function baseDocPath(root: string, docId: string): string {
  return metadataPath(root, BASE_DIR, 'docs', `${docId}.tex`);
}

export async function readBaseDoc(root: string, docId: string): Promise<string | undefined> {
  return fs.readFile(baseDocPath(root, docId), 'utf8').catch(() => undefined);
}

export async function writeBaseDoc(root: string, docId: string, content: string): Promise<string> {
  const target = baseDocPath(root, docId);
  await atomicWriteText(target, content);
  return sha1(content);
}

export function syncStatusPath(root: string): string {
  return metadataPath(root, SYNC_STATUS_NAME);
}

export async function readSyncStatus(root: string): Promise<SyncStatusReport | undefined> {
  try {
    const bounded = await readTextFileBounded(syncStatusPath(root), MAX_METADATA_JSON_BYTES);
    if (!bounded) return undefined;
    const parsed = JSON.parse(bounded) as SyncStatusReport;
    const validationError = validateSyncStatus(parsed);
    if (validationError) throw new Error(validationError);
    return parsed;
  } catch (error) {
    await quarantineCorruptFile(syncStatusPath(root));
    console.warn(`Overleaf sync status at ${syncStatusPath(root)} was quarantined: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export async function readTextFileBounded(target: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(target, 'r');
  try {
    const initialSize = (await handle.stat()).size;
    if (initialSize > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit.`);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of handle.createReadStream()) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit.`);
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function quarantineCorruptFile(target: string): Promise<void> {
  const quarantine = `${target}.corrupt-${Date.now()}`;
  await fs.rename(target, quarantine).catch(() => undefined);
}

export async function writeSyncStatus(root: string, report: SyncStatusReport): Promise<void> {
  assertValidSyncStatus(report);
  await atomicWriteText(syncStatusPath(root), `${JSON.stringify(report, null, 2)}\n`);
}

const metadataWriteQueues = new Map<string, Promise<void>>();

export async function atomicWriteText(target: string, content: string): Promise<void> {
  return enqueueMetadataWrite(target, async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      await fs.writeFile(temporary, content, 'utf8');
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  });
}

export async function atomicWriteBytes(target: string, content: Uint8Array): Promise<void> {
  return enqueueMetadataWrite(target, async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      await fs.writeFile(temporary, content);
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  });
}

async function enqueueMetadataWrite(target: string, write: () => Promise<void>): Promise<void> {
  const previous = metadataWriteQueues.get(target) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(write);
  metadataWriteQueues.set(target, current);
  try {
    await current;
  } finally {
    if (metadataWriteQueues.get(target) === current) {
      metadataWriteQueues.delete(target);
    }
  }
}

export function shouldIgnore(manifest: OverleafCodexManifest, relPath: string): boolean {
  const normalized = toPosixPath(relPath);
  return manifest.ignore.some(pattern => minimatch(normalized, pattern, { dot: true }))
    || TOOLKIT_SYNC_EXCLUDE_PATTERNS.some(pattern => minimatch(normalized, pattern, { dot: true }));
}

export function shouldSyncToolkitPath(relPath: string): boolean {
  const normalized = toPosixPath(relPath);
  if (TOOLKIT_SYNC_EXCLUDE_PATTERNS.some(pattern => minimatch(normalized, pattern, { dot: true }))) return false;
  return TOOLKIT_CONFIG_ALLOWLIST.some(pattern => minimatch(normalized, pattern, { dot: true }))
    || isSourceLikePath(normalized);
}

function isSourceLikePath(relPath: string): boolean {
  return /\.(?:tex|bib|sty|cls|bst)$/i.test(relPath);
}

export function shouldIgnoreUntrackedLocalPath(manifest: OverleafCodexManifest, relPath: string): boolean {
  const normalized = toPosixPath(relPath);
  if (shouldIgnore(manifest, normalized)) return true;
  const matcher = localIgnoreRules.get(manifest) ?? createIgnore().add(DEFAULT_LOCAL_IGNORE_CONTENT);
  return matcher.ignores(normalized) || matcher.ignores(`${normalized.replace(/\/+$/, '')}/`);
}

export function parseLocalIgnoreFile(content: string): LocalIgnoreRule[] {
  const rules: LocalIgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const escapedMarker = line.startsWith('\\#') || line.startsWith('\\!');
    if (escapedMarker) {
      line = line.slice(1);
    }
    const negated = !escapedMarker && line.startsWith('!');
    if (negated) {
      line = line.slice(1).trim();
    }
    if (!line) {
      continue;
    }
    const anchored = line.startsWith('/');
    if (anchored) {
      line = line.slice(1);
    }
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) {
      line = line.replace(/\/+$/, '');
    }
    if (line) {
      const pattern = toPosixPath(line);
      rules.push({ raw: `${negated ? '!' : ''}${anchored ? '/' : ''}${pattern}${directoryOnly ? '/' : ''}`, pattern, negated, directoryOnly, anchored });
    }
  }
  return rules;
}

export function matchesLocalIgnoreRule(relPath: string, rule: LocalIgnoreRule): boolean {
  const normalized = toPosixPath(relPath);
  if (rule.negated) {
    return createIgnore().add(rule.raw.slice(1)).ignores(normalized);
  }
  const matcher = createIgnore().add(rule.raw);
  return matcher.ignores(normalized) || matcher.ignores(`${normalized.replace(/\/+$/, '')}/`);
}

export function addOrUpdateFile(
  manifest: OverleafCodexManifest,
  file: Omit<ManifestFile, 'sha1'>,
  content?: Uint8Array | string
): void {
  manifest.files[file.path] = {
    ...file,
    sha1: content === undefined ? manifest.files[file.path]?.sha1 : sha1(content)
  };
  manifestEntityIndexes.delete(manifest);
}

export function addOrUpdateFolder(manifest: OverleafCodexManifest, folder: ManifestFolder): void {
  manifest.folders[folder.path] = folder;
  manifestEntityIndexes.delete(manifest);
}

export function folderPathById(manifest: OverleafCodexManifest, folderId: string): string | undefined {
  return getManifestEntityIndex(manifest).folders.get(folderId);
}

export function filePathById(manifest: OverleafCodexManifest, entityId: string): string | undefined {
  return getManifestEntityIndex(manifest).files.get(entityId);
}

export function invalidateManifestEntityIndex(manifest: OverleafCodexManifest): void {
  manifestEntityIndexes.delete(manifest);
}

function getManifestEntityIndex(manifest: OverleafCodexManifest): ManifestEntityIndex {
  const existing = manifestEntityIndexes.get(manifest);
  if (existing) return existing;
  const index: ManifestEntityIndex = { files: new Map(), folders: new Map() };
  for (const file of Object.values(manifest.files)) index.files.set(file.entityId, file.path);
  for (const folder of Object.values(manifest.folders)) index.folders.set(folder.entityId, folder.path);
  manifestEntityIndexes.set(manifest, index);
  return index;
}

export function findParentFolderId(manifest: OverleafCodexManifest, relPath: string): string | undefined {
  const parent = toPosixPath(path.posix.dirname(toPosixPath(relPath)));
  const folderPath = parent === '.' ? '' : parent;
  return manifest.folders[folderPath]?.entityId;
}
