import * as vscode from 'vscode';
import { Identity } from './types';
import { normalizeServerUrl } from './util';
import { MacKeychainCredentialStore } from './keychainStore';
import { readSharedState } from './sharedState';

const SECRET_PREFIX = 'overleafCodex.identity.';
const SERVERS_KEY = 'overleafCodex.servers';

export class SecretStore {
  private readonly keychain = new MacKeychainCredentialStore();
  constructor(private readonly context: vscode.ExtensionContext) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.keychain.saveIdentity(normalized, identity);
    await this.context.secrets.store(this.key(normalized), JSON.stringify(identity));
    await this.addServer(normalized);
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    const normalized = normalizeServerUrl(serverUrl);
    const keychain = await this.keychain.getIdentity(normalized);
    if (keychain) return keychain;
    const shared = await readSharedState();
    if (shared.credentialTombstones.includes(normalized) || shared.credentialMigrations.includes(normalized)) return undefined;
    const value = await this.context.secrets.get(this.key(serverUrl));
    if (!value) {
      return undefined;
    }
    const identity = JSON.parse(value) as Identity;
    await this.keychain.saveIdentity(normalized, identity);
    return identity;
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.keychain.deleteIdentity(normalized);
    await this.context.secrets.delete(this.key(normalized));
    await this.removeServer(normalized);
  }

  async listServers(): Promise<string[]> {
    const value = await this.context.secrets.get(SERVERS_KEY);
    if (!value) {
      return this.keychain.listServers();
    }
    return [...new Set([...(JSON.parse(value) as string[]), ...await this.keychain.listServers()])].sort();
  }

  private key(serverUrl: string): string {
    return `${SECRET_PREFIX}${normalizeServerUrl(serverUrl)}`;
  }

  private async addServer(serverUrl: string): Promise<void> {
    const servers = new Set(await this.listServers());
    servers.add(normalizeServerUrl(serverUrl));
    await this.context.secrets.store(SERVERS_KEY, JSON.stringify([...servers].sort()));
  }

  private async removeServer(serverUrl: string): Promise<void> {
    const servers = new Set(await this.listServers());
    servers.delete(normalizeServerUrl(serverUrl));
    await this.context.secrets.store(SERVERS_KEY, JSON.stringify([...servers].sort()));
  }
}
