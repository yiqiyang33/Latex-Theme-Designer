import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifestFolderFingerprints, folderFingerprintFromLocal } from '../src/overleaf/folderFingerprint';
import { sha1 } from '../src/overleaf/util';
import type { OverleafCodexManifest } from '../src/overleaf/types';

/**
 * Folder rename detection compares the manifest-side fingerprint against the local-side one, so
 * the two must produce byte-identical part strings for a folder that is actually in sync. They
 * did not: the manifest side prepended the folder-relative path instead of replacing the full one.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-fp-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function manifestFor(files: Record<string, string>, folders: string[]): OverleafCodexManifest {
  const manifest: any = {
    schemaVersion: 1, serverUrl: 'https://example.test', projectId: 'p', projectName: 'P',
    rootDocId: 'd', compiler: 'pdflatex', ignore: [],
    folders: { '': { path: '', entityId: 'root' } },
    files: {}
  };
  for (const folder of folders) manifest.folders[folder] = { path: folder, entityId: `f-${folder}` };
  let index = 0;
  for (const [rel, content] of Object.entries(files)) {
    index += 1;
    manifest.files[rel] = {
      path: rel, entityId: `e${index}`, entityType: 'doc', parentFolderId: 'f',
      binary: false, sha1: sha1(Buffer.from(content))
    };
  }
  return manifest as OverleafCodexManifest;
}

async function writeAll(files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  }
}

describe('folder fingerprints', () => {
  it('agrees between manifest and local for a nested folder in sync', async () => {
    const files = { 'Sections/our_model.tex': 'alpha\n', 'Sections/intro.tex': 'beta\n' };
    await writeAll(files);
    const manifest = manifestFor(files, ['Sections']);

    expect(buildManifestFolderFingerprints(manifest).get('Sections'))
      .toBe(await folderFingerprintFromLocal(root, 'Sections', manifest));
  });

  it('agrees for a folder containing a subfolder', async () => {
    const files = { 'Sections/a.tex': 'a\n', 'Sections/sub/b.tex': 'b\n' };
    await writeAll(files);
    const manifest = manifestFor(files, ['Sections', 'Sections/sub']);

    expect(buildManifestFolderFingerprints(manifest).get('Sections'))
      .toBe(await folderFingerprintFromLocal(root, 'Sections', manifest));
  });

  it('agrees at the project root, where there is no prefix to strip', async () => {
    const files = { 'main.tex': 'main\n', 'Sections/a.tex': 'a\n' };
    await writeAll(files);
    const manifest = manifestFor(files, ['Sections']);

    expect(buildManifestFolderFingerprints(manifest).get(''))
      .toBe(await folderFingerprintFromLocal(root, '', manifest));
  });

  it('still differs when the folder genuinely differs', async () => {
    const files = { 'Sections/a.tex': 'a\n' };
    await writeAll(files);
    const manifest = manifestFor({ 'Sections/a.tex': 'DIFFERENT\n' }, ['Sections']);

    expect(buildManifestFolderFingerprints(manifest).get('Sections'))
      .not.toBe(await folderFingerprintFromLocal(root, 'Sections', manifest));
  });
});
