import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  arrangeLocalNotes,
  groupNameError,
  groupOfNote,
  noteCount,
  sortGroups,
  type LocalNoteGroup,
  type LocalNoteGroupRegistry
} from "./localNoteGroups";
import { LOCAL_PROJECT_LABEL_MAX_LENGTH, type LocalProjectRegistry } from "./projectRegistry";
import { localPathFromArgument, noteGroupIdFromArgument, projectIdFromArgument } from "./treeNodes";
import type { LocalNoteProject, LocalNoteProjectStatus } from "./types";

type RegisterCommand = <T extends unknown[]>(id: string, handler: (...args: T) => unknown) => vscode.Disposable;

export interface LocalNotesCommandDeps {
  projects: LocalProjectRegistry;
  groups: LocalNoteGroupRegistry;
  refresh(): void;
  /** Runs Create Project for a project in this group. */
  createProjectInGroup(groupId: string): Promise<void>;
}

/** Registers the Local Notes commands. Each takes the tree node it was run on, or its click arguments. */
export function registerLocalNotesCommands(register: RegisterCommand, deps: LocalNotesCommandDeps): vscode.Disposable[] {
  return [
    register("latexEditingToolkit.openLocalProject", (target?: unknown) => openLocalProject(deps, target, false)),
    register("latexEditingToolkit.openLocalProjectInNewWindow", (target?: unknown) => openLocalProject(deps, target, true)),
    register("latexEditingToolkit.relocateLocalProject", (target?: unknown) => relocateLocalProject(deps, target)),
    register("latexEditingToolkit.removeLocalProject", (target?: unknown) => removeLocalProject(deps, target)),
    register("latexEditingToolkit.clearMissingLocalProjects", () => clearMissingLocalProjects(deps)),
    register("latexEditingToolkit.showLocalProjectPath", (target?: unknown) => showLocalProjectPath(deps, target)),
    register("latexEditingToolkit.renameLocalProject", (target?: unknown) => renameLocalProject(deps, target)),
    register("latexEditingToolkit.moveLocalProjectToGroup", (target?: unknown) => moveLocalProjectToGroup(deps, target)),
    register("latexEditingToolkit.removeLocalProjectFromGroup", (target?: unknown) => removeLocalProjectFromGroup(deps, target)),
    register("latexEditingToolkit.newLocalNoteGroup", () => newLocalNoteGroup(deps)),
    register("latexEditingToolkit.renameLocalNoteGroup", (target?: unknown) => renameLocalNoteGroup(deps, target)),
    register("latexEditingToolkit.deleteLocalNoteGroup", (target?: unknown) => deleteLocalNoteGroup(deps, target)),
    register("latexEditingToolkit.addNotesToGroup", (target?: unknown) => addNotesToGroup(deps, target)),
    register("latexEditingToolkit.createProjectInGroup", (target?: unknown) => createProjectInGroup(deps, target))
  ];
}

/** Moves notes dropped in the tree. Ids that no longer name a project are left out. */
export async function moveDroppedNotes(deps: LocalNotesCommandDeps, noteIds: readonly string[], groupId: string | undefined): Promise<void> {
  const registered = new Set((await deps.projects.list()).map((project) => project.id));
  const moved = await deps.groups.moveNotes(noteIds.filter((noteId) => registered.has(noteId)), groupId);
  deps.refresh();
  if (moved === 0) return;
  const group = groupId ? (await deps.groups.list()).find((candidate) => candidate.id === groupId) : undefined;
  vscode.window.setStatusBarMessage(group ? `Moved ${noteCount(moved)} to '${group.name}'.` : `Took ${noteCount(moved)} out of its group.`, 2500);
}

async function openLocalProject(deps: LocalNotesCommandDeps, target: unknown, newWindow: boolean): Promise<void> {
  const project = await projectFromArgument(deps.projects, target);
  const projectPath = project?.rootPath ?? (typeof target === "string" ? localPathFromArgument(target) : undefined);
  if (!projectPath) {
    warnUnresolvedProject();
    return;
  }
  try {
    if (!(await fs.promises.stat(projectPath)).isDirectory()) throw new Error("not a directory");
  } catch {
    vscode.window.showWarningMessage("Local note project is not available in this environment. Relocate or forget it from Local Notes.");
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectPath), { forceNewWindow: newWindow });
}

async function relocateLocalProject(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const oldProject = await projectFromArgument(deps.projects, target);
  const oldPath = oldProject?.rootPath ?? (typeof target === "string" ? localPathFromArgument(target) : undefined);
  if (!oldPath) {
    warnUnresolvedProject();
    return;
  }
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Relocate Toolkit Project Here"
  });
  if (!selected?.[0]) return;
  if (selected[0].scheme !== "file") {
    vscode.window.showErrorMessage("LaTeX Editing Toolkit only supports local project folders.");
    return;
  }
  const updated = await deps.projects.relocate(oldPath, selected[0].fsPath);
  deps.refresh();
  vscode.window.setStatusBarMessage(`Relocated local note project to ${updated.rootPath}.`, 2500);
}

async function removeLocalProject(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const project = await projectFromArgument(deps.projects, target);
  const projectPath = project?.rootPath ?? (typeof target === "string" ? localPathFromArgument(target) : undefined);
  if (!projectPath) {
    warnUnresolvedProject();
    return;
  }
  const label = project?.label ?? path.basename(path.normalize(projectPath));
  const choice = await vscode.window.showWarningMessage(
    `Forget local note project '${label}'? This only removes it from the Toolkit list and does not delete files.`,
    { modal: true },
    "Forget"
  );
  if (choice !== "Forget") return;
  const removed = await deps.projects.remove(projectPath);
  if (project) await deps.groups.forgetNotes([project.id]);
  deps.refresh();
  vscode.window.setStatusBarMessage(removed ? `Forgot local note project '${label}'.` : "Local note project was already removed.", 2500);
}

async function clearMissingLocalProjects(deps: LocalNotesCommandDeps): Promise<void> {
  const missing = (await deps.projects.list()).filter((project) => project.missing);
  if (missing.length === 0) {
    vscode.window.showInformationMessage("No missing local note projects to clear.");
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Forget ${missing.length} missing local note project${missing.length === 1 ? "" : "s"}? This only removes registry metadata and does not delete files.`,
    { modal: true },
    "Clear Missing"
  );
  if (choice !== "Clear Missing") return;
  const removed = await deps.projects.removeMissing();
  // A folder can come back between the two reads; only what was actually removed leaves its group.
  const registered = new Set((await deps.projects.list()).map((project) => project.id));
  await deps.groups.forgetNotes(missing.map((project) => project.id).filter((noteId) => !registered.has(noteId)));
  deps.refresh();
  vscode.window.setStatusBarMessage(`Cleared ${removed} missing local note project${removed === 1 ? "" : "s"}.`, 2500);
}

async function showLocalProjectPath(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const project = await projectFromArgument(deps.projects, target);
  if (!project) {
    warnUnresolvedProject();
    return;
  }
  const copy = "Copy Path";
  const reveal = process.platform === "darwin" ? "Reveal in Finder" : process.platform === "win32" ? "Reveal in File Explorer" : "Open Containing Folder";
  const action = await vscode.window.showInformationMessage(project.rootPath, copy, ...(project.missing ? [] : [reveal]));
  if (action === copy) {
    await vscode.env.clipboard.writeText(project.rootPath);
    vscode.window.setStatusBarMessage("Copied the project path.", 2000);
  } else if (action === reveal) {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(project.rootPath));
  }
}

async function renameLocalProject(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const project = await projectFromArgument(deps.projects, target);
  if (!project) {
    warnUnresolvedProject();
    return;
  }
  const label = await vscode.window.showInputBox({
    title: "Rename Note",
    prompt: `The name shown in Local Notes; the folder stays '${path.basename(project.rootPath)}'. Leave empty to use the folder's name.`,
    value: project.label,
    valueSelection: [0, project.label.length],
    validateInput: (value) => value.trim().length > LOCAL_PROJECT_LABEL_MAX_LENGTH ? `Use at most ${LOCAL_PROJECT_LABEL_MAX_LENGTH} characters.` : undefined
  });
  if (label === undefined) return;
  const renamed = await deps.projects.rename(project.id, label);
  deps.refresh();
  vscode.window.setStatusBarMessage(`Renamed to '${renamed.label}'.`, 2500);
}

async function moveLocalProjectToGroup(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const project = await projectFromArgument(deps.projects, target);
  if (!project) {
    warnUnresolvedProject();
    return;
  }
  const groups = await deps.groups.list();
  // With nothing to choose from, go straight to naming the first group.
  if (groups.length === 0) {
    await newLocalNoteGroup(deps, [project.id]);
    return;
  }
  const current = groupOfNote(groups, project.id);
  type Item = vscode.QuickPickItem & { group?: LocalNoteGroup; action?: "new" | "ungroup" };
  const items: Item[] = [
    ...sortGroups(groups).map((group) => ({
      label: `$(folder-library) ${group.name}`,
      description: group.id === current?.id ? "current group" : undefined,
      group
    })),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(new-collection) New Group…", action: "new" },
    ...(current ? [{ label: "$(circle-slash) Remove from Group", description: `take it out of '${current.name}'`, action: "ungroup" as const }] : [])
  ];
  const picked = await vscode.window.showQuickPick(items, { title: `Move '${project.label}' to a Group`, placeHolder: "Choose a group" });
  if (!picked) return;
  if (picked.action === "new") {
    await newLocalNoteGroup(deps, [project.id]);
    return;
  }
  const destination = picked.action === "ungroup" ? undefined : picked.group;
  if (destination && destination.id === current?.id) return;
  await deps.groups.moveNotes([project.id], destination?.id);
  deps.refresh();
  vscode.window.setStatusBarMessage(
    destination ? `Moved '${project.label}' to '${destination.name}'.` : `Removed '${project.label}' from '${current?.name}'.`,
    2500
  );
}

async function removeLocalProjectFromGroup(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const project = await projectFromArgument(deps.projects, target);
  if (!project) {
    warnUnresolvedProject();
    return;
  }
  const current = groupOfNote(await deps.groups.list(), project.id);
  if (!current) return;
  await deps.groups.moveNotes([project.id], undefined);
  deps.refresh();
  vscode.window.setStatusBarMessage(`Removed '${project.label}' from '${current.name}'.`, 2500);
}

/** Creates a group, moving `noteIds` into it. */
async function newLocalNoteGroup(deps: LocalNotesCommandDeps, noteIds: readonly string[] = []): Promise<void> {
  const name = await askGroupName(await deps.groups.list(), { title: "New Group" });
  if (name === undefined) return;
  const group = await deps.groups.create(name, noteIds);
  deps.refresh();
  vscode.window.setStatusBarMessage(
    noteIds.length > 0 ? `Moved ${noteCount(noteIds.length)} to the new group '${group.name}'.` : `Created the group '${group.name}'.`,
    2500
  );
}

async function renameLocalNoteGroup(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const groups = await deps.groups.list();
  const group = groupFromArgument(groups, target);
  if (!group) {
    warnMissingGroup();
    return;
  }
  const name = await askGroupName(groups, { title: "Rename Group", value: group.name, ignoreId: group.id });
  if (name === undefined) return;
  const renamed = await deps.groups.rename(group.id, name);
  deps.refresh();
  vscode.window.setStatusBarMessage(`Renamed the group to '${renamed.name}'.`, 2500);
}

async function deleteLocalNoteGroup(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const [groups, projects] = await Promise.all([deps.groups.list(), deps.projects.list()]);
  const group = groupFromArgument(groups, target);
  if (!group) {
    warnMissingGroup();
    return;
  }
  const members = notesInGroup(projects, groups, group.id).length;
  if (members > 0) {
    const choice = await vscode.window.showWarningMessage(
      `Delete the group '${group.name}'? ${members === 1 ? "Its note moves" : `Its ${members} notes move`} back to Local Notes; no files are deleted.`,
      { modal: true },
      "Delete Group"
    );
    if (choice !== "Delete Group") return;
  }
  await deps.groups.remove(group.id);
  deps.refresh();
  vscode.window.setStatusBarMessage(`Deleted the group '${group.name}'.`, 2500);
}

/** Puts several notes in a group at once, picked from all the notes elsewhere. */
async function addNotesToGroup(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const [groups, projects] = await Promise.all([deps.groups.list(), deps.projects.list()]);
  const group = groupFromArgument(groups, target);
  if (!group) {
    warnMissingGroup();
    return;
  }
  type Item = vscode.QuickPickItem & { projectId?: string };
  const items: Item[] = [];
  const section = (heading: string, members: readonly LocalNoteProjectStatus[]): void => {
    if (members.length === 0) return;
    items.push({ label: heading, kind: vscode.QuickPickItemKind.Separator });
    for (const project of members) items.push({ label: project.label, description: project.missing ? "Missing" : undefined, projectId: project.id });
  };
  const arranged = arrangeLocalNotes(projects, groups);
  section("Not in a group", arranged.ungrouped);
  for (const entry of arranged.groups) {
    if (entry.group.id !== group.id) section(`In '${entry.group.name}'`, entry.projects);
  }
  if (!items.some((item) => item.projectId)) {
    vscode.window.showInformationMessage(projects.length === 0 ? "There are no notes to add yet." : `Every note is already in '${group.name}'.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: `Add Notes to '${group.name}'`,
    placeHolder: "Pick the notes to put in this group",
    canPickMany: true
  });
  const noteIds = (picked ?? []).flatMap((item) => item.projectId ? [item.projectId] : []);
  if (noteIds.length === 0) return;
  const moved = await deps.groups.moveNotes(noteIds, group.id);
  deps.refresh();
  vscode.window.setStatusBarMessage(`Added ${noteCount(moved)} to '${group.name}'.`, 2500);
}

async function createProjectInGroup(deps: LocalNotesCommandDeps, target: unknown): Promise<void> {
  const groupId = noteGroupIdFromArgument(target);
  if (!groupId) {
    warnMissingGroup();
    return;
  }
  await deps.createProjectInGroup(groupId);
}

async function projectFromArgument(projects: LocalProjectRegistry, value: unknown): Promise<LocalNoteProjectStatus | undefined> {
  const projectId = projectIdFromArgument(value);
  if (projectId) return projects.findById(projectId);
  const projectPath = localPathFromArgument(value);
  return projectPath ? projects.find(projectPath) : undefined;
}

function groupFromArgument(groups: readonly LocalNoteGroup[], value: unknown): LocalNoteGroup | undefined {
  const groupId = noteGroupIdFromArgument(value);
  return groupId ? groups.find((group) => group.id === groupId) : undefined;
}

function warnUnresolvedProject(): void {
  vscode.window.showWarningMessage("The selected local note project could not be resolved.");
}

function warnMissingGroup(): void {
  vscode.window.showWarningMessage("This group no longer exists.");
}

/** Where a new project goes. Neither field set means no group. */
export interface NewProjectGroup {
  /** An existing group to join. */
  group?: LocalNoteGroup;
  /** A group to create once the project exists, so a cancelled wizard leaves no empty group behind. */
  newGroupName?: string;
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
