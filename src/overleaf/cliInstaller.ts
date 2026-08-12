import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MARKER = '.latex-editing-toolkit-cli.json';

export interface CliInstallResult {
  installRoot: string;
  commandPath: string;
  pathConfigured: boolean;
}

export async function installCli(extensionRoot: string, version: string): Promise<CliInstallResult> {
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
      fs.cp(path.join(extensionRoot, 'dist', 'cli-vendor'), path.join(stagingRoot, 'cli-vendor'), { recursive: true, force: true })
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
  return {
    installRoot,
    commandPath,
    pathConfigured: (process.env.PATH ?? '').split(path.delimiter).includes(commandDir)
  };
}

export async function uninstallCli(): Promise<{ removed: boolean; commandPath: string }> {
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
    : path.join(os.homedir(), 'Library', 'Application Support', 'latex-editing-toolkit', 'cli');
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
  return fs.stat(path.join(path.dirname(target), MARKER)).then(() => true, () => false);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
