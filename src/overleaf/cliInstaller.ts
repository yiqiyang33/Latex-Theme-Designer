import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { migrateLegacyLinuxPaths } from './sharedState';
import { hostTag } from './hostIdentity';

const execFileAsync = promisify(execFile);
const MARKER = '.latex-editing-toolkit-cli.json';
const LAUNCHER_MARKER = 'latex-editing-toolkit-cli-launcher v1';
const MAX_LAUNCHER_BYTES = 16 * 1024;
const MINIMUM_NODE_MAJOR = 20;
// Editors whose remote servers bundle a Node runtime the CLI can borrow when none is installed.
const REMOTE_SERVER_HOMES = ['.vscode-server', '.vscode-server-insiders', '.cursor-server', '.windsurf-server', '.vscodium-server'];

export interface CliInstallResult {
  installRoot: string;
  commandPath: string;
  pathConfigured: boolean;
  /** The Node.js runtime the install was checked with. */
  node: string;
  /** Superseded version directories removed after this install, for reporting. */
  removedVersions: string[];
}

export async function installCli(extensionRoot: string, version: string): Promise<CliInstallResult> {
  await migrateLegacyLinuxPaths();
  const node = await resolveCliNode();
  const supportRoot = cliSupportRoot();
  const installRoot = path.join(supportRoot, version);
  const commandPath = cliCommandPath();
  const commandDir = path.dirname(commandPath);
  await assertManagedDestination(commandPath, supportRoot);
  await fs.mkdir(supportRoot, { recursive: true });
  // Several login nodes of a cluster can update the same NFS home at once: scratch names carry the
  // host, so no installer ever touches another's.
  const scratchId = `${hostTag()}-${process.pid}-${Date.now()}`;
  const stagingRoot = path.join(supportRoot, `.staging-${version}-${scratchId}`);
  const backupRoot = path.join(supportRoot, `.backup-${version}-${scratchId}`);
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
      if (await fs.stat(backupRoot).then(() => true, () => false)) await fs.rename(backupRoot, installRoot).catch(() => undefined);
      // Another node finished installing this same version first; its copy is as good as ours.
      if (!isOccupied(error) || await installedVersion(installRoot) !== version) throw error;
    }
    await fs.rm(backupRoot, { recursive: true, force: true });
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
  await fs.mkdir(commandDir, { recursive: true });
  const temporary = `${commandPath}.tmp-${scratchId}`;
  await fs.rm(temporary, { force: true });
  await fs.writeFile(temporary, launcherScript(path.join(installRoot, 'cli.js')), { mode: 0o755 });
  await fs.chmod(temporary, 0o755);
  await fs.rename(temporary, commandPath);
  // Only after the command points at the new install, so a prune can never orphan the live launcher.
  const removedVersions = await pruneSupersededInstalls(supportRoot, version);
  return {
    installRoot,
    commandPath,
    pathConfigured: (process.env.PATH ?? '').split(path.delimiter).includes(commandDir),
    node: node.path,
    removedVersions
  };
}

/**
 * The installed command: a small sh launcher rather than a symlink to cli.js, because cli.js's
 * `#!/usr/bin/env node` needs `node` on PATH, which a remote server reached over SSH often lacks.
 * It falls back to the Node runtime bundled with the VS Code (or Cursor, ...) server, looked up at
 * run time since those directories are named after editor versions and replaced on every update.
 */
export function launcherScript(cliPath: string): string {
  const serverNodes = REMOTE_SERVER_HOMES.flatMap(home => [
    `"$HOME"/${home}/cli/servers/*/server/node`,
    `"$HOME"/${home}/bin/*/node`
  ]).join(' \\\n  ');
  return [
    '#!/bin/sh',
    `# Managed by LaTeX Editing Toolkit (${LAUNCHER_MARKER}); reinstall from the editor instead of editing.`,
    `# target: ${JSON.stringify(cliPath)}`,
    `cli=${shellQuote(cliPath)}`,
    'usable() {',
    `  "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= ${MINIMUM_NODE_MAJOR} ? 0 : 1)' >/dev/null 2>&1`,
    '}',
    'if [ -n "${LATEX_TOOLKIT_NODE:-}" ]; then exec "$LATEX_TOOLKIT_NODE" --no-deprecation "$cli" "$@"; fi',
    'if command -v node >/dev/null 2>&1 && usable node; then exec node --no-deprecation "$cli" "$@"; fi',
    `for candidate in ${serverNodes}; do`,
    '  if [ -x "$candidate" ] && usable "$candidate"; then exec "$candidate" --no-deprecation "$cli" "$@"; fi',
    'done',
    `echo "latex-toolkit: Node.js ${MINIMUM_NODE_MAJOR} or newer was not found on PATH or in an editor server installation; install it or set LATEX_TOOLKIT_NODE." >&2`,
    'exit 127',
    ''
  ].join('\n');
}

/**
 * The Node.js runtime the CLI will run on here, using the launcher's order: $LATEX_TOOLKIT_NODE,
 * `node` on PATH, the extension host's own runtime when it is plain Node (a remote server's), then
 * any editor server's bundled runtime.
 */
export async function resolveCliNode(env: NodeJS.ProcessEnv = process.env): Promise<{ path: string; major: number }> {
  const candidates = [
    ...(env.LATEX_TOOLKIT_NODE ? [env.LATEX_TOOLKIT_NODE] : []),
    'node',
    // Electron's binary (the local editor's extension host) only runs scripts with
    // ELECTRON_RUN_AS_NODE, so it is no use to a plain shell command.
    ...(process.versions.electron ? [] : [process.execPath]),
    ...await editorServerNodes(os.homedir())
  ];
  for (const candidate of candidates) {
    const major = await nodeMajor(candidate);
    if (major >= MINIMUM_NODE_MAJOR) return { path: candidate, major };
  }
  throw new Error(
    `Installing the CLI requires Node.js ${MINIMUM_NODE_MAJOR} or newer, on PATH or in an editor server installation. `
    + 'Install Node.js, or set LATEX_TOOLKIT_NODE to a node binary.'
  );
}

async function editorServerNodes(home: string): Promise<string[]> {
  const found: string[] = [];
  for (const base of REMOTE_SERVER_HOMES) {
    for (const [parent, suffix] of [[path.join(home, base, 'cli', 'servers'), ['server', 'node']], [path.join(home, base, 'bin'), ['node']]] as const) {
      const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) found.push(path.join(parent, entry.name, ...suffix));
      }
    }
  }
  return found;
}

async function nodeMajor(candidate: string): Promise<number> {
  const result = await execFileAsync(candidate, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 15_000 })
    .catch(() => undefined);
  const major = Number(/^(\d+)\./.exec(String(result?.stdout ?? '').trim())?.[1]);
  return Number.isFinite(major) ? major : 0;
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
  const ownScratch = `-${hostTag()}-${process.pid}-`;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keepVersion) continue;
    const candidate = path.join(supportRoot, entry.name);
    const scratch = entry.name.startsWith('.staging-') || entry.name.startsWith('.backup-');
    // Scratch directories carry the host and pid that created them. Another process - possibly on
    // another machine sharing this home - can be mid-install in its own, and deleting that would
    // break its rename or, worse, its rollback. Reclaim only the ones this process left behind
    // (names without a host come from older versions).
    const mine = entry.name.includes(ownScratch)
      || (!SCRATCH_WITH_HOST.test(entry.name) && entry.name.includes(`-${process.pid}-`));
    if (scratch && !mine) continue;
    if (!scratch && !await hasManagedMarker(candidate)) continue;
    if (await fs.rm(candidate, { recursive: true, force: true }).then(() => true, () => false)) {
      removed.push(entry.name);
    }
  }
  return removed;
}

const SCRATCH_WITH_HOST = /-[0-9a-f]{8}-\d+-\d+$/;

async function hasManagedMarker(installRoot: string): Promise<boolean> {
  return fs.stat(path.join(installRoot, MARKER)).then(() => true, () => false);
}

async function installedVersion(installRoot: string): Promise<string | undefined> {
  const raw = await fs.readFile(path.join(installRoot, MARKER), 'utf8').catch(() => undefined);
  try {
    const parsed = JSON.parse(raw ?? '') as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function isOccupied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}

export async function uninstallCli(): Promise<{ removed: boolean; commandPath: string }> {
  await migrateLegacyLinuxPaths();
  const supportRoot = cliSupportRoot();
  const commandPath = cliCommandPath();
  const managed = await isManagedCommand(commandPath, supportRoot);
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
  if (!await isManagedCommand(commandPath, supportRoot)) return undefined;
  return installCli(extensionRoot, version);
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
  if (!await isManagedCommand(commandPath, supportRoot)) {
    throw new Error(`Refusing to overwrite non-managed command: ${commandPath}`);
  }
}

/** Whether `commandPath` is this toolkit's launcher (or the symlink older versions installed). */
async function isManagedCommand(commandPath: string, supportRoot: string): Promise<boolean> {
  const stat = await fs.lstat(commandPath).catch(() => undefined);
  if (!stat) return false;
  const canonicalSupportRoot = await fs.realpath(supportRoot).catch(() => path.resolve(supportRoot));
  if (stat.isSymbolicLink()) {
    const target = await fs.realpath(commandPath).catch(() => undefined);
    if (!target || !isWithin(canonicalSupportRoot, target)) return false;
    return hasManagedMarker(path.dirname(target));
  }
  if (!stat.isFile() || stat.size > MAX_LAUNCHER_BYTES) return false;
  const content = await fs.readFile(commandPath, 'utf8').catch(() => '');
  if (!content.includes(LAUNCHER_MARKER)) return false;
  const declared = /^# target: (".*")$/m.exec(content)?.[1];
  let target: string | undefined;
  try { target = declared ? JSON.parse(declared) as string : undefined; } catch { target = undefined; }
  if (!target) return false;
  // A launcher whose install was removed is still ours to replace or delete.
  const resolved = await fs.realpath(target).catch(() => path.resolve(target!));
  return isWithin(canonicalSupportRoot, resolved) || isWithin(path.resolve(supportRoot), path.resolve(target));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
