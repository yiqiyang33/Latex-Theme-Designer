import * as path from 'path';
import type { BinaryTransaction, BinaryTransactionStore } from './binaryTransactions';
import type { OverleafClient } from './overleafClient';
import type { OverleafCodexManifest } from './types';
import { formatUnknownError } from './util';

type RemoteMutationClient = Pick<OverleafClient, 'moveEntity' | 'renameEntity' | 'deleteEntity'>;
type EntityType = 'doc' | 'file' | 'folder';

export interface RemoteBinaryEntityState {
  entityId: string;
  name: string;
  parentFolderId: string;
}

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
    inspectEntity: (entityId: string) => RemoteBinaryEntityState | undefined;
  }
): Promise<boolean> {
  const records = await store.list();
  let manifestChanged = false;
  for (const transaction of records) {
    options.beforeMutation?.(transaction.originalEntityId);
    options.beforeMutation?.(transaction.tempEntityId);
    try {
      manifestChanged = await recoverBinaryTransactionFromRemoteState(
        client,
        projectId,
        manifest,
        transaction,
        options.inspectEntity
      ) || manifestChanged;
      await store.remove(transaction.id);
    } catch (error) {
      options.log?.(`Could not recover binary transaction ${transaction.id}: ${formatUnknownError(error)}`);
    }
  }
  return manifestChanged;
}

async function recoverBinaryTransactionFromRemoteState(
  client: RemoteMutationClient,
  projectId: string,
  manifest: OverleafCodexManifest,
  transaction: BinaryTransaction,
  inspectEntity: (entityId: string) => RemoteBinaryEntityState | undefined
): Promise<boolean> {
  const original = inspectEntity(transaction.originalEntityId);
  const temporary = inspectEntity(transaction.tempEntityId);
  assertExpectedBinaryParent(original, transaction.parentFolderId, transaction.path);
  assertExpectedBinaryParent(temporary, transaction.parentFolderId, transaction.path);

  if (temporary?.name === transaction.finalName) {
    if (original) await client.deleteEntity(projectId, 'file', transaction.originalEntityId);
    return commitRecoveredBinary(manifest, transaction);
  }

  if (original?.name === transaction.finalName) {
    if (temporary) await client.deleteEntity(projectId, 'file', transaction.tempEntityId);
    return false;
  }

  if (original?.name === transaction.backupName) {
    await client.renameEntity(projectId, 'file', transaction.originalEntityId, transaction.finalName);
    if (temporary) await client.deleteEntity(projectId, 'file', transaction.tempEntityId);
    return false;
  }

  if (!original && temporary?.name === transaction.tempName) {
    await client.renameEntity(projectId, 'file', transaction.tempEntityId, transaction.finalName);
    return commitRecoveredBinary(manifest, transaction);
  }

  throw new Error(
    `Remote binary entities for ${transaction.path} are in an unknown state `
    + `(original=${original?.name ?? 'missing'}, temporary=${temporary?.name ?? 'missing'}).`
  );
}

function assertExpectedBinaryParent(
  entity: RemoteBinaryEntityState | undefined,
  expectedParentFolderId: string,
  relPath: string
): void {
  if (entity && entity.parentFolderId !== expectedParentFolderId) {
    throw new Error(`Remote binary transaction entity for ${relPath} moved to an unexpected folder.`);
  }
}

function commitRecoveredBinary(
  manifest: OverleafCodexManifest,
  transaction: BinaryTransaction
): boolean {
  const entry = manifest.files[transaction.path];
  if (!entry) return false;
  const changed = entry.entityId !== transaction.tempEntityId
    || entry.remoteBlobHash !== transaction.expectedBlobHash
    || transaction.expectedSha1 !== undefined && entry.sha1 !== transaction.expectedSha1;
  entry.entityId = transaction.tempEntityId;
  entry.remoteBlobHash = transaction.expectedBlobHash;
  if (transaction.expectedSha1 !== undefined) entry.sha1 = transaction.expectedSha1;
  return changed;
}

export function transactionName(filename: string, suffix: string): string {
  const ext = path.posix.extname(filename);
  const stem = path.posix.basename(filename, ext);
  const marker = `.overleaf-codex-${suffix}`;
  const maxStem = Math.max(1, 150 - ext.length - marker.length);
  return `${stem.slice(0, maxStem)}${marker}${ext}`;
}
