import * as vscode from "vscode";
import { arrangeLocalNotes, groupNameError, groupOfNote, type LocalNoteGroup, type LocalNoteGroupRegistry } from "./localNoteGroups";
import type { LocalProjectRegistry } from "./projectRegistry";
import type { LocalNoteProject, LocalNoteProjectStatus } from "./types";

/** Where a new project goes. Neither field set means no group. */
export interface NewProjectGroup {
  /** An existing group to join. */
  group?: LocalNoteGroup;
  /** A group to create once the project exists, so a cancelled wizard leaves no empty group behind. */
  newGroupName?: string;
}

export function noteCount(count: number): string {
  return `${count} note${count === 1 ? "" : "s"}`;
}

/** The notes shown under a group, newest first. */
export function notesInGroup(projects: readonly LocalNoteProjectStatus[], groups: readonly LocalNoteGroup[], groupId: string): LocalNoteProjectStatus[] {
  const entry = arrangeLocalNotes(projects, groups).groups.find((candidate) => candidate.group.id === groupId);
  return [...(entry?.projects ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** The group of a Local Notes project open in this window, if there is one. */
export async function openNoteGroup(projects: LocalProjectRegistry, groups: readonly LocalNoteGroup[]): Promise<LocalNoteGroup | undefined> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== "file") continue;
    const project = await projects.find(folder.uri.fsPath);
    const group = project ? groupOfNote(groups, project.id) : undefined;
    if (group) return group;
  }
  return undefined;
}

/**
 * Asks which group a new project joins; undefined when the user cancels. The group of the note open
 * in this window comes first, as the likeliest home for the next one.
 */
export async function pickGroupForNewProject(
  groups: readonly LocalNoteGroup[],
  projects: readonly LocalNoteProjectStatus[],
  openGroup: LocalNoteGroup | undefined,
  title: string
): Promise<NewProjectGroup | undefined> {
  type Item = vscode.QuickPickItem & { choice?: NewProjectGroup | "new" };
  const lastUsed = (group: LocalNoteGroup): string => notesInGroup(projects, groups, group.id)[0]?.createdAt ?? group.createdAt;
  const groupItem = (group: LocalNoteGroup, description: string): Item => ({ label: `$(folder-library) ${group.name}`, description, choice: { group } });
  const others = groups
    .filter((group) => group.id !== openGroup?.id)
    .sort((left, right) => lastUsed(right).localeCompare(lastUsed(left)));
  const items: Item[] = [
    ...(openGroup ? [groupItem(openGroup, "group of the open note")] : []),
    { label: "$(circle-slash) No group", description: "directly under Local Notes", choice: {} },
    ...others.map((group) => groupItem(group, noteCount(notesInGroup(projects, groups, group.id).length))),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(new-collection) New Group…", choice: "new" }
  ];
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: "Put the new project in a group" });
  if (!picked?.choice) return undefined;
  if (picked.choice !== "new") return picked.choice;
  const name = await askGroupName(groups, { title: "New Group", prompt: "The group is created together with the project." });
  return name === undefined ? undefined : { newGroupName: name };
}

export function askGroupName(
  groups: readonly LocalNoteGroup[],
  options: { title: string; prompt?: string; value?: string; ignoreId?: string }
): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: options.title,
    prompt: options.prompt ?? "Groups only organize Local Notes: no folder is created or moved.",
    placeHolder: "e.g. LP Homework",
    value: options.value,
    valueSelection: options.value ? [0, options.value.length] : undefined,
    validateInput: (value) => groupNameError(value, groups, options.ignoreId)
  });
}

/** Puts a project that was just created in the group chosen for it. The project exists either way. */
export async function placeNewProject(groups: LocalNoteGroupRegistry, project: LocalNoteProject, choice: NewProjectGroup): Promise<void> {
  try {
    if (choice.newGroupName) await groups.ensure(choice.newGroupName, [project.id]);
    else if (choice.group) await groups.moveNotes([project.id], choice.group.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`Created '${project.label}', but could not put it in its group: ${message}`);
  }
}
