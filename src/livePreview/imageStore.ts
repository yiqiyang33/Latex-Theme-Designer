import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { svgDataUri } from './mathRenderer';

/**
 * Keeps rendered formulas as SVG files, so a decoration carries a short file URI rather than its
 * whole image: VS Code sends every decoration of a type again whenever one of them changes, and
 * hashes and styles each one on its UI thread. Files are named by their content, so a formula
 * rendered again is not written again.
 *
 * Each extension host writes to a folder named by its process, removed when it ends; the folders
 * of hosts that ended without removing theirs are cleared when the next one starts.
 */
export class ImageStore {
  private readonly dir: string;
  private readonly written = new Set<string>();
  private failed = false;

  constructor(private readonly root: string) {
    this.dir = path.join(root, String(process.pid));
    void this.sweep();
  }

  /** Where the image is: its file, or the image itself as a data URI once files cannot be written. */
  readonly write = (svg: string): string => {
    if (this.failed) return svgDataUri(svg);
    const file = path.join(this.dir, `${createHash('sha1').update(svg).digest('hex')}.svg`);
    if (!this.written.has(file)) {
      try {
        if (!this.written.size) fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(file, svg);
      } catch {
        this.failed = true;
        return svgDataUri(svg);
      }
      this.written.add(file);
    }
    return pathToFileURL(file).href;
  };

  dispose(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** Removes the folders of extension hosts that have ended. */
  private async sweep(): Promise<void> {
    const names = await fs.promises.readdir(this.root).catch(() => [] as string[]);
    for (const name of names) {
      const pid = Number(name);
      if (!/^\d+$/.test(name) || pid === process.pid || isRunning(pid)) continue;
      await fs.promises.rm(path.join(this.root, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
