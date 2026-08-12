import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildProjectTreeIndex } from './tree';
import {
  ensureLocalIgnoreFile,
  metadataPath,
  writeBaseDoc,
  writeManifest
} from './manifest';
import type { ManifestFile, ProjectSummary } from './types';
import { OverleafClient } from './overleafClient';
import { isTextLike, sanitizeProjectFolderName, sha1 } from './util';
import { registerSharedMirror } from './sharedState';

const execFileAsync = promisify(execFile);

export async function createProjectMirror(
  client: OverleafClient,
  project: ProjectSummary,
  parentRoot: string
): Promise<string> {
  const targetRoot = path.join(parentRoot, sanitizeProjectFolderName(project.name, project.id));
  if (await exists(targetRoot)) throw new Error(`Mirror target already exists: ${targetRoot}`);
  const session = await client.connectSocket(project.id);
  try {
    const joined = session.getProject();
    if (!joined) throw new Error('Realtime connection did not provide a project tree.');
    const index = buildProjectTreeIndex(client.getServerUrl(), project.id, project.name, joined);
    await fs.mkdir(targetRoot, { recursive: true });
    for (const folder of index.folders) if (folder.path) await fs.mkdir(path.join(targetRoot, folder.path), { recursive: true });
    for (const file of index.files) await writeInitialFile(client, session, project.id, targetRoot, file);
    for (const name of ['output', 'conflicts', path.join('base', 'docs'), 'trash']) {
      await fs.mkdir(metadataPath(targetRoot, name), { recursive: true });
    }
    await ensureLocalIgnoreFile(targetRoot);
    await writeManifest(targetRoot, index.manifest);
    await writeMirrorSupportFiles(targetRoot, index.manifest.rootDocPath);
    await initializeGit(targetRoot, `Initial Overleaf mirror: ${project.name}`);
    await registerSharedMirror(targetRoot);
    return targetRoot;
  } catch (error) {
    await fs.rm(targetRoot, { recursive: true, force: true });
    throw error;
  } finally {
    session.disconnect();
  }
}

async function writeInitialFile(
  client: OverleafClient,
  session: Awaited<ReturnType<OverleafClient['connectSocket']>>,
  projectId: string,
  root: string,
  file: ManifestFile
): Promise<void> {
  const target = path.join(root, file.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (file.entityType === 'doc') {
    const joined = await session.joinDoc(file.entityId);
    await fs.writeFile(target, joined.content, 'utf8');
    file.version = joined.version;
    file.binary = !isTextLike(file.path);
    file.sha1 = sha1(joined.content);
    file.baseHash = await writeBaseDoc(root, file.entityId, joined.content);
    await session.leaveDoc(file.entityId).catch(() => undefined);
  } else {
    const content = await client.downloadProjectFile(projectId, file.entityId);
    await fs.writeFile(target, content);
    file.binary = true;
    file.sha1 = sha1(content);
  }
}

async function writeMirrorSupportFiles(root: string, rootDocPath?: string): Promise<void> {
  const agents = `# AGENTS.md\n\nThis folder is a local mirror of an Overleaf project.\n\n- Edit source files normally.\n- Do not edit .overleaf-codex/**.\n- Put local-only paths in .overleaf-codexignore.\n`;
  const gitignore = `.overleaf-codex/\n.vscode/\n*.aux\n*.log\n*.fls\n*.fdb_latexmk\n*.synctex.gz\nmain.pdf\noutput.pdf\n.DS_Store\n`;
  const settings = {
    'latex-workshop.latex.rootFile.doNotPrompt': true,
    ...(rootDocPath ? { 'latex-workshop.latex.search.rootFiles.include': [rootDocPath] } : {}),
    'latex-workshop.latex.outDir': '%WORKSPACE_FOLDER%/.overleaf-codex/local-build'
  };
  await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, 'AGENTS.md'), agents, 'utf8'),
    fs.writeFile(path.join(root, '.gitignore'), gitignore, 'utf8'),
    fs.writeFile(path.join(root, '.vscode', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf8'),
    fs.writeFile(path.join(root, '.latexmkrc'), `$out_dir = '.overleaf-codex/local-build';\n$aux_dir = $out_dir;\n`, 'utf8')
  ]);
}

async function initializeGit(root: string, message: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: root, encoding: 'utf8' });
  await execFileAsync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
  await execFileAsync('git', [
    '-c', 'user.name=Overleaf Codex', '-c', 'user.email=overleaf-codex@local',
    'commit', '-m', message
  ], { cwd: root, encoding: 'utf8' }).catch(() => undefined);
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

