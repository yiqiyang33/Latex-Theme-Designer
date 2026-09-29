/**
 * The row actions a folder in the Sync panel gets. A folder has no content to diff or push, so it
 * only gets what its state calls for. A folder deleted locally can be deleted on Overleaf too - the
 * engine refuses if anything inside it has not reached this computer - or restored from there.
 *
 * `encodedPath` must already be HTML-escaped by the caller.
 */
export function folderSyncActions(status: string, encodedPath: string): string[] {
  if (status !== "local deleted") return [];
  return [
    `<button class="icon-button danger" data-sync-action="push" data-sync-path="${encodedPath}" aria-label="Delete folder ${encodedPath} on Overleaf" title="Delete this folder on Overleaf too"><i class="codicon codicon-trash"></i></button>`,
    `<button class="icon-button" data-sync-action="pull" data-sync-path="${encodedPath}" aria-label="Restore folder ${encodedPath} from Overleaf" title="Restore this folder from Overleaf"><i class="codicon codicon-cloud-download"></i></button>`
  ];
}
