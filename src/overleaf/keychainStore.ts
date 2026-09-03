import * as crypto from 'crypto';
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

const systemSecretTool: SecretToolRunner = { run: (args, stdin) => runCommand('secret-tool', args, stdin) };

export class MacKeychainCredentialStore implements CredentialStore {
  constructor(private keychain?: KeychainApi) {}

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
    return {
      kind: 'macos-keychain',
      available: process.platform === 'darwin',
      location: process.platform === 'darwin'
        ? path.join(__dirname, 'vendor', 'keytar', `${process.platform}-${process.arch}`)
        : undefined
    };
  }

  private assertMacOS(): void {
    if (process.platform !== 'darwin' && !process.env.LATEX_TOOLKIT_ALLOW_MOCK_KEYCHAIN) {
      throw new Error('The macOS Keychain credential store is only available on macOS.');
    }
  }

  private backend(): KeychainApi {
    if (!this.keychain) this.keychain = loadMacKeychainApi();
    return this.keychain;
  }
}

export class SecretToolCredentialStore implements CredentialStore {
  constructor(private readonly secretTool: SecretToolRunner = systemSecretTool) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    const account = normalizeServerUrl(serverUrl);
    await this.secretTool.run(
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
      const raw = await this.secretTool.run(['lookup', 'service', KEYCHAIN_SERVICE, 'account', account]);
      return raw ? parseIdentity(raw) : undefined;
    } catch (error) {
      if (isMissingCredential(error)) return undefined;
      throw error;
    }
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    const account = normalizeServerUrl(serverUrl);
    await this.secretTool.run(['clear', 'service', KEYCHAIN_SERVICE, 'account', account]).catch(error => {
      if (!isMissingCredential(error)) throw error;
    });
    await markCredentialDeleted(account);
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

  constructor(
    private readonly primary: CredentialStore,
    private readonly fallback: FileCredentialStore
  ) {
    this.fallbackActive = !(primary.describe?.()?.available ?? true);
  }

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    try {
      await this.primary.saveIdentity(serverUrl, identity);
      this.fallbackActive = false;
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
      await this.fallback.saveIdentity(serverUrl, identity);
      this.fallbackActive = true;
    }
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    let primaryValue: Identity | undefined;
    try {
      primaryValue = await this.primary.getIdentity(serverUrl);
      this.fallbackActive = false;
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
      this.fallbackActive = true;
    }
    if (primaryValue) return primaryValue;
    const fallbackValue = await this.fallback.getIdentity(serverUrl);
    if (fallbackValue && !this.fallbackActive) {
      try {
        await this.primary.saveIdentity(serverUrl, fallbackValue);
        await this.fallback.clearIdentity(serverUrl);
      } catch (error) {
        if (!isBackendUnavailable(error)) throw error;
      }
    }
    return fallbackValue;
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    let deletedByPrimary = false;
    try {
      await this.primary.deleteIdentity(serverUrl);
      deletedByPrimary = true;
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
      this.fallbackActive = true;
    }
    await this.fallback.clearIdentity(serverUrl);
    if (!deletedByPrimary) await markCredentialDeleted(normalizeServerUrl(serverUrl));
  }

  async listServers(): Promise<string[]> {
    return (await readSharedState()).servers;
  }

  describe(): CredentialBackendInfo {
    if (!this.fallbackActive) return this.primary.describe?.() ?? { kind: 'secret-tool', available: true };
    return this.fallback.describe();
  }
}

export function createCredentialStore(platform: NodeJS.Platform = process.platform): CredentialStore {
  if (platform === 'darwin') return new MacKeychainCredentialStore();
  if (platform === 'linux') return new FallbackCredentialStore(new SecretToolCredentialStore(), new FileCredentialStore());
  return new FileCredentialStore();
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
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function runCommand(command: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', error => reject(error));
    child.once('close', code => {
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (code === 0) resolve(output);
      else {
        const error = new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} exited with code ${code}.`);
        (error as NodeJS.ErrnoException).code = String(code ?? 'unknown');
        reject(error);
      }
    });
    child.stdin.end(stdin === undefined ? undefined : `${stdin}\n`);
  });
}

function loadMacKeychainApi(): KeychainApi {
  const target = `${process.platform}-${process.arch}`;
  const entry = path.join(__dirname, 'vendor', 'keytar', target, 'lib', 'keytar.js');
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
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|command not found|dbus|secret service|cannot autolaunch|org\.freedesktop\.secrets|no such file or directory/i.test(message);
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
