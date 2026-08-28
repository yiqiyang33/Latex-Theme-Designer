import type { BinaryTransaction } from './binaryTransactions';
import type { PersistedConflict } from './conflictStore';
import type { OverleafCodexManifest, SyncStatusItem, SyncStatusReport } from './types';
import { normalizeProjectRelativePath } from './util';

type ValidationResult = string | undefined;

const STATUS_VALUES = new Set([
  'synced', 'local ahead', 'remote ahead', 'diverged', 'local only', 'remote only',
  'remote deleted', 'local deleted', 'error'
]);
const ENTITY_TYPES = new Set(['doc', 'file', 'folder']);
const HASH_FIELDS = ['sha1', 'baseHash', 'remoteBlobHash', 'localHashCache'] as const;

export function validateManifest(value: unknown): ValidationResult {
  if (!isRecord(value)) return '$ must be an object';
  const required = requiredStrings(value, ['serverUrl', 'projectId', 'projectName', 'lastSyncAt']);
  if (required) return required;
  if (value.schemaVersion !== undefined && ![1, 2, 3].includes(value.schemaVersion as number)) return '$.schemaVersion must be 1, 2, or 3';
  if (!Array.isArray(value.ignore) || value.ignore.some(item => typeof item !== 'string')) return '$.ignore must be an array of strings';
  if (!isRecord(value.files)) return '$.files must be an object';
  if (!isRecord(value.folders)) return '$.folders must be an object';
  for (const [key, item] of Object.entries(value.files)) {
    const at = `$.files[${JSON.stringify(key)}]`;
    if (!isRecord(item)) return `${at} must be an object`;
    const error = requiredStrings(item, ['path', 'entityId', 'parentFolderId'], at);
    if (error) return error;
    if (item.path !== key) return `${at}.path must match its map key`;
    try {
      if (normalizeProjectRelativePath(item.path) !== item.path) return `${at}.path must use canonical relative separators`;
    } catch { return `${at}.path must be a safe relative project path`; }
    if (item.entityType !== 'doc' && item.entityType !== 'file') return `${at}.entityType must be "doc" or "file"`;
    if (item.binary !== undefined && typeof item.binary !== 'boolean') return `${at}.binary must be a boolean`;
    for (const field of HASH_FIELDS) if (item[field] !== undefined && typeof item[field] !== 'string') return `${at}.${field} must be a string`;
    for (const field of ['version', 'remoteRevision', 'remoteSize', 'localSize', 'localMtimeMs', 'localCtimeMs', 'localInode'] as const) {
      if (item[field] !== undefined && !isNonNegativeNumber(item[field])) return `${at}.${field} must be a non-negative finite number`;
    }
  }
  for (const [key, item] of Object.entries(value.folders)) {
    const at = `$.folders[${JSON.stringify(key)}]`;
    if (!isRecord(item)) return `${at} must be an object`;
    const error = requiredStrings(item, ['path', 'entityId'], at);
    if (error) return error;
    if (item.path !== key) return `${at}.path must match its map key`;
    try {
      if (normalizeProjectRelativePath(item.path, true) !== item.path) return `${at}.path must use canonical relative separators`;
    } catch { return `${at}.path must be a safe relative project path`; }
    if (item.parentFolderId !== undefined && typeof item.parentFolderId !== 'string') return `${at}.parentFolderId must be a string`;
  }
  for (const field of ['rootDocId', 'rootDocPath', 'compiler', 'lastFullAuditAt'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return `$.${field} must be a string`;
  }
  if (value.lastRemoteCompile !== undefined) {
    if (!isRecord(value.lastRemoteCompile)) return '$.lastRemoteCompile must be an object';
    if (typeof value.lastRemoteCompile.completedAt !== 'string') return '$.lastRemoteCompile.completedAt must be a string';
    for (const field of ['pdfPath', 'logPath'] as const) {
      const filePath = value.lastRemoteCompile[field];
      if (filePath !== undefined) {
        if (typeof filePath !== 'string') return `$.lastRemoteCompile.${field} must be a string`;
        try {
          if (normalizeProjectRelativePath(filePath) !== filePath) return `$.lastRemoteCompile.${field} must be a safe relative project path`;
        } catch { return `$.lastRemoteCompile.${field} must be a safe relative project path`; }
      }
    }
  }
  if (value.rootDocPath !== undefined) {
    try {
      if (normalizeProjectRelativePath(value.rootDocPath as string) !== value.rootDocPath) return '$.rootDocPath must use canonical relative separators';
    } catch { return '$.rootDocPath must be a safe relative project path'; }
  }
  if (value.projectVersion !== undefined && !isNonNegativeNumber(value.projectVersion)) return '$.projectVersion must be a non-negative finite number';
  return undefined;
}

export function validateSyncStatus(value: unknown): ValidationResult {
  if (!isRecord(value)) return '$ must be an object';
  const required = requiredStrings(value, ['checkedAt', 'projectId', 'projectName']);
  if (required) return required;
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return '$.schemaVersion must be 1 or 2';
  if (typeof value.hasBlocking !== 'boolean') return '$.hasBlocking must be a boolean';
  if (!Array.isArray(value.items)) return '$.items must be an array';
  for (let index = 0; index < value.items.length; index += 1) {
    const error = validateStatusItem(value.items[index], `$.items[${index}]`);
    if (error) return error;
  }
  if (value.checkMode !== undefined && value.checkMode !== 'incremental' && value.checkMode !== 'full') return '$.checkMode is invalid';
  if (value.completeness !== undefined && !['complete', 'partial', 'failed'].includes(value.completeness as string)) return '$.completeness is invalid';
  if (value.globalBlockReason !== undefined && typeof value.globalBlockReason !== 'string') return '$.globalBlockReason must be a string';
  return undefined;
}

export function validateConflictList(value: unknown): ValidationResult {
  if (!Array.isArray(value)) return '$ must be an array';
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const at = `$[${index}]`;
    if (!isRecord(item)) return `${at} must be an object`;
    const error = requiredStrings(item, ['relPath', 'docId', 'remotePath', 'reason', 'createdAt'], at);
    if (error) return error;
    try {
      if (normalizeProjectRelativePath(item.relPath as string) !== item.relPath) return `${at}.relPath must be a safe canonical relative project path`;
    } catch { return `${at}.relPath must be a safe relative project path`; }
    if (!isNonNegativeNumber(item.remoteVersion)) return `${at}.remoteVersion must be a non-negative finite number`;
  }
  return undefined;
}

export function validateTransactionList(value: unknown): ValidationResult {
  if (!Array.isArray(value)) return '$ must be an array';
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const at = `$[${index}]`;
    if (!isRecord(item)) return `${at} must be an object`;
    const error = requiredStrings(item, [
      'id', 'path', 'parentFolderId', 'finalName', 'tempName', 'backupName', 'originalEntityId',
      'tempEntityId', 'expectedBlobHash', 'createdAt'
    ], at);
    if (error) return error;
    try {
      if (normalizeProjectRelativePath(item.path as string) !== item.path) return `${at}.path must be a safe canonical relative project path`;
    } catch { return `${at}.path must be a safe relative project path`; }
    if (!['temp-uploaded', 'original-backed-up', 'promoted'].includes(item.stage as string)) return `${at}.stage is invalid`;
    if (item.expectedSha1 !== undefined && typeof item.expectedSha1 !== 'string') return `${at}.expectedSha1 must be a string`;
  }
  return undefined;
}

export function assertValidManifest(value: OverleafCodexManifest): void {
  const error = validateManifest(value);
  if (error) throw new Error(`Cannot write invalid Overleaf manifest: ${error}`);
}

export function assertValidSyncStatus(value: SyncStatusReport): void {
  const error = validateSyncStatus(value);
  if (error) throw new Error(`Cannot write invalid Overleaf sync status: ${error}`);
}

export function assertValidConflicts(value: PersistedConflict[]): void {
  const error = validateConflictList(value);
  if (error) throw new Error(`Cannot write invalid Overleaf conflict index: ${error}`);
}

export function assertValidTransactions(value: BinaryTransaction[]): void {
  const error = validateTransactionList(value);
  if (error) throw new Error(`Cannot write invalid Overleaf binary transactions: ${error}`);
}

function validateStatusItem(value: unknown, at: string): ValidationResult {
  if (!isRecord(value)) return `${at} must be an object`;
  if (typeof value.path !== 'string') return `${at}.path must be a string`;
  try { normalizeProjectRelativePath(value.path); } catch { return `${at}.path must be a safe relative project path`; }
  if (!STATUS_VALUES.has(value.status as string)) return `${at}.status is invalid`;
  if (typeof value.blocking !== 'boolean') return `${at}.blocking must be a boolean`;
  if (value.entityType !== undefined && !ENTITY_TYPES.has(value.entityType as string)) return `${at}.entityType is invalid`;
  for (const field of ['entityId', 'parentFolderId', 'localHash', 'remoteHash', 'baseHash', 'message', 'localPath', 'remotePath'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return `${at}.${field} must be a string`;
  }
  for (const field of ['version', 'remoteVersion', 'localSize', 'remoteSize', 'localMtimeMs'] as const) {
    if (value[field] !== undefined && !isNonNegativeNumber(value[field])) return `${at}.${field} must be a non-negative finite number`;
  }
  if (value.blockingScope !== undefined && !['none', 'path', 'subtree', 'project'].includes(value.blockingScope as string)) return `${at}.blockingScope is invalid`;
  if (value.changeKind !== undefined && !['content', 'create', 'delete', 'rename', 'move', 'type-change', 'read-error'].includes(value.changeKind as string)) return `${at}.changeKind is invalid`;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredStrings(value: Record<string, unknown>, fields: readonly string[], at = '$'): ValidationResult {
  for (const field of fields) if (typeof value[field] !== 'string') return `${at}.${field} must be a string`;
  return undefined;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
