import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import type { MirrorManager } from './mirrorManager';
import { readSharedState, registerSharedMirror, updateSharedState } from './sharedState';
import { normalizeServerUrl } from './util';

const MIGRATION_KEY = 'latexEditingToolkit.overleaf.sharedStateMigrated.v1';
let applyingSharedSettings = false;

export async function initializeSharedConfigBridge(
  context: vscode.ExtensionContext,
  mirrorManager: MirrorManager
): Promise<void> {
  if (!context.globalState.get<boolean>(MIGRATION_KEY)) {
    await syncExplicitSettings();
    for (const mirror of await mirrorManager.listLocalMirrors()) await registerSharedMirror(mirror.root);
    await context.globalState.update(MIGRATION_KEY, true);
  }
  await applySharedSettings();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (applyingSharedSettings) return;
    if (event.affectsConfiguration('overleafCodex') || event.affectsConfiguration('latexEditingToolkit.overleaf')) {
      void syncExplicitSettings().catch(() => undefined);
    }
  }));
}

async function applySharedSettings(): Promise<void> {
  const state = await readSharedState();
  const legacy = vscode.workspace.getConfiguration('overleafCodex');
  const modern = vscode.workspace.getConfiguration('latexEditingToolkit.overleaf');
  applyingSharedSettings = true;
  try {
    await Promise.all([
      legacy.update('serverUrl', state.serverUrl, vscode.ConfigurationTarget.Global),
      legacy.update('localProjectsRoot', state.localProjectsRoot, vscode.ConfigurationTarget.Global),
      legacy.update('autoPushLocalAhead', state.policy.autoPushLocalAhead, vscode.ConfigurationTarget.Global),
      legacy.update('syncBinaryFiles', state.policy.syncBinaryFiles, vscode.ConfigurationTarget.Global),
      legacy.update('syncDestructiveChanges', state.policy.syncDestructiveChanges, vscode.ConfigurationTarget.Global),
      legacy.update('connectTimeout', state.policy.networkTimeouts.connectMs / 1000, vscode.ConfigurationTarget.Global),
      legacy.update('projectJoinTimeout', state.policy.networkTimeouts.projectJoinMs / 1000, vscode.ConfigurationTarget.Global),
      legacy.update('httpTimeout', state.policy.networkTimeouts.httpMs / 1000, vscode.ConfigurationTarget.Global),
      legacy.update('joinDocTimeout', state.policy.networkTimeouts.joinDocMs / 1000, vscode.ConfigurationTarget.Global),
      legacy.update('otAckTimeout', state.policy.networkTimeouts.otAckMs / 1000, vscode.ConfigurationTarget.Global),
      modern.update('autoPushLocalAhead', state.policy.autoPushLocalAhead, vscode.ConfigurationTarget.Global),
      modern.update('syncBinaryFiles', state.policy.syncBinaryFiles, vscode.ConfigurationTarget.Global)
    ]);
  } finally {
    applyingSharedSettings = false;
  }
}

async function syncExplicitSettings(): Promise<void> {
  const legacy = vscode.workspace.getConfiguration('overleafCodex');
  const modern = vscode.workspace.getConfiguration('latexEditingToolkit.overleaf');
  await updateSharedState(state => {
    const server = explicitValue<string>(legacy, 'serverUrl');
    if (server) state.serverUrl = normalizeServerUrl(server);
    const localRoot = explicitValue<string>(legacy, 'localProjectsRoot');
    if (localRoot) state.localProjectsRoot = expandHome(localRoot);

    const autoPush = explicitValue<boolean>(modern, 'autoPushLocalAhead')
      ?? explicitValue<boolean>(legacy, 'autoPushLocalAhead');
    if (autoPush !== undefined) state.policy.autoPushLocalAhead = autoPush;
    const binary = explicitValue<boolean>(modern, 'syncBinaryFiles')
      ?? explicitValue<boolean>(legacy, 'syncBinaryFiles');
    if (binary !== undefined) state.policy.syncBinaryFiles = binary;
    const destructive = explicitValue<boolean>(legacy, 'syncDestructiveChanges');
    if (destructive !== undefined) state.policy.syncDestructiveChanges = destructive;

    for (const [setting, field] of [
      ['connectTimeout', 'connectMs'], ['projectJoinTimeout', 'projectJoinMs'],
      ['httpTimeout', 'httpMs'], ['joinDocTimeout', 'joinDocMs'], ['otAckTimeout', 'otAckMs']
    ] as const) {
      const seconds = explicitValue<number>(legacy, setting);
      if (seconds !== undefined) state.policy.networkTimeouts[field] = seconds * 1000;
    }
    const legacyTimeout = explicitValue<number>(legacy, 'timeout');
    if (legacyTimeout !== undefined && explicitValue<number>(legacy, 'httpTimeout') === undefined) {
      state.policy.networkTimeouts.httpMs = legacyTimeout * 1000;
    }
  });
}

function explicitValue<T>(configuration: vscode.WorkspaceConfiguration, section: string): T | undefined {
  const inspected = configuration.inspect<T>(section);
  return inspected?.workspaceFolderValue
    ?? inspected?.workspaceValue
    ?? inspected?.globalValue;
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}
