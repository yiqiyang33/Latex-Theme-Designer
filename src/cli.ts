import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import { OverleafSyncEngine } from './overleaf/overleafSyncEngine';
import type { CredentialStore, SyncHost, SyncPolicy } from './overleaf/coreInterfaces';
import { createCredentialStore } from './overleaf/keychainStore';
import { compileRemoteProject, latestRemotePdf } from './overleaf/compileCore';
import { createProjectMirror } from './overleaf/mirrorCore';
import { manifestPath, readManifest, readSyncStatus } from './overleaf/manifest';
import { OverleafClient } from './overleaf/overleafClient';
import {
  listSharedMirrors,
  readSharedState,
  registerSharedMirror,
  updateSharedState
} from './overleaf/sharedState';
import {
  inspectOwner,
  SyncOwnerCoordinator,
  type OwnerEvent
} from './overleaf/syncOwnerCoordinator';
import type { Identity, SyncStatusReport } from './overleaf/types';
import type { SharedOverleafState } from './overleaf/sharedState';
import { formatUnknownError, normalizeServerUrl } from './overleaf/util';
import { executeSyncCommand, syncOperationRequiresForce, type SyncCommandBackend } from './overleaf/syncCommandCore';

const execFileAsync = promisify(execFile);

interface ParsedArgs {
  positionals: string[];
  options: Map<string, string | boolean>;
}

interface CliEnvelope {
  schemaVersion: 1;
  ok: boolean;
  command: string;
  root?: string;
  data?: unknown;
  warnings: string[];
  error?: { code: string; message: string };
}

class CliError extends Error {
  constructor(message: string, readonly exitCode: number, readonly code: string) {
    super(message);
  }
}

class Output {
  readonly warnings: string[] = [];
  constructor(readonly json: boolean, readonly command: string, readonly root?: string) {}

  log(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  warn(message: string): void {
    this.warnings.push(message);
    if (!this.json) process.stderr.write(`Warning: ${message}\n`);
  }

  event(event: string, root: string, data?: unknown): void {
    if (this.json) process.stdout.write(`${JSON.stringify({ version: 1, event, root, data })}\n`);
    else process.stdout.write(`[${event}]${data ? ` ${humanValue(data)}` : ''}\n`);
  }

  success(data?: unknown): void {
    if (this.json) {
      const envelope = makeSuccessEnvelope(this.command, this.root, data, this.warnings);
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    } else if (data !== undefined) {
      process.stdout.write(`${humanValue(data)}\n`);
    }
  }

  failure(error: CliError): void {
    if (this.json) {
      const envelope: CliEnvelope = {
        schemaVersion: 1,
        ok: false,
        command: this.command,
        root: this.root,
        warnings: this.warnings,
        error: { code: error.code, message: error.message }
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    } else process.stderr.write(`Error: ${error.message}\n`);
  }
}

function makeSuccessEnvelope(
  command: string,
  root: string | undefined,
  data: unknown,
  warnings: string[]
): CliEnvelope {
  return { schemaVersion: 1, ok: true, command, root, data, warnings: [...warnings] };
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  let output = new Output(argv.some(item => item === '--json' || item === '--json=true'), 'unknown');
  try {
    const parsed = parseArgs(argv);
    const positionals = parsed.positionals[0] === 'overleaf' ? parsed.positionals.slice(1) : parsed.positionals;
    const command = commandName(positionals);
    const json = boolOption(parsed, 'json');
    let root = stringOption(parsed, 'root');
    output = new Output(json, command, root ? path.resolve(root) : undefined);
    if (root) {
      root = await resolveMirrorRoot(root);
      output = new Output(json, command, root);
    }
    if (positionals.length === 0 || ['help', '--help', '-h'].includes(positionals[0])) {
      output.success(helpText());
      return 0;
    }
    const result = await dispatch(positionals, parsed, output, root);
    if (result !== WATCH_RESULT) output.success(result);
    return blockingExitCode(result);
  } catch (error) {
    const cliError = classifyError(error);
    output.failure(cliError);
    return cliError.exitCode;
  }
}

const WATCH_RESULT = Symbol('watch');

async function dispatch(
  args: string[],
  parsed: ParsedArgs,
  output: Output,
  root?: string
): Promise<unknown> {
  const [group, action, operand] = args;
  const credentials = createCredentialStore();
  const shared = await readSharedState();
  const server = normalizeServerUrl(stringOption(parsed, 'server') ?? shared.serverUrl);

  if (group === 'auth') {
    if (action === 'login') {
      const cookie = boolOption(parsed, 'cookie-stdin') ? (await readAllStdin()).trim() : await readSecret('Overleaf Cookie: ');
      if (!cookie) throw usageError('No Cookie was provided.');
      const client = new OverleafClient(server, undefined, shared.policy.networkTimeouts.httpMs / 1000, shared.policy.networkTimeouts);
      const identity = await client.loginWithCookie(cookie);
      await credentials.saveIdentity(server, identity);
      return { server, authenticated: true, userEmail: identity.userEmail };
    }
    if (action === 'logout') {
      await credentials.deleteIdentity(server);
      return { server, authenticated: false };
    }
    if (action === 'status') {
      const identity = await credentials.getIdentity(server);
      return { server, authenticated: Boolean(identity), userEmail: identity?.userEmail };
    }
    throw usageError('Use auth login, auth logout, or auth status.');
  }

  if (group === 'projects' && action === 'list') {
    return (await makeClient(server, credentials, shared.policy)).listProjects();
  }

  if (group === 'mirrors' && action === 'list') return listSharedMirrors();

  if (group === 'mirror' && action === 'create') {
    const parent = path.resolve(stringOption(parsed, 'parent') ?? shared.localProjectsRoot);
    const client = await makeClient(server, credentials, shared.policy);
    const projects = await client.listProjects();
    let project = operand ? projects.find(item => item.id === operand) : undefined;
    if (!project && operand) throw usageError(`No Overleaf project has id ${operand}.`);
    if (!project) {
      if (!process.stdin.isTTY || output.json) throw usageError('Provide project-id in non-interactive mode.');
      project = await chooseProject(projects);
    }
    const created = await createProjectMirror(client, project!, parent);
    return { root: created, projectId: project!.id, projectName: project!.name };
  }

  if (group === 'config') {
    if (action === 'list') return shared;
    if (action === 'get') return getConfigValue(shared, operand);
    if (action === 'set') {
      const key = operand;
      const value = args[3];
      if (!key || value === undefined) throw usageError('Use config set <key> <value>.');
      return updateSharedState(state => setConfigValue(state, key, value));
    }
    throw usageError('Use config list, config get <key>, or config set <key> <value>.');
  }

  if (group === 'doctor') return doctor(root, server, credentials, shared.policy);

  if (['status', 'sync', 'push', 'pull', 'conflicts', 'compile', 'pdf'].includes(group)) {
    root = root ?? await resolveMirrorRoot(process.cwd());
    await registerSharedMirror(root);
  }

  if (group === 'compile') {
    const manifest = await readManifest(root!);
    const client = await makeClient(manifest.serverUrl, credentials, shared.policy);
    return compileRemoteProject(root!, client, stringOption(parsed, 'root-doc'));
  }

  if (group === 'pdf') {
    const pdf = await latestRemotePdf(root!);
    if (!pdf) throw dataError('No downloaded remote PDF exists. Run compile first.');
    if (action === 'path') return { path: pdf };
    if (action === 'open') {
      await execFileAsync(openCommand(), [pdf]);
      return { path: pdf, opened: true };
    }
    throw usageError('Use pdf path or pdf open.');
  }

  if (group === 'status') {
    if (!boolOption(parsed, 'refresh') && !boolOption(parsed, 'full')) return readSyncStatus(root!);
    return withOwner(root!, shared.policy, credentials, output, owner => owner.command('status', {
      refresh: true, full: boolOption(parsed, 'full')
    }));
  }

  if (group === 'sync') {
    if (boolOption(parsed, 'watch')) {
      await watchWithTakeover(root!, shared.policy, credentials, output);
      return WATCH_RESULT;
    }
    if (!boolOption(parsed, 'once')) throw usageError('Use sync --once or sync --watch.');
    return withOwner(root!, shared.policy, credentials, output, owner => owner.command('sync-once'));
  }

  if (group === 'push' || group === 'pull') {
    if (!action) throw usageError(`Use ${group} <path>.`);
    const force = boolOption(parsed, 'force');
    if (force && !process.stdin.isTTY && !parsed.options.has('force')) throw usageError('--force must be explicit.');
    if (!force && await operationIsDestructive(root!, action, group)) {
      if (!process.stdin.isTTY || output.json) throw usageError(`This ${group} may overwrite or delete data; pass --force.`);
      if (!await confirm(`Proceed with ${group} ${action}?`)) throw usageError('Operation cancelled.');
    }
    return withOwner(root!, shared.policy, credentials, output, owner => owner.command(group, { path: action, force }));
  }

  if (group === 'conflicts') {
    if (action === 'list') return withOwner(root!, shared.policy, credentials, output, owner => owner.command('conflicts-list'));
    if (action === 'resolve') {
      if (!operand) throw usageError('Use conflicts resolve <path> --use local|remote.');
      const use = stringOption(parsed, 'use');
      if (use !== 'local' && use !== 'remote') throw usageError('--use must be local or remote.');
      return withOwner(root!, shared.policy, credentials, output, owner => owner.command('conflicts-resolve', { path: operand, use }));
    }
    throw usageError('Use conflicts list or conflicts resolve <path> --use local|remote.');
  }

  throw usageError(`Unknown command: ${args.join(' ')}`);
}

class OwnerFacade {
  private engine?: OverleafSyncEngine;
  private readonly coordinator = new SyncOwnerCoordinator();

  constructor(
    private readonly root: string,
    private readonly policy: SyncPolicy,
    private readonly credentials: CredentialStore,
    private readonly output: Output
  ) {}

  async start(): Promise<'owner' | 'client'> {
    return this.coordinator.claim(this.root, (command, args) => this.handle(command, args));
  }

  command(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.coordinator.request(command, args);
  }

  async subscribe(listener: (event: OwnerEvent) => void): Promise<ReturnType<SyncOwnerCoordinator['subscribe']>> {
    return this.coordinator.subscribe(listener);
  }

  async runWatchAsOwner(): Promise<void> {
    const engine = await this.getEngine();
    const unsubscribe = engine.onEvent(event => this.coordinator.emit(event.event, event.data));
    try { await engine.watch(); } finally { unsubscribe(); }
  }

  requestStop(): void { this.engine?.requestStop(); }

  async close(): Promise<void> {
    await this.engine?.stop();
    await this.coordinator.release();
  }

  private async handle(command: string, args: Record<string, unknown>): Promise<unknown> {
    const engine = await this.getEngine();
    const backend: SyncCommandBackend = {
      status: request => engine.status(request.refresh, request.full, request.paths, request.reason),
      syncOnce: () => engine.syncOnce(),
      push: (relPath, force) => engine.push(relPath, force),
      pull: (relPath, force) => engine.pull(relPath, force),
      conflicts: () => engine.conflicts(),
      resolveConflict: (relPath, use) => engine.resolveConflict(relPath, use)
    };
    return executeSyncCommand(backend, command, args);
  }

  private async getEngine(): Promise<OverleafSyncEngine> {
    if (this.engine) return this.engine;
    const manifest = await readManifest(this.root);
    const client = await makeClient(manifest.serverUrl, this.credentials, this.policy);
    const host: SyncHost = {
      log: message => this.output.log(message),
      progress: event => { if (!this.output.json) this.output.log(event.message); },
      status: report => this.coordinator.emit('status', report),
      conflict: (path, reason) => this.coordinator.emit('conflict', { path, reason })
    };
    this.engine = new OverleafSyncEngine(this.root, client, this.policy, host);
    await this.engine.start();
    return this.engine;
  }
}

async function withOwner<T>(
  root: string,
  policy: SyncPolicy,
  credentials: CredentialStore,
  output: Output,
  run: (owner: OwnerFacade) => Promise<T>
): Promise<T> {
  const owner = new OwnerFacade(root, policy, credentials, output);
  await owner.start();
  try { return await run(owner); } finally { await owner.close(); }
}

async function watchWithTakeover(
  root: string,
  policy: SyncPolicy,
  credentials: CredentialStore,
  output: Output
): Promise<void> {
  let stopping = false;
  let interrupted = false;
  let activeOwner: OwnerFacade | undefined;
  let activeSocket: Awaited<ReturnType<OwnerFacade['subscribe']>> | undefined;
  const stop = (): void => {
    interrupted = true;
    stopping = true;
    activeSocket?.destroy();
    activeOwner?.requestStop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    while (!stopping) {
      const owner = new OwnerFacade(root, policy, credentials, output);
      activeOwner = owner;
      const role = await owner.start();
      output.event(role === 'owner' ? 'owner-acquired' : 'owner-connected', root);
      if (role === 'owner') {
        await owner.runWatchAsOwner();
      } else {
        activeSocket = await owner.subscribe(event => output.event(event.event, event.root, event.data));
        await new Promise<void>(resolve => {
          activeSocket!.once('close', resolve);
          activeSocket!.once('error', resolve);
          const interval = setInterval(() => {
            if (stopping) { clearInterval(interval); resolve(); }
          }, 250);
        });
      }
      activeSocket = undefined;
      await owner.close();
      activeOwner = undefined;
      if (!stopping) {
        output.event('owner-lost', root);
        await delay(500);
      }
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    activeSocket?.destroy();
    await activeOwner?.close();
  }
  if (interrupted) throw new CliError('Interrupted.', 130, 'interrupted');
}

async function doctor(
  root: string | undefined,
  server: string,
  credentials: CredentialStore,
  policy: SyncPolicy
): Promise<Record<string, unknown>> {
  let identity: Identity | undefined;
  let credentialError: string | undefined;
  try {
    identity = await credentials.getIdentity(server);
  } catch (error) {
    credentialError = formatUnknownError(error);
  }
  const credentialStore = credentials.describe?.();
  const checks: Record<string, unknown> = {
    platform: { ok: process.platform === 'darwin' || process.platform === 'linux', value: process.platform },
    node: { ok: Number(process.versions.node.split('.')[0]) >= 20, value: process.versions.node },
    credentialStore: credentialStore ?? { kind: 'unknown', available: false },
    authentication: { ok: Boolean(identity), server, ...(credentialError ? { error: credentialError } : {}) }
  };
  if (identity) {
    try {
      const projects = await new OverleafClient(server, identity, policy.networkTimeouts.httpMs / 1000, policy.networkTimeouts).listProjects();
      checks.network = { ok: true, server, projectCount: projects.length };
    } catch (error) {
      checks.network = { ok: false, server, error: formatUnknownError(error) };
    }
  } else checks.network = { ok: false, skipped: true, reason: 'Not authenticated.' };
  if (root) {
    checks.manifest = { ok: await exists(manifestPath(root)), path: manifestPath(root) };
    checks.owner = await inspectOwner(root);
  }
  return checks;
}

async function makeClient(
  serverUrl: string,
  credentials: CredentialStore,
  policy: SyncPolicy
): Promise<OverleafClient> {
  const normalized = normalizeServerUrl(serverUrl);
  const identity = await credentials.getIdentity(normalized);
  if (!identity) throw authError(`Not logged in to ${normalized}. Run auth login first.`);
  return new OverleafClient(normalized, identity, policy.networkTimeouts.httpMs / 1000, policy.networkTimeouts);
}

async function resolveMirrorRoot(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  const stat = await fs.stat(current).catch(() => undefined);
  if (stat?.isFile()) current = path.dirname(current);
  while (true) {
    if (await exists(manifestPath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw dataError(`No .overleaf-codex/manifest.json was found from ${candidate} upward.`);
}

async function operationIsDestructive(root: string, relPath: string, operation: 'push' | 'pull'): Promise<boolean> {
  const status = await readSyncStatus(root);
  const item = status?.items.find(candidate => candidate.path === toPosix(relPath));
  return syncOperationRequiresForce(operation, item?.status);
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string | boolean>();
  const valueOptions = new Set(['root', 'server', 'parent', 'use', 'root-doc']);
  const booleanOptions = new Set([
    'json', 'no-color', 'cookie-stdin', 'refresh', 'full', 'once', 'watch', 'force', 'help'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { positionals.push(token); continue; }
    const [rawKey, inline] = token.slice(2).split('=', 2);
    if (valueOptions.has(rawKey)) {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw usageError(`--${rawKey} requires a value.`);
      options.set(rawKey, value);
    } else {
      if (!booleanOptions.has(rawKey)) {
        if (rawKey === 'cookie') throw usageError('Cookies must not be passed in argv; use auth login --cookie-stdin.');
        throw usageError(`Unknown option: --${rawKey}`);
      }
      options.set(rawKey, inline ?? true);
    }
  }
  return { positionals, options };
}

function stringOption(args: ParsedArgs, key: string): string | undefined {
  const value = args.options.get(key);
  return typeof value === 'string' ? value : undefined;
}

function boolOption(args: ParsedArgs, key: string): boolean {
  return args.options.get(key) === true || args.options.get(key) === 'true';
}

function getConfigValue(state: SharedOverleafState, key?: string): unknown {
  if (!key) throw usageError('Use config get <key>.');
  return key.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, state as unknown);
}

function setConfigValue(state: SharedOverleafState, key: string, raw: string): void {
  const allowed = new Set([
    'serverUrl', 'localProjectsRoot', 'policy.autoPushLocalAhead',
    'policy.syncBinaryFiles', 'policy.syncDestructiveChanges',
    'policy.networkTimeouts.connectMs', 'policy.networkTimeouts.projectJoinMs',
    'policy.networkTimeouts.httpMs', 'policy.networkTimeouts.joinDocMs', 'policy.networkTimeouts.otAckMs'
  ]);
  if (!allowed.has(key)) throw usageError(`Unsupported config key: ${key}`);
  const parts = key.split('.');
  let target = state as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part] as Record<string, unknown>;
  }
  const value = /^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : /^\d+$/.test(raw) ? Number(raw) : raw;
  target[parts.at(-1)!] = key === 'serverUrl' ? normalizeServerUrl(String(value)) : value;
}

function helpText(): string {
  return `latex-toolkit overleaf <command> [options]\n\n`
    + `Commands: auth login|logout|status, projects list, mirrors list, mirror create,\n`
    + `config list|get|set, status, doctor, sync --once|--watch, push, pull,\n`
    + `conflicts list|resolve, compile, pdf path|open\n\n`
    + `Global options: --root <path> --server <url> --json --no-color`;
}

function commandName(positionals: string[]): string {
  if (positionals.length === 0) return 'help';
  return new Set(['auth', 'projects', 'mirrors', 'mirror', 'config', 'conflicts', 'pdf']).has(positionals[0])
    ? positionals.slice(0, 2).join(' ')
    : positionals[0];
}

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw usageError('Use --cookie-stdin in non-interactive mode.');
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string): void => {
      if (chunk === '\r' || chunk === '\n') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write('\n');
        resolve(value);
      } else if (chunk === '\u0003') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write('\n');
        reject(new CliError('Interrupted.', 130, 'interrupted'));
      } else if (chunk === '\u007f') value = value.slice(0, -1);
      else value += chunk;
    };
    process.stdin.on('data', onData);
  });
}

async function readAllStdin(): Promise<string> {
  let content = '';
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

async function chooseProject<T extends { id: string; name: string }>(projects: T[]): Promise<T> {
  projects.forEach((project, index) => process.stderr.write(`${index + 1}. ${project.name} · ${project.id}\n`));
  const choice = await question('Project number: ');
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || !projects[index]) throw usageError('Invalid project selection.');
  return projects[index];
}

async function confirm(prompt: string): Promise<boolean> {
  return /^y(?:es)?$/i.test((await question(`${prompt} [y/N] `)).trim());
}

function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => rl.question(prompt, answer => { rl.close(); resolve(answer); }));
}

function blockingExitCode(result: unknown): number {
  if (isSyncReport(result) && result.hasBlocking) return 2;
  return 0;
}

function isSyncReport(value: unknown): value is SyncStatusReport {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as SyncStatusReport).items)
    && typeof (value as SyncStatusReport).hasBlocking === 'boolean';
}

function classifyError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = formatUnknownError(error);
  if (/not logged in|cookie|authentication|unauthori[sz]ed|403/i.test(message)) return authError(message);
  if (/owner|ipc|socket|EADDRINUSE|ECONNREFUSED/i.test(message)) return new CliError(message, 5, 'owner_error');
  if (/network|connect|timeout|overleaf|HTTP|socket/i.test(message)) return new CliError(message, 6, 'network_error');
  return dataError(message);
}

function usageError(message: string): CliError { return new CliError(message, 3, 'usage_error'); }
function authError(message: string): CliError { return new CliError(message, 4, 'authentication_error'); }
function dataError(message: string): CliError { return new CliError(message, 7, 'data_error'); }
function toPosix(value: string): string { return value.replace(/[\\/]+/g, '/').replace(/^\/+/, ''); }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function exists(target: string): Promise<boolean> { return fs.stat(target).then(() => true, () => false); }
function humanValue(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }

function openCommand(): string {
  if (process.platform === 'darwin') return '/usr/bin/open';
  if (process.platform === 'linux') return 'xdg-open';
  throw new Error(`Opening files is not supported on ${process.platform}.`);
}

if (require.main === module) {
  void main().then(code => { process.exitCode = code; });
}

export { main, parseArgs, blockingExitCode, makeSuccessEnvelope, openCommand };
