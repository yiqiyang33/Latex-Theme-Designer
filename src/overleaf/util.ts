import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

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

export function sanitizeProjectFolderName(projectName: string, projectId: string): string {
  const safeName = projectName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'overleaf-project';
  return `${safeName}-${projectId}`;
}
