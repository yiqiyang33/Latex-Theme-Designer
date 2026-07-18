import * as vscode from 'vscode';
import { Identity } from './types';
import { normalizeServerUrl } from './util';

const SECRET_PREFIX = 'overleafCodex.identity.';
const SERVERS_KEY = 'overleafCodex.servers';

export class SecretStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async saveIdentity(serverUrl: string, identity: Identity): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.context.secrets.store(this.key(normalized), JSON.stringify(identity));
    await this.addServer(normalized);
  }

  async getIdentity(serverUrl: string): Promise<Identity | undefined> {
    const value = await this.context.secrets.get(this.key(serverUrl));
    if (!value) {
      return undefined;
    }
    return JSON.parse(value) as Identity;
  }

  async deleteIdentity(serverUrl: string): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl);
    await this.context.secrets.delete(this.key(normalized));
    await this.removeServer(normalized);
  }

  async listServers(): Promise<string[]> {
    const value = await this.context.secrets.get(SERVERS_KEY);
    if (!value) {
      return [];
    }
    return JSON.parse(value) as string[];
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
