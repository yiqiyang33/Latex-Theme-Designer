import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  matchesLocalIgnoreRule,
  migrateManifest,
  parseLocalIgnoreFile,
  readManifest,
  shouldIgnore,
  shouldIgnoreUntrackedLocalPath
} from "../src/overleaf/manifest";
import {
  cachedLocalFileHash,
  classifyFolderStructure,
  classifySyncStatus,
  isBlockingStatus,
  mergeTargetedSyncStatusReport,
  repairFolderManifestFromRemote
} from "../src/overleaf/syncStatus";
import { applyOtOperations, buildOtOperations, mergeRemoteIntoLocal, hasLocalChangedSinceLastSync, hasRemoteChangedSinceLastSync } from "../src/overleaf/ot";
import { OtDocumentSession, type OtDocumentTransport } from "../src/overleaf/otDocumentSession";
import { getWithLegacyFallback, hasExplicitConfigurationValue, needsGlobalConfigurationUpdate, type ConfigurationInspection, type InspectableConfiguration } from "../src/overleaf/config";
import { firstWorkspaceMirrorRoot, resolveMirrorRootForPath, workspaceContainsPath } from "../src/overleaf/mirrorRoots";
import { formatUnknownError, gitBlobHash } from "../src/overleaf/util";
import { parseContentRange, mergeCookieHeader, loadSocketIoClient, parseSocketAck } from "../src/overleaf/overleafClient";
import { RenameDetector } from "../src/overleaf/renameDetector";
import { performRemotePathChange, transactionName } from "../src/overleaf/remoteMutationCore";
import {
  LocalRenameConflictError,
  renameLocalPathSafely,
  renameLocalPathTransactionally
} from "../src/overleaf/localRename";
import {
  addProjectTreeEntity,
  buildProjectTreeIndex,
  moveProjectTreeEntity,
  removeProjectTreeEntity,
  renameProjectTreeEntity,
  updateProjectTreeDocVersion
} from "../src/overleaf/tree";
import type { JoinDocResult, OtUpdate, OverleafCodexManifest, OverleafProject, SyncStatusReport } from "../src/overleaf/types";

class FakeConfig implements InspectableConfiguration {
  constructor(
    private readonly values: Record<string, unknown>,
    private readonly inspections: Record<string, ConfigurationInspection<unknown> | undefined> = {}
  ) {}

  get<T>(section: string, defaultValue: T): T {
    return (Object.prototype.hasOwnProperty.call(this.values, section) ? this.values[section] : defaultValue) as T;
  }

  inspect<T>(section: string): ConfigurationInspection<T> | undefined {
    return this.inspections[section] as ConfigurationInspection<T> | undefined;
  }
}

function fakeConfig(values: Record<string, unknown>, inspections: Record<string, ConfigurationInspection<unknown> | undefined> = {}): InspectableConfiguration {
  return new FakeConfig(values, inspections);
}

describe("Overleaf integration primitives", () => {
  it("migrates old manifests and applies gitignore-style local rules", async () => {
    const manifest = migrateManifest({
      schemaVersion: 1,
      serverUrl: "https://www.overleaf.com/",
      projectId: "project",
      projectName: "Project",
      files: {},
      folders: {},
      ignore: [],
      lastSyncAt: "2026-01-01T00:00:00.000Z"
    });
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.ignore).toContain(".overleaf-codex/**");
    expect(shouldIgnore(manifest, "figures/input.pdf")).toBe(false);
    expect(shouldIgnoreUntrackedLocalPath(manifest, "main.pdf")).toBe(true);

    const rules = parseLocalIgnoreFile("tmp/\n*.swp\n!tmp/keep.tex\n");
    expect(matchesLocalIgnoreRule("tmp/pdfs/output.pdf", rules[0])).toBe(true);
    expect(matchesLocalIgnoreRule("main.tex.swp", rules[1])).toBe(true);
    expect(rules[2].negated).toBe(true);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-ignore-"));
    try {
      await fs.mkdir(path.join(root, ".overleaf-codex"), { recursive: true });
      await fs.writeFile(path.join(root, ".overleaf-codex", "manifest.json"), JSON.stringify(manifest));
      await fs.writeFile(path.join(root, ".overleaf-codexignore"), "tmp/\n!tmp/keep.tex\n", "utf8");
      const loaded = await readManifest(root);
      expect(shouldIgnoreUntrackedLocalPath(loaded, "tmp/render.png")).toBe(true);
      expect(shouldIgnoreUntrackedLocalPath(loaded, "tmp/keep.tex")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("classifies clean, local, remote and diverged paths", () => {
    const manifestFile = {
      path: "main.tex", entityId: "doc-1", entityType: "doc" as const,
      parentFolderId: "root", version: 3, sha1: "base", baseHash: "base"
    };
    expect(classifySyncStatus({ path: "main.tex", manifestFile, localExists: true, localHash: "base", remoteHash: "base", remoteFile: { ...manifestFile, version: 4 } }).status).toBe("synced");
    expect(classifySyncStatus({ path: "main.tex", manifestFile, localExists: true, localHash: "local", remoteHash: "base", remoteFile: { ...manifestFile, version: 4 } }).status).toBe("local ahead");
    expect(classifySyncStatus({ path: "main.tex", manifestFile, localExists: true, localHash: "base", remoteHash: "remote", remoteFile: { ...manifestFile, version: 4 } }).status).toBe("remote ahead");
    expect(classifySyncStatus({ path: "main.tex", manifestFile, localExists: true, localHash: "local", remoteHash: "remote", remoteFile: { ...manifestFile, version: 4 } }).status).toBe("diverged");
    expect(isBlockingStatus("diverged")).toBe(true);
    expect(isBlockingStatus("synced")).toBe(false);
  });

  it("keeps unrelated targeted sync failures and detects folder identity drift", () => {
    const previous: SyncStatusReport = {
      schemaVersion: 2, checkedAt: "old", projectId: "project", projectName: "Project",
      hasBlocking: true, completeness: "failed", globalBlockReason: "tree unavailable",
      items: [{ path: "retry.tex", status: "error", blocking: true }, { path: "other.tex", status: "diverged", blocking: true }]
    };
    const targeted: SyncStatusReport = {
      schemaVersion: 2, checkedAt: "new", projectId: "project", projectName: "Project",
      hasBlocking: false, completeness: "complete", items: [{ path: "retry.tex", status: "synced", blocking: false }]
    };
    const merged = mergeTargetedSyncStatusReport(previous, targeted, ["retry.tex"]);
    expect(merged.items.map(item => [item.path, item.status])).toEqual([["other.tex", "diverged"], ["retry.tex", "synced"]]);
    expect(merged.globalBlockReason).toBe("tree unavailable");

    const make = (folders: OverleafCodexManifest["folders"]): OverleafCodexManifest => ({
      schemaVersion: 3, serverUrl: "https://www.overleaf.com/", projectId: "project", projectName: "Project",
      files: {}, folders, ignore: [], lastSyncAt: "now"
    });
    expect(classifyFolderStructure(make({ "": { path: "", entityId: "a" } }), make({ "": { path: "", entityId: "b" } })).globalBlockReason).toMatch(/root folder/);

    const gitFolder = {
      "": { path: "", entityId: "root" },
      ".git": { path: ".git", entityId: "remote-git", parentFolderId: "root" }
    };
    expect(classifyFolderStructure(make(gitFolder), make(gitFolder), undefined, []).items).toEqual([]);
  });

  it("repairs corroborated folder renames and missing folder metadata", () => {
    const make = (folders: OverleafCodexManifest["folders"], files: OverleafCodexManifest["files"] = {}): OverleafCodexManifest => ({
      schemaVersion: 3, serverUrl: "https://www.overleaf.com/", projectId: "project", projectName: "Project",
      files, folders, ignore: [], lastSyncAt: "now"
    });
    const manifest = make({
      "": { path: "", entityId: "root" },
      "old": { path: "old", entityId: "folder-1", parentFolderId: "root" }
    }, {
      "old/main.tex": { path: "old/main.tex", entityId: "doc-1", entityType: "doc", parentFolderId: "folder-1" }
    });
    const remote = make({
      "": { path: "", entityId: "root" },
      "new": { path: "new", entityId: "folder-1", parentFolderId: "root" },
      "assets": { path: "assets", entityId: "folder-2", parentFolderId: "root" }
    });

    const repaired = repairFolderManifestFromRemote(manifest, remote, ["new", "assets"]);
    expect(repaired.remapped).toEqual([{ oldPath: "old", newPath: "new" }]);
    expect(repaired.adopted).toEqual(["assets"]);
    expect(manifest.folders.old).toBeUndefined();
    expect(manifest.files["new/main.tex"]?.entityId).toBe("doc-1");
    expect(manifest.folders.assets?.entityId).toBe("folder-2");
  });

  it("pairs folder delete/create events as a rename", () => {
    let now = 1000;
    const detector = new RenameDetector(5000, () => now);
    expect(detector.registerDelete({ path: "chapters", hash: "tree-hash", entityType: "folder" })).toEqual({ kind: "none" });
    now += 250;
    expect(detector.registerCreate({ path: "sections", hash: "tree-hash", entityType: "folder" })).toEqual({
      kind: "matched", oldPath: "chapters", newPath: "sections"
    });
  });

  it("uses one rollback-safe remote rename/move transaction for CLI and extension adapters", async () => {
    const calls: string[] = [];
    const client = {
      renameEntity: async (_projectId: string, _type: string, entityId: string, name: string) => {
        calls.push(`rename:${entityId}:${name}`);
      },
      moveEntity: async (_projectId: string, _type: string, entityId: string, parentId: string) => {
        calls.push(`move:${entityId}:${parentId}`);
      },
      deleteEntity: async () => undefined
    };
    await performRemotePathChange(client as never, "project", {
      entityType: "doc",
      entityId: "doc-1",
      oldParentFolderId: "left",
      newParentFolderId: "right",
      oldName: "old.tex",
      newName: "new.tex"
    });
    expect(calls[0]).toMatch(/^rename:doc-1:new\.overleaf-codex-move-\d+\.tex$/);
    expect(calls.slice(1)).toEqual(["move:doc-1:right", "rename:doc-1:new.tex"]);
    expect(transactionName(`${"a".repeat(200)}.pdf`, "upload-id").length).toBeLessThanOrEqual(150);
  });

  it("restores the original remote name when a combined rename/move fails", async () => {
    const calls: string[] = [];
    const client = {
      renameEntity: async (_projectId: string, _type: string, _entityId: string, name: string) => {
        calls.push(`rename:${name}`);
      },
      moveEntity: async () => {
        calls.push("move:failed");
        throw new Error("move failed");
      },
      deleteEntity: async () => undefined
    };
    await expect(performRemotePathChange(client as never, "project", {
      entityType: "file",
      entityId: "file-1",
      oldParentFolderId: "left",
      newParentFolderId: "right",
      oldName: "old.pdf",
      newName: "new.pdf"
    })).rejects.toThrow("move failed");
    expect(calls.at(-1)).toBe("rename:old.pdf");
  });

  it("applies local remote-renames without overwriting an existing target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-rename-"));
    try {
      await fs.mkdir(path.join(root, "chapters"), { recursive: true });
      await fs.writeFile(path.join(root, "draft.tex"), "remote source", "utf8");
      await fs.writeFile(path.join(root, "main.tex"), "local target", "utf8");

      await expect(renameLocalPathSafely(root, "draft.tex", "main.tex"))
        .rejects.toBeInstanceOf(LocalRenameConflictError);
      expect(await fs.readFile(path.join(root, "draft.tex"), "utf8")).toBe("remote source");
      expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe("local target");

      await renameLocalPathSafely(root, "draft.tex", "chapters/renamed.tex");
      await expect(fs.stat(path.join(root, "draft.tex"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(root, "chapters", "renamed.tex"), "utf8")).toBe("remote source");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects remote-renames whose paths escape the mirror", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-rename-path-"));
    try {
      await fs.writeFile(path.join(root, "main.tex"), "source", "utf8");
      await expect(renameLocalPathSafely(root, "main.tex", "../outside.tex"))
        .rejects.toThrow(/Invalid local mirror path|escapes the local mirror/);
      expect(await fs.readFile(path.join(root, "main.tex"), "utf8")).toBe("source");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps both directory trees when a remote folder rename has a local target conflict", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-folder-rename-"));
    try {
      await fs.mkdir(path.join(root, "old-folder"), { recursive: true });
      await fs.mkdir(path.join(root, "new-folder"), { recursive: true });
      await fs.writeFile(path.join(root, "old-folder", "remote.tex"), "remote tree", "utf8");
      await fs.writeFile(path.join(root, "new-folder", "local.tex"), "local tree", "utf8");

      await expect(renameLocalPathSafely(root, "old-folder", "new-folder"))
        .rejects.toBeInstanceOf(LocalRenameConflictError);
      expect(await fs.readFile(path.join(root, "old-folder", "remote.tex"), "utf8")).toBe("remote tree");
      expect(await fs.readFile(path.join(root, "new-folder", "local.tex"), "utf8")).toBe("local tree");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back the local path and state when a remote rename cannot be committed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-rename-rollback-"));
    let manifestPath = "old.tex";
    try {
      await fs.writeFile(path.join(root, "old.tex"), "source", "utf8");
      await expect(renameLocalPathTransactionally(
        root,
        "old.tex",
        "new.tex",
        async () => {
          manifestPath = "new.tex";
          throw new Error("manifest write failed");
        },
        async () => {
          manifestPath = "old.tex";
        }
      )).rejects.toThrow("manifest write failed");
      expect(manifestPath).toBe("old.tex");
      expect(await fs.readFile(path.join(root, "old.tex"), "utf8")).toBe("source");
      await expect(fs.stat(path.join(root, "new.tex"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the realtime project tree current across entity events", () => {
    const project: OverleafProject = {
      rootFolder: { _id: "root", name: "root", docs: [], fileRefs: [], folders: [
        { _id: "left", name: "left", docs: [], fileRefs: [], folders: [] },
        { _id: "right", name: "right", docs: [], fileRefs: [], folders: [] }
      ] }
    };
    expect(addProjectTreeEntity(project, "left", "doc", { _id: "doc-1", name: "draft.tex", version: 1 })).toBe(true);
    expect(updateProjectTreeDocVersion(project, "doc-1", 2)).toBe(true);
    expect(renameProjectTreeEntity(project, "doc-1", "main.tex")).toBe(true);
    expect(moveProjectTreeEntity(project, "doc-1", "right")).toBe(true);
    let indexed = buildProjectTreeIndex("https://www.overleaf.com/", "project", "Project", project).manifest;
    expect(indexed.files["right/main.tex"]?.version).toBe(2);
    expect(removeProjectTreeEntity(project, "doc-1")).toBe(true);
    indexed = buildProjectTreeIndex("https://www.overleaf.com/", "project", "Project", project).manifest;
    expect(indexed.files["right/main.tex"]).toBeUndefined();
  });

  it("round-trips OT text and computes Overleaf binary hashes", () => {
    const before = "Hello World\n";
    const after = "Hello Overleaf Codex\n";
    expect(applyOtOperations(before, buildOtOperations(before, after))).toBe(after);
    expect(mergeRemoteIntoLocal("Hello World", "Hello Overleaf", "Hello World!")).toMatchObject({ clean: true, content: "Hello Overleaf!" });
    expect(hasLocalChangedSinceLastSync("local", "manifest")).toBe(true);
    expect(hasRemoteChangedSinceLastSync(4, 4, "remote", "manifest")).toBe(false);
    expect(gitBlobHash(Buffer.from("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("loads the native Socket.IO runtime and validates HTTP helpers", () => {
    const runtimeRoot = existsSync(path.resolve("dist/vendor/socket.io-client/lib/io.js"))
      ? path.resolve("dist/vendor/socket.io-client")
      : path.resolve("node_modules/socket.io-client");
    const socketIo = loadSocketIoClient(runtimeRoot);
    expect(socketIo.version).toBe("0.9.17-overleaf-5");
    expect(typeof socketIo.connect).toBe("function");
    expect(socketIo.parser.decodePacket(socketIo.parser.encodePacket({ type: "message", data: "ok" })).data).toBe("ok");
    expect(parseContentRange("bytes 10-19/30")).toEqual({ start: 10, end: 19, total: 30 });
    expect(() => parseContentRange(null)).toThrow(/Content-Range/);
    expect(mergeCookieHeader("overleaf_session2=abc; GCLB=old", ["GCLB=new; Path=/"])).toBe("overleaf_session2=abc; GCLB=new");
  });

  it("accepts non-node-style socket acknowledgements and formats object errors", () => {
    expect(parseSocketAck([])).toEqual({ values: [] });
    expect(parseSocketAck([null, ["line"], 7])).toEqual({ values: [["line"], 7] });
    expect(parseSocketAck([{}])).toEqual({ values: [{}] });
    expect(parseSocketAck([{ ok: true, version: 8 }])).toEqual({ values: [{ ok: true, version: 8 }] });

    const failure = parseSocketAck([{ message: "Overleaf rejected the update", code: "bad_update" }]);
    expect(failure.error?.message).toContain("Overleaf rejected the update");
    expect(failure.error?.message).toContain("bad_update");
    expect(formatUnknownError({ error: "not_authorized", status: 403 })).toContain("not_authorized");
  });

  it("verifies ambiguous object-shaped OT acknowledgements by reading the document back", async () => {
    const afterApply = new AmbiguousAckTransport("Hello", 1);
    afterApply.objectAckAfterFirstApply = true;
    const accepted = await makeOtSession(afterApply).submitLocal("Hello!");
    expect(accepted).toMatchObject({ content: "Hello!", changed: true });
    expect(afterApply.content).toBe("Hello!");
    expect(afterApply.applyCount).toBe(1);
    expect(afterApply.lastUpdate).not.toHaveProperty("meta");

    const beforeApply = new AmbiguousAckTransport("Hello", 1);
    beforeApply.objectAckBeforeFirstApply = true;
    const retried = await makeOtSession(beforeApply).submitLocal("Hello!");
    expect(retried).toMatchObject({ content: "Hello!", changed: true });
    expect(beforeApply.content).toBe("Hello!");
    expect(beforeApply.applyCount).toBe(2);
  });

  it("falls back to legacy Overleaf settings unless the new Toolkit key is explicit", () => {
    expect(hasExplicitConfigurationValue({ defaultValue: false })).toBe(false);
    expect(hasExplicitConfigurationValue({ globalValue: false })).toBe(true);
    expect(hasExplicitConfigurationValue({ workspaceValue: false })).toBe(true);
    expect(hasExplicitConfigurationValue({ workspaceFolderValue: false })).toBe(true);

    const legacyEnabled = fakeConfig({ compileOnSave: true });
    const newDefaultOnly = fakeConfig(
      { compileOnSave: false },
      { compileOnSave: { defaultValue: false } }
    );
    expect(getWithLegacyFallback(newDefaultOnly, "compileOnSave", legacyEnabled, "compileOnSave", false)).toBe(true);

    const newExplicitFalse = fakeConfig(
      { compileOnSave: false },
      { compileOnSave: { defaultValue: false, workspaceValue: false } }
    );
    expect(getWithLegacyFallback(newExplicitFalse, "compileOnSave", legacyEnabled, "compileOnSave", false)).toBe(false);

    const legacyDisabled = fakeConfig({ autoPushLocalAhead: false });
    const newAutoPushDefaultOnly = fakeConfig(
      { autoPushLocalAhead: true },
      { autoPushLocalAhead: { defaultValue: true } }
    );
    expect(getWithLegacyFallback(newAutoPushDefaultOnly, "autoPushLocalAhead", legacyDisabled, "autoPushLocalAhead", true)).toBe(false);
    expect(needsGlobalConfigurationUpdate({ defaultValue: true }, true, true)).toBe(false);
    expect(needsGlobalConfigurationUpdate({ globalValue: false }, false, false)).toBe(false);
    expect(needsGlobalConfigurationUpdate({ globalValue: false }, false, true)).toBe(true);
  });

  it("resolves saved file paths to their owning Overleaf mirror", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-roots-"));
    const first = path.join(parent, "first");
    const second = path.join(parent, "second");
    try {
      await fs.mkdir(path.join(first, ".overleaf-codex"), { recursive: true });
      await fs.mkdir(path.join(second, ".overleaf-codex"), { recursive: true });
      const hasManifest = (root: string) => root === first || root === second;

      expect(firstWorkspaceMirrorRoot([first, second], hasManifest)).toBe(first);
      expect(resolveMirrorRootForPath(path.join(second, "chapters", "intro.tex"), [first, second], hasManifest)).toBe(second);
      expect(resolveMirrorRootForPath(second, [first, second], hasManifest)).toBe(second);
      expect(workspaceContainsPath(second, [parent])).toBe(true);
      expect(workspaceContainsPath(path.join(parent, "outside"), [first, second])).toBe(false);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it("reuses local hash cache only while file metadata is stable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-overleaf-cache-"));
    try {
      const file = path.join(root, "main.tex");
      const manifestFile = { path: "main.tex", entityId: "doc-1", entityType: "doc" as const, parentFolderId: "root" };
      await fs.writeFile(file, "one", "utf8");
      const first = await cachedLocalFileHash(file, manifestFile);
      const second = await cachedLocalFileHash(file, manifestFile);
      expect(first.reused).toBe(false);
      expect(second.reused).toBe(true);
      expect(second.hash).toBe(first.hash);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

class AmbiguousAckTransport implements OtDocumentTransport {
  applyCount = 0;
  objectAckAfterFirstApply = false;
  objectAckBeforeFirstApply = false;
  lastUpdate?: OtUpdate;

  constructor(public content: string, public version: number) {}

  async joinDoc(): Promise<JoinDocResult> {
    return { content: this.content, version: this.version };
  }

  async applyOtUpdate(_docId: string, update: OtUpdate): Promise<void> {
    this.applyCount += 1;
    this.lastUpdate = update;
    if (this.applyCount === 1 && this.objectAckBeforeFirstApply) {
      this.objectAckBeforeFirstApply = false;
      throw { event: "applyOtUpdate", status: "unknown" };
    }
    this.content = applyOtOperations(this.content, update.op ?? []);
    this.version = update.v + 1;
    if (this.applyCount === 1 && this.objectAckAfterFirstApply) {
      this.objectAckAfterFirstApply = false;
      throw { event: "applyOtUpdate", applied: true };
    }
  }
}

function makeOtSession(transport: AmbiguousAckTransport): OtDocumentSession {
  return new OtDocumentSession({
    docId: "doc-1",
    version: transport.version,
    localCache: transport.content,
    remoteCache: transport.content
  }, transport);
}
