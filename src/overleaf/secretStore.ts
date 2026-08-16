import type * as vscode from 'vscode';
import type { Identity } from './types';
import { normalizeServerUrl } from './util';
import { MacKeychainCredentialStore } from './keychainStore';
import { readSharedState } from './sharedState';

const SECRET_PREFIX = 'overleafCodex.identity.';
const SERVERS_KEY = 'overleafCodex.servers';

export class SecretStore {
  constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'secrets'>,
    private readonly keychain = new MacKeychainCredentialStore()
  ) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.keychain.saveIdentity(normalized, identity);
    await this.purgeLegacyIdentity(normalized);
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    const normalized = normalizeServerUrl(serverUrl);
    const keychain = await this.keychain.getIdentity(normalized);
    if (keychain) {
      await this.purgeLegacyIdentity(normalized);
      return keychain;
    }
    const shared = await readSharedState();
    if (shared.credentialTombstones.includes(normalized) || shared.credentialMigrations.includes(normalized)) {
      await this.purgeLegacyIdentity(normalized);
      return undefined;
    }
    const value = await this.context.secrets.get(this.key(normalized));
    if (!value) return undefined;
    const identity = JSON.parse(value) as Identity;
    await this.keychain.saveIdentity(normalized, identity);
    await this.purgeLegacyIdentity(normalized);
    return identity;
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.keychain.deleteIdentity(normalized);
    await this.purgeLegacyIdentity(normalized);
  }

  async listServers(): Promise<string[]> {
    for (const server of await this.legacyServers()) await this.getIdentity(server);
    await this.context.secrets.delete(SERVERS_KEY);
    return this.keychain.listServers();
  }

  private key(serverUrl: string): string {
    return `${SECRET_PREFIX}${normalizeServerUrl(serverUrl)}`;
  }

  private async legacyServers(): Promise<string[]> {
    const value = await this.context.secrets.get(SERVERS_KEY);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? [...new Set(parsed.filter((item): item is string => typeof item === 'string').map(normalizeServerUrl))]
        : [];
    } catch {
      return [];
    }
  }

  private async purgeLegacyIdentity(serverUrl: string): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.context.secrets.delete(this.key(normalized));
    const remaining = (await this.legacyServers()).filter(item => item !== normalized);
    if (remaining.length > 0) await this.context.secrets.store(SERVERS_KEY, JSON.stringify(remaining.sort()));
    else await this.context.secrets.delete(SERVERS_KEY);
  }
}
