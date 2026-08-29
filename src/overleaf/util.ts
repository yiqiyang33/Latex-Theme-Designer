import * as crypto from 'crypto';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { inspect } from 'util';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim() || 'https://www.overleaf.com/';
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid Overleaf server URL: ${raw}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Overleaf server URL must use HTTP(S): ${raw}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Overleaf server URL must not contain credentials: ${raw}`);
  }
  parsed.pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  return parsed.toString();
}

export function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function sha1(content: Uint8Array | string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

export function gitBlobHash(content: Uint8Array): string {
  const bytes = Buffer.from(content);
  return crypto.createHash('sha1')
    .update(`blob ${bytes.length}\x00`, 'utf8')
    .update(bytes)
    .digest('hex');
}

export function isTextLike(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [
    '.tex',
    '.ltx',
    '.ctx',
    '.bib',
    '.sty',
    '.cls',
    '.bbx',
    '.cbx',
    '.txt',
    '.md',
    '.tikz',
    '.asy',
    '.r',
    '.py',
    '.m'
  ].includes(ext);
}

export function toPosixPath(input: string): string {
  return input.replace(/[\\/]+/g, '/').replace(/^\/+/, '');
}

/** Normalize and validate a path that is relative to an Overleaf mirror. */
export function normalizeProjectRelativePath(input: string, allowRoot = false): string {
  if (typeof input !== 'string' || input.includes('\0')) {
    throw new Error(`Invalid project path: ${String(input)}`);
  }
  const slashPath = input.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath)) {
    throw new Error(`Project path must be relative: ${input}`);
  }
  const normalized = path.posix.normalize(slashPath);
  if (!normalized || normalized === '.') {
    if (allowRoot) return '';
    throw new Error(`Project path cannot be empty: ${input}`);
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Project path escapes the mirror: ${input}`);
  }
  return normalized;
}

/** Validate one remote entity name before it is joined into a project path. */
export function validateProjectPathSegment(input: string): string {
  if (typeof input !== 'string' || !input || input === '.' || input === '..'
    || /[\\/\0\u0000-\u001f\u007f]/.test(input)
    || /[<>:"|?*]/.test(input)
    || /[ .]$/.test(input)) {
    throw new Error(`Invalid remote project path segment: ${String(input)}`);
  }
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(input)) {
    throw new Error(`Invalid remote project path segment: ${input}`);
  }
  return input;
}

/** Reject symlink components below a mirror before reading or mutating a path. */
export async function assertNoSymlinkPath(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeProjectRelativePath(relativePath);
  const absoluteRoot = path.resolve(root);
  let current = absoluteRoot;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to access symlinked mirror path: ${relativePath}`);
    }
    if (!stat.isDirectory() && current !== path.join(absoluteRoot, ...normalized.split('/'))) {
      throw new Error(`Mirror path component is not a directory: ${relativePath}`);
    }
  }
  return path.join(absoluteRoot, ...normalized.split('/'));
}

/** Reject symlink components for an already-resolved path below a trusted root. */
export async function assertNoSymlinkAbsolutePath(root: string, candidate: string): Promise<string> {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = assertPathWithin(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  let current = absoluteRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`Refusing to access symlinked path: ${candidate}`);
  }
  return absoluteCandidate;
}

/** Ensure an absolute path remains inside a trusted directory. */
export function assertPathWithin(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the trusted root: ${candidate}`);
  }
  return absoluteCandidate;
}

export async function processStartSignature(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === 'linux') {
    try {
      const raw = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const endOfCommand = raw.lastIndexOf(')');
      if (endOfCommand < 0) return undefined;
      return raw.slice(endOfCommand + 2).trim().split(/\s+/)[19];
    } catch {
      return undefined;
    }
  }
  try {
    const result = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
    return String(result.stdout ?? '').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error === undefined) {
    return 'Unknown error';
  }
  if (error === null || typeof error !== 'object') {
    return String(error);
  }

  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : undefined;
  const nested = record.error;
  const nestedMessage = typeof nested === 'string'
    ? nested
    : nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).message === 'string'
      ? String((nested as Record<string, unknown>).message)
      : undefined;
  const main = message ?? nestedMessage;
  const details = Object.entries(record)
    .filter(([key, value]) => value !== undefined && value !== '' && key !== 'message' && key !== 'stack')
    .map(([key, value]) => `${key}=${formatErrorDetail(value)}`)
    .join(', ');
  if (main) {
    return details ? `${main} (${details})` : main;
  }

  const json = safeJson(error);
  return json && json !== '{}' ? json : inspect(error, { depth: 4, breakLength: 140 });
}

/** Keep credentials and oversized server text out of logs and diagnostics. */
export function sanitizeDiagnosticText(value: string, maxLength = 2000): string {
  let text = value
    .replace(/(cookie|set-cookie|authorization|csrf(?:-token)?|token|secret|password)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]')
    .replace(/(session(?:id)?|jwt)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]');
  if (text.length > maxLength) text = `${text.slice(0, Math.max(0, maxLength - 20))}…[truncated]`;
  return text;
}

function formatErrorDetail(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return safeJson(value) ?? inspect(value, { depth: 2, breakLength: 80 });
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function sanitizeProjectFolderName(projectName: string, projectId: string): string {
  const safeName = projectName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'overleaf-project';
  return `${safeName}-${projectId}`;
}
