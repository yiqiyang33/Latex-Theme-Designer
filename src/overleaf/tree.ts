import * as path from 'path';
import {
  ManifestFile,
  ManifestFolder,
  OverleafCodexManifest,
  OverleafFolder,
  OverleafProject
} from './types';
import { DEFAULT_IGNORE_PATTERNS } from './manifest';

export interface ProjectTreeIndex {
  manifest: OverleafCodexManifest;
  folders: ManifestFolder[];
  files: ManifestFile[];
}

export function getRootFolder(project: OverleafProject): OverleafFolder {
  const root = Array.isArray(project.rootFolder) ? project.rootFolder[0] : project.rootFolder;
  if (!root) {
    throw new Error('Overleaf project did not include a root folder.');
  }
  return root;
}

export function buildProjectTreeIndex(
  serverUrl: string,
  projectId: string,
  projectName: string,
  project: OverleafProject
): ProjectTreeIndex {
  const folders: ManifestFolder[] = [];
  const files: ManifestFile[] = [];
  const root = getRootFolder(project);

  const manifest: OverleafCodexManifest = {
    schemaVersion: 3,
    serverUrl,
    projectId,
    projectName,
    rootDocId: project.rootDoc_id,
    compiler: project.compiler,
    files: {},
    folders: {},
    ignore: [...DEFAULT_IGNORE_PATTERNS],
    lastSyncAt: new Date().toISOString(),
    projectVersion: project.version
  };

  walkFolder(root, '', undefined, folders, files);

  for (const folder of folders) {
    manifest.folders[folder.path] = folder;
  }
  for (const file of files) {
    manifest.files[file.path] = file;
    if (project.rootDoc_id && file.entityId === project.rootDoc_id) {
      manifest.rootDocPath = file.path;
    }
  }

  return { manifest, folders, files };
}

function walkFolder(
  folder: OverleafFolder,
  folderPath: string,
  parentFolderId: string | undefined,
  folders: ManifestFolder[],
  files: ManifestFile[]
): void {
  folders.push({
    path: folderPath,
    entityId: folder._id,
    parentFolderId
  });

  for (const child of folder.folders ?? []) {
    const childPath = path.posix.join(folderPath, child.name);
    walkFolder(child, childPath, folder._id, folders, files);
  }

  for (const doc of folder.docs ?? []) {
    files.push({
      path: path.posix.join(folderPath, doc.name),
      entityId: doc._id,
      entityType: 'doc',
      parentFolderId: folder._id,
      version: doc.version,
      binary: false
    });
  }

  for (const file of folder.fileRefs ?? []) {
    files.push({
      path: path.posix.join(folderPath, file.name),
      entityId: file._id,
      entityType: 'file',
      parentFolderId: folder._id,
      binary: true,
      remoteBlobHash: file.hash,
      remoteRevision: file.rev
    });
  }
}
