import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeSyncService } from '../src/overleaf/realtimeSync';
import { SyncGate } from '../src/overleaf/syncGate';
import { createExtensionContextMock, createOutputChannelMock, resetTestState } from './mocks/vscode';

/**
 * Regressions for the Overleaf sync faults observed in real activity logs: a delete event for an
 * untracked path latching the sync gate, and a delete event being trusted without confirming the
 * file is actually gone.
 */

function makeService() {
  const context = createExtensionContextMock();
  const output = createOutputChannelMock();
  const service = new RealtimeSyncService(context as never, output as never);
  return { service, context, output, internals: service as unknown as Record<string, any> };
}

/** The activity log is written fire-and-forget; wait for it before touching the temp dir. */
async function flushActivityLog(internals: Record<string, any>): Promise<void> {
  await internals.activityLogWrite.catch(() => undefined);
}

function makeManifest(root: string) {
  return {
    schemaVersion: 1,
    serverUrl: 'https://www.overleaf.com',
    projectId: 'p1',
    projectName: 'example project',
    rootDocId: 'd1',
    compiler: 'pdflatex',
    files: {
      'main.tex': { path: 'main.tex', entityId: 'd1', entityType: 'doc', parentFolderId: 'f0', binary: false }
    },
    folders: { '': { path: '', entityId: 'f0' } },
    ignore: [],
    root
  };
}

let tmpRoot: string;

beforeEach(async () => {
  resetTestState();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'realtime-sync-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  vi.restoreAllMocks();
});

describe('SyncGate transient blocking', () => {
  it('treats a reconnect or an in-flight check as transient', () => {
    const gate = new SyncGate();
    gate.setProject('reconnecting', 'socket dropped');
    expect(gate.isTransientlyBlocked('Sections/a.tex')).toBe(true);
    gate.setProject('checking');
    expect(gate.isTransientlyBlocked('Sections/a.tex')).toBe(true);
  });

  it('does not treat a path-level block as transient, even mid-reconnect', () => {
    const gate = new SyncGate();
    gate.setProject('reconnecting');
    gate.setPath('Sections/a.tex', 'conflict', 'diverged');
    expect(gate.isTransientlyBlocked('Sections/a.tex')).toBe(false);
    // A sibling with no entry of its own is still only transiently held up.
    expect(gate.isTransientlyBlocked('Sections/b.tex')).toBe(true);
  });

  it('does not treat terminal project states as transient', () => {
    const gate = new SyncGate();
    for (const state of ['ready', 'blocked-auth', 'blocked-tree', 'stopped'] as const) {
      gate.setProject(state);
      expect(gate.isTransientlyBlocked('Sections/a.tex')).toBe(false);
    }
  });
});

describe('SyncGate.applyReport blocking scope', () => {
  function report(items: Array<{ path: string; status: string }>) {
    return {
      items: items.map(item => ({ ...item, blocking: item.status !== 'synced', blockingScope: 'path' })),
      hasBlocking: items.some(item => item.status !== 'synced')
    } as never;
  }

  it('does not gate a file whose only problem is that it needs uploading', () => {
    const gate = new SyncGate();
    gate.applyReport(report([{ path: 'a.tex', status: 'local ahead' }, { path: 'b.tex', status: 'local only' }]));
    expect(gate.canSync('a.tex')).toBe(true);
    expect(gate.canSync('b.tex')).toBe(true);
  });

  it('still gates genuine divergence and errors', () => {
    const gate = new SyncGate();
    gate.applyReport(report([
      { path: 'c.tex', status: 'diverged' },
      { path: 'd.tex', status: 'error' },
      { path: 'e.tex', status: 'remote ahead' }
    ]));
    expect(gate.findBlocking('c.tex')?.state).toBe('conflict');
    expect(gate.findBlocking('d.tex')?.state).toBe('error');
    expect(gate.findBlocking('e.tex')?.state).toBe('pending');
    expect(gate.canSync('c.tex')).toBe(false);
  });
});

describe('handleLocalDelete for untracked paths', () => {
  it('ignores a delete for a path the manifest does not track, without gating it', async () => {
    const { service, internals } = makeService();
    internals.root = tmpRoot;
    internals.manifest = makeManifest(tmpRoot);

    // The real logs showed this firing with the project folder's own name.
    const phantom = 'example project-6a0282b79838aaad1bc58595';
    await internals.handleLocalDelete(phantom);

    const messages = service.getActivityLog().map(entry => entry.message);
    expect(messages.some(message => message.includes('Skipped remote delete'))).toBe(false);
    expect(internals.syncGate.findBlocking(phantom)).toBeUndefined();
    expect(internals.syncGate.canSync(phantom)).toBe(false); // project gate is still 'stopped'
  });

  it('still reports a skipped delete for a tracked path when destructive sync is off', async () => {
    const { service, internals } = makeService();
    internals.root = tmpRoot;
    internals.manifest = makeManifest(tmpRoot);

    await internals.handleLocalDelete('main.tex');
    await flushActivityLog(internals);

    const messages = service.getActivityLog().map(entry => entry.message);
    expect(messages.some(message => message.includes('Skipped remote delete for main.tex'))).toBe(true);
    expect(internals.syncGate.findBlocking('main.tex')?.state).toBe('pending');
  });
});

describe('handleLocalChange delete guard', () => {
  it('does not delete the remote entity when the file still exists locally', async () => {
    const { service, internals } = makeService();
    internals.root = tmpRoot;
    internals.manifest = makeManifest(tmpRoot);
    internals.client = {};
    internals.session = {};
    await fs.writeFile(path.join(tmpRoot, 'main.tex'), '\\documentclass{article}\n');

    internals.syncGate.setProject('ready');
    const deleteSpy = vi.spyOn(internals, 'handleLocalDelete').mockResolvedValue(undefined);
    // Stop before the upload machinery, which needs a real client.
    const pushSpy = vi.spyOn(internals, 'pushLocalFile').mockResolvedValue(undefined);

    await internals.handleLocalChange('main.tex', 'delete').catch(() => undefined);

    expect(deleteSpy).not.toHaveBeenCalled();
    void pushSpy;
    void service;
  });

  it('deletes when the file is genuinely gone', async () => {
    const { internals } = makeService();
    internals.root = tmpRoot;
    internals.manifest = makeManifest(tmpRoot);
    internals.client = {};
    internals.session = {};

    internals.syncGate.setProject('ready');
    const deleteSpy = vi.spyOn(internals, 'handleLocalDelete').mockResolvedValue(undefined);

    await internals.handleLocalChange('main.tex', 'delete').catch(() => undefined);

    expect(deleteSpy).toHaveBeenCalledWith('main.tex');
  });
});

describe('activity log retention', () => {
  it('collapses a repeating message instead of evicting history', async () => {
    const { service, internals } = makeService();
    internals.log('first unique message');
    for (let index = 0; index < 5; index += 1) internals.log('repeating message');
    internals.log('last unique message');

    const messages = service.getActivityLog().map(entry => entry.message);
    expect(messages).toEqual([
      'first unique message',
      'repeating message (x5)',
      'last unique message'
    ]);
  });

  it('keeps far more than the previous 100-entry window', async () => {
    const { service, internals } = makeService();
    for (let index = 0; index < 500; index += 1) internals.log(`message ${index}`);

    const log = service.getActivityLog();
    expect(log.length).toBe(500);
    expect(log[0].message).toBe('message 0');
  });
});
