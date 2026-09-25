import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { classifyProjectPaths, fetchRemoteSnapshot, reconcileProject, type RemoteSnapshot } from '../src/overleaf/syncReconciler';
import { scanLocalProject } from '../src/overleaf/syncStatus';
import { SyncHealthService } from '../src/overleaf/syncHealthService';
import type { OverleafCodexManifest } from '../src/overleaf/types';
import { sha1 } from '../src/overleaf/util';

/**
 * The realtime service and the CLI engine used to carry separate copies of this read. These cover
 * the shared implementation directly, so a drift between the two callers shows up here first.
 */

function manifest(): OverleafCodexManifest {
  return {
    schemaVersion: 1,
    serverUrl: 'https://example.test',
    projectId: 'p1',
    projectName: 'Example',
    rootDocId: 'doc-main',
    compiler: 'pdflatex',
    files: {},
    folders: { '': { path: '', entityId: 'root' } },
    ignore: []
  } as unknown as OverleafCodexManifest;
}

function project() {
  return {
    rootFolder: {
      _id: 'root',
      name: '',
      docs: [{ _id: 'doc-main', name: 'main.tex', version: 3 }],
      fileRefs: [{ _id: 'file-fig', name: 'fig.png' }],
      folders: []
    }
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    getProject: () => project(),
    joinDoc: vi.fn(async () => ({ content: '\\documentclass{article}', version: 7 })),
    ...overrides
  } as never;
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    downloadProjectFileToPath: vi.fn(async () => ({ size: 12, sha1: 'sha-fig', gitBlobHash: 'blob-fig' })),
    ...overrides
  } as never;
}

describe('fetchRemoteSnapshot', () => {
  it('joins docs, downloads binaries and records the joined doc version', async () => {
    const snapshot = await fetchRemoteSnapshot({
      manifest: manifest(),
      session: session(),
      client: client(),
      syncHealth: new SyncHealthService(),
      mode: 'full'
    });

    expect(snapshot.contents.get('main.tex')).toBe('\\documentclass{article}');
    expect(snapshot.hashes.get('fig.png')).toBe('sha-fig');
    expect(snapshot.blobHashes.get('fig.png')).toBe('blob-fig');
    expect(snapshot.failures.size).toBe(0);
    // The version the join returned wins over the one in the tree listing.
    expect(snapshot.manifest.files['main.tex'].version).toBe(7);
    expect(snapshot.metrics).toMatchObject({ treeCount: 1, joinDocCount: 1, binaryGetCount: 1 });
  });

  it('records a per-path failure instead of failing the whole snapshot', async () => {
    const onFailure = vi.fn();
    const snapshot = await fetchRemoteSnapshot({
      manifest: manifest(),
      session: session({ joinDoc: vi.fn(async () => { throw new Error('join exploded'); }) }),
      client: client(),
      syncHealth: new SyncHealthService(),
      mode: 'full',
      onFailure
    });

    expect(snapshot.failures.get('main.tex')).toMatch(/join exploded/);
    expect(snapshot.contents.has('main.tex')).toBe(false);
    // A binary in the same pass still succeeds.
    expect(snapshot.hashes.get('fig.png')).toBe('sha-fig');
    expect(onFailure).toHaveBeenCalledWith('main.tex', expect.stringMatching(/join exploded/));
  });

  it('reports progress once per path so both callers can render the same totals', async () => {
    const seen: Array<{ path: string; completed: number; total: number }> = [];
    await fetchRemoteSnapshot({
      manifest: manifest(),
      session: session(),
      client: client(),
      syncHealth: new SyncHealthService(),
      mode: 'full',
      onProgress: event => void seen.push(event)
    });

    expect(seen.map(event => event.path).sort()).toEqual(['fig.png', 'main.tex']);
    expect(seen.every(event => event.total === 2)).toBe(true);
    expect(seen.map(event => event.completed)).toEqual([1, 2]);
  });

  it('refuses to silently skip binaries when no client is available', async () => {
    await expect(fetchRemoteSnapshot({
      manifest: manifest(),
      session: session(),
      client: undefined,
      syncHealth: new SyncHealthService(),
      mode: 'full'
    })).rejects.toThrow(/client is not available/);
  });

  it('fails loudly when the session has no project tree', async () => {
    await expect(fetchRemoteSnapshot({
      manifest: manifest(),
      session: session({ getProject: () => undefined }),
      client: client(),
      syncHealth: new SyncHealthService()
    })).rejects.toThrow(/does not have a project tree/);
  });
});


describe('classifyProjectPaths', () => {
  async function fixture(files: Record<string, string>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reconciler-'));
    for (const [rel, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), content);
    }
    return root;
  }

  function snapshot(overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
    return {
      manifest: manifest(),
      contents: new Map(),
      hashes: new Map(),
      blobHashes: new Map(),
      failures: new Map(),
      reused: new Set(),
      metrics: { treeCount: 1, joinDocCount: 0, binaryGetCount: 0, remoteCacheReuseCount: 0 },
      ...overrides
    };
  }

  it('excludes the local-only paths that used to reach CLI status reports', async () => {
    const root = await fixture({
      'main.tex': 'hello',
      '.DS_Store': 'junk',
      '.latexmkrc': 'junk',
      '.gitignore': 'junk',
      '.overleaf-codexignore': 'junk'
    });
    try {
      const local = await scanLocalProject(root, manifest());
      const result = await classifyProjectPaths({
        root, manifest: manifest(), remote: snapshot(), localScan: local, mode: 'full'
      });
      expect(result.items.map(item => item.path)).toEqual(['main.tex']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('honours a caller-specific exclusion on top of the shared ones', async () => {
    const root = await fixture({ 'main.tex': 'hello', 'theme.sty': 'x' });
    try {
      const local = await scanLocalProject(root, manifest());
      const result = await classifyProjectPaths({
        root, manifest: manifest(), remote: snapshot(), localScan: local, mode: 'full',
        isExcluded: relPath => relPath === 'theme.sty'
      });
      expect(result.items.map(item => item.path)).toEqual(['main.tex']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports paths in a stable sorted order regardless of scan order', async () => {
    const root = await fixture({ 'z.tex': 'z', 'a.tex': 'a', 'm/b.tex': 'b' });
    try {
      const local = await scanLocalProject(root, manifest());
      const result = await classifyProjectPaths({
        root, manifest: manifest(), remote: snapshot(), localScan: local, mode: 'full'
      });
      expect(result.items.map(item => item.path)).toEqual(['a.tex', 'm/b.tex', 'z.tex']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('carries local size and mtime into the report', async () => {
    const root = await fixture({ 'main.tex': 'hello' });
    try {
      const local = await scanLocalProject(root, manifest());
      const result = await classifyProjectPaths({
        root, manifest: manifest(), remote: snapshot(), localScan: local, mode: 'full'
      });
      expect(result.items[0].localSize).toBe(5);
      expect(typeof result.items[0].localMtimeMs).toBe('number');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('initialises the trusted base for a doc that matches remote, enabling three-way detection', async () => {
    const root = await fixture({ 'main.tex': 'shared' });
    try {
      const remoteManifest = manifest();
      remoteManifest.files = {
        'main.tex': { path: 'main.tex', entityId: 'doc-main', entityType: 'doc', parentFolderId: 'root', binary: false }
      } as never;
      const local = await scanLocalProject(root, manifest());
      const result = await classifyProjectPaths({
        root,
        manifest: manifest(),
        remote: snapshot({ manifest: remoteManifest, contents: new Map([['main.tex', 'shared']]) }),
        localScan: local,
        mode: 'full'
      });
      expect(result.manifestChanged).toBe(true);
      // The base doc is what a later divergence check compares against.
      await expect(fs.readFile(path.join(root, '.overleaf-codex', 'base', 'docs', 'doc-main.tex'), 'utf8'))
        .resolves.toBe('shared');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});


describe('reconcileProject', () => {
  async function fixture(files: Record<string, string>) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-project-'));
    for (const [rel, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), content);
    }
    return root;
  }

  function remoteSnapshot(projectVersion?: number): RemoteSnapshot {
    const remoteManifest = manifest();
    remoteManifest.projectVersion = projectVersion;
    return {
      manifest: remoteManifest,
      contents: new Map(),
      hashes: new Map(),
      blobHashes: new Map(),
      failures: new Map(),
      reused: new Set(),
      metrics: { treeCount: 1, joinDocCount: 0, binaryGetCount: 0, remoteCacheReuseCount: 0 }
    };
  }

  it('adopts the remote project version once nothing is outstanding', async () => {
    const root = await fixture({ 'main.tex': 'hello' });
    try {
      const local = await scanLocalProject(root, manifest());
      const target = manifest();
      const result = await reconcileProject({
        root, manifest: target, remote: remoteSnapshot(42), localScan: local, mode: 'full'
      });
      expect(target.projectVersion).toBe(42);
      expect(result.manifestChanged).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not adopt the remote project version while a read failed', async () => {
    const root = await fixture({ 'main.tex': 'hello' });
    try {
      const local = await scanLocalProject(root, manifest());
      const target = manifest();
      const remote = remoteSnapshot(42);
      remote.failures.set('other.tex', 'boom');
      await reconcileProject({ root, manifest: target, remote, localScan: local, mode: 'full' });
      expect(target.projectVersion).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  describe('repairs a wrongly recorded base once both sides agree', () => {
    // A push race once stored an empty-content base for a document both sides held in full; the
    // next edit would then have looked like a change on both sides - a false conflict.
    const tracked = () => ({
      path: 'main.tex', entityId: 'doc-main', entityType: 'doc' as const, parentFolderId: 'root',
      version: 3, sha1: sha1('shared'), baseHash: sha1('')
    });

    it('from the content a full check read', async () => {
      const root = await fixture({ 'main.tex': 'shared' });
      try {
        const target = manifest();
        target.files['main.tex'] = tracked();
        const remote = remoteSnapshot();
        remote.manifest.files['main.tex'] = tracked();
        remote.contents.set('main.tex', 'shared');
        const result = await reconcileProject({
          root, manifest: target, remote, localScan: await scanLocalProject(root, target), mode: 'full'
        });
        expect(result.report.items.find(item => item.path === 'main.tex')?.status).toBe('synced');
        expect(target.files['main.tex'].baseHash).toBe(sha1('shared'));
        await expect(fs.readFile(path.join(root, '.overleaf-codex', 'base', 'docs', 'doc-main.tex'), 'utf8')).resolves.toBe('shared');
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it('from the stored base copy when an incremental check reused the remote', async () => {
      const root = await fixture({ 'main.tex': 'shared', '.overleaf-codex/base/docs/doc-main.tex': 'shared' });
      try {
        const target = manifest();
        target.files['main.tex'] = tracked();
        const remote = remoteSnapshot();
        remote.manifest.files['main.tex'] = tracked();
        remote.reused.add('main.tex');
        await reconcileProject({ root, manifest: target, remote, localScan: await scanLocalProject(root, target), mode: 'incremental' });
        expect(target.files['main.tex'].baseHash).toBe(sha1('shared'));
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  it('marks the report partial when a remote read failed', async () => {
    const root = await fixture({ 'main.tex': 'hello' });
    try {
      const local = await scanLocalProject(root, manifest());
      const remote = remoteSnapshot();
      remote.failures.set('main.tex', 'boom');
      const result = await reconcileProject({
        root, manifest: manifest(), remote, localScan: local, mode: 'full'
      });
      expect(result.report.completeness).toBe('partial');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
