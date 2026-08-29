import * as path from 'path';
import {
  ManifestFile,
  ManifestFolder,
  OverleafCodexManifest,
  OverleafDoc,
  OverleafFileRef,
  OverleafFolder,
  OverleafProject
} from './types';
import { DEFAULT_IGNORE_PATTERNS } from './manifest';
import { validateProjectPathSegment } from './util';

export interface ProjectTreeIndex {
  manifest: OverleafCodexManifest;
  folders: ManifestFolder[];
  files: ManifestFile[];
}

export type ProjectTreeEntityKind = 'doc' | 'file' | 'folder';

export function addProjectTreeEntity(
  project: OverleafProject,
  parentFolderId: string,
  kind: ProjectTreeEntityKind,
  entity: OverleafDoc | OverleafFileRef | OverleafFolder
): boolean {
  const parent = findProjectFolder(project, parentFolderId);
  if (!parent || findProjectEntity(project, entity._id)) return false;
  if (kind === 'doc') (parent.docs ??= []).push(entity as OverleafDoc);
  else if (kind === 'file') (parent.fileRefs ??= []).push(entity as OverleafFileRef);
  else (parent.folders ??= []).push(entity as OverleafFolder);
  return true;
}

export function renameProjectTreeEntity(project: OverleafProject, entityId: string, newName: string): boolean {
  const found = findProjectEntity(project, entityId);
  if (!found) return false;
  found.entity.name = newName;
  return true;
}

export function updateProjectTreeDocVersion(project: OverleafProject, docId: string, version: number): boolean {
  const found = findProjectEntity(project, docId);
  if (!found || found.kind !== 'doc') return false;
  (found.entity as OverleafDoc).version = version;
  return true;
}

export function moveProjectTreeEntity(project: OverleafProject, entityId: string, newParentFolderId: string): boolean {
  const target = findProjectFolder(project, newParentFolderId);
  const found = findProjectEntity(project, entityId);
  if (!target || !found || found.kind === 'folder' && containsFolder(found.entity as OverleafFolder, newParentFolderId)) {
    return false;
  }
  found.collection.splice(found.index, 1);
  if (found.kind === 'doc') (target.docs ??= []).push(found.entity as OverleafDoc);
  else if (found.kind === 'file') (target.fileRefs ??= []).push(found.entity as OverleafFileRef);
  else (target.folders ??= []).push(found.entity as OverleafFolder);
  return true;
}

export function removeProjectTreeEntity(project: OverleafProject, entityId: string): boolean {
  const found = findProjectEntity(project, entityId);
  if (!found) return false;
  found.collection.splice(found.index, 1);
  return true;
}

function findProjectFolder(project: OverleafProject, folderId: string): OverleafFolder | undefined {
  const root = getRootFolder(project);
  if (!root || !root._id) throw new Error('Overleaf project root folder is invalid.');
  if (root._id === folderId) return root;
  return findFolderBelow(root, folderId);
}

function findFolderBelow(folder: OverleafFolder, folderId: string): OverleafFolder | undefined {
  for (const child of folder.folders ?? []) {
    if (child._id === folderId) return child;
    const nested = findFolderBelow(child, folderId);
    if (nested) return nested;
  }
  return undefined;
}

function containsFolder(folder: OverleafFolder, folderId: string): boolean {
  return folder._id === folderId || Boolean(findFolderBelow(folder, folderId));
}

interface FoundProjectEntity {
  kind: ProjectTreeEntityKind;
  entity: OverleafDoc | OverleafFileRef | OverleafFolder;
  collection: Array<OverleafDoc | OverleafFileRef | OverleafFolder>;
  index: number;
}

function findProjectEntity(project: OverleafProject, entityId: string): FoundProjectEntity | undefined {
  return findEntityBelow(getRootFolder(project), entityId);
}

function findEntityBelow(folder: OverleafFolder, entityId: string): FoundProjectEntity | undefined {
  const groups: Array<{
    kind: ProjectTreeEntityKind;
    collection: Array<OverleafDoc | OverleafFileRef | OverleafFolder>;
  }> = [
    { kind: 'doc', collection: folder.docs ?? [] },
    { kind: 'file', collection: folder.fileRefs ?? [] },
    { kind: 'folder', collection: folder.folders ?? [] }
  ];
  for (const group of groups) {
    const index = group.collection.findIndex(entity => entity._id === entityId);
    if (index >= 0) return { kind: group.kind, entity: group.collection[index], collection: group.collection, index };
  }
  for (const child of folder.folders ?? []) {
    const nested = findEntityBelow(child, entityId);
    if (nested) return nested;
  }
  return undefined;
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
  if (!root._id) throw new Error('Overleaf project root folder is invalid.');
  const canonicalPaths = new Set<string>();

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
    const key = canonicalPathKey(folder.path);
    if (manifest.folders[folder.path] || canonicalPaths.has(key)) throw new Error(`Overleaf project contains duplicate folder path: ${folder.path || '.'}`);
    manifest.folders[folder.path] = folder;
    canonicalPaths.add(key);
  }
  for (const file of files) {
    const key = canonicalPathKey(file.path);
    if (manifest.files[file.path] || manifest.folders[file.path] || canonicalPaths.has(key)) throw new Error(`Overleaf project contains duplicate path: ${file.path}`);
    manifest.files[file.path] = file;
    canonicalPaths.add(key);
    if (project.rootDoc_id && file.entityId === project.rootDoc_id) {
      manifest.rootDocPath = file.path;
    }
  }

  return { manifest, folders, files };
}

function canonicalPathKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
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
    const childPath = path.posix.join(folderPath, validateProjectPathSegment(child.name));
    walkFolder(child, childPath, folder._id, folders, files);
  }

  for (const doc of folder.docs ?? []) {
    validateProjectPathSegment(doc.name);
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
    validateProjectPathSegment(file.name);
    files.push({
      path: path.posix.join(folderPath, file.name),
      entityId: file._id,
      entityType: 'file',
      parentFolderId: folder._id,
      binary: true,
      remoteBlobHash: file.hash,
      remoteRevision: file.rev,
      remoteSize: file.size
    });
  }
}
