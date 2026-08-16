import * as path from 'path';
import type { BinaryTransactionStore } from './binaryTransactions';
import type { OverleafClient } from './overleafClient';
import type { OverleafCodexManifest } from './types';
import { formatUnknownError } from './util';

type RemoteMutationClient = Pick<OverleafClient, 'moveEntity' | 'renameEntity' | 'deleteEntity'>;
type EntityType = 'doc' | 'file' | 'folder';

export interface RemotePathChange {
  entityType: EntityType;
  entityId: string;
  oldParentFolderId: string;
  newParentFolderId: string;
  oldName: string;
  newName: string;
}

export async function performRemotePathChange(
  client: RemoteMutationClient,
  projectId: string,
  change: RemotePathChange,
  beforeMutation: (entityId: string) => void = () => undefined
): Promise<void> {
  const renamed = change.oldName !== change.newName;
  const moved = change.oldParentFolderId !== change.newParentFolderId;
  if (!renamed && !moved) return;
  if (!renamed) {
    beforeMutation(change.entityId);
    await client.moveEntity(projectId, change.entityType, change.entityId, change.newParentFolderId);
    return;
  }
  if (!moved) {
    beforeMutation(change.entityId);
    await client.renameEntity(projectId, change.entityType, change.entityId, change.newName);
    return;
  }

  const temporary = transactionName(change.newName, `move-${Date.now()}`);
  beforeMutation(change.entityId);
  await client.renameEntity(projectId, change.entityType, change.entityId, temporary);
  try {
    beforeMutation(change.entityId);
    await client.moveEntity(projectId, change.entityType, change.entityId, change.newParentFolderId);
  } catch (error) {
    beforeMutation(change.entityId);
    await client.renameEntity(projectId, change.entityType, change.entityId, change.oldName).catch(() => undefined);
    throw error;
  }
  try {
    beforeMutation(change.entityId);
    await client.renameEntity(projectId, change.entityType, change.entityId, change.newName);
  } catch (error) {
    beforeMutation(change.entityId);
    await client.moveEntity(projectId, change.entityType, change.entityId, change.oldParentFolderId).catch(() => undefined);
    beforeMutation(change.entityId);
    await client.renameEntity(projectId, change.entityType, change.entityId, change.oldName).catch(() => undefined);
    throw error;
  }
}

export async function recoverBinaryTransactions(
  client: RemoteMutationClient,
  projectId: string,
  manifest: OverleafCodexManifest,
  store: BinaryTransactionStore,
  options: {
    beforeMutation?: (entityId: string) => void;
    log?: (message: string) => void;
  } = {}
): Promise<boolean> {
  const records = await store.list();
  for (const transaction of records) {
    options.beforeMutation?.(transaction.originalEntityId);
    options.beforeMutation?.(transaction.tempEntityId);
    try {
      if (transaction.stage === 'temp-uploaded') {
        await client.deleteEntity(projectId, 'file', transaction.tempEntityId).catch(() => undefined);
      } else if (transaction.stage === 'original-backed-up') {
        await client.renameEntity(projectId, 'file', transaction.originalEntityId, transaction.finalName);
        await client.deleteEntity(projectId, 'file', transaction.tempEntityId).catch(() => undefined);
      } else {
        await client.deleteEntity(projectId, 'file', transaction.originalEntityId).catch(() => undefined);
        const entry = manifest.files[transaction.path];
        if (entry) {
          entry.entityId = transaction.tempEntityId;
          entry.remoteBlobHash = transaction.expectedBlobHash;
        }
      }
      await store.remove(transaction.id);
    } catch (error) {
      options.log?.(`Could not recover binary transaction ${transaction.id}: ${formatUnknownError(error)}`);
    }
  }
  return records.length > 0;
}

export function transactionName(filename: string, suffix: string): string {
  const ext = path.posix.extname(filename);
  const stem = path.posix.basename(filename, ext);
  const marker = `.overleaf-codex-${suffix}`;
  const maxStem = Math.max(1, 150 - ext.length - marker.length);
  return `${stem.slice(0, maxStem)}${marker}${ext}`;
}
