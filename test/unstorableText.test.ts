import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readManifest, shouldIgnoreUntrackedLocalPath, writeManifest } from '../src/overleaf/manifest';
import { validateSyncStatus } from '../src/overleaf/metadataValidation';
import { applyOtOperations } from '../src/overleaf/ot';
import { OtDocumentSession } from '../src/overleaf/otDocumentSession';
import { awaitUpdateVerdict, OverleafUpdateRejectedError, OverleafUpdateUnconfirmedError } from '../src/overleaf/otUpdateVerdict';
import { OverleafSocketSession } from '../src/overleaf/overleafClient';
import { findUnsupportedCharacters, unsupportedCharactersMessage } from '../src/overleaf/overleafText';
import { OverleafSyncEngine } from '../src/overleaf/overleafSyncEngine';
import { RealtimeSyncService } from '../src/overleaf/realtimeSync';
import { DEFAULT_SYNC_POLICY } from '../src/overleaf/sharedState';
import { markRejectedUploads, planSafeSyncActions, type RejectedUpload } from '../src/overleaf/syncCommandCore';
import { SyncGate } from '../src/overleaf/syncGate';
import { classifySyncStatus, keepLocalCopyBeforePull } from '../src/overleaf/syncStatus';
import type { ManifestFile, OtUpdate, OverleafCodexManifest, SyncStatusItem, SyncStatusReport } from '../src/overleaf/types';
import { sha1 } from '../src/overleaf/util';
import { createExtensionContextMock, createOutputChannelMock, resetTestState } from './mocks/vscode';

/**
 * Regressions for informs2026-puma: two notes holding 𝓘 and 𝔈 were published to Overleaf, which
 * cannot store characters outside the Basic Multilingual Plane. Overleaf refused each upload after
 * acknowledging it, the push was recorded as done, and the empty documents left behind then read as
 * an Overleaf edit - which the next "sync once" would have pulled over the notes.
 */

let tmpRoot: string;

beforeEach(async () => {
  resetTestState();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-toolkit-unstorable-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  vi.restoreAllMocks();
});

function item(fields: Partial<SyncStatusItem> & Pick<SyncStatusItem, 'path' | 'status'>): SyncStatusItem {
  return { blocking: true, entityType: 'doc', ...fields };
}

function report(items: SyncStatusItem[]): SyncStatusReport {
  return { schemaVersion: 2, checkedAt: 'now', projectId: 'p', projectName: 'p', hasBlocking: true, completeness: 'complete', items };
}

describe('text Overleaf cannot store', () => {
  it('finds characters outside the Basic Multilingual Plane, by line', () => {
    expect(findUnsupportedCharacters('Range(𝓘⋆)\nplain\nclass 𝔈 = …')).toEqual([
      { character: '𝓘', line: 1 },
      { character: '𝔈', line: 3 }
    ]);
    // A lone surrogate is replaced by Overleaf just the same.
    expect(findUnsupportedCharacters('\uD835x')).toHaveLength(1);
  });

  it('leaves Chinese, letterlike symbols and other BMP text alone', () => {
    const text = '观察等价是参数的性质：μ⋆ 与 μ⋆+h（h ∈ ker ℐ⋆），ℰ ∩ ball。';
    expect(findUnsupportedCharacters(text)).toEqual([]);
    expect(unsupportedCharactersMessage('story.md', text)).toBeUndefined();
  });

  it('names each character with its lines and a replacement Overleaf can store', () => {
    const message = unsupportedCharactersMessage('story.md', 'ker 𝓘⋆\nRange(𝓘⋆)\nclass 𝔈\n𝟙 and 🙂')!;
    expect(message).toContain('story.md contains characters Overleaf cannot store');
    expect(message).toContain('𝓘 U+1D4D8 (lines 1, 2)');
    expect(message).toContain('𝔈 U+1D508 (line 3)');
    expect(message).toContain('𝓘 with ℐ or \\mathcal{I}');
    expect(message).toContain('𝔈 with \\mathfrak{E}');
    expect(message).toContain('𝟙 with 1');
    expect(unsupportedCharactersMessage('a.md', 'done 🙂')).toMatch(/Replace or remove them\.$/);
  });
});

describe("waiting for Overleaf's verdict on an update", () => {
  it('settles on the bare echo Overleaf sends the sender, and nothing else', async () => {
    const socket = new EventEmitter();
    const verdict = awaitUpdateVerdict(socket, 'd1', 3, 1000);
    let settled = false;
    void verdict.settled.then(() => { settled = true; });
    socket.emit('otUpdateApplied', { doc: 'd2', v: 3 });
    socket.emit('otUpdateApplied', { doc: 'd1', v: 3, op: [{ p: 0, i: 'x' }] });
    socket.emit('otUpdateApplied', { doc: 'd1', v: 2 });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.emit('otUpdateApplied', { doc: 'd1', v: 3 });
    await expect(verdict.settled).resolves.toBeUndefined();
    expect(socket.listenerCount('otUpdateApplied') + socket.listenerCount('otUpdateError') + socket.listenerCount('disconnect')).toBe(0);
  });

  it("rejects when Overleaf refuses the update, ignoring other documents' errors", async () => {
    const socket = new EventEmitter();
    const verdict = awaitUpdateVerdict(socket, 'd1', 0, 1000);
    socket.emit('otUpdateError', 'Invalid hash', { doc_id: 'd2' });
    socket.emit('otUpdateError', 'Invalid hash', { doc_id: 'd1' });
    await expect(verdict.settled).rejects.toBeInstanceOf(OverleafUpdateRejectedError);
    await expect(verdict.settled).rejects.toMatchObject({ docId: 'd1', reason: 'Invalid hash' });
  });

  it('is unconfirmed, not rejected, when the connection drops or the wait runs out', async () => {
    const dropped = new EventEmitter();
    const verdict = awaitUpdateVerdict(dropped, 'd1', 0, 1000);
    dropped.emit('disconnect');
    await expect(verdict.settled).rejects.toBeInstanceOf(OverleafUpdateUnconfirmedError);
    await expect(awaitUpdateVerdict(new EventEmitter(), 'd1', 0, 5).settled).rejects.toBeInstanceOf(OverleafUpdateUnconfirmedError);
  });

  it('stops listening when the update was never sent', async () => {
    const socket = new EventEmitter();
    const verdict = awaitUpdateVerdict(socket, 'd1', 0, 1000);
    verdict.dispose();
    await expect(verdict.settled).resolves.toBeUndefined();
    expect(socket.listenerCount('otUpdateError')).toBe(0);
  });

  it('reports an update Overleaf acknowledged and then refused as refused, not as pushed', async () => {
    // What Overleaf does with text it cannot store: queue the update, acknowledge it, then report the
    // document updater's refusal and disconnect.
    const socket = new EventEmitter();
    socket.on('applyOtUpdate', (docId: string, _update: OtUpdate, ack: () => void) => {
      ack();
      setImmediate(() => {
        socket.emit('otUpdateError', 'Invalid hash', { doc_id: docId });
        socket.emit('disconnect');
      });
    });
    const session = Object.assign(Object.create(OverleafSocketSession.prototype), { socket, timeouts: { otAckMs: 1000 } }) as OverleafSocketSession;
    await expect(session.applyOtUpdate('d1', { doc: 'd1', v: 0, op: [{ p: 0, i: '𝓘' }] }))
      .rejects.toMatchObject({ name: 'OverleafUpdateRejectedError', reason: 'Invalid hash' });

    socket.removeAllListeners('applyOtUpdate');
    socket.on('applyOtUpdate', (docId: string, update: OtUpdate, ack: () => void) => {
      ack();
      setImmediate(() => socket.emit('otUpdateApplied', { doc: docId, v: update.v }));
    });
    await expect(session.applyOtUpdate('d1', { doc: 'd1', v: 0, op: [{ p: 0, i: 'ℐ' }] })).resolves.toBeUndefined();
  });

  it('gives up at once on a refused update, instead of reading back and sending it again', async () => {
    const transport = {
      joinDoc: vi.fn(async () => ({ content: '', version: 0 })),
      applyOtUpdate: vi.fn(async (docId: string) => { throw new OverleafUpdateRejectedError(docId, 'Invalid hash'); })
    };
    const session = new OtDocumentSession({ docId: 'd1', version: 0, localCache: '', remoteCache: '' }, transport);
    await expect(session.submitLocal('text')).rejects.toBeInstanceOf(OverleafUpdateRejectedError);
    expect(transport.applyOtUpdate).toHaveBeenCalledTimes(1);
    expect(transport.joinDoc).not.toHaveBeenCalled();
    expect(session.state).toMatchObject({ version: 0, remoteCache: '' });
  });

  it('still reads back after an unconfirmed update, to learn whether it landed', async () => {
    let attempts = 0;
    const transport = {
      joinDoc: vi.fn(async () => ({ content: '', version: 0 })),
      applyOtUpdate: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new OverleafUpdateUnconfirmedError('Overleaf disconnected before confirming the applyOtUpdate.');
      })
    };
    const session = new OtDocumentSession({ docId: 'd1', version: 0, localCache: '', remoteCache: '' }, transport);
    await expect(session.submitLocal('text')).resolves.toMatchObject({ changed: true });
    expect(transport.joinDoc).toHaveBeenCalledTimes(1);
  });
});

describe('planning, holding and marking uploads', () => {
  it('never uploads automatically what Overleaf would refuse', () => {
    const plan = planSafeSyncActions(report([
      item({ path: 'ok.md', status: 'local only' }),
      item({ path: 'story.md', status: 'local only', uploadBlocked: true, message: 'cannot store' })
    ]), { autoPushLocalAhead: true, syncBinaryFiles: false });
    expect(plan.pushes.map((entry) => entry.path)).toEqual(['ok.md']);
  });

  it('does not pull an emptied Overleaf document over a local file that still has content', () => {
    const empty = sha1('');
    const plan = planSafeSyncActions(report([
      item({ path: 'story.md', status: 'remote ahead', remoteHash: empty, localHash: sha1('notes') }),
      // Nothing to lose: the local file is empty too.
      item({ path: 'blank.md', status: 'remote ahead', remoteHash: empty, localHash: empty }),
      item({ path: 'edited.md', status: 'remote ahead', remoteHash: sha1('theirs'), localHash: sha1('mine') }),
      item({ path: 'new.md', status: 'remote only', remoteHash: empty })
    ]), { autoPushLocalAhead: true, syncBinaryFiles: false });
    expect(plan.pulls.map((entry) => entry.path)).toEqual(['blank.md', 'edited.md', 'new.md']);
  });

  it('holds a path whose upload Overleaf would refuse, so saving it again uploads nothing', () => {
    const gate = new SyncGate();
    gate.applyReport(report([
      item({ path: 'ok.md', status: 'local ahead' }),
      item({ path: 'story.md', status: 'local ahead', uploadBlocked: true, message: 'cannot store' })
    ]));
    expect(gate.canSync('ok.md')).toBe(true);
    expect(gate.findBlocking('story.md')).toMatchObject({ state: 'pending', reason: 'cannot store' });
  });

  it('marks refused content until the file changes or no longer needs uploading', () => {
    const rejected = new Map<string, RejectedUpload>([
      ['a.md', { localHash: sha1('refused'), reason: 'Overleaf rejected the upload of a.md (Invalid hash)' }],
      ['b.md', { localHash: sha1('refused'), reason: 'refused' }],
      ['c.md', { localHash: sha1('refused'), reason: 'refused' }]
    ]);
    const fresh = report([
      item({ path: 'a.md', status: 'local ahead', localHash: sha1('refused') }),
      item({ path: 'b.md', status: 'local ahead', localHash: sha1('edited since') }),
      item({ path: 'c.md', status: 'synced', localHash: sha1('refused') })
    ]);
    markRejectedUploads(fresh, rejected);
    expect(fresh.items[0]).toMatchObject({ uploadBlocked: true, message: expect.stringContaining('Invalid hash') });
    expect(fresh.items[1].uploadBlocked).toBeUndefined();
    expect([...rejected.keys()]).toEqual(['a.md']);
  });

  it('accepts the new field in saved status files, and only as a boolean', () => {
    expect(validateSyncStatus(report([item({ path: 'a.md', status: 'local ahead', uploadBlocked: true })]))).toBeUndefined();
    expect(validateSyncStatus(report([{ ...item({ path: 'a.md', status: 'local ahead' }), uploadBlocked: 'yes' as never }])))
      .toBe('$.items[0].uploadBlocked must be a boolean');
  });

  it("ignores beamer's generated files in new mirrors", () => {
    const fresh = { files: {}, folders: { '': { path: '', entityId: 'root' } }, ignore: [] } as unknown as OverleafCodexManifest;
    for (const generated of ['main.nav', 'main.snm', 'main.vrb']) expect(shouldIgnoreUntrackedLocalPath(fresh, generated)).toBe(true);
  });
});

describe('keeping the local copy a pull replaces', () => {
  async function local(content: string): Promise<void> {
    await fs.writeFile(path.join(tmpRoot, 'notes.md'), content);
  }

  async function keep(incoming: { sha1?: string; empty: boolean }, agreed: string | undefined): Promise<string | undefined> {
    const kept = await keepLocalCopyBeforePull(tmpRoot, 'notes.md', incoming, agreed);
    return kept === undefined ? undefined : fs.readFile(kept, 'utf8');
  }

  it('keeps work the pull would lose: local edits, or content an emptied document would erase', async () => {
    await local('mine');
    await expect(keep({ sha1: sha1('theirs'), empty: false }, sha1('older'))).resolves.toBe('mine');
    await expect(keep({ sha1: sha1(''), empty: true }, sha1('mine'))).resolves.toBe('mine');
  });

  it('keeps nothing on a routine pull of an unedited file', async () => {
    await local('mine');
    await expect(keep({ sha1: sha1('theirs'), empty: false }, sha1('mine'))).resolves.toBeUndefined();
    await expect(keep({ sha1: sha1('mine'), empty: false }, sha1('older'))).resolves.toBeUndefined();
    await local('');
    await expect(keep({ sha1: sha1(''), empty: true }, undefined)).resolves.toBeUndefined();
    await fs.rm(path.join(tmpRoot, 'notes.md'));
    await expect(keep({ sha1: sha1('theirs'), empty: false }, undefined)).resolves.toBeUndefined();
  });
});

describe('the extension engine', () => {
  function service() {
    const context = createExtensionContextMock();
    const internals = new RealtimeSyncService(context as never, createOutputChannelMock() as never) as unknown as Record<string, any>;
    internals.root = tmpRoot;
    internals.manifest = {
      schemaVersion: 1, serverUrl: 'https://www.overleaf.com', projectId: 'p1', projectName: 'p', rootDocId: 'd1', compiler: 'pdflatex',
      files: {}, folders: { '': { path: '', entityId: 'f0' } }, ignore: [], root: tmpRoot
    };
    internals.client = { addDoc: vi.fn(async (_projectId: string, _folderId: string, name: string) => ({ _id: 'doc-new', name })) };
    internals.ensureRemoteParentFolders = vi.fn(async () => ({ parentFolderId: 'f0' }));
    internals.persistManifest = vi.fn(async () => undefined);
    return internals;
  }

  async function flush(internals: Record<string, any>): Promise<void> {
    internals.flushActivityLog();
    await internals.activityLogWrite.catch(() => undefined);
  }

  it('refuses text Overleaf cannot store before creating anything there', async () => {
    const internals = service();
    await expect(internals.handleLocalFileCreate('story.md', Buffer.from('Range(𝓘⋆)'), false)).resolves.toBe(false);
    await expect(internals.handleLocalFileCreate('story.md', Buffer.from('Range(𝓘⋆)'), true)).rejects.toThrow(/cannot store: 𝓘 U\+1D4D8 \(line 1\)/);
    expect(internals.client.addDoc).not.toHaveBeenCalled();
    expect(internals.ensureRemoteParentFolders).not.toHaveBeenCalled();
    expect(internals.syncGate.findBlocking('story.md')).toMatchObject({ state: 'pending' });
    await flush(internals);
  });

  it('holds a new local file it cannot upload with the reason, not as a disabled upload', async () => {
    const internals = service();
    internals.session = {};
    internals.syncGate.setProject('ready');
    internals.canAutoPushLocalAhead = () => true;
    internals.scheduleSyncStatusCheck = vi.fn();
    await fs.writeFile(path.join(tmpRoot, 'story.md'), 'Range(𝓘⋆)');

    await internals.handleLocalChange('story.md', 'create');

    expect(internals.client.addDoc).not.toHaveBeenCalled();
    expect(internals.syncGate.findBlocking('story.md')).toMatchObject({ state: 'pending', reason: expect.stringContaining('cannot store: 𝓘') });
    await flush(internals);
  });

  it('records a refused upload as local work still to send, not as an Overleaf edit to pull', async () => {
    const internals = service();
    internals.session = {
      joinDoc: vi.fn(async () => ({ content: '', version: 0 })),
      applyOtUpdate: vi.fn(async (docId: string) => { throw new OverleafUpdateRejectedError(docId, 'Invalid hash'); })
    };
    await expect(internals.handleLocalFileCreate('notes.md', Buffer.from('notes'), true))
      .rejects.toThrow('Overleaf rejected the upload of notes.md (Invalid hash); nothing was changed on Overleaf.');

    const entry: ManifestFile = internals.manifest.files['notes.md'];
    expect(entry.sha1).toBe(sha1(''));
    expect(entry.baseHash).toBeUndefined();
    const next = classifySyncStatus({
      path: 'notes.md', manifestFile: entry, remoteFile: { ...entry, version: 0 },
      localHash: sha1('notes'), remoteHash: sha1(''), localExists: true
    });
    expect(next.status).toBe('local ahead');
    const fresh = report([{ ...next }]);
    markRejectedUploads(fresh, internals.rejectedUploads);
    expect(fresh.items[0]).toMatchObject({ uploadBlocked: true, message: expect.stringContaining('Invalid hash') });
    await flush(internals);
  });

  it('keeps the local copy when a pull empties a file', async () => {
    const internals = service();
    await fs.writeFile(path.join(tmpRoot, 'notes.md'), 'notes');
    // The state the refused upload left behind: Overleaf empty, the local text recorded as agreed.
    internals.manifest.files['notes.md'] = {
      path: 'notes.md', entityId: 'd-notes', entityType: 'doc', parentFolderId: 'f0', binary: false, version: 0,
      sha1: sha1('notes'), baseHash: sha1('notes')
    };
    internals.session = { joinDoc: vi.fn(async () => ({ content: '', version: 0 })) };
    internals.currentRemoteTree = () => ({ folders: {}, files: {} });
    internals.fetchFreshRemoteSnapshot = vi.fn(async () => ({
      manifest: { files: { 'notes.md': { path: 'notes.md', entityId: 'd-notes', entityType: 'doc', parentFolderId: 'f0', version: 0 } } },
      contents: new Map([['notes.md', '']]),
      failures: new Map()
    }));

    await internals.pullRemoteFile('notes.md', false);

    await expect(fs.readFile(path.join(tmpRoot, 'notes.md'), 'utf8')).resolves.toBe('');
    const trash = path.join(tmpRoot, '.overleaf-codex', 'trash');
    const [stamp] = await fs.readdir(trash);
    await expect(fs.readFile(path.join(trash, stamp, 'notes.md'), 'utf8')).resolves.toBe('notes');
    await flush(internals);
  });
});

describe('the CLI engine', () => {
  async function setup(options: { local: string; remote?: string; remoteVersion?: number; agreed?: string; rejectWith?: string }) {
    const docs: Array<{ _id: string; name: string; version: number }> = options.remote === undefined ? [] : [{ _id: 'd-notes', name: 'notes.md', version: options.remoteVersion ?? 1 }];
    const remote: Record<string, string> = options.remote === undefined ? {} : { 'd-notes': options.remote };
    const project = { rootFolder: { _id: 'root', name: 'root', docs, fileRefs: [], folders: [] } };
    const added: string[] = [];
    const session = {
      getProject: () => project,
      joinDoc: async (id: string) => ({ content: remote[id] ?? '', version: docs.find((doc) => doc._id === id)?.version ?? 1 }),
      applyOtUpdate: async (id: string, update: OtUpdate) => {
        if (options.rejectWith) throw new OverleafUpdateRejectedError(id, options.rejectWith);
        remote[id] = applyOtOperations(remote[id] ?? '', update.op ?? []);
      },
      on: () => undefined,
      disconnect: () => undefined
    };
    const client = {
      connectSocket: async () => session,
      addDoc: async (_projectId: string, _folderId: string, name: string) => {
        added.push(name);
        docs.push({ _id: 'd-new', name, version: 1 });
        return { _id: 'd-new', name };
      }
    };
    const state: OverleafCodexManifest = {
      schemaVersion: 3, serverUrl: 'https://example.test/', projectId: 'project', projectName: 'Project',
      files: {}, folders: { '': { path: '', entityId: 'root' } }, ignore: [], lastSyncAt: '2026-10-28T00:00:00.000Z'
    };
    if (options.agreed !== undefined) {
      state.files['notes.md'] = {
        path: 'notes.md', entityId: 'd-notes', entityType: 'doc', parentFolderId: 'root', version: 1,
        sha1: sha1(options.agreed), baseHash: sha1(options.agreed)
      };
    }
    await writeManifest(tmpRoot, state);
    await fs.writeFile(path.join(tmpRoot, 'notes.md'), options.local);
    const engine = new OverleafSyncEngine(
      tmpRoot,
      client as never,
      structuredClone(DEFAULT_SYNC_POLICY),
      { log: () => undefined, progress: () => undefined, status: () => undefined, conflict: () => undefined }
    );
    return { engine, added, remote };
  }

  async function withEngine(options: Parameters<typeof setup>[0], body: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
    const ctx = await setup(options);
    try {
      await body(ctx);
    } finally {
      await ctx.engine.stop();
    }
  }

  const noteStatus = async (engine: OverleafSyncEngine) => (await engine.status(true))!.items.find((entry) => entry.path === 'notes.md');

  it('refuses text Overleaf cannot store before creating anything there', () => withEngine({ local: 'Range(𝓘⋆)' }, async ({ engine, added }) => {
    await expect(engine.push('notes.md', false)).rejects.toThrow(/cannot store: 𝓘 U\+1D4D8/);
    expect(added).toEqual([]);
  }));

  it('reports such a file with the reason, and a sync does not try to upload it', () => withEngine({ local: 'Range(𝓘⋆)' }, async ({ engine, added }) => {
    expect(await noteStatus(engine)).toMatchObject({ status: 'local only', uploadBlocked: true, message: expect.stringContaining('ℐ or \\mathcal{I}') });
    await engine.syncOnce();
    expect(added).toEqual([]);
  }));

  it('records a refused upload as local work still to send, and does not send it again', () => withEngine(
    { local: 'notes', rejectWith: 'Invalid hash' },
    async ({ engine, added }) => {
      await expect(engine.push('notes.md', false)).rejects.toThrow('Overleaf rejected the upload of notes.md (Invalid hash)');
      expect(added).toEqual(['notes.md']);
      expect((await readManifest(tmpRoot)).files['notes.md'].sha1).toBe(sha1(''));
      expect(await noteStatus(engine)).toMatchObject({ status: 'local ahead', uploadBlocked: true });
      await engine.syncOnce();
      expect(added).toEqual(['notes.md']);
    }
  ));

  it('does not pull an emptied document over the notes in a sync, and keeps a copy on a pull', () => withEngine(
    // As informs2026-puma had it: recorded at version 1 with the text, while Overleaf stayed empty at 0.
    { local: 'notes', remote: '', remoteVersion: 0, agreed: 'notes' },
    async ({ engine }) => {
      expect(await noteStatus(engine)).toMatchObject({ status: 'remote ahead' });
      await engine.syncOnce();
      await expect(fs.readFile(path.join(tmpRoot, 'notes.md'), 'utf8')).resolves.toBe('notes');

      await engine.pull('notes.md', false);
      await expect(fs.readFile(path.join(tmpRoot, 'notes.md'), 'utf8')).resolves.toBe('');
      const trash = path.join(tmpRoot, '.overleaf-codex', 'trash');
      const [stamp] = await fs.readdir(trash);
      await expect(fs.readFile(path.join(trash, stamp, 'notes.md'), 'utf8')).resolves.toBe('notes');
    }
  ));
});
