import * as crypto from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import type { CredentialBackendInfo, CredentialStore } from './coreInterfaces';
import type { Identity } from './types';
import { credentialRoot, readSharedState, updateSharedState } from './sharedState';
import { normalizeServerUrl } from './util';

export const KEYCHAIN_SERVICE = 'yiqiyang33.latex-editing-toolkit.overleaf';

export interface SecurityRunner {
  run(args: string[], stdin?: string): Promise<string>;
}

export type SecretToolRunner = SecurityRunner;

export interface KeychainApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

/**
 * The system keyring cannot be used from this process: not installed, no keyring collection, a
 * locked collection that would need an unlock prompt, no D-Bus session, or a call that hung.
 * FallbackCredentialStore treats it as a signal to use the restricted file store instead.
 */
export class CredentialBackendUnavailableError extends Error {
  readonly code = 'CREDENTIAL_BACKEND_UNAVAILABLE';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CredentialBackendUnavailableError';
  }
}

export interface SecretToolTimeouts {
  lookupMs: number;
  storeMs: number;
}

// A keyring that needs an unlock prompt it cannot show (no display over SSH) blocks forever.
const DEFAULT_SECRET_TOOL_TIMEOUTS: SecretToolTimeouts = { lookupMs: 5_000, storeMs: 10_000 };

const systemSecretTool: SecretToolRunner = {
  run: (args, stdin) => runCommand(
    'secret-tool',
    args,
    stdin,
    args[0] === 'store' ? DEFAULT_SECRET_TOOL_TIMEOUTS.storeMs : DEFAULT_SECRET_TOOL_TIMEOUTS.lookupMs
  )
};

// How long a failed system keyring is skipped before this process tries it again.
const PRIMARY_RETRY_MS = 10 * 60_000;

export class MacKeychainCredentialStore implements CredentialStore {
  constructor(
    private keychain?: KeychainApi,
    private readonly runtimeRoot = path.join(__dirname, 'vendor', 'keytar', `${process.platform}-${process.arch}`)
  ) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    this.assertMacOS();
    const account = normalizeServerUrl(serverUrl);
    await this.backend().setPassword(KEYCHAIN_SERVICE, account, JSON.stringify(identity));
    await markCredentialSaved(account);
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    this.assertMacOS();
    const account = normalizeServerUrl(serverUrl);
    const state = await readSharedState();
    if (state.credentialTombstones.includes(account)) return undefined;
    const raw = await this.backend().getPassword(KEYCHAIN_SERVICE, account);
    return raw ? parseIdentity(raw) : undefined;
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    this.assertMacOS();
    const account = normalizeServerUrl(serverUrl);
    await this.backend().deletePassword(KEYCHAIN_SERVICE, account);
    await markCredentialDeleted(account);
  }

  async listServers(): Promise<string[]> {
    return (await readSharedState()).servers;
  }

  describe(): CredentialBackendInfo {
    const available = process.platform === 'darwin'
      && (Boolean(this.keychain) || hasKeytarRuntime(this.runtimeRoot));
    return {
      kind: 'macos-keychain',
      available,
      location: process.platform === 'darwin' ? this.runtimeRoot : undefined,
      warning: process.platform === 'darwin' && !available
        ? 'The bundled macOS Keychain runtime is unavailable; the restricted file credential store will be used.'
        : undefined
    };
  }

  private assertMacOS(): void {
    if (process.platform !== 'darwin' && !process.env.LATEX_TOOLKIT_ALLOW_MOCK_KEYCHAIN) {
      throw new Error('The macOS Keychain credential store is only available on macOS.');
    }
  }

  private backend(): KeychainApi {
    if (!this.keychain) this.keychain = loadMacKeychainApi(this.runtimeRoot);
    return this.keychain;
  }
}

export class SecretToolCredentialStore implements CredentialStore {
  constructor(
    private readonly secretTool: SecretToolRunner = systemSecretTool,
    private readonly timeouts: SecretToolTimeouts = DEFAULT_SECRET_TOOL_TIMEOUTS
  ) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    const account = normalizeServerUrl(serverUrl);
    await this.invoke(
      ['store', '--label', 'LaTeX Editing Toolkit Overleaf', 'service', KEYCHAIN_SERVICE, 'account', account],
      JSON.stringify(identity)
    );
    await markCredentialSaved(account);
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    const account = normalizeServerUrl(serverUrl);
    const state = await readSharedState();
    if (state.credentialTombstones.includes(account)) return undefined;
    try {
      const raw = await this.invoke(['lookup', 'service', KEYCHAIN_SERVICE, 'account', account]);
      return raw ? parseIdentity(raw) : undefined;
    } catch (error) {
      if (isMissingCredential(error)) return undefined;
      throw error;
    }
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    const account = normalizeServerUrl(serverUrl);
    await this.invoke(['clear', 'service', KEYCHAIN_SERVICE, 'account', account]).catch(error => {
      if (!isMissingCredential(error)) throw error;
    });
    await markCredentialDeleted(account);
  }

  /**
   * Runs one secret-tool operation under a deadline. A miss stays a miss, and every other failure
   * becomes CredentialBackendUnavailableError: on a headless host the keyring fails in many ways
   * (no login collection, locked collection, no D-Bus session), and none of them is fixable here.
   */
  private async invoke(args: string[], stdin?: string): Promise<string> {
    const operation = args[0];
    const timeoutMs = operation === 'store' ? this.timeouts.storeMs : this.timeouts.lookupMs;
    try {
      return await withTimeout(
        this.secretTool.run(args, stdin),
        timeoutMs,
        `secret-tool ${operation} timed out after ${timeoutMs} ms`
      );
    } catch (error) {
      // secret-tool reports "nothing stored" for lookup and clear as a bare exit status 1.
      if ((operation === 'lookup' || operation === 'clear') && isBareExitOne(error)) return '';
      if (isMissingCredential(error)) throw error;
      throw new CredentialBackendUnavailableError(
        `secret-tool ${operation} failed: ${errorMessage(error)}`,
        { cause: error }
      );
    }
  }

  async listServers(): Promise<string[]> {
    return (await readSharedState()).servers;
  }

  describe(): CredentialBackendInfo {
    const available = findExecutable('secret-tool') !== undefined;
    return {
      kind: 'secret-tool',
      available,
      location: findExecutable('secret-tool'),
      warning: available ? undefined : 'secret-tool is not installed; the restricted file credential store will be used.'
    };
  }
}

export class FileCredentialStore implements CredentialStore {
  constructor(private readonly root = credentialRoot()) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    const account = normalizeServerUrl(serverUrl);
    await writePrivateJson(this.filePath(account), { schemaVersion: 1, serverUrl: account, identity });
    await markCredentialSaved(account);
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    const account = normalizeServerUrl(serverUrl);
    const state = await readSharedState();
    if (state.credentialTombstones.includes(account)) return undefined;
    const raw = await fs.readFile(this.filePath(account), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { schemaVersion?: number; serverUrl?: string; identity?: unknown };
    if (parsed.schemaVersion !== 1 || parsed.serverUrl !== account) throw new Error(`Invalid Overleaf credential file for ${account}.`);
    return parseIdentity(parsed.identity);
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    const account = normalizeServerUrl(serverUrl);
    await this.clearIdentity(account);
    await markCredentialDeleted(account);
  }

  async clearIdentity(serverUrl: string): Promise<void> {
    await fs.rm(this.filePath(normalizeServerUrl(serverUrl)), { force: true });
  }

  async listServers(): Promise<string[]> {
    return (await readSharedState()).servers;
  }

  describe(): CredentialBackendInfo {
    return {
      kind: 'restricted-file',
      available: true,
      location: this.root,
      warning: 'Credentials are stored in a local file protected by filesystem permissions.'
    };
  }

  private filePath(account: string): string {
    const digest = crypto.createHash('sha256').update(account).digest('hex');
    return path.join(this.root, `${digest}.json`);
  }
}

export class FallbackCredentialStore implements CredentialStore {
  private fallbackActive: boolean;
  private primaryUnavailableUntil = 0;
  private primaryUnavailableReason?: string;

  constructor(
    private readonly primary: CredentialStore,
    private readonly fallback: FileCredentialStore,
    private readonly now: () => number = Date.now
  ) {
    this.fallbackActive = !(primary.describe?.()?.available ?? true);
  }

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    if (this.primaryUsable()) {
      try {
        await this.primary.saveIdentity(serverUrl, identity);
        this.fallbackActive = false;
        // A copy left by an earlier fallback is stale now; don't leave it on disk.
        await this.fallback.clearIdentity(serverUrl);
        return;
      } catch (error) {
        if (!isBackendUnavailable(error)) throw error;
        this.markPrimaryUnavailable(error);
      }
    }
    await this.fallback.saveIdentity(serverUrl, identity);
    this.fallbackActive = true;
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    if (this.primaryUsable()) {
      try {
        const primaryValue = await this.primary.getIdentity(serverUrl);
        if (primaryValue) {
          this.fallbackActive = false;
          return primaryValue;
        }
      } catch (error) {
        if (!isBackendUnavailable(error)) throw error;
        this.markPrimaryUnavailable(error);
      }
    }
    const fallbackValue = await this.fallback.getIdentity(serverUrl);
    if (!fallbackValue) return undefined;
    this.fallbackActive = true;
    if (this.primaryUsable()) await this.migrateToPrimary(serverUrl, fallbackValue);
    return fallbackValue;
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    let deletedByPrimary = false;
    if (this.primaryUsable()) {
      try {
        await this.primary.deleteIdentity(serverUrl);
        deletedByPrimary = true;
      } catch (error) {
        if (!isBackendUnavailable(error)) throw error;
        this.markPrimaryUnavailable(error);
      }
    }
    await this.fallback.clearIdentity(serverUrl);
    if (!deletedByPrimary) await markCredentialDeleted(normalizeServerUrl(serverUrl));
  }

  async listServers(): Promise<string[]> {
    return (await readSharedState()).servers;
  }

  describe(): CredentialBackendInfo {
    if (!this.fallbackActive && this.primaryUsable()) {
      return this.primary.describe?.() ?? { kind: 'secret-tool', available: true };
    }
    const info = this.fallback.describe();
    return this.primaryUnavailableReason
      ? { ...info, warning: `${info.warning} The system keyring is unavailable: ${this.primaryUnavailableReason}` }
      : info;
  }

  /**
   * Moves a file credential into the system keyring once the keyring works, and deletes the file
   * only after reading the credential back: a keyring that accepts writes into a volatile session
   * collection would otherwise lose the login on its next restart.
   */
  private async migrateToPrimary(serverUrl: string, identity: Identity): Promise<void> {
    try {
      await this.primary.saveIdentity(serverUrl, identity);
      const stored = await this.primary.getIdentity(serverUrl);
      if (!stored || JSON.stringify(stored) !== JSON.stringify(identity)) return;
      await this.fallback.clearIdentity(serverUrl);
      this.fallbackActive = false;
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
      this.markPrimaryUnavailable(error);
    }
  }

  private primaryUsable(): boolean {
    return this.now() >= this.primaryUnavailableUntil;
  }

  /** Skips the keyring for a while, so status refreshes don't spawn a failing process each time. */
  private markPrimaryUnavailable(error: unknown): void {
    this.primaryUnavailableUntil = this.now() + PRIMARY_RETRY_MS;
    this.primaryUnavailableReason = errorMessage(error);
    this.fallbackActive = true;
  }
}

/**
 * Picks the credential backend. LATEX_TOOLKIT_CREDENTIAL_STORE overrides the automatic choice for
 * both the extension and the CLI: `file` always uses the restricted file store, `system` uses only
 * the platform keyring and surfaces its errors, and anything else (or unset) means `auto`.
 */
export function createCredentialStore(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): CredentialStore {
  const mode = env.LATEX_TOOLKIT_CREDENTIAL_STORE?.trim().toLowerCase();
  if (mode === 'file') return new FileCredentialStore();
  const system = platform === 'darwin'
    ? new MacKeychainCredentialStore()
    : platform === 'linux' ? new SecretToolCredentialStore() : undefined;
  if (mode === 'system') {
    if (!system) throw new Error(`LATEX_TOOLKIT_CREDENTIAL_STORE=system is not supported on ${platform}.`);
    return system;
  }
  return system ? new FallbackCredentialStore(system, new FileCredentialStore()) : new FileCredentialStore();
}

async function markCredentialSaved(account: string): Promise<void> {
  await updateSharedState(state => {
    if (!state.servers.includes(account)) state.servers.push(account);
    if (!state.credentialMigrations.includes(account)) state.credentialMigrations.push(account);
    state.credentialTombstones = state.credentialTombstones.filter(item => item !== account);
  });
}

async function markCredentialDeleted(account: string): Promise<void> {
  await updateSharedState(state => {
    state.servers = state.servers.filter(item => item !== account);
    if (!state.credentialMigrations.includes(account)) state.credentialMigrations.push(account);
    if (!state.credentialTombstones.includes(account)) state.credentialTombstones.push(account);
  });
}

function parseIdentity(value: unknown): Identity {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== 'object') throw new Error('Overleaf credential data is invalid.');
  const record = parsed as Record<string, unknown>;
  if (typeof record.cookies !== 'string' || typeof record.csrfToken !== 'string') {
    throw new Error('Overleaf credential data is missing cookies or csrfToken.');
  }
  return {
    cookies: record.cookies,
    csrfToken: record.csrfToken,
    ...(typeof record.userId === 'string' ? { userId: record.userId } : {}),
    ...(typeof record.userEmail === 'string' ? { userEmail: record.userEmail } : {})
  };
}

async function writePrivateJson(target: string, value: unknown): Promise<void> {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => undefined);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await restrictToOwner(temporary);
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600).catch(() => undefined);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

/**
 * Makes a credential file owner-only. ACL-backed NFS servers (Isilon) may reject chmod or report
 * 0600 as 0700, so the check is that no group or other bit remains, not an exact mode.
 */
async function restrictToOwner(target: string): Promise<void> {
  const chmodError = await fs.chmod(target, 0o600).then(() => undefined, (error: unknown) => error);
  const mode = (await fs.stat(target)).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to store the Overleaf credential in ${target}: other users could read it (mode ${mode.toString(8)})`
      + `${chmodError ? `, and chmod failed: ${errorMessage(chmodError)}` : ''}.`
    );
  }
}

interface CommandError extends Error {
  code?: string;
  exitCode?: number | null;
  stderr?: string;
}

function runCommand(command: string, args: string[], stdin?: string, timeoutMs?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      const error: CommandError = new Error(`${command} ${args[0] ?? ''} timed out after ${timeoutMs} ms.`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    // An early exit closes stdin before the write lands; the exit status reports the real outcome.
    child.stdin.on('error', () => undefined);
    child.once('error', error => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', code => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (code === 0) resolve(output);
      else {
        const errorText = Buffer.concat(stderr).toString('utf8').trim();
        const error: CommandError = new Error(errorText || `${command} exited with code ${code}.`);
        error.code = String(code ?? 'unknown');
        error.exitCode = code;
        error.stderr = errorText;
        reject(error);
      }
    });
    child.stdin.end(stdin === undefined ? undefined : `${stdin}\n`);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error: CommandError = new Error(message);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });
}

function isBareExitOne(error: unknown): boolean {
  const failure = error as CommandError | undefined;
  return failure?.exitCode === 1 && !failure.stderr?.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasKeytarRuntime(root: string): boolean {
  return existsSync(path.join(root, 'lib', 'keytar.js'))
    && existsSync(path.join(root, 'build', 'Release', 'keytar.node'));
}

function loadMacKeychainApi(root: string): KeychainApi {
  const target = `${process.platform}-${process.arch}`;
  const entry = path.join(root, 'lib', 'keytar.js');
  try {
    const loaded = createRequire(entry)(entry) as Partial<KeychainApi>;
    if (!loaded || typeof loaded.getPassword !== 'function'
      || typeof loaded.setPassword !== 'function' || typeof loaded.deletePassword !== 'function') {
      throw new Error('keytar runtime exports are incomplete');
    }
    return loaded as KeychainApi;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load the macOS Keychain runtime for ${target}: ${message}. Install the matching macOS VSIX.`);
  }
}

function isMissingCredential(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not be found|no such secret|not found in collection|SecKeychainSearchCopyNext|specified item could not be found/i.test(message);
}

function isBackendUnavailable(error: unknown): boolean {
  if (error instanceof CredentialBackendUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|command not found|cannot find module|could not load the macOS Keychain runtime|dlopen|incompatible architecture|NODE_MODULE_VERSION|dbus|secret service|cannot autolaunch|org\.freedesktop\.secrets?|\/org\/freedesktop\/secrets|locked collection|timed out|no such file or directory/i.test(message);
}

function findExecutable(command: string): string | undefined {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, command);
    try {
      const stat = require('fs').statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return candidate;
    } catch {
      // Continue searching PATH entries.
    }
  }
  return undefined;
}
