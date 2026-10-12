import * as path from "node:path";
import * as vscode from "vscode";
import { arrangeLocalNotes, noteCount, type LocalNoteGroup } from "./localNoteGroups";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { localResourceNode, projectIdFromArgument, type ToolkitTreeNode } from "./treeNodes";
import type { LocalNoteProjectStatus } from "./types";

/** Context values of Local Notes nodes. The package.json menus key on these. */
export const LOCAL_NOTES_CONTEXT = {
  root: "localNotesRoot",
  group: "localNoteGroup",
  emptyGroup: "localNoteGroupEmpty",
  project: "localProject",
  missingProject: "localProjectMissing",
  groupedProject: "localProjectGrouped",
  missingGroupedProject: "localProjectMissingGrouped"
} as const;

/** The Local Notes section: its groups first, then the notes in no group. */
export function localNotesRootNode(
  projects: readonly LocalNoteProjectStatus[],
  groups: readonly LocalNoteGroup[],
  openProjectIds: ReadonlySet<string>
): ToolkitTreeNode {
  return {
    id: "local-notes",
    label: "Local Notes",
    iconId: "book",
    children: localNotesChildren(projects, groups, openProjectIds),
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    contextValue: LOCAL_NOTES_CONTEXT.root,
    dropGroupId: null
  };
}

function localNotesChildren(
  projects: readonly LocalNoteProjectStatus[],
  groups: readonly LocalNoteGroup[],
  openProjectIds: ReadonlySet<string>
): ToolkitTreeNode[] {
  if (projects.length === 0 && groups.length === 0) {
    return [
      infoNode("local-notes-empty", "No local notes yet", "Create a project to add it here.", "info"),
      actionNode("local-notes-create", "Create New Project", "from template", "new-folder", "latexEditingToolkit.createProject")
    ];
  }
  const arranged = arrangeLocalNotes(projects, groups);
  return [
    ...arranged.groups.map(({ group, projects: members }) => localNoteGroupNode(group, members, openProjectIds)),
    ...arranged.ungrouped.map((project) => localProjectNode(project, openProjectIds.has(project.id))),
    ...(projects.some((project) => project.missing)
      ? [actionNode("local-notes-clear-missing", "Clear Missing Projects", "remove stale registry entries", "trash", "latexEditingToolkit.clearMissingLocalProjects")]
      : [])
  ];
}

function localNoteGroupNode(
  group: LocalNoteGroup,
  members: readonly LocalNoteProjectStatus[],
  openProjectIds: ReadonlySet<string>
): ToolkitTreeNode {
  const missing = members.filter((project) => project.missing).length;
  const summary = members.length === 0 ? "empty" : `${noteCount(members.length)}${missing > 0 ? ` · ${missing} missing` : ""}`;
  return {
    id: `local-note-group:${group.id}`,
    label: group.name,
    description: summary,
    tooltip: `${group.name}: ${summary}`,
    iconId: "folder-library",
    children: members.length > 0
      ? members.map((project) => localProjectNode(project, openProjectIds.has(project.id), group.id))
      : [emptyGroupNode(group)],
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    contextValue: LOCAL_NOTES_CONTEXT.group,
    noteGroupId: group.id,
    dropGroupId: group.id
  };
}

/** Stands in for the notes of an empty group: a drop target, and a click creates the first note. */
function emptyGroupNode(group: LocalNoteGroup): ToolkitTreeNode {
  return {
    id: `local-note-group-empty:${group.id}`,
    label: "No notes yet",
    description: "drag notes here, or click to create one",
    tooltip: `Drag notes onto '${group.name}', or click to create a project in it`,
    iconId: "add",
    commandId: "latexEditingToolkit.createProjectInGroup",
    commandArgs: [{ noteGroupId: group.id }],
    contextValue: LOCAL_NOTES_CONTEXT.emptyGroup,
    noteGroupId: group.id,
    dropGroupId: group.id
  };
}

/** A note. `groupId` is the group it is shown in; notes dropped on it join that group too. */
export function localProjectNode(project: LocalNoteProjectStatus, isOpen: boolean, groupId?: string): ToolkitTreeNode {
  const folderName = path.basename(project.rootPath);
  const parent = path.basename(path.dirname(project.rootPath)) || path.dirname(project.rootPath);
  const template = STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === project.templateId);
  const presentationDescription = project.templateId === "beamer-generic"
    ? "Beamer · Generic Beamer · main.tex"
    : template?.kind === "beamer"
      ? `Beamer · ${template.label} · main.tex`
      : undefined;
  const contextValue = groupId
    ? project.missing ? LOCAL_NOTES_CONTEXT.missingGroupedProject : LOCAL_NOTES_CONTEXT.groupedProject
    : project.missing ? LOCAL_NOTES_CONTEXT.missingProject : LOCAL_NOTES_CONTEXT.project;
  return {
    ...localResourceNode({
      id: `local-project:${project.id}`,
      identity: { projectId: project.id },
      label: project.label,
      description: project.missing ? "Missing" : presentationDescription || (isOpen ? `Open · ${parent}` : parent),
      tooltip: project.missing
        ? "Project folder not found in this environment"
        : project.label === folderName ? "Local note project" : `Local note project in the folder '${folderName}'`,
      iconId: project.missing ? "warning" : isOpen ? "root-folder-opened" : "folder",
      commandId: "latexEditingToolkit.openLocalProject",
      contextValue
    }),
    dropGroupId: groupId ?? null
  };
}

function actionNode(id: string, label: string, description: string, iconId: string, commandId: string): ToolkitTreeNode {
  return { id, label, description, tooltip: `${label}: ${description}`, iconId, commandId, commandArgs: [], contextValue: "action" };
}

function infoNode(id: string, label: string, description: string, iconId: string): ToolkitTreeNode {
  return { id, label, description, tooltip: `${label}: ${description}`, iconId, contextValue: "info" };
}

export const LOCAL_NOTES_DRAG_MIME = "application/vnd.latex-editing-toolkit.local-notes";

/** The notes among dragged nodes. Nothing else in the tree moves by dragging. */
export function draggedNoteIds(nodes: readonly (ToolkitTreeNode | undefined)[]): string[] {
  return [...new Set(nodes.map((node) => projectIdFromArgument(node)).filter((id): id is string => id !== undefined))];
}

/**
 * Moves notes between groups by drag and drop: onto a group or a note in it to join that group, onto
 * the Local Notes heading or a note in no group to leave groups. Drops anywhere else do nothing.
 */
export class LocalNotesDragAndDrop implements vscode.TreeDragAndDropController<ToolkitTreeNode> {
  readonly dragMimeTypes = [LOCAL_NOTES_DRAG_MIME];
  readonly dropMimeTypes = [LOCAL_NOTES_DRAG_MIME];

  constructor(private readonly moveNotes: (noteIds: string[], groupId: string | undefined) => Promise<void>) {}

  handleDrag(source: readonly ToolkitTreeNode[], dataTransfer: vscode.DataTransfer): void {
    const noteIds = draggedNoteIds(source);
    if (noteIds.length > 0) dataTransfer.set(LOCAL_NOTES_DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(noteIds)));
  }

  async handleDrop(target: ToolkitTreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const groupId = target?.dropGroupId;
    if (groupId === undefined) return;
    const noteIds = parseNoteIds(await dataTransfer.get(LOCAL_NOTES_DRAG_MIME)?.asString());
    if (noteIds.length > 0) await this.moveNotes(noteIds, groupId ?? undefined);
  }
}

function parseNoteIds(raw: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}
