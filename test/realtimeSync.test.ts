import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverleafHttpError } from '../src/overleaf/overleafClient';
import { RealtimeSyncService } from '../src/overleaf/realtimeSync';
import { SyncGate } from '../src/overleaf/syncGate';
import { createExtensionContextMock, createOutputChannelMock, resetTestState, testState } from './mocks/vscode';
import type { SyncStatusKind } from '../src/overleaf/types';

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

describe('local change recorded while its path was held', () => {
  it('is sent once a check reopens the path, instead of sitting as local ahead', async () => {
    // What an-idea's log showed: a tool deleted a tracked file and rewrote it 82s later. The
    // delete was held for confirmation, so the rewrite arrived to a held path and was only
    // recorded; the next check found it local ahead, and nothing sent it until the next save.
    vi.useFakeTimers();
    try {
      const { internals } = makeService();
      internals.root = tmpRoot;
      internals.client = {};
      internals.session = {};
      internals.manifest = makeManifest(tmpRoot);
      internals.scheduleSyncStatusCheck = vi.fn();
      internals.runPathOperation = vi.fn((_relPath: string, operation: () => Promise<void>) => operation());
      internals.handleLocalChange = vi.fn(async () => undefined);
      internals.syncGate.setProject('ready');
      internals.syncGate.setPath('main.tex', 'pending', 'Local deletion is waiting for explicit confirmation.');

      internals.scheduleLocalChange('main.tex', 'create', 0);
      await vi.runOnlyPendingTimersAsync();
      expect(internals.handleLocalChange).not.toHaveBeenCalled();

      // The check finds the rewritten file local ahead, which does not hold the path.
      internals.syncGate.applyReport({
        schemaVersion: 2, checkedAt: 'now', projectId: 'p1', projectName: 'p', hasBlocking: true, completeness: 'complete',
        items: [{ path: 'main.tex', entityType: 'doc', status: 'local ahead', blocking: true }]
      });
      internals.retryHeldLocalChanges();
      await vi.runOnlyPendingTimersAsync();

      expect(internals.handleLocalChange).toHaveBeenCalledWith('main.tex', 'change');
      // Sent once; a later check must not queue it again.
      internals.retryHeldLocalChanges();
      await vi.runOnlyPendingTimersAsync();
      expect(internals.handleLocalChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays held while the path is still blocked for a reason of its own', async () => {
    vi.useFakeTimers();
    try {
      const { internals } = makeService();
      internals.root = tmpRoot;
      internals.client = {};
      internals.session = {};
      internals.manifest = makeManifest(tmpRoot);
      internals.scheduleSyncStatusCheck = vi.fn();
      internals.handleLocalChange = vi.fn(async () => undefined);
      internals.syncGate.setProject('ready');
      internals.syncGate.setPath('main.tex', 'conflict', 'diverged');

      internals.scheduleLocalChange('main.tex', 'change', 0);
      await vi.runOnlyPendingTimersAsync();
      internals.retryHeldLocalChanges();
      await vi.runOnlyPendingTimersAsync();

      expect(internals.handleLocalChange).not.toHaveBeenCalled();
      expect(internals.heldLocalChanges.has('main.tex')).toBe(true);
      // Re-queuing it anyway would pause it again and schedule another check - after every check.
      expect(internals.scheduleSyncStatusCheck).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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


describe('folders', () => {
  const doc = (id: string, name: string) => ({ _id: id, name, version: 1 });

  /** Overleaf's view: Sections-legacy with a file and a nested folder holding another file. */
  function projectTree(withLegacy = true) {
    return {
      rootFolder: {
        _id: 'f0',
        name: '',
        docs: [doc('d1', 'main.tex')],
        fileRefs: [],
        folders: withLegacy ? [{
          _id: 'f-legacy',
          name: 'Sections-legacy',
          docs: [doc('d-old', 'old.tex')],
          fileRefs: [],
          folders: [{ _id: 'f-sub', name: 'sub', docs: [doc('d-deep', 'deep.tex')], fileRefs: [], folders: [] }]
        }] : []
      }
    };
  }

  function manifestWithLegacy(root: string) {
    const target = makeManifest(root) as any;
    const entry = (relPath: string, entityId: string, parentFolderId: string) =>
      ({ path: relPath, entityId, entityType: 'doc', parentFolderId, binary: false });
    target.files['Sections-legacy/old.tex'] = entry('Sections-legacy/old.tex', 'd-old', 'f-legacy');
    target.files['Sections-legacy/sub/deep.tex'] = entry('Sections-legacy/sub/deep.tex', 'd-deep', 'f-sub');
    target.folders['Sections-legacy'] = { path: 'Sections-legacy', entityId: 'f-legacy', parentFolderId: 'f0' };
    target.folders['Sections-legacy/sub'] = { path: 'Sections-legacy/sub', entityId: 'f-sub', parentFolderId: 'f-legacy' };
    return target;
  }

  type StatusFixture = SyncStatusKind | { status: SyncStatusKind; baseHash?: string; remoteHash?: string };

  /**
   * What classifySyncStatus actually reports for a tracked file that was deleted locally after a
   * collaborator edited it on Overleaf: still 'local deleted', with only the hashes disagreeing.
   */
  const editedOnOverleaf: StatusFixture = { status: 'local deleted', baseHash: 'base', remoteHash: 'edited' };

  /** A running service whose next status check reports `statuses` for the given paths. */
  function harness(statuses: Record<string, StatusFixture>, withLegacyRemotely = true) {
    const { service, internals } = makeService();
    internals.root = tmpRoot;
    internals.manifest = manifestWithLegacy(tmpRoot);
    const deleteEntity = vi.fn(async () => undefined);
    internals.client = { deleteEntity };
    internals.session = { getProject: () => projectTree(withLegacyRemotely) };
    internals.syncGate.setProject('ready');
    vi.spyOn(internals, 'persistManifest').mockResolvedValue(undefined);
    const checkTargeted = vi.spyOn(internals, 'checkTargeted').mockImplementation(async () => ({
      items: Object.entries(statuses).map(([relPath, fixture]) => ({
        path: relPath,
        blocking: true,
        ...(typeof fixture === 'string' ? { status: fixture } : fixture)
      }))
    }));
    return { service, internals, deleteEntity, checkTargeted };
  }

  const allLocallyDeleted: Record<string, StatusFixture> = {
    'Sections-legacy': 'local deleted',
    'Sections-legacy/old.tex': 'local deleted',
    'Sections-legacy/sub': 'local deleted',
    'Sections-legacy/sub/deep.tex': 'local deleted'
  };

  const legacyKeys = (manifest: any) =>
    [...Object.keys(manifest.files), ...Object.keys(manifest.folders)].filter(key => key.startsWith('Sections-legacy'));

  describe('pushing a folder that was deleted locally', () => {
    it('deletes it on Overleaf and leaves no orphans in the manifest', async () => {
      const { internals, deleteEntity } = harness(allLocallyDeleted);
      await internals.pushLocalFile('Sections-legacy', false, true);
      expect(deleteEntity).toHaveBeenCalledWith('p1', 'folder', 'f-legacy');
      expect(deleteEntity).toHaveBeenCalledTimes(1);
      expect(legacyKeys(internals.manifest)).toEqual([]);
      expect(internals.manifest.files['main.tex']).toBeDefined();
    });

    it('checks every descendant, including one that exists only on Overleaf', async () => {
      const { internals, checkTargeted } = harness(allLocallyDeleted);
      await internals.pushLocalFile('Sections-legacy', false, true);
      const checked = [...(checkTargeted.mock.calls[0][0] as Iterable<string>)].sort();
      expect(checked).toEqual(['Sections-legacy', 'Sections-legacy/old.tex', 'Sections-legacy/sub', 'Sections-legacy/sub/deep.tex']);
      // Read fresh: an irreversible delete must not rest on cached version bookkeeping.
      expect(checkTargeted.mock.calls[0][2]).toBe('full');
    });

    it('refuses when a collaborator changed a file inside it, and names the file', async () => {
      const { internals, deleteEntity } = harness({ ...allLocallyDeleted, 'Sections-legacy/sub/deep.tex': editedOnOverleaf });
      await expect(internals.pushLocalFile('Sections-legacy', false, true))
        .rejects.toThrow(/Sections-legacy\/sub\/deep\.tex \(changed on Overleaf\)/);
      expect(deleteEntity).not.toHaveBeenCalled();
      expect(legacyKeys(internals.manifest)).toHaveLength(4);
    });

    it('refuses on a file a collaborator added, even though it was never local', async () => {
      const { internals, deleteEntity } = harness({ ...allLocallyDeleted, 'Sections-legacy/new.tex': 'remote only' });
      await expect(internals.pushLocalFile('Sections-legacy', false, true)).rejects.toThrow(/new\.tex \(added on Overleaf\)/);
      expect(deleteEntity).not.toHaveBeenCalled();
    });

    it('asks first when the caller has not already confirmed, and does nothing if declined', async () => {
      const { internals, deleteEntity } = harness(allLocallyDeleted);
      await internals.pushLocalFile('Sections-legacy', false, false);
      expect(testState.shownWarnings.some(message => /Delete the folder Sections-legacy and the 2 file\(s\)/.test(message))).toBe(true);
      expect(deleteEntity).not.toHaveBeenCalled();
    });

    it('does not ask again when the caller already confirmed', async () => {
      const { internals, deleteEntity } = harness(allLocallyDeleted);
      await internals.pushLocalFile('Sections-legacy', false, true);
      expect(testState.shownWarnings).toEqual([]);
      expect(deleteEntity).toHaveBeenCalled();
    });
  });

  it('rejects pushing a folder that still exists locally, instead of uploading it as a file', async () => {
    const { internals, deleteEntity } = harness(allLocallyDeleted);
    await fs.mkdir(path.join(tmpRoot, 'Sections-legacy'), { recursive: true });
    await expect(internals.pushLocalFile('Sections-legacy', false, true)).rejects.toThrow(/is a folder\. Push the files inside it/);
    expect(deleteEntity).not.toHaveBeenCalled();
  });

  describe('pulling a folder that was deleted locally', () => {
    function recordChildPulls(internals: Record<string, any>, service: unknown, fail: string[] = []) {
      const realPull = internals.pullRemoteFile.bind(service);
      const pulled: string[] = [];
      vi.spyOn(internals, 'pullRemoteFile').mockImplementation(async (...args: unknown[]) => {
        const [relPath, refresh] = args as [string, boolean];
        if (relPath === 'Sections-legacy') return realPull(relPath, refresh);
        pulled.push(relPath);
        if (fail.includes(relPath)) throw new Error('read failed');
      });
      return pulled;
    }

    it('recreates the folders, including an empty one, and pulls every file back', async () => {
      const { service, internals } = harness(allLocallyDeleted);
      const pulled = recordChildPulls(internals, service);
      await internals.pullRemoteFile('Sections-legacy', false);
      expect(pulled.sort()).toEqual(['Sections-legacy/old.tex', 'Sections-legacy/sub/deep.tex']);
      await expect(fs.stat(path.join(tmpRoot, 'Sections-legacy', 'sub'))).resolves.toBeDefined();
    });

    it('keeps going past a file that fails, then reports it', async () => {
      const { service, internals } = harness(allLocallyDeleted);
      const pulled = recordChildPulls(internals, service, ['Sections-legacy/old.tex']);
      await expect(internals.pullRemoteFile('Sections-legacy', false)).rejects.toThrow(/except 1 of 2 file\(s\): Sections-legacy\/old\.tex/);
      // The file after the failing one was still attempted.
      expect(pulled).toContain('Sections-legacy/sub/deep.tex');
    });
  });

  it('moving a remotely deleted folder to trash removes its whole subtree from the manifest', async () => {
    const { internals } = harness({}, false);
    await fs.mkdir(path.join(tmpRoot, 'Sections-legacy', 'sub'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'Sections-legacy', 'old.tex'), 'old');
    await internals.moveRemoteDeletedToTrash('Sections-legacy');
    expect(legacyKeys(internals.manifest)).toEqual([]);
    await expect(fs.stat(path.join(tmpRoot, 'Sections-legacy'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  describe('automatic folder delete with syncDestructiveChanges on', () => {
    beforeEach(() => {
      testState.configuration.set('overleafCodex', { syncDestructiveChanges: true });
    });

    it('holds an unsafe delete for review instead of sweeping a collaborator\'s edit away', async () => {
      const { internals, deleteEntity } = harness({ ...allLocallyDeleted, 'Sections-legacy/old.tex': editedOnOverleaf });
      await internals.handleLocalDelete('Sections-legacy');
      expect(deleteEntity).not.toHaveBeenCalled();
      const held = internals.syncGate.findBlocking('Sections-legacy/sub/deep.tex');
      expect(held).toMatchObject({ path: 'Sections-legacy', state: 'pending', subtree: true });
      expect(held.reason).toMatch(/old\.tex \(changed on Overleaf\)/);
    });

    it('deletes a safe folder and clears its descendants, not just the folder entry', async () => {
      const { internals, deleteEntity } = harness(allLocallyDeleted);
      await internals.handleLocalDelete('Sections-legacy');
      expect(deleteEntity).toHaveBeenCalledWith('p1', 'folder', 'f-legacy');
      expect(legacyKeys(internals.manifest)).toEqual([]);
    });
  });
});
