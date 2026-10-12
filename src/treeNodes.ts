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

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field ? field : undefined;
}
