import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { migrateLegacyLinuxPaths } from './sharedState';

const execFileAsync = promisify(execFile);
const MARKER = '.latex-editing-toolkit-cli.json';

export interface CliInstallResult {
  installRoot: string;
  commandPath: string;
  pathConfigured: boolean;
  /** Superseded version directories removed after this install, for reporting. */
  removedVersions: string[];
}

export async function installCli(extensionRoot: string, version: string): Promise<CliInstallResult> {
  await migrateLegacyLinuxPaths();
  await assertNode20();
  const supportRoot = cliSupportRoot();
  const installRoot = path.join(supportRoot, version);
  const commandPath = cliCommandPath();
  const commandDir = path.dirname(commandPath);
  await assertManagedDestination(commandPath, supportRoot);
  await fs.mkdir(supportRoot, { recursive: true });
  const stagingRoot = path.join(supportRoot, `.staging-${version}-${process.pid}-${Date.now()}`);
  const backupRoot = path.join(supportRoot, `.backup-${version}-${process.pid}-${Date.now()}`);
  await fs.mkdir(stagingRoot, { recursive: true });
  try {
    await Promise.all([
      fs.copyFile(path.join(extensionRoot, 'dist', 'cli.js'), path.join(stagingRoot, 'cli.js')),
      fs.cp(path.join(extensionRoot, 'dist', 'vendor'), path.join(stagingRoot, 'vendor'), { recursive: true, force: true })
    ]);
    await fs.writeFile(path.join(stagingRoot, MARKER), `${JSON.stringify({ managed: true, version }, null, 2)}\n`, 'utf8');
    await fs.chmod(path.join(stagingRoot, 'cli.js'), 0o755);
    if (await fs.stat(installRoot).then(() => true, () => false)) await fs.rename(installRoot, backupRoot);
    try {
      await fs.rename(stagingRoot, installRoot);
    } catch (error) {
      if (await fs.stat(backupRoot).then(() => true, () => false)) await fs.rename(backupRoot, installRoot);
      throw error;
    }
    await fs.rm(backupRoot, { recursive: true, force: true });
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
  await fs.mkdir(commandDir, { recursive: true });
  const temporary = `${commandPath}.tmp-${process.pid}`;
  await fs.rm(temporary, { force: true });
  await fs.symlink(path.join(installRoot, 'cli.js'), temporary);
  await fs.rename(temporary, commandPath);
  // Only after the command points at the new install, so a prune can never orphan the live link.
  const removedVersions = await pruneSupersededInstalls(supportRoot, version);
  return {
    installRoot,
    commandPath,
    pathConfigured: (process.env.PATH ?? '').split(path.delimiter).includes(commandDir),
    removedVersions
  };
}

/**
 * Drops superseded installs from the support root, which otherwise accumulate one directory per
 * released version forever. Only directories carrying the managed marker are removed, plus staging
 * and backup leftovers from an interrupted install, so anything else that ends up here is left
 * alone. Best-effort: the new CLI is already live by this point, so a failure to prune must not
 * fail the install.
 */
async function pruneSupersededInstalls(supportRoot: string, keepVersion: string): Promise<string[]> {
  const entries = await fs.readdir(supportRoot, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keepVersion) continue;
    const candidate = path.join(supportRoot, entry.name);
    const scratch = entry.name.startsWith('.staging-') || entry.name.startsWith('.backup-');
    // Scratch directories carry the pid that created them. Another process can be mid-install in
    // its own, and deleting that would break its rename - or, worse, its rollback. Reclaim only
    // the ones this process left behind.
    if (scratch && !entry.name.includes(`-${process.pid}-`)) continue;
    if (!scratch && !await hasManagedMarker(candidate)) continue;
    if (await fs.rm(candidate, { recursive: true, force: true }).then(() => true, () => false)) {
      removed.push(entry.name);
    }
  }
  return removed;
}

async function hasManagedMarker(installRoot: string): Promise<boolean> {
  return fs.stat(path.join(installRoot, MARKER)).then(() => true, () => false);
}

export async function uninstallCli(): Promise<{ removed: boolean; commandPath: string }> {
  await migrateLegacyLinuxPaths();
  const supportRoot = cliSupportRoot();
  const commandPath = cliCommandPath();
  const managed = await isManagedLink(commandPath, supportRoot);
  if (!managed) return { removed: false, commandPath };
  await fs.rm(commandPath, { force: true });
  await fs.rm(supportRoot, { recursive: true, force: true });
  return { removed: true, commandPath };
}

export async function updateManagedCliIfInstalled(
  extensionRoot: string,
  version: string
): Promise<CliInstallResult | undefined> {
  await migrateLegacyLinuxPaths();
  const supportRoot = cliSupportRoot();
  const commandPath = cliCommandPath();
  if (!await isManagedLink(commandPath, supportRoot)) return undefined;
  return installCli(extensionRoot, version);
}

async function assertNode20(): Promise<void> {
  const result = await execFileAsync('/usr/bin/env', ['node', '--version'], { encoding: 'utf8' }).catch(() => undefined);
  const major = Number(/^v(\d+)/.exec(String(result?.stdout ?? ''))?.[1]);
  if (!Number.isFinite(major) || major < 20) throw new Error('Installing the CLI requires Node.js 20 or newer on PATH.');
}

function cliSupportRoot(): string {
  return process.env.LATEX_TOOLKIT_CLI_SUPPORT_HOME
    ? path.resolve(process.env.LATEX_TOOLKIT_CLI_SUPPORT_HOME)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'latex-editing-toolkit', 'cli')
      : path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
        'latex-editing-toolkit',
        'cli'
      );
}

function cliCommandPath(): string {
  return path.join(
    process.env.LATEX_TOOLKIT_BIN_HOME ? path.resolve(process.env.LATEX_TOOLKIT_BIN_HOME) : path.join(os.homedir(), '.local', 'bin'),
    'latex-toolkit'
  );
}

async function assertManagedDestination(commandPath: string, supportRoot: string): Promise<void> {
  const stat = await fs.lstat(commandPath).catch(() => undefined);
  if (!stat) return;
  if (!await isManagedLink(commandPath, supportRoot)) {
    throw new Error(`Refusing to overwrite non-managed command: ${commandPath}`);
  }
}

async function isManagedLink(commandPath: string, supportRoot: string): Promise<boolean> {
  const stat = await fs.lstat(commandPath).catch(() => undefined);
  if (!stat?.isSymbolicLink()) return false;
  const target = await fs.realpath(commandPath).catch(() => undefined);
  const canonicalSupportRoot = await fs.realpath(supportRoot).catch(() => path.resolve(supportRoot));
  if (!target || !isWithin(canonicalSupportRoot, target)) return false;
  return hasManagedMarker(path.dirname(target));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
