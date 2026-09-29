import { describe, expect, it } from 'vitest';
import { filePathById, folderPathById, removeManifestSubtree } from '../src/overleaf/manifest';
import { findUnsafeFolderDescendants } from '../src/overleaf/syncStatus';
import type { OverleafCodexManifest, SyncStatusItem, SyncStatusKind } from '../src/overleaf/types';

/**
 * Folder deletes and restores used to touch only manifest.files, so a deleted folder could be
 * neither pushed nor pulled, and the paths that did delete one left its descendants orphaned.
 */

function manifest(): OverleafCodexManifest {
  const file = (path: string, entityId: string, parentFolderId: string) =>
    ({ path, entityId, entityType: 'doc', parentFolderId, binary: false, sha1: `sha-${entityId}` });
  return {
    schemaVersion: 3,
    serverUrl: 'https://example.test/',
    projectId: 'p1',
    projectName: 'Example',
    files: {
      'main.tex': file('main.tex', 'd-main', 'root'),
      'Sections/intro.tex': file('Sections/intro.tex', 'd-intro', 'f-sections'),
      'Sections-legacy/old.tex': file('Sections-legacy/old.tex', 'd-old', 'f-legacy'),
      'Sections-legacy/sub/deep.tex': file('Sections-legacy/sub/deep.tex', 'd-deep', 'f-sub')
    },
    folders: {
      '': { path: '', entityId: 'root' },
      'Sections': { path: 'Sections', entityId: 'f-sections', parentFolderId: 'root' },
      'Sections-legacy': { path: 'Sections-legacy', entityId: 'f-legacy', parentFolderId: 'root' },
      'Sections-legacy/sub': { path: 'Sections-legacy/sub', entityId: 'f-sub', parentFolderId: 'f-legacy' }
    },
    ignore: []
  } as unknown as OverleafCodexManifest;
}

describe('removeManifestSubtree', () => {
  it('removes the folder and every file and folder beneath it', () => {
    const target = manifest();
    removeManifestSubtree(target, 'Sections-legacy');
    expect(Object.keys(target.files).sort()).toEqual(['Sections/intro.tex', 'main.tex']);
    expect(Object.keys(target.folders).sort()).toEqual(['', 'Sections']);
  });

  it('leaves a sibling whose name merely shares the prefix', () => {
    const target = manifest();
    removeManifestSubtree(target, 'Sections');
    // "Sections-legacy" starts with "Sections" but is not inside it.
    expect(target.folders['Sections-legacy']).toBeDefined();
    expect(target.files['Sections-legacy/old.tex']).toBeDefined();
    expect(target.files['Sections/intro.tex']).toBeUndefined();
  });

  it('returns the removed files so callers can drop runtime state keyed by them', () => {
    const removed = removeManifestSubtree(manifest(), 'Sections-legacy');
    expect(removed.map(file => file.entityId).sort()).toEqual(['d-deep', 'd-old']);
  });

  it('invalidates the entity index so removed ids no longer resolve', () => {
    const target = manifest();
    // Warm the cache first, as a running sync would have.
    expect(filePathById(target, 'd-old')).toBe('Sections-legacy/old.tex');
    expect(folderPathById(target, 'f-sub')).toBe('Sections-legacy/sub');
    removeManifestSubtree(target, 'Sections-legacy');
    expect(filePathById(target, 'd-old')).toBeUndefined();
    expect(folderPathById(target, 'f-sub')).toBeUndefined();
  });

  it('refuses to remove the project root', () => {
    expect(() => removeManifestSubtree(manifest(), '')).toThrow(/project root/);
  });
});

describe('findUnsafeFolderDescendants', () => {
  const item = (path: string, status: SyncStatusKind): SyncStatusItem =>
    ({ path, status, blocking: status !== 'synced' }) as SyncStatusItem;

  it('lets a folder go when everything under it is only missing locally', () => {
    const items = [item('Sections-legacy', 'local deleted'), item('Sections-legacy/old.tex', 'local deleted')];
    expect(findUnsafeFolderDescendants(items, 'Sections-legacy')).toEqual([]);
  });

  // classifySyncStatus reports 'local deleted' for any tracked file missing locally and present
  // remotely - including one a collaborator has since edited. Only the hashes tell them apart.
  it('blocks a locally deleted file that a collaborator edited on Overleaf', () => {
    const edited = { ...item('Sections-legacy/old.tex', 'local deleted'), baseHash: 'base', remoteHash: 'edited' };
    expect(findUnsafeFolderDescendants([edited], 'Sections-legacy')).toEqual([edited]);
  });

  it('lets a locally deleted file go when its Overleaf copy still matches the base', () => {
    const untouched = { ...item('Sections-legacy/old.tex', 'local deleted'), baseHash: 'base', remoteHash: 'base' };
    expect(findUnsafeFolderDescendants([untouched], 'Sections-legacy')).toEqual([]);
  });

  it.each(['remote ahead', 'diverged', 'remote only', 'error'] as const)(
    'blocks on a descendant that is %s',
    status => {
      const items = [item('Sections-legacy/old.tex', 'local deleted'), item('Sections-legacy/sub/deep.tex', status)];
      expect(findUnsafeFolderDescendants(items, 'Sections-legacy').map(unsafe => unsafe.path))
        .toEqual(['Sections-legacy/sub/deep.tex']);
    }
  );

  it('ignores the folder item itself and anything outside it', () => {
    const items = [
      item('Sections-legacy', 'diverged'),
      item('Sections/intro.tex', 'remote ahead'),
      item('main.tex', 'error')
    ];
    expect(findUnsafeFolderDescendants(items, 'Sections-legacy')).toEqual([]);
  });
});
