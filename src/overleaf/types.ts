export type EntityType = 'doc' | 'file' | 'folder';

export interface Identity {
  csrfToken: string;
  cookies: string;
  userId?: string;
  userEmail?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  accessLevel?: string;
  archived?: boolean;
  trashed?: boolean;
  lastUpdated?: string;
}

export interface OverleafDoc {
  _id: string;
  name: string;
  version?: number;
}

export interface OverleafFileRef {
  _id: string;
  name: string;
  hash?: string;
  rev?: number;
  size?: number;
  linkedFileData?: unknown;
}

export interface OverleafFolder {
  _id: string;
  name: string;
  docs?: OverleafDoc[];
  fileRefs?: OverleafFileRef[];
  folders?: OverleafFolder[];
}

export interface OverleafProject {
  _id?: string;
  id?: string;
  name?: string;
  rootFolder?: OverleafFolder[] | OverleafFolder;
  rootDoc_id?: string;
  compiler?: string;
  version?: number;
}

export interface ManifestFile {
  path: string;
  entityId: string;
  entityType: 'doc' | 'file';
  parentFolderId: string;
  version?: number;
  binary?: boolean;
  sha1?: string;
  baseHash?: string;
  remoteBlobHash?: string;
  remoteRevision?: number;
  remoteSize?: number;
  localSize?: number;
  localMtimeMs?: number;
  localCtimeMs?: number;
  localInode?: number;
  localHashCache?: string;
}

export interface ManifestFolder {
  path: string;
  entityId: string;
  parentFolderId?: string;
}

export interface OverleafCodexManifest {
  schemaVersion: 1 | 2 | 3;
  serverUrl: string;
  projectId: string;
  projectName: string;
  rootDocId?: string;
  rootDocPath?: string;
  compiler?: string;
  files: Record<string, ManifestFile>;
  folders: Record<string, ManifestFolder>;
  ignore: string[];
  lastSyncAt: string;
  projectVersion?: number;
  lastFullAuditAt?: string;
  lastRemoteCompile?: {
    completedAt: string;
    pdfPath?: string;
    logPath?: string;
  };
}

export interface JoinDocResult {
  content: string;
  version: number;
}

export interface OtOperation {
  p: number;
  i?: string;
  d?: string;
  u?: boolean;
}

export interface OtUpdate {
  doc: string;
  op?: OtOperation[];
  v: number;
  lastV?: number;
  hash?: string;
}

export interface CompileOutputFile {
  path?: string;
  url?: string;
  type?: string;
  build?: string;
}

export interface CompileResponse {
  status: 'success' | 'failure' | 'error';
  compileGroup: string;
  clsiServerId?: string;
  pdfDownloadDomain?: string;
  outputFiles: CompileOutputFile[];
  enableHybridPdfDownload?: boolean;
}

export interface SyncCodeResponse {
  pdf?: Array<{
    page: number;
    h: number;
    v: number;
    width: number;
    height: number;
  }>;
}

export interface SyncPdfResponse {
  file: string;
  line: number;
  column: number;
}

export interface OnlineUser {
  client_id: string;
  connected?: boolean;
  cursorData?: {
    column: number;
    doc_id: string;
    row: number;
  };
  email?: string;
  first_name?: string;
  last_name?: string;
  last_updated_at?: string | number;
  user_id?: string;
}

export interface CollaboratorPosition {
  id: string;
  user_id?: string;
  name?: string;
  email?: string;
  doc_id?: string;
  row?: number;
  column?: number;
  last_updated_at?: number;
}

export type SyncStatusKind =
  | 'synced'
  | 'local ahead'
  | 'remote ahead'
  | 'diverged'
  | 'local only'
  | 'remote only'
  | 'remote deleted'
  | 'local deleted'
  | 'error';

export interface SyncStatusItem {
  path: string;
  status: SyncStatusKind;
  entityId?: string;
  entityType?: 'doc' | 'file' | 'folder';
  parentFolderId?: string;
  version?: number;
  remoteVersion?: number;
  localHash?: string;
  remoteHash?: string;
  baseHash?: string;
  message?: string;
  blocking: boolean;
  blockingScope?: 'none' | 'path' | 'subtree' | 'project';
  localPath?: string;
  remotePath?: string;
  changeKind?: 'content' | 'create' | 'delete' | 'rename' | 'move' | 'type-change' | 'read-error';
  localSize?: number;
  remoteSize?: number;
  localMtimeMs?: number;
}

export interface SyncStatusReport {
  schemaVersion: 1 | 2;
  checkedAt: string;
  projectId: string;
  projectName: string;
  hasBlocking: boolean;
  items: SyncStatusItem[];
  checkMode?: 'incremental' | 'full';
  completeness?: 'complete' | 'partial' | 'failed';
  globalBlockReason?: string;
}

export interface UploadFileResult extends OverleafFileRef {
  entityType?: 'file' | 'doc';
}

export interface FileTransferResult {
  size: number;
  sha1: string;
  gitBlobHash: string;
}

export interface NetworkTimeouts {
  connectMs: number;
  projectJoinMs: number;
  httpMs: number;
  joinDocMs: number;
  otAckMs: number;
}
