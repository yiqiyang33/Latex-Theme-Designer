import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { classifyProjectPaths, fetchRemoteSnapshot, type RemoteSnapshot } from '../src/overleaf/syncReconciler';
import { scanLocalProject } from '../src/overleaf/syncStatus';
import { SyncHealthService } from '../src/overleaf/syncHealthService';
import type { OverleafCodexManifest } from '../src/overleaf/types';

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
