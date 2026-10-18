import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ImageStore } from '../src/livePreview/imageStore';

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-'));
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('ImageStore', () => {
  it('writes each image once, named by its content, and hands out its file URI', () => {
    const root = tempRoot();
    const store = new ImageStore(root);
    const first = store.write('<svg>a</svg>');
    expect(first.startsWith('file://')).toBe(true);
    expect(fs.readFileSync(fileURLToPath(first), 'utf8')).toBe('<svg>a</svg>');
    expect(store.write('<svg>a</svg>')).toBe(first);
    expect(store.write('<svg>b</svg>')).not.toBe(first);
    expect(path.dirname(fileURLToPath(first))).toBe(path.join(root, String(process.pid)));
    store.dispose();
    expect(fs.existsSync(path.join(root, String(process.pid)))).toBe(false);
  });

  it('falls back to data URIs once it cannot write', () => {
    const root = tempRoot();
    // A file where its folder should go.
    fs.writeFileSync(path.join(root, String(process.pid)), '');
    const store = new ImageStore(root);
    expect(store.write('<svg>c</svg>')).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg>c</svg>').toString('base64')}`);
  });

  it('clears the folders of extension hosts that have ended, and only those', async () => {
    const root = tempRoot();
    const ended = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
    for (const name of [ended, String(process.ppid), 'not-a-host']) fs.mkdirSync(path.join(root, name));
    new ImageStore(root);
    await settle();
    expect(fs.readdirSync(root).sort()).toEqual([String(process.ppid), 'not-a-host'].sort());
  });
});
