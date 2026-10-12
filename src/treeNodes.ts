import type * as vscode from "vscode";

/**
 * A node in the Toolkit tree. VS Code hands this object back - not the TreeItem built from it - to
 * every command run from the node's context menu or inline actions, so anything such a command
 * needs to find its target has to be on the node itself, not only in `commandArgs`.
 */
export interface ToolkitTreeNode {
  id: string;
  label: string;
  kind?: "workspace" | "group" | "action" | "info";
  description?: string;
  tooltip?: string;
  iconId?: string;
  commandId?: string;
  commandArgs?: unknown[];
  children?: ToolkitTreeNode[];
  collapsibleState?: vscode.TreeItemCollapsibleState;
  contextValue?: string;
  resourceUri?: vscode.Uri;
  folderUri?: vscode.Uri;
  /** The Local Notes project this node stands for. */
  projectId?: string;
  /** The Overleaf mirror this node stands for. */
  mirrorId?: string;
  /** The Local Notes group this node stands for, or sits in as its placeholder. Never set on a note. */
  noteGroupId?: string;
  /**
   * Where notes dropped on this node go: a group id, or null for no group. Absent on nodes that
   * take no drops.
   */
  dropGroupId?: string | null;
}

/**
 * What a resource node points at. Ids only: absolute paths stay out of node data, which VS Code
 * renders, serializes and passes around (TODO.md, "limit Local Notes path metadata").
 */
export type LocalResourceIdentity = { projectId: string } | { mirrorId: string };

/**
 * A node for a registered resource. A click runs `commandId` with `commandArgs`, while a context
 * menu command receives the node, so the identity goes into both.
 */
export function localResourceNode(options: {
  id: string;
  identity: LocalResourceIdentity;
  label: string;
  description?: string;
  tooltip?: string;
  iconId: string;
  commandId: string;
  contextValue: string;
}): ToolkitTreeNode {
  return {
    ...options.identity,
    id: options.id,
    label: options.label,
    description: options.description,
    tooltip: options.tooltip ?? options.label,
    iconId: options.iconId,
    commandId: options.commandId,
    commandArgs: [{ ...options.identity }],
    contextValue: options.contextValue
  };
}

/** The project id carried by a node or by a node's click arguments. */
export function projectIdFromArgument(value: unknown): string | undefined {
  return stringField(value, "projectId");
}

/** The mirror id carried by a node or by a node's click arguments. */
export function mirrorIdFromArgument(value: unknown): string | undefined {
  return stringField(value, "mirrorId");
}

/**
 * The Local Notes group a node or its click arguments name. A note's node never names one, even in
 * a group, so a group command can never be pointed at a note's group by mistake.
 */
export function noteGroupIdFromArgument(value: unknown): string | undefined {
  return projectIdFromArgument(value) ? undefined : stringField(value, "noteGroupId");
}

/** A local path passed directly, as a Uri, or as an Explorer item's `resourceUri`. */
export function localPathFromArgument(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { fsPath?: unknown; resourceUri?: unknown };
  if (typeof candidate.fsPath === "string") return candidate.fsPath;
  const resourceUri = candidate.resourceUri;
  if (resourceUri && typeof resourceUri === "object" && typeof (resourceUri as { fsPath?: unknown }).fsPath === "string") {
    return (resourceUri as { fsPath: string }).fsPath;
  }
  return undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field ? field : undefined;
}
