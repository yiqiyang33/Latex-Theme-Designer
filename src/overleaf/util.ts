import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { inspect } from 'util';

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim() || 'https://www.overleaf.com/';
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return url.endsWith('/') ? url : `${url}/`;
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
