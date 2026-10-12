import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DataTransfer } from "vscode";
import type { LocalNoteGroup } from "../src/localNoteGroups";
import { registerLocalNotesCommands, type LocalNotesCommandDeps } from "../src/localNotesCommands";
import { LOCAL_NOTES_CONTEXT, LOCAL_NOTES_DRAG_MIME, LocalNotesDragAndDrop, localNotesRootNode } from "../src/localNotesTree";
import { noteGroupIdFromArgument, projectIdFromArgument, type ToolkitTreeNode } from "../src/treeNodes";
import type { LocalNoteProjectStatus } from "../src/types";

function project(id: string, label: string, missing = false): LocalNoteProjectStatus {
  return { id, rootPath: path.join(os.tmpdir(), "notes", label), label, templateId: "article-minimal", createdAt: "2026-01-01T00:00:00.000Z", missing };
}

function group(id: string, name: string, noteIds: string[]): LocalNoteGroup {
  return { id, name, createdAt: "2026-01-01T00:00:00.000Z", noteIds };
}

function flatten(node: ToolkitTreeNode): ToolkitTreeNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

/** A tree with one of every kind of Local Notes node. */
function fullTree(): ToolkitTreeNode {
  return localNotesRootNode(
    [project("hw1", "hw-1-LP"), project("hw2", "hw-2-LP", true), project("loose", "Scratch"), project("gone", "Old", true)],
    [group("lp", "LP", ["hw1", "hw2"]), group("thesis", "Thesis", [])],
    new Set(["hw1"])
  );
}

function nodeById(root: ToolkitTreeNode, id: string): ToolkitTreeNode {
  const node = flatten(root).find((candidate) => candidate.id === id);
  if (!node) throw new Error(`No node ${id}`);
  return node;
}

describe("the Local Notes tree", () => {
  it("lists groups first, then notes in no group", () => {
    const root = fullTree();
    expect(root).toMatchObject({ id: "local-notes", contextValue: LOCAL_NOTES_CONTEXT.root, dropGroupId: null });
    expect(root.children?.map((node) => node.id)).toEqual([
      "local-note-group:lp",
      "local-note-group:thesis",
      "local-project:loose",
      "local-project:gone",
      "local-notes-clear-missing"
    ]);
    expect(nodeById(root, "local-note-group:lp")).toMatchObject({
      label: "LP",
      description: "2 notes · 1 missing",
      contextValue: LOCAL_NOTES_CONTEXT.group,
      noteGroupId: "lp",
      dropGroupId: "lp"
    });
  });

  it("marks notes inside a group so their menus can offer to take them out", () => {
    const root = fullTree();
    expect(nodeById(root, "local-project:hw1")).toMatchObject({ contextValue: LOCAL_NOTES_CONTEXT.groupedProject, dropGroupId: "lp" });
    expect(nodeById(root, "local-project:hw2")).toMatchObject({ contextValue: LOCAL_NOTES_CONTEXT.missingGroupedProject, dropGroupId: "lp" });
    expect(nodeById(root, "local-project:loose")).toMatchObject({ contextValue: LOCAL_NOTES_CONTEXT.project, dropGroupId: null });
    expect(nodeById(root, "local-project:gone")).toMatchObject({ contextValue: LOCAL_NOTES_CONTEXT.missingProject, dropGroupId: null });
  });

  it("gives an empty group a placeholder that creates a note in it", () => {
    const placeholder = nodeById(fullTree(), "local-note-group-empty:thesis");
    expect(placeholder).toMatchObject({ commandId: "latexEditingToolkit.createProjectInGroup", dropGroupId: "thesis" });
    expect(noteGroupIdFromArgument(placeholder.commandArgs?.[0])).toBe("thesis");
  });

  it("shows groups even before there are any notes", () => {
    const root = localNotesRootNode([], [group("lp", "LP", [])], new Set());
    expect(root.children?.map((node) => node.id)).toEqual(["local-note-group:lp"]);
    expect(localNotesRootNode([], [], new Set()).children?.map((node) => node.id)).toEqual(["local-notes-empty", "local-notes-create"]);
  });

  it("never repeats an id, which would make VS Code reject the whole tree", () => {
    const ids = flatten(fullTree()).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves each node to what it shows, and never a note to its group", () => {
    const root = fullTree();
    expect(projectIdFromArgument(nodeById(root, "local-project:hw1"))).toBe("hw1");
    expect(noteGroupIdFromArgument(nodeById(root, "local-note-group:lp"))).toBe("lp");
    expect(noteGroupIdFromArgument(nodeById(root, "local-project:hw1"))).toBeUndefined();
    expect(projectIdFromArgument(nodeById(root, "local-note-group:lp"))).toBeUndefined();
  });
});

describe("dragging notes between groups", () => {
  async function dropped(target: ToolkitTreeNode | undefined, dragged: ToolkitTreeNode[]) {
    const moveNotes = vi.fn(async () => undefined);
    const controller = new LocalNotesDragAndDrop(moveNotes);
    const transfer = new DataTransfer();
    controller.handleDrag(dragged, transfer as never);
    await controller.handleDrop(target, transfer as never);
    return moveNotes.mock.calls;
  }

  it("moves notes into the group they are dropped on, or out of groups", async () => {
    const root = fullTree();
    const loose = nodeById(root, "local-project:loose");
    expect(await dropped(nodeById(root, "local-note-group:lp"), [loose])).toEqual([[["loose"], "lp"]]);
    expect(await dropped(nodeById(root, "local-project:hw1"), [loose])).toEqual([[["loose"], "lp"]]);
    expect(await dropped(nodeById(root, "local-note-group-empty:thesis"), [loose])).toEqual([[["loose"], "thesis"]]);
    const grouped = nodeById(root, "local-project:hw1");
    expect(await dropped(root, [grouped])).toEqual([[["hw1"], undefined]]);
    expect(await dropped(nodeById(root, "local-project:gone"), [grouped])).toEqual([[["hw1"], undefined]]);
  });

  it("ignores drops that do not land in Local Notes and drags of anything but notes", async () => {
    const root = fullTree();
    const loose = nodeById(root, "local-project:loose");
    expect(await dropped(undefined, [loose])).toEqual([]);
    expect(await dropped(nodeById(root, "local-notes-clear-missing"), [loose])).toEqual([]);
    expect(await dropped(nodeById(root, "local-note-group:lp"), [nodeById(root, "local-note-group:thesis")])).toEqual([]);
  });

  it("ignores a payload it did not write", async () => {
    const moveNotes = vi.fn(async () => undefined);
    const transfer = new DataTransfer();
    transfer.set(LOCAL_NOTES_DRAG_MIME, { asString: async () => "not json" } as never);
    await new LocalNotesDragAndDrop(moveNotes).handleDrop(fullTree(), transfer as never);
    expect(moveNotes).not.toHaveBeenCalled();
  });
});

describe("the Local Notes menus in package.json", () => {
  interface MenuEntry { command: string; when?: string; group?: string }
  const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as {
    contributes: { commands: Array<{ command: string; icon?: string }>; menus: Record<string, MenuEntry[]> };
  };
  const itemMenus = manifest.contributes.menus["view/item/context"];

  function shownFor(when: string | undefined, contextValue: string): boolean {
    return (when ?? "").split("&&").map((clause) => clause.trim()).every((clause) => {
      if (clause === "view == latexEditingToolkit.actions") return true;
      return clause.replace(/^\((.*)\)$/, "$1").split("||").map((option) => option.trim()).some((option) => {
        const equal = /^viewItem == (\S+)$/.exec(option);
        if (equal) return equal[1] === contextValue;
        const match = /^viewItem =~ \/(.*)\/([a-z]*)$/.exec(option);
        if (match) return new RegExp(match[1], match[2]).test(contextValue);
        throw new Error(`Unsupported when clause: ${option}`);
      });
    });
  }

  const contextValues = [...new Set(flatten(fullTree()).map((node) => node.contextValue ?? ""))];
  const { root, group: groupNode, project: note, missingProject, groupedProject, missingGroupedProject } = LOCAL_NOTES_CONTEXT;
  const anyNote = [note, missingProject, groupedProject, missingGroupedProject];
  const expected: Record<string, string[]> = {
    "latexEditingToolkit.newLocalNoteGroup": [root],
    "latexEditingToolkit.createProjectInGroup": [groupNode],
    "latexEditingToolkit.addNotesToGroup": [groupNode],
    "latexEditingToolkit.renameLocalNoteGroup": [groupNode],
    "latexEditingToolkit.deleteLocalNoteGroup": [groupNode],
    "latexEditingToolkit.openLocalProjectInNewWindow": [note, groupedProject],
    "latexEditingToolkit.moveLocalProjectToGroup": anyNote,
    "latexEditingToolkit.removeLocalProjectFromGroup": [groupedProject, missingGroupedProject],
    "latexEditingToolkit.renameLocalProject": anyNote,
    "latexEditingToolkit.relocateLocalProject": [missingProject, missingGroupedProject],
    "latexEditingToolkit.showLocalProjectPath": anyNote,
    "latexEditingToolkit.removeLocalProject": anyNote
  };

  it("offers each command on exactly the nodes it applies to", () => {
    for (const [command, nodes] of Object.entries(expected)) {
      const entries = itemMenus.filter((entry) => entry.command === command);
      const shown = contextValues.filter((contextValue) => entries.some((entry) => shownFor(entry.when, contextValue)));
      expect({ command, shown: shown.sort() }).toEqual({ command, shown: [...nodes].sort() });
    }
  });

  it("declares, registers and gives an icon to every command the menus use", () => {
    const declared = new Map(manifest.contributes.commands.map((entry) => [entry.command, entry]));
    const registered: string[] = [];
    const deps = {} as LocalNotesCommandDeps;
    registerLocalNotesCommands((id) => {
      registered.push(id);
      return { dispose: () => undefined } as never;
    }, deps);
    for (const command of Object.keys(expected)) {
      expect(declared.has(command), command).toBe(true);
      expect(registered, command).toContain(command);
    }
    for (const entry of itemMenus.filter((menu) => menu.group?.startsWith("inline"))) {
      expect(declared.get(entry.command)?.icon, entry.command).toBeTruthy();
    }
  });

  it("keeps commands that need a node out of the command palette", () => {
    const hidden = new Set(manifest.contributes.menus.commandPalette.filter((entry) => entry.when === "false").map((entry) => entry.command));
    for (const command of Object.keys(expected)) {
      expect(hidden.has(command), command).toBe(command !== "latexEditingToolkit.newLocalNoteGroup");
    }
  });
});
