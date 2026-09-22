import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteProjectMirror } from '../src/overleaf/mirrorCore';
import type { OverleafClient } from '../src/overleaf/overleafClient';

/**
 * Covers the create-on-Overleaf path: Overleaf hands back a project that already holds a default
 * main.tex, and the rollback is deliberately asymmetric around the point the manifest lands.
 */

let parentRoot: string;

beforeEach(async () => {
  parentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'create-remote-'));
});

afterEach(async () => {
  await fs.rm(parentRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A project tree as Overleaf returns it for a freshly created project. */
function freshProject(extraDocs: Array<{ _id: string; name: string }> = []) {
  return {
    rootFolder: {
      _id: 'root-folder-id',
      name: '',
      docs: [{ _id: 'default-doc', name: 'main.tex' }, ...extraDocs],
      fileRefs: [],
      folders: []
    }
  };
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    createProject: vi.fn(async () => 'proj-1'),
    deleteProject: vi.fn(async () => undefined),
    deleteEntity: vi.fn(async () => undefined),
    getServerUrl: () => 'https://example.test',
    connectSocket: vi.fn(async () => ({
      getProject: () => freshProject(),
      disconnect: vi.fn()
    })),
    ...overrides
  } as unknown as OverleafClient;
}

const noopPublish = async () => undefined;

describe('createRemoteProjectMirror', () => {
  it('clears the default main.tex so the scaffold is the only content', async () => {
    const client = fakeClient();
    const result = await createRemoteProjectMirror(client, 'My Paper', parentRoot, {
      scaffold: async root => { await fs.writeFile(path.join(root, 'main.tex'), 'scaffolded\n'); },
      publish: noopPublish,
      register: async () => undefined
    });

    expect((client.deleteEntity as any)).toHaveBeenCalledWith('proj-1', 'doc', 'default-doc');
    expect(result.published).toBe(true);
    // Folder follows the mirror naming convention.
    expect(path.basename(result.root)).toBe('My Paper-proj-1');
    // The manifest must not still claim the deleted default doc.
    const manifest = JSON.parse(await fs.readFile(path.join(result.root, '.overleaf-codex', 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.files)).toEqual([]);
    expect(manifest.projectId).toBe('proj-1');
    await expect(fs.readFile(path.join(result.root, 'main.tex'), 'utf8')).resolves.toBe('scaffolded\n');
  });

  it('refuses to clear a project that holds more than a blank one would', async () => {
    const client = fakeClient({
      connectSocket: vi.fn(async () => ({
        getProject: () => freshProject([
          { _id: 'd2', name: 'chapter1.tex' },
          { _id: 'd3', name: 'chapter2.tex' }
        ]),
        disconnect: vi.fn()
      }))
    });

    await expect(createRemoteProjectMirror(client, 'My Paper', parentRoot, {
      scaffold: noopPublish as never, publish: noopPublish, register: async () => undefined
    })).rejects.toThrow(/refusing to clear/);

    // Nothing was deleted, and the project we made was rolled back.
    expect((client.deleteEntity as any)).not.toHaveBeenCalled();
    expect((client.deleteProject as any)).toHaveBeenCalledWith('proj-1');
    await expect(fs.readdir(parentRoot)).resolves.toEqual([]);
  });

  it('rolls back the remote project when scaffolding fails', async () => {
    const client = fakeClient();
    await expect(createRemoteProjectMirror(client, 'My Paper', parentRoot, {
      scaffold: async () => { throw new Error('template exploded'); },
      publish: noopPublish,
      register: async () => undefined
    })).rejects.toThrow(/template exploded/);

    expect((client.deleteProject as any)).toHaveBeenCalledWith('proj-1');
    await expect(fs.readdir(parentRoot)).resolves.toEqual([]);
  });

  it('keeps the project when only publishing fails, since the mirror can retry', async () => {
    const client = fakeClient();
    const result = await createRemoteProjectMirror(client, 'My Paper', parentRoot, {
      scaffold: async root => { await fs.writeFile(path.join(root, 'main.tex'), 'x\n'); },
      publish: async () => { throw new Error('upload exploded'); },
      register: async () => undefined
    });

    expect(result.published).toBe(false);
    expect(result.publishError?.message).toMatch(/upload exploded/);
    // Deleting here would throw away a legitimate, resumable mirror.
    expect((client.deleteProject as any)).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(result.root, '.overleaf-codex', 'manifest.json'))).resolves.toBeTruthy();
  });

  it('registers the new mirror so it appears alongside the others', async () => {
    const register = vi.fn(async (_root: string) => undefined);
    await createRemoteProjectMirror(fakeClient(), 'My Paper', parentRoot, {
      scaffold: async () => undefined, publish: noopPublish, register
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0]).toContain('My Paper-proj-1');
  });
});
