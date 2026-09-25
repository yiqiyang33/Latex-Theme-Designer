import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectRootDocuments,
  isPublishedInPlace,
  localIgnoreEntries,
  previewLocalPublish,
  publishLocalFolder
} from '../src/overleaf/mirrorCore';
import type { OverleafClient } from '../src/overleaf/overleafClient';

/**
 * Publishing works on a folder the user already owns, so every test here is really about what it
 * must NOT do: delete the folder on rollback, or overwrite files the user already had.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-local-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function write(rel: string, content: string) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
}

async function read(rel: string) {
  return fs.readFile(path.join(root, rel), 'utf8');
}

const exists = (rel: string) => fs.stat(path.join(root, rel)).then(() => true, () => false);

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    createProject: vi.fn(async () => 'proj-1'),
    deleteProject: vi.fn(async () => undefined),
    deleteEntity: vi.fn(async () => undefined),
    getServerUrl: () => 'https://example.test',
    connectSocket: vi.fn(async () => ({
      getProject: () => ({
        rootFolder: { _id: 'root-folder', name: '', docs: [{ _id: 'default-doc', name: 'main.tex' }], fileRefs: [], folders: [] }
      }),
      disconnect: vi.fn()
    })),
    ...overrides
  } as unknown as OverleafClient;
}

const opts = (publish = async () => undefined, excludedPaths?: string[]) => ({ publish, register: async () => undefined, excludedPaths });

/**
 * A client whose server URL the manifest validator rejects, so writeManifest throws - after the
 * metadata folder, the in-place marker and the ignore entries already exist, which is exactly the
 * window rollback has to clean up.
 */
const failingAtManifest = () => fakeClient({ getServerUrl: () => undefined });

describe('publishLocalFolder rollback never touches the user folder', () => {
  it('keeps every user file when a failure lands before the manifest', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('figures/plot.png', 'PNG');
    await write('notes/draft.md', 'my notes');
    const client = failingAtManifest();

    await expect(publishLocalFolder(client, root, 'Paper', 'paper.tex', opts(undefined, ['notes/draft.md'])))
      .rejects.toThrow(/serverUrl/);

    // The user's work is untouched...
    await expect(read('paper.tex')).resolves.toBe('\\documentclass{article}\n');
    await expect(read('figures/plot.png')).resolves.toBe('PNG');
    await expect(read('notes/draft.md')).resolves.toBe('my notes');
    // ...what we created is gone...
    expect(await exists('.overleaf-codex')).toBe(false);
    expect(await exists('.overleaf-codexignore')).toBe(false);
    // ...and so is the remote project.
    expect((client.deleteProject as any)).toHaveBeenCalledWith('proj-1');
  });

  it('restores a pre-existing ignore file exactly on rollback, appended entries and all', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('notes.txt', 'n');
    await write('.overleaf-codexignore', '# mine\nscratch/');

    await expect(publishLocalFolder(failingAtManifest(), root, 'Paper', 'paper.tex', opts(undefined, ['notes.txt'])))
      .rejects.toThrow();
    await expect(read('.overleaf-codexignore')).resolves.toBe('# mine\nscratch/');
  });

  it('keeps a pre-existing metadata folder but removes the marker it added', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('.overleaf-codex/leftover.txt', 'from an earlier attempt');

    await expect(publishLocalFolder(failingAtManifest(), root, 'Paper', 'paper.tex', opts())).rejects.toThrow();
    await expect(read('.overleaf-codex/leftover.txt')).resolves.toBe('from an earlier attempt');
    expect(await isPublishedInPlace(root)).toBe(false);
  });

  it('keeps the mirror and reports rather than deleting when only the upload fails', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    const client = fakeClient();
    const result = await publishLocalFolder(client, root, 'Paper', 'paper.tex', opts(async () => {
      throw new Error('upload exploded');
    }));

    expect(result.published).toBe(false);
    expect((client.deleteProject as any)).not.toHaveBeenCalled();
    expect(await exists('.overleaf-codex/manifest.json')).toBe(true);
    await expect(read('paper.tex')).resolves.toBe('\\documentclass{article}\n');
  });
});

describe('publishLocalFolder keeps the files a user already has', () => {
  it('does not overwrite existing editor, latexmk or agent files, and says so', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('.vscode/settings.json', '{"mine": true}\n');
    await write('.latexmkrc', '$pdf_mode = 1; # mine\n');
    await write('AGENTS.md', '# my agent rules\n');

    const result = await publishLocalFolder(fakeClient(), root, 'Paper', 'paper.tex', opts());

    await expect(read('.vscode/settings.json')).resolves.toBe('{"mine": true}\n');
    await expect(read('.latexmkrc')).resolves.toBe('$pdf_mode = 1; # mine\n');
    await expect(read('AGENTS.md')).resolves.toBe('# my agent rules\n');
    expect(result.keptFiles).toEqual(['.latexmkrc', '.vscode/settings.json', 'AGENTS.md']);
  });

  it('still writes them when the user has none', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    const result = await publishLocalFolder(fakeClient(), root, 'Paper', 'paper.tex', opts());

    expect(result.keptFiles).toEqual([]);
    expect(await exists('.vscode/settings.json')).toBe(true);
    expect(await exists('.latexmkrc')).toBe(true);
    expect(await exists('AGENTS.md')).toBe(true);
  });

  it('refuses a folder that is already a mirror, before creating anything remotely', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('.overleaf-codex/manifest.json', '{}');
    const client = fakeClient();

    await expect(publishLocalFolder(client, root, 'Paper', 'paper.tex', opts()))
      .rejects.toThrow(/already an Overleaf mirror/);
    expect((client.createProject as any)).not.toHaveBeenCalled();
  });
});

describe('publishLocalFolder leaves unchecked files out', () => {
  it('appends them to the ignore file, so neither this upload nor later syncs pick them up', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('figures/draft [old].png', 'PNG');
    await write('notes.txt', 'n');
    await write('.overleaf-codexignore', '# mine\nscratch/\n');

    await publishLocalFolder(fakeClient(), root, 'Paper', 'paper.tex', opts(undefined, ['figures/draft [old].png', 'notes.txt']));

    const ignore = await read('.overleaf-codexignore');
    expect(ignore.startsWith('# mine\nscratch/\n')).toBe(true);
    expect(ignore).toContain('/figures/draft \\[old].png\n/notes.txt\n');
    expect((await previewLocalPublish(root)).files.map(file => file.path)).toEqual(['paper.tex']);
  });

  it('refuses to leave out the main document, before creating anything remotely', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    const client = fakeClient();

    await expect(publishLocalFolder(client, root, 'Paper', 'paper.tex', opts(undefined, ['paper.tex'])))
      .rejects.toThrow(/main document/);
    expect((client.createProject as any)).not.toHaveBeenCalled();
  });

  it('refuses a main document that would not be uploaded', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    const client = fakeClient();

    await expect(publishLocalFolder(client, root, 'Paper', '../escape.tex', opts())).rejects.toThrow(/not among the files/);
    expect((client.createProject as any)).not.toHaveBeenCalled();
  });

  it('marks the folder as published in place, so deleting the mirror keeps it', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    expect(await isPublishedInPlace(root)).toBe(false);
    await publishLocalFolder(fakeClient(), root, 'Paper', 'paper.tex', opts());
    expect(await isPublishedInPlace(root)).toBe(true);
  });
});

describe('publishLocalFolder refuses to nest mirrors', () => {
  it('refuses a folder inside a mirror', async () => {
    await write('.overleaf-codex/manifest.json', '{}');
    await write('chapter/paper.tex', '\\documentclass{article}\n');
    const client = fakeClient();

    await expect(publishLocalFolder(client, path.join(root, 'chapter'), 'Chapter', 'paper.tex', opts()))
      .rejects.toThrow(/inside the Overleaf mirror/);
    expect((client.createProject as any)).not.toHaveBeenCalled();
  });

  it('refuses a folder that contains a mirror', async () => {
    await write('paper.tex', '\\documentclass{article}\n');
    await write('old-copy/.overleaf-codex/manifest.json', '{}');
    const client = fakeClient();

    expect((await previewLocalPublish(root)).nestedMirrors).toEqual(['old-copy']);
    await expect(publishLocalFolder(client, root, 'Paper', 'paper.tex', opts())).rejects.toThrow(/contains another Overleaf mirror/);
    expect((client.createProject as any)).not.toHaveBeenCalled();
  });
});

describe('localIgnoreEntries', () => {
  it('anchors each path and escapes the characters the ignore syntax would read as patterns', () => {
    const excluded = ['a[1].tex', 'x*.png', '#notes.md', '!keep.tex', 'trailing.tex '];
    const entries = localIgnoreEntries(excluded, [...excluded, 'a1.tex', 'xy.png', 'notes.md', 'keep.tex', 'trailing.tex']);
    expect(entries).toEqual(['/a\\[1].tex', '/x\\*.png', '/#notes.md', '/!keep.tex', '/trailing.tex\\ ']);
  });

  it('rejects entries that would also catch a file nobody unchecked', () => {
    // `?` has no escape, so it stays a one-character wildcard and would also match qa.tex.
    expect(() => localIgnoreEntries(['q?.tex'], ['q?.tex', 'qa.tex'])).toThrow(/qa\.tex/);
    expect(localIgnoreEntries(['q?.tex'], ['q?.tex', 'other.tex'])).toEqual(['/q?.tex']);
  });
});

describe('previewLocalPublish', () => {
  it('applies an ignore file the folder already has', async () => {
    await write('main.tex', '\\documentclass{article}\n');
    await write('scratch/try.tex', 'x');
    await write('.overleaf-codexignore', 'scratch/\n');

    expect((await previewLocalPublish(root)).files.map(file => file.path)).toEqual(['main.tex']);
  });

  it('lists sources and leaves out build output, VCS and editor state', async () => {
    await write('main.tex', '\\documentclass{article}\n');
    await write('refs.bib', '@article{x}');
    await write('figures/a.png', 'PNG');
    await write('main.pdf', 'PDF');
    await write('main.aux', 'aux');
    await write('.git/config', '[core]');
    await write('node_modules/pkg/index.js', 'x');
    await write('.vscode/settings.json', '{}');
    await write('.DS_Store', 'junk');

    const preview = await previewLocalPublish(root);
    expect(preview.files.map(file => file.path)).toEqual(['figures/a.png', 'main.tex', 'refs.bib']);
    expect(preview.totalBytes).toBe('\\documentclass{article}\n'.length + '@article{x}'.length + 'PNG'.length);
  });
});

describe('detectRootDocuments', () => {
  it('finds documentclass files, main.tex first, then shallower ones', async () => {
    await write('sub/deep/chapter.tex', '\\documentclass{article}\n');
    await write('paper.tex', '\\documentclass{article}\n');
    await write('main.tex', '\\documentclass{book}\n');
    await write('sections/intro.tex', '\\section{Intro}\n'); // a fragment, not a root

    const found = await detectRootDocuments(root, ['sub/deep/chapter.tex', 'paper.tex', 'main.tex', 'sections/intro.tex']);
    expect(found).toEqual(['main.tex', 'paper.tex', 'sub/deep/chapter.tex']);
  });

  it('ignores a documentclass that is commented out', async () => {
    await write('old.tex', '% \\documentclass{article}\n\\section{x}\n');
    expect(await detectRootDocuments(root, ['old.tex'])).toEqual([]);
  });
});
