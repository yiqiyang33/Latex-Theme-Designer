import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverleafHttpError } from '../src/overleaf/overleafClient';
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

/** Writes are debounced and fire-and-forget; force one and wait before touching the temp dir. */
async function flushActivityLog(internals: Record<string, any>): Promise<void> {
  internals.flushActivityLog();
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

describe('downloadVerifiedBinary', () => {
  function serviceWithClient(download: (...args: any[]) => Promise<any>) {
    const { service, internals } = makeService();
    internals.root = tmpRoot;
    internals.manifest = makeManifest(tmpRoot);
    internals.client = { downloadProjectFileToPath: download };
    return { service, internals };
  }

  it('refuses to install content whose hash does not match what Overleaf advertised', async () => {
    // An expired session answers the download with a login page; without the check that HTML
    // would replace the user's file and its digest would become the manifest's truth.
    const { internals } = serviceWithClient(async (_p: string, _e: string, target: string) => {
      await fs.writeFile(target, '<html>please log in</html>');
      return { size: 26, sha1: 'sha-of-login-page', gitBlobHash: 'blob-of-login-page' };
    });
    await fs.writeFile(path.join(tmpRoot, 'fig.png'), 'original bytes');

    await expect(internals.downloadVerifiedBinary('e1', 'fig.png', 'blob-expected'))
      .rejects.toThrow(/unexpected content/);
    // The working copy is untouched.
    await expect(fs.readFile(path.join(tmpRoot, 'fig.png'), 'utf8')).resolves.toBe('original bytes');
  });

  it('installs when the hash matches, and stages outside the watched workspace', async () => {
    let stagedIn = '';
    const { internals } = serviceWithClient(async (_p: string, _e: string, target: string) => {
      stagedIn = target;
      await fs.writeFile(target, 'new bytes');
      return { size: 9, sha1: 'sha-new', gitBlobHash: 'blob-expected' };
    });

    const result = await internals.downloadVerifiedBinary('e1', 'fig.png', 'blob-expected');

    expect(result.gitBlobHash).toBe('blob-expected');
    await expect(fs.readFile(path.join(tmpRoot, 'fig.png'), 'utf8')).resolves.toBe('new bytes');
    // Staging inside .overleaf-codex keeps the partial file away from the file watcher.
    expect(stagedIn).toContain('.overleaf-codex');
    expect(stagedIn.startsWith(path.join(tmpRoot, '.overleaf-codex'))).toBe(true);
  });

  it('still installs when Overleaf advertised no hash to compare against', async () => {
    const { internals } = serviceWithClient(async (_p: string, _e: string, target: string) => {
      await fs.writeFile(target, 'bytes');
      return { size: 5, sha1: 'sha', gitBlobHash: 'blob' };
    });
    await internals.downloadVerifiedBinary('e1', 'fig.png', undefined);
    await expect(fs.readFile(path.join(tmpRoot, 'fig.png'), 'utf8')).resolves.toBe('bytes');
  });
});

describe('reconnect backoff', () => {
  it('does not reset the attempt counter before the connection is established', async () => {
    const { internals } = makeService();
    internals.root = tmpRoot;
    internals.client = {};
    internals.shouldReconnect = true;

    // Two consecutive failures must escalate rather than retry at a flat 1s forever.
    internals.scheduleReconnect();
    const first = internals.reconnectAttempt;
    internals.reconnectTimer = undefined;
    internals.scheduleReconnect();
    const second = internals.reconnectAttempt;

    expect(first).toBe(1);
    expect(second).toBe(2);
    for (const timer of [internals.reconnectTimer]) if (timer) clearTimeout(timer);
  });
});

describe('startup auto-push', () => {
  const localOnly = (paths: string[]) => ({
    schemaVersion: 2, checkedAt: 'now', projectId: 'p1', projectName: 'p', hasBlocking: true, completeness: 'complete',
    items: paths.map(relPath => ({ path: relPath, entityType: 'doc', status: 'local only', blocking: true }))
  });

  function autoPushService(pushLocalFile: (relPath: string) => Promise<void>) {
    const { internals } = makeService();
    internals.root = tmpRoot;
    internals.client = {};
    internals.canAutoPushLocalAhead = () => true;
    internals.canSyncBinaryFiles = () => true;
    internals.pushLocalFile = vi.fn(pushLocalFile);
    internals.checkSyncStatus = vi.fn(async () => localOnly([]));
    return internals;
  }

  it('keeps pushing past a file that fails, instead of aborting sync startup', async () => {
    const pushed: string[] = [];
    const internals = autoPushService(async relPath => {
      if (relPath === 'b.tex') throw new Error('upload exploded');
      pushed.push(relPath);
    });

    await expect(internals.autoPushLocalAhead(localOnly(['a.tex', 'b.tex', 'c.tex']))).resolves.toBeDefined();
    expect(pushed).toEqual(['a.tex', 'c.tex']);
    await flushActivityLog(internals);
  });

  it('still stops on an expired login, so the re-login prompt can run', async () => {
    const internals = autoPushService(async () => {
      throw new OverleafHttpError('Forbidden', 403);
    });

    await expect(internals.autoPushLocalAhead(localOnly(['a.tex', 'b.tex']))).rejects.toThrow('Forbidden');
    expect(internals.pushLocalFile).toHaveBeenCalledTimes(1);
    await flushActivityLog(internals);
  });
});

describe('pushing a new document', () => {
  function joinedDoc(internals: Record<string, any>, relPath: string, content: string) {
    internals.root = tmpRoot;
    internals.session = {};
    internals.manifest = {
      ...makeManifest(tmpRoot),
      files: { [relPath]: { path: relPath, entityId: 'doc-new', entityType: 'doc', parentFolderId: 'f0', binary: false, version: 1 } }
    };
    const state = { relPath, docId: 'doc-new', version: 1, localCache: content, remoteCache: content };
    internals.docStates.set(relPath, state);
    internals.persistManifest = vi.fn(async () => undefined);
    return state;
  }

  it('ignores Overleaf echoing our own update back, instead of rewriting the file', async () => {
    const { internals } = makeService();
    joinedDoc(internals, 'theme.sty', 'pushed');
    await fs.writeFile(path.join(tmpRoot, 'theme.sty'), 'pushed');
    internals.syncGate.setProject('ready');
    internals.writeLocalFile = vi.fn();

    // The ack arrives as a bare {doc, v} carrying the version the push was applied at.
    await internals.handleRemoteUpdate({ doc: 'doc-new', v: 0 });

    expect(internals.writeLocalFile).not.toHaveBeenCalled();
    expect(internals.persistManifest).not.toHaveBeenCalled();
  });

  it('records the acknowledged content as the base, not whatever the file holds afterwards', async () => {
    const { internals } = makeService();
    joinedDoc(internals, 'theme.sty', 'pushed');
    await fs.mkdir(path.join(tmpRoot, '.overleaf-codex', 'base', 'docs'), { recursive: true });
    // Mid-write (or already edited again): the file no longer holds what was pushed.
    await fs.writeFile(path.join(tmpRoot, 'theme.sty'), '');

    await internals.refreshBaseAfterLocalPush('theme.sty');

    const entry = internals.manifest.files['theme.sty'];
    const pushedHash = createHash('sha1').update('pushed').digest('hex');
    expect(entry.baseHash).toBe(pushedHash);
    expect(entry.sha1).toBe(pushedHash);
  });
});

describe('remote update on a document joined on demand', () => {
  it('brings the remote edit down instead of pushing the stale local copy back over it', async () => {
    // A health check joins documents without leaving them, so their updates arrive with no state
    // held for them yet. Joining on demand used to treat the joined content as already agreed,
    // which made the untouched local file look like a local edit - and the sync reverted the
    // collaborator's change on Overleaf.
    const { internals } = makeService();
    await fs.mkdir(path.join(tmpRoot, '.overleaf-codex', 'base', 'docs'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, '.overleaf-codex', 'base', 'docs', 'd1.tex'), 'hello');
    await fs.writeFile(path.join(tmpRoot, 'a.tex'), 'hello');
    internals.root = tmpRoot;
    internals.manifest = {
      ...makeManifest(tmpRoot),
      files: { 'a.tex': {
        path: 'a.tex', entityId: 'd1', entityType: 'doc', parentFolderId: 'f0', binary: false, version: 1,
        sha1: createHash('sha1').update('hello').digest('hex'), baseHash: createHash('sha1').update('hello').digest('hex')
      } }
    };
    const submitted: unknown[] = [];
    internals.session = {
      joinDoc: vi.fn(async () => ({ content: 'hello world', version: 2 })),
      applyOtUpdate: vi.fn(async (_doc: string, update: unknown) => { submitted.push(update); })
    };
    internals.persistManifest = vi.fn(async () => undefined);
    internals.syncGate.setProject('ready');

    await internals.handleRemoteUpdate({ doc: 'd1', v: 1, op: [{ p: 5, i: ' world' }] });

    expect(submitted).toEqual([]);
    await expect(fs.readFile(path.join(tmpRoot, 'a.tex'), 'utf8')).resolves.toBe('hello world');
  });
});

describe('activity log write coalescing', () => {
  it('writes once for a burst instead of once per line', async () => {
    const { internals } = makeService();
    internals.root = tmpRoot;
    let writes = 0;
    const original = internals.flushActivityLog.bind(internals);
    internals.flushActivityLog = () => { writes += 1; return original(); };

    for (let index = 0; index < 50; index += 1) internals.log(`message ${index}`);
    expect(writes).toBe(0); // nothing written yet; the flush is on a trailing timer

    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(writes).toBe(1);

    await internals.activityLogWrite.catch(() => undefined);
    const written = JSON.parse(await fs.readFile(path.join(tmpRoot, '.overleaf-codex', 'activity-log.json'), 'utf8'));
    expect(written).toHaveLength(50);
  });
});
