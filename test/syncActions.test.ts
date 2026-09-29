import { describe, expect, it } from 'vitest';
import { folderSyncActions } from '../src/webview/syncActions';

/**
 * Folder rows in the Sync panel used to render no actions at all, so a folder deleted locally could
 * not be resolved from the panel. The click handler routes data-sync-action "push" to overleaf-push
 * and "pull" to overleaf-pull, so those exact values are the contract.
 */

const actionsOf = (markup: string[]) =>
  markup.map(button => /data-sync-action="([^"]+)"/.exec(button)?.[1]);

describe('folderSyncActions', () => {
  it('lets a locally deleted folder be deleted on Overleaf or restored from it', () => {
    expect(actionsOf(folderSyncActions('local deleted', 'Sections-legacy'))).toEqual(['push', 'pull']);
  });

  it('marks the delete as the destructive action', () => {
    const [deleteButton, restoreButton] = folderSyncActions('local deleted', 'Sections-legacy');
    expect(deleteButton).toMatch(/class="icon-button danger"/);
    expect(restoreButton).not.toMatch(/danger/);
  });

  it('offers no diff, since a folder has no content to compare', () => {
    expect(actionsOf(folderSyncActions('local deleted', 'Sections-legacy'))).not.toContain('diff');
  });

  // Trash for 'remote deleted' and retry for 'error' are added by the row renderer for every entity,
  // so they are deliberately not duplicated here.
  it.each(['synced', 'local only', 'remote only', 'remote deleted', 'diverged', 'error'])(
    'adds no folder actions for a folder that is %s',
    status => {
      expect(folderSyncActions(status, 'Sections-legacy')).toEqual([]);
    }
  );

  it('uses the path it is given verbatim, leaving escaping to the caller', () => {
    const [button] = folderSyncActions('local deleted', 'a &amp; b');
    expect(button).toContain('data-sync-path="a &amp; b"');
  });
});
