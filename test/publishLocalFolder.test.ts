import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectRootDocuments,
  isPublishedInPlace,
  localIgnoreEntries,
  previewLocalPublish,
  publishLocalFolder,
  upgradeGeneratedLatexmkRc,
  upgradeGeneratedVsCodeSettings,
  writeMirrorSupportFiles
} from '../src/overleaf/mirrorCore';
import type { OverleafClient } from '../src/overleaf/overleafClient';

const execFileAsync = promisify(execFile);

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

describe('generated .latexmkrc build settings', () => {
  // Any latexmk run in a mirror builds into the directory VS Code's PDF viewer reads. One without
  // SyncTeX - an agent checking the build, say - made pdfTeX delete the viewer's .synctex.gz, and
  // latexmk then called the unchanged document up to date, so neither Cmd+click in the PDF nor
  // pressing compile recovered it until a .tex file changed.
  const synctexLine = '$$cmd =~ s/ %O/ -synctex=1 %O/';
  const alwaysCompileLine = '$go_mode = 1 unless grep { /^-pvc/ } @ARGV;';
  const header = '# Generated by Overleaf Codex for local VS Code/LaTeX Workshop builds.';

  it('writes SyncTeX and compiles for real on every run in a newly generated file', async () => {
    await writeMirrorSupportFiles(root, 'main.tex', 'pdflatex');
    const rc = await read('.latexmkrc');
    expect(rc).toContain(synctexLine);
    expect(rc).toContain('\\$pdflatex');
    expect(rc).toContain(alwaysCompileLine);
  });

  it('adds both, once, to a file generated before either existed', async () => {
    const old = `${header}\n$out_dir = 'build';`;
    await write('.latexmkrc', old);

    expect(await upgradeGeneratedLatexmkRc(root, 'main.tex')).toBe(true);
    const upgraded = await read('.latexmkrc');
    expect(upgraded.startsWith(`${old}\n`)).toBe(true);
    expect(upgraded).toContain(synctexLine);
    expect(upgraded).toContain(alwaysCompileLine);

    expect(await upgradeGeneratedLatexmkRc(root, 'main.tex')).toBe(false);
    await expect(read('.latexmkrc')).resolves.toBe(upgraded);
  });

  it('adds only what is missing to a file that already writes SyncTeX', async () => {
    const withSynctex = `${header}\nforeach my $cmd (\\$pdflatex) {\n  $$cmd =~ s/ %O/ -synctex=1 %O/;\n}\n`;
    await write('.latexmkrc', withSynctex);

    expect(await upgradeGeneratedLatexmkRc(root, 'main.tex')).toBe(true);
    const upgraded = await read('.latexmkrc');
    expect(upgraded).toBe(`${withSynctex}# Compile for real every time, even when latexmk thinks nothing changed.\n${alwaysCompileLine}\n`);
  });

  it('never touches a .latexmkrc the user wrote, or one that is missing', async () => {
    await write('chapter/.latexmkrc', '$pdf_mode = 1; # mine\n');
    expect(await upgradeGeneratedLatexmkRc(root, 'chapter/main.tex')).toBe(false);
    await expect(read('chapter/.latexmkrc')).resolves.toBe('$pdf_mode = 1; # mine\n');
    expect(await upgradeGeneratedLatexmkRc(root, 'main.tex')).toBe(false);
  });
});

describe('generated local build: biber cache', () => {
  // Biber unpacks itself into PAR_TEMP. Older files fixed that to one path in the system temp
  // directory, which on a shared Linux machine the first user to build owns.
  const uid = process.getuid?.() ?? 0;

  async function privateRuntimeDir(): Promise<string> {
    const runtime = path.join(root, '..', `${path.basename(root)}-xdg`);
    await fs.mkdir(runtime, { mode: 0o700 });
    return runtime;
  }

  it.runIf(process.platform !== 'win32')('works the cache out at build time in the LaTeX Workshop task', async () => {
    await writeMirrorSupportFiles(root, 'main.tex', 'pdflatex');
    const settings = JSON.parse(await read('.vscode/settings.json'));
    const tool = settings['latex-workshop.latex.tools'].find((item: { name: string }) => item.name === 'latexmk-local-mirror');
    expect(tool.env.PAR_TEMP).toBeUndefined();
    expect(tool.env.PAR_GLOBAL_TEMP).toBeUndefined();
    const group = /\{ biber_root=.*?; \}/.exec(tool.args[1])?.[0];
    expect(group).toBeDefined();
    const runtime = await privateRuntimeDir();
    try {
      const { stdout } = await execFileAsync('bash', ['-c', `${group} && printf %s "$PAR_TEMP"`], {
        cwd: root,
        env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtime }
      });
      expect(stdout.startsWith(path.join(runtime, `latex-toolkit-${uid}`, 'biber') + path.sep)).toBe(true);
      expect((await fs.stat(path.join(runtime, `latex-toolkit-${uid}`))).mode & 0o777).toBe(0o700);
    } finally {
      await fs.rm(runtime, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('works the cache out at build time in .latexmkrc', async () => {
    await writeMirrorSupportFiles(root, 'main.tex', 'pdflatex');
    const runtime = await privateRuntimeDir();
    try {
      const { stdout } = await execFileAsync('perl', ['-e', 'do "./.latexmkrc"; die $@ if $@; print $ENV{PAR_TEMP}'], {
        cwd: root,
        env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtime }
      });
      expect(stdout.startsWith(path.join(runtime, `latex-toolkit-${uid}`, 'biber') + path.sep)).toBe(true);
    } finally {
      await fs.rm(runtime, { recursive: true, force: true });
    }
  });

  it('moves files generated with a fixed shared path to the per-user cache, once', async () => {
    const header = '# Generated by Overleaf Codex for local VS Code/LaTeX Workshop builds.';
    await write('.latexmkrc', [
      header,
      "my $overleaf_codex_build_dir = '.overleaf-codex/local-build';",
      "my $overleaf_codex_biber_cache = '/tmp/overleaf-codex-biber/0123456789ab';",
      'make_path($overleaf_codex_biber_cache);',
      "$ENV{'PAR_TEMP'} = $overleaf_codex_biber_cache;",
      ''
    ].join('\n'));
    expect(await upgradeGeneratedLatexmkRc(root, 'main.tex')).toBe(true);
    const rc = await read('.latexmkrc');
    expect(rc).not.toContain('/tmp/overleaf-codex-biber');
    expect(rc).toContain('latex-toolkit-$<');
    expect(await upgradeGeneratedLatexmkRc(root, 'main.tex')).toBe(false);

    await write('.vscode/settings.json', JSON.stringify({
      'latex-workshop.latex.tools': [{
        name: 'latexmk-local-mirror',
        command: 'bash',
        args: ['-lc', "mkdir -p '.overleaf-codex/local-build' && mkdir -p '/tmp/overleaf-codex-biber/0123456789ab' && cd '.' && latexmk main.tex"],
        env: { TEXINPUTS: '.:', PAR_GLOBAL_TEMP: '/tmp/overleaf-codex-biber/0123456789ab', PAR_TEMP: '/tmp/overleaf-codex-biber/0123456789ab' }
      }],
      'editor.fontSize': 14
    }));
    expect(await upgradeGeneratedVsCodeSettings(root)).toBe(true);
    const settings = JSON.parse(await read('.vscode/settings.json'));
    const tool = settings['latex-workshop.latex.tools'][0];
    expect(tool.args[1]).not.toContain('overleaf-codex-biber');
    expect(tool.args[1]).toContain('{ biber_root=');
    expect(tool.args[1]).toContain("&& cd '.' && latexmk main.tex");
    expect(tool.env).toEqual({ TEXINPUTS: '.:' });
    expect(settings['editor.fontSize']).toBe(14);
    expect(await upgradeGeneratedVsCodeSettings(root)).toBe(false);
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
