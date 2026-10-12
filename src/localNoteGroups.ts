import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { caseFoldPath, LOCAL_RESOURCE_ID_MAX_LENGTH, LOCAL_RESOURCE_MAX_ENTRIES, scopedStateKey } from "./localResourceRegistry";
import type { LocalProjectStateStore } from "./types";

export const LOCAL_NOTE_GROUPS_STATE_KEY = "latexEditingToolkit.localProjectGroups";
export const LOCAL_NOTE_GROUPS_MAX_ENTRIES = 200;
export const LOCAL_NOTE_GROUP_NAME_MAX_LENGTH = 80;

/**
 * A named group of Local Notes projects. Groups are labels only: putting a project in a group, or
 * renaming or deleting the group, never touches the project's folder.
 *
 * Membership lives here rather than on the project records. Those are rewritten in their parsed
 * form on every read, so an older copy of the extension still running in another window would drop
 * a field it does not know - and with it every membership. This key is one it never reads.
 */
export interface LocalNoteGroup {
  id: string;
  name: string;
  createdAt: string;
  noteIds: string[];
}

export function scopedLocalNoteGroupsStateKey(scope: string): string {
  return scopedStateKey(LOCAL_NOTE_GROUPS_STATE_KEY, scope);
}

export class LocalNoteGroupRegistry {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LocalProjectStateStore,
    private readonly stateKey = LOCAL_NOTE_GROUPS_STATE_KEY
  ) {}

  /** The stored groups, as stored. Reading never writes, so malformed data is skipped, not repaired. */
  list(): Promise<LocalNoteGroup[]> {
    return this.serialized(() => this.read());
  }

  /** Creates a group, moving `noteIds` into it from wherever they were. */
  create(name: string, noteIds: readonly string[] = []): Promise<LocalNoteGroup> {
    return this.serialized(async () => {
      const groups = this.read();
      const error = groupNameError(name, groups);
      if (error) throw new Error(error);
      return this.writeCreated(groups, name, noteIds);
    });
  }

  /**
   * Like `create`, but reuses the group of that name when there already is one - another window may
   * have created it while the name was being typed here.
   */
  ensure(name: string, noteIds: readonly string[] = []): Promise<LocalNoteGroup> {
    return this.serialized(async () => {
      const groups = this.read();
      const existing = findGroupByName(groups, name);
      if (!existing) {
        const error = groupNameError(name, groups);
        if (error) throw new Error(error);
        return this.writeCreated(groups, name, noteIds);
      }
      const next = withNotesMoved(groups, noteIds, existing.id);
      if (countMoved(groups, next, noteIds) > 0) await this.write(next);
      return next.find((group) => group.id === existing.id)!;
    });
  }

  rename(id: string, name: string): Promise<LocalNoteGroup> {
    return this.serialized(async () => {
      const groups = this.read();
      const current = groups.find((group) => group.id === id);
      if (!current) throw new Error("This group no longer exists.");
      const error = groupNameError(name, groups, id);
      if (error) throw new Error(error);
      const renamed = { ...current, name: normalizeGroupName(name) };
      await this.write(groups.map((group) => group.id === id ? renamed : group));
      return renamed;
    });
  }

  /** Deletes a group. Its notes simply become ungrouped. */
  remove(id: string): Promise<LocalNoteGroup | undefined> {
    return this.serialized(async () => {
      const groups = this.read();
      const removed = groups.find((group) => group.id === id);
      if (removed) await this.write(groups.filter((group) => group.id !== id));
      return removed;
    });
  }

  /**
   * Puts `noteIds` in the group `groupId`, or in no group when it is undefined. Returns how many of
   * them changed group.
   */
  moveNotes(noteIds: readonly string[], groupId: string | undefined): Promise<number> {
    return this.serialized(async () => {
      const groups = this.read();
      if (groupId !== undefined && !groups.some((group) => group.id === groupId)) {
        throw new Error("This group no longer exists.");
      }
      const next = withNotesMoved(groups, noteIds, groupId);
      const moved = countMoved(groups, next, noteIds);
      if (moved > 0) await this.write(next);
      return moved;
    });
  }

  /** Drops notes that are no longer registered from every group. */
  forgetNotes(noteIds: readonly string[]): Promise<void> {
    return this.serialized(async () => {
      const groups = this.read();
      const next = withNotesMoved(groups, noteIds, undefined);
      if (countMoved(groups, next, noteIds) > 0) await this.write(next);
    });
  }

  private async writeCreated(groups: LocalNoteGroup[], name: string, noteIds: readonly string[]): Promise<LocalNoteGroup> {
    if (groups.length >= LOCAL_NOTE_GROUPS_MAX_ENTRIES) {
      throw new Error(`Local Notes can hold at most ${LOCAL_NOTE_GROUPS_MAX_ENTRIES} groups.`);
    }
    const created: LocalNoteGroup = { id: randomUUID(), name: normalizeGroupName(name), createdAt: new Date().toISOString(), noteIds: [] };
    const next = withNotesMoved([...groups, created], noteIds, created.id);
    await this.write(next);
    return next.find((group) => group.id === created.id)!;
  }

  private read(): LocalNoteGroup[] {
    return parseGroups(this.store.get<unknown>(this.stateKey));
  }

  private async write(groups: LocalNoteGroup[]): Promise<void> {
    await this.store.update(this.stateKey, groups);
  }

  private serialized<R>(task: () => R | Promise<R>): Promise<R> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export function noteCount(count: number): string {
  return `${count} note${count === 1 ? "" : "s"}`;
}

export function normalizeGroupName(raw: string): string {
  return String(raw ?? "").trim();
}

/** Why `raw` cannot name a group, or undefined when it can. `ignoreId` is the group being renamed. */
export function groupNameError(raw: string, groups: readonly LocalNoteGroup[], ignoreId?: string): string | undefined {
  const name = normalizeGroupName(raw);
  if (!name) return "Group name is required.";
  if (name.length > LOCAL_NOTE_GROUP_NAME_MAX_LENGTH) return `Use at most ${LOCAL_NOTE_GROUP_NAME_MAX_LENGTH} characters.`;
  const existing = findGroupByName(groups, name);
  if (existing && existing.id !== ignoreId) return `A group named '${existing.name}' already exists.`;
  return undefined;
}

export function findGroupByName(groups: readonly LocalNoteGroup[], raw: string): LocalNoteGroup | undefined {
  const key = normalizeGroupName(raw).toLocaleLowerCase();
  return groups.find((group) => group.name.toLocaleLowerCase() === key);
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Groups in display order: by name, with numbers compared by value ("HW 2" before "HW 10"). */
export function sortGroups(groups: readonly LocalNoteGroup[]): LocalNoteGroup[] {
  return [...groups].sort((left, right) => naturalOrder.compare(left.name, right.name) || left.createdAt.localeCompare(right.createdAt));
}

/** The group a note shows under. A note listed by two groups shows under the first in display order. */
export function groupOfNote(groups: readonly LocalNoteGroup[], noteId: string): LocalNoteGroup | undefined {
  return sortGroups(groups).find((group) => group.noteIds.includes(noteId));
}

export interface ArrangedLocalNotes<P> {
  groups: Array<{ group: LocalNoteGroup; projects: P[] }>;
  ungrouped: P[];
}

/**
 * Splits projects into their groups. Every project lands in exactly one place, since the tree
 * rejects a repeated id. Inside a group projects sort by name, like a folder; ungrouped ones keep
 * the order they came in (newest first, from the registry).
 */
export function arrangeLocalNotes<P extends { id: string; label: string; createdAt: string }>(
  projects: readonly P[],
  groups: readonly LocalNoteGroup[]
): ArrangedLocalNotes<P> {
  const ordered = sortGroups(groups);
  const owner = new Map<string, string>();
  for (const group of ordered) {
    for (const noteId of group.noteIds) if (!owner.has(noteId)) owner.set(noteId, group.id);
  }
  const members = new Map<string, P[]>(ordered.map((group) => [group.id, []]));
  const ungrouped: P[] = [];
  for (const project of projects) {
    const groupId = owner.get(project.id);
    if (groupId) members.get(groupId)!.push(project);
    else ungrouped.push(project);
  }
  return {
    groups: ordered.map((group) => ({
      group,
      projects: members.get(group.id)!.sort((left, right) => naturalOrder.compare(left.label, right.label) || right.createdAt.localeCompare(left.createdAt))
    })),
    ungrouped
  };
}

/**
 * Where a new note in a group most likely belongs: the folder holding most of the group's existing
 * notes, the most recently used one on a tie. `excludedParents` leaves out folders that are not a
 * choice of the user's, such as the Overleaf mirrors root.
 */
export function suggestGroupFolder(
  projects: ReadonlyArray<{ rootPath: string; missing: boolean; createdAt: string }>,
  excludedParents: readonly string[] = []
): string | undefined {
  const excluded = new Set(excludedParents.map((parent) => caseFoldPath(path.normalize(parent))));
  const parents = new Map<string, { parent: string; count: number; latest: string }>();
  for (const project of projects) {
    if (project.missing) continue;
    const parent = path.dirname(project.rootPath);
    const key = caseFoldPath(parent);
    if (excluded.has(key)) continue;
    const entry = parents.get(key);
    if (!entry) parents.set(key, { parent, count: 1, latest: project.createdAt });
    else {
      entry.count += 1;
      if (project.createdAt > entry.latest) entry.latest = project.createdAt;
    }
  }
  return [...parents.values()].sort((left, right) => right.count - left.count || right.latest.localeCompare(left.latest))[0]?.parent;
}

/** A folder name without the Overleaf project id a mirror's folder ends with. */
export function stripOverleafProjectId(folderName: string): string {
  return folderName.replace(/-[0-9a-f]{24}$/, "");
}

/**
 * The next name in a numbered series, from the latest one: the last number goes up by one and keeps
 * its zero padding ("hw-1-LP" -> "hw-2-LP", "Lecture 09" -> "Lecture 10"). Names `isTaken` rejects
 * are skipped. Undefined when the name has no number to count from.
 */
export function suggestNextNoteName(latestName: string, isTaken: (candidate: string) => boolean): string | undefined {
  const match = /^(.*\D)?(\d+)(\D*)$/.exec(stripOverleafProjectId(latestName));
  if (!match) return undefined;
  const [, prefix = "", digits, suffix] = match;
  let value = BigInt(digits);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    value += 1n;
    const candidate = `${prefix}${value.toString().padStart(digits.length, "0")}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  return undefined;
}

function withNotesMoved(groups: readonly LocalNoteGroup[], noteIds: readonly string[], targetId: string | undefined): LocalNoteGroup[] {
  const moving = new Set(noteIds);
  return groups.map((group) => {
    const kept = group.noteIds.filter((noteId) => !moving.has(noteId));
    return { ...group, noteIds: group.id === targetId ? [...kept, ...moving] : kept };
  });
}

/** How many of `noteIds` belong to different groups in `after` than in `before`. */
function countMoved(before: readonly LocalNoteGroup[], after: readonly LocalNoteGroup[], noteIds: readonly string[]): number {
  const membership = (groups: readonly LocalNoteGroup[], noteId: string): string => groups
    .filter((group) => group.noteIds.includes(noteId))
    .map((group) => group.id)
    .join("\n");
  return [...new Set(noteIds)].filter((noteId) => membership(before, noteId) !== membership(after, noteId)).length;
}

function parseGroups(raw: unknown): LocalNoteGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: LocalNoteGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (groups.length >= LOCAL_NOTE_GROUPS_MAX_ENTRIES) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? normalizeGroupName(record.name) : "";
    if (!id || id.length > LOCAL_RESOURCE_ID_MAX_LENGTH || seen.has(id)) continue;
    if (!name || name.length > LOCAL_NOTE_GROUP_NAME_MAX_LENGTH) continue;
    seen.add(id);
    const createdAt = typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt))
      ? new Date(Date.parse(record.createdAt)).toISOString()
      : new Date(0).toISOString();
    const noteIds = Array.isArray(record.noteIds)
      ? [...new Set(record.noteIds.filter((noteId): noteId is string => typeof noteId === "string" && noteId.length > 0 && noteId.length <= LOCAL_RESOURCE_ID_MAX_LENGTH))]
        .slice(0, LOCAL_RESOURCE_MAX_ENTRIES)
      : [];
    groups.push({ id, name, createdAt, noteIds });
  }
  return groups;
}
