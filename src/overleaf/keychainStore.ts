import { spawn } from 'child_process';
import type { CredentialStore } from './coreInterfaces';
import type { Identity } from './types';
import { normalizeServerUrl } from './util';
import { readSharedState, updateSharedState } from './sharedState';

export const KEYCHAIN_SERVICE = 'yiqiyang33.latex-editing-toolkit.overleaf';

export interface SecurityRunner {
  run(args: string[], stdin?: string): Promise<string>;
}

const systemSecurity: SecurityRunner = {
  run: runSecurity
};

export class MacKeychainCredentialStore implements CredentialStore {
  constructor(private readonly security: SecurityRunner = systemSecurity) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    this.assertMacOS();
    const account = normalizeServerUrl(serverUrl);
    await this.security.run(
      ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      JSON.stringify(identity)
    );
    await updateSharedState(state => {
      if (!state.servers.includes(account)) state.servers.push(account);
      if (!state.credentialMigrations.includes(account)) state.credentialMigrations.push(account);
      state.credentialTombstones = state.credentialTombstones.filter(item => item !== account);
    });
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    this.assertMacOS();
    const account = normalizeServerUrl(serverUrl);
    const state = await readSharedState();
    if (state.credentialTombstones.includes(account)) return undefined;
    try {
      const raw = await this.security.run(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w']);
      return raw ? JSON.parse(raw) as Identity : undefined;
    } catch (error) {
      if (isMissingKeychainItem(error)) return undefined;
      throw error;
    }
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    this.assertMacOS();
    const account = normalizeServerUrl(serverUrl);
    await this.security.run(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]).catch(error => {
      if (!isMissingKeychainItem(error)) throw error;
    });
    await updateSharedState(state => {
      state.servers = state.servers.filter(item => item !== account);
      if (!state.credentialMigrations.includes(account)) state.credentialMigrations.push(account);
      if (!state.credentialTombstones.includes(account)) state.credentialTombstones.push(account);
    });
  }

  async listServers(): Promise<string[]> {
    return (await readSharedState()).servers;
  }

  private assertMacOS(): void {
    if (process.platform !== 'darwin' && !process.env.LATEX_TOOLKIT_ALLOW_MOCK_KEYCHAIN) {
      throw new Error('The Overleaf CLI credential store currently supports macOS Keychain only.');
    }
  }
}

function runSecurity(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => {
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (code === 0) resolve(output);
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `security exited with code ${code}.`));
    });
    child.stdin.end(stdin === undefined ? undefined : `${stdin}\n`);
  });
}

function isMissingKeychainItem(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not be found|SecKeychainSearchCopyNext|The specified item could not be found/i.test(message);
}
