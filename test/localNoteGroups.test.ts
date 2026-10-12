import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  arrangeLocalNotes,
  groupNameError,
  groupOfNote,
  LOCAL_NOTE_GROUP_NAME_MAX_LENGTH,
  LOCAL_NOTE_GROUPS_STATE_KEY,
  LocalNoteGroupRegistry,
  suggestGroupFolder,
  suggestNextNoteName,
  type LocalNoteGroup
} from "../src/localNoteGroups";
import { LOCAL_PROJECTS_STATE_KEY, LocalProjectRegistry } from "../src/projectRegistry";
import { runCreateProjectWorkflow } from "../src/projectWorkflow";
import type { LocalProjectStateStore } from "../src/types";

/** Stores values the way VS Code's global state does: as JSON, so nothing is shared by reference. */
class JsonStateStore implements LocalProjectStateStore {
  private readonly values = new Map<string, string>();
  writes = 0;

  get<T>(key: string): T | undefined {
    const raw = this.values.get(key);
    return raw === undefined ? undefined : JSON.parse(raw) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.writes += 1;
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, JSON.stringify(value));
  }
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-note-groups-"));
  temporaryRoots.push(root);
  return root;
}

function group(id: string, name: string, noteIds: string[] = [], createdAt = "2026-01-01T00:00:00.000Z"): LocalNoteGroup {
  return { id, name, createdAt, noteIds };
}

function note(id: string, label: string, createdAt = "2026-01-01T00:00:00.000Z") {
  return { id, label, createdAt };
}

describe("Local Notes group registry", () => {
  it("creates groups with trimmed, unique names", async () => {
    const groups = new LocalNoteGroupRegistry(new JsonStateStore());
    const lp = await groups.create("  LP Homework ");
    expect(lp.name).toBe("LP Homework");
    expect(lp.noteIds).toEqual([]);
    await expect(groups.create("lp homework")).rejects.toThrow("A group named 'LP Homework' already exists.");
    await expect(groups.create("   ")).rejects.toThrow("Group name is required.");
    await expect(groups.create("x".repeat(LOCAL_NOTE_GROUP_NAME_MAX_LENGTH + 1))).rejects.toThrow("at most");
    expect((await groups.list()).map((entry) => entry.name)).toEqual(["LP Homework"]);
  });

  it("renames a group, allowing a change of case but not a clash", async () => {
    const groups = new LocalNoteGroupRegistry(new JsonStateStore());
    const lp = await groups.create("LP");
    await groups.create("Game Theory");
    expect((await groups.rename(lp.id, "lp")).name).toBe("lp");
    await expect(groups.rename(lp.id, "game theory")).rejects.toThrow("already exists");
    await expect(groups.rename("gone", "Anything")).rejects.toThrow("no longer exists");
  });

  it("keeps a note in one group at a time", async () => {
    const groups = new LocalNoteGroupRegistry(new JsonStateStore());
    const lp = await groups.create("LP", ["hw1", "hw2"]);
    const games = await groups.create("Games", ["hw2", "nash"]);
    let stored = await groups.list();
    expect(stored.find((entry) => entry.id === lp.id)?.noteIds).toEqual(["hw1"]);
    expect(stored.find((entry) => entry.id === games.id)?.noteIds).toEqual(["hw2", "nash"]);

    expect(await groups.moveNotes(["hw1", "hw2"], lp.id)).toBe(1);
    stored = await groups.list();
    expect(groupOfNote(stored, "hw1")?.id).toBe(lp.id);
    expect(groupOfNote(stored, "hw2")?.id).toBe(lp.id);
    expect(stored.find((entry) => entry.id === games.id)?.noteIds).toEqual(["nash"]);

    expect(await groups.moveNotes(["hw2"], undefined)).toBe(1);
    expect(groupOfNote(await groups.list(), "hw2")).toBeUndefined();
    await expect(groups.moveNotes(["hw1"], "gone")).rejects.toThrow("no longer exists");
  });

  it("does not write when a move changes nothing", async () => {
    const store = new JsonStateStore();
    const groups = new LocalNoteGroupRegistry(store);
    const lp = await groups.create("LP", ["hw1"]);
    const writes = store.writes;
    expect(await groups.moveNotes(["hw1"], lp.id)).toBe(0);
    expect(await groups.moveNotes(["loose"], undefined)).toBe(0);
    await groups.forgetNotes(["never-grouped"]);
    expect(store.writes).toBe(writes);
  });

  it("reuses an existing group of the same name instead of failing", async () => {
    const groups = new LocalNoteGroupRegistry(new JsonStateStore());
    const lp = await groups.create("LP Homework", ["hw1"]);
    const ensured = await groups.ensure("lp homework", ["hw2"]);
    expect(ensured.id).toBe(lp.id);
    expect(ensured.noteIds).toEqual(["hw1", "hw2"]);
    const created = await groups.ensure("Thesis", ["draft"]);
    expect(created.noteIds).toEqual(["draft"]);
    expect((await groups.list()).map((entry) => entry.name).sort()).toEqual(["LP Homework", "Thesis"]);
  });

  it("deletes a group without touching its notes elsewhere, and forgets removed notes", async () => {
    const groups = new LocalNoteGroupRegistry(new JsonStateStore());
    const lp = await groups.create("LP", ["hw1", "hw2"]);
    await groups.create("Games", ["nash"]);
    expect((await groups.remove(lp.id))?.name).toBe("LP");
    expect(await groups.remove(lp.id)).toBeUndefined();
    await groups.forgetNotes(["nash"]);
    expect(await groups.list()).toMatchObject([{ name: "Games", noteIds: [] }]);
  });

  it("skips malformed stored data without rewriting it", async () => {
    const store = new JsonStateStore();
    await store.update(LOCAL_NOTE_GROUPS_STATE_KEY, [
      null,
      "text",
      { id: "", name: "No id" },
      { id: "a", name: "   " },
      { id: "b", name: "Kept", createdAt: "not a date", noteIds: ["n1", 7, "", "n1", "n2"] },
      { id: "b", name: "Duplicate id" }
    ]);
    const writes = store.writes;
    const groups = new LocalNoteGroupRegistry(store);
    expect(await groups.list()).toEqual([{ id: "b", name: "Kept", createdAt: new Date(0).toISOString(), noteIds: ["n1", "n2"] }]);
    expect(store.writes).toBe(writes);

    await store.update(LOCAL_NOTE_GROUPS_STATE_KEY, { not: "an array" });
    expect(await groups.list()).toEqual([]);
  });

  it("serializes concurrent changes", async () => {
    const groups = new LocalNoteGroupRegistry(new JsonStateStore());
    const [lp] = await Promise.all([groups.create("LP"), groups.create("Games"), groups.create("Thesis")]);
    await Promise.all([groups.moveNotes(["a"], lp.id), groups.moveNotes(["b"], lp.id), groups.rename(lp.id, "LP 2026")]);
    expect(await groups.list()).toHaveLength(3);
    expect((await groups.list()).find((entry) => entry.id === lp.id)).toMatchObject({ name: "LP 2026", noteIds: ["a", "b"] });
  });

  it("validates names against the other groups", () => {
    const groups = [group("lp", "LP")];
    expect(groupNameError("Games", groups)).toBeUndefined();
    expect(groupNameError(" lp ", groups)).toContain("already exists");
    expect(groupNameError("lp", groups, "lp")).toBeUndefined();
  });
});

describe("arranging Local Notes", () => {
  it("sorts groups and their notes by name, numbers by value, and leaves ungrouped notes in order", () => {
    const projects = [
      note("loose-new", "Scratch", "2026-03-01T00:00:00.000Z"),
      note("hw10", "HW10"),
      note("hw2", "HW2"),
      note("loose-old", "Another", "2026-01-01T00:00:00.000Z"),
      note("nash", "nash equilibria")
    ];
    const arranged = arrangeLocalNotes(projects, [
      group("g10", "Week 10", []),
      group("lp", "lp", ["hw10", "hw2"]),
      group("g2", "Week 2", ["nash"])
    ]);
    expect(arranged.groups.map((entry) => entry.group.name)).toEqual(["lp", "Week 2", "Week 10"]);
    expect(arranged.groups[0]?.projects.map((entry) => entry.label)).toEqual(["HW2", "HW10"]);
    expect(arranged.groups[2]?.projects).toEqual([]);
    expect(arranged.ungrouped.map((entry) => entry.id)).toEqual(["loose-new", "loose-old"]);
  });

  it("places every note exactly once, ignoring ids no project has", () => {
    const projects = [note("a", "A"), note("b", "B"), note("c", "C")];
    const arranged = arrangeLocalNotes(projects, [
      group("second", "Second", ["a", "ghost"]),
      group("first", "First", ["a", "b"])
    ]);
    const placed = [...arranged.groups.flatMap((entry) => entry.projects), ...arranged.ungrouped].map((entry) => entry.id);
    expect(placed.sort()).toEqual(["a", "b", "c"]);
    expect(arranged.groups.find((entry) => entry.group.id === "first")?.projects.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(groupOfNote([group("second", "Second", ["a"]), group("first", "First", ["a"])], "a")?.id).toBe("first");
  });

  it("shows groups even when there are no notes at all", () => {
    expect(arrangeLocalNotes([], [group("lp", "LP")]).groups).toHaveLength(1);
  });
});

describe("defaults for a new note in a group", () => {
  it("counts on from the latest name in a numbered series", () => {
    const free = () => false;
    expect(suggestNextNoteName("hw-1-LP", free)).toBe("hw-2-LP");
    expect(suggestNextNoteName("HW2", free)).toBe("HW3");
    expect(suggestNextNoteName("HW9", free)).toBe("HW10");
    expect(suggestNextNoteName("Lecture 09", free)).toBe("Lecture 10");
    expect(suggestNextNoteName("007", free)).toBe("008");
    expect(suggestNextNoteName("LP-notes", free)).toBeUndefined();
  });

  it("ignores the Overleaf project id a mirror folder ends with", () => {
    expect(suggestNextNoteName("hw-3-LP-6ab88eb9e86a0a4beae6b018", () => false)).toBe("hw-4-LP");
  });

  it("skips names that are already taken", () => {
    const taken = new Set(["hw-2-LP", "hw-3-LP"]);
    expect(suggestNextNoteName("hw-1-LP", (candidate) => taken.has(candidate))).toBe("hw-4-LP");
    expect(suggestNextNoteName("hw-1-LP", () => true)).toBeUndefined();
  });

  it("suggests the folder most of the group's notes live in", () => {
    const base = path.join(os.tmpdir(), "notes");
    const at = (folder: string, createdAt: string, missing = false) => ({ rootPath: path.join(base, folder), missing, createdAt });
    expect(suggestGroupFolder([
      at("LP/hw-1", "2026-01-01T00:00:00.000Z"),
      at("LP/hw-2", "2026-01-02T00:00:00.000Z"),
      at("Desktop/hw-3", "2026-01-03T00:00:00.000Z")
    ])).toBe(path.join(base, "LP"));
    // On a tie the more recently used folder wins.
    expect(suggestGroupFolder([at("A/x", "2026-01-01T00:00:00.000Z"), at("B/y", "2026-02-01T00:00:00.000Z")])).toBe(path.join(base, "B"));
    expect(suggestGroupFolder([at("Gone/x", "2026-01-01T00:00:00.000Z", true)])).toBeUndefined();
    expect(suggestGroupFolder([at("mirrors/paper-1", "2026-01-01T00:00:00.000Z")], [path.join(base, "mirrors")])).toBeUndefined();
  });
});

describe("Local Notes display names", () => {
  it("renames the shown name only, and an empty name goes back to the folder's", async () => {
    const registry = new LocalProjectRegistry(new JsonStateStore());
    const root = path.join(await temporaryRoot(), "hw-1-LP");
    const created = await registry.add(root, "homework-assignment");
    expect((await registry.rename(created.id, "  HW 1: Simplex ")).label).toBe("HW 1: Simplex");
    expect((await registry.find(root))?.rootPath).toBe(path.normalize(root));
    expect((await registry.rename(created.id, "")).label).toBe("hw-1-LP");
    await expect(registry.rename(created.id, "x".repeat(300))).rejects.toThrow("at most");
    await expect(registry.rename("gone", "Name")).rejects.toThrow("no longer registered");
  });

  it("never stores the computed missing flag", async () => {
    const store = new JsonStateStore();
    const registry = new LocalProjectRegistry(store);
    const created = await registry.add(path.join(await temporaryRoot(), "gone"), "book-minimal");
    await registry.rename(created.id, "Renamed");
    expect(store.get<Array<Record<string, unknown>>>(LOCAL_PROJECTS_STATE_KEY)?.[0]).not.toHaveProperty("missing");
  });

  it("keeps a chosen name across a relocation, and lets a folder name follow the folder", async () => {
    const registry = new LocalProjectRegistry(new JsonStateStore());
    const parent = await temporaryRoot();
    const relocated = async (from: string, to: string, label?: string) => {
      const created = await registry.add(path.join(parent, from), "book-minimal");
      if (label) await registry.rename(created.id, label);
      await fs.mkdir(path.join(parent, to));
      await fs.writeFile(path.join(parent, to, "main.tex"), "\\documentclass{book}\n", "utf8");
      return (await registry.relocate(path.join(parent, from), path.join(parent, to))).label;
    };
    expect(await relocated("old-plain", "new-plain")).toBe("new-plain");
    expect(await relocated("old-named", "new-named", "My Notes")).toBe("My Notes");
  });

  it("returns the record the create workflow registered, under the name it was given", async () => {
    const registry = new LocalProjectRegistry(new JsonStateStore());
    const root = path.join(await temporaryRoot(), "Paper-6ab88eb9e86a0a4beae6b018");
    const service = { handle: async () => ({}) };
    const created = await runCreateProjectWorkflow(service, registry, root, "research-paper", undefined, { label: "Paper" });
    expect(created).toMatchObject({ rootPath: path.normalize(root), label: "Paper" });
    expect((await registry.findById(created.id))?.label).toBe("Paper");
  });

  it("registers a project under a given name, also over an existing record", async () => {
    const registry = new LocalProjectRegistry(new JsonStateStore());
    const root = path.join(await temporaryRoot(), "Paper-6ab88eb9e86a0a4beae6b018");
    expect((await registry.add(root, "research-paper", { label: "Paper" })).label).toBe("Paper");
    expect((await registry.add(root, "research-paper")).label).toBe("Paper");
    expect((await registry.add(root, "research-paper", { label: "Paper v2" })).label).toBe("Paper v2");
  });
});
