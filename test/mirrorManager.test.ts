import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => ({
  configuredRoot: "",
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: string) => vscodeMock.configuredRoot || fallback
    })
  },
  commands: { executeCommand: vi.fn() }
}));

vi.mock("vscode", () => vscodeMock);

import { MirrorManager } from "../src/overleaf/mirrorManager";
import { writeManifest } from "../src/overleaf/manifest";
import type { OverleafCodexManifest } from "../src/overleaf/types";
import { scopedStateKey } from "../src/localResourceRegistry";

class MemoryStateStore {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function context(store: MemoryStateStore): any {
  return { globalState: store };
}

function manifest(projectId: string, projectName: string): OverleafCodexManifest {
  return {
    schemaVersion: 3,
    serverUrl: "https://example.test/",
    projectId,
    projectName,
    files: {},
    folders: { "": { path: "", entityId: "root" } },
    ignore: [],
    lastSyncAt: "2026-08-12T00:00:00.000Z"
  };
}

describe("MirrorManager local registry", () => {
  afterEach(() => {
    vscodeMock.configuredRoot = "";
  });

  it("discovers configured-root mirrors, honors forget tombstones, and restores on registration", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-mirrors-"));
    const support = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-mirror-support-"));
    vscodeMock.configuredRoot = root;
    process.env.LATEX_TOOLKIT_SUPPORT_HOME = support;
    try {
      const first = path.join(root, "first");
      const second = path.join(root, "second");
      await writeManifest(first, manifest("first", "First Mirror"));
      await writeManifest(second, manifest("second", "Second Mirror"));
      const manager = new MirrorManager(context(new MemoryStateStore()), "remote-a");

      expect((await manager.listLocalMirrors()).map(item => item.name).sort()).toEqual(["First Mirror", "Second Mirror"]);
      await manager.forgetLocalMirror(first);
      expect((await manager.listLocalMirrors()).map(item => item.name)).toEqual(["Second Mirror"]);

      await manager.registerLocalMirror(first);
      expect((await manager.listLocalMirrors()).map(item => item.name).sort()).toEqual(["First Mirror", "Second Mirror"]);
    } finally {
      delete process.env.LATEX_TOOLKIT_SUPPORT_HOME;
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(support, { recursive: true, force: true });
    }
  });

  it("retains missing manifest records and clears metadata without deleting the folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-missing-mirror-"));
    try {
      const mirrorRoot = path.join(root, "mirror");
      await writeManifest(mirrorRoot, manifest("missing", "Missing Mirror"));
      const manager = new MirrorManager(context(new MemoryStateStore()), "remote-b");
      await manager.registerLocalMirror(mirrorRoot);
      await fs.rm(path.join(mirrorRoot, ".overleaf-codex", "manifest.json"));

      expect((await manager.listLocalMirrors()).map(item => [item.name, item.missing])).toEqual([["Missing Mirror", true]]);
      expect(await manager.clearMissingLocalMirrors()).toBe(1);
      expect(await manager.listLocalMirrors()).toEqual([]);
      await expect(fs.stat(mirrorRoot)).resolves.toBeDefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("migrates only legacy mirror records inside the configured root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-legacy-mirror-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "latex-toolkit-legacy-outside-"));
    vscodeMock.configuredRoot = root;
    try {
      const inside = path.join(root, "inside");
      const external = path.join(outside, "external");
      await writeManifest(inside, manifest("inside", "Inside"));
      await writeManifest(external, manifest("external", "External"));
      const store = new MemoryStateStore();
      await store.update("overleafCodex.localMirrors.v1", [
        { root: inside, name: "Inside", projectId: "inside", serverUrl: "https://example.test/" },
        { root: external, name: "External", projectId: "external", serverUrl: "https://example.test/" }
      ]);
      const manager = new MirrorManager(context(store), "legacy-scope", true);
      expect((await manager.listLocalMirrors()).map(item => item.name)).toEqual(["Inside"]);
      expect(store.get<unknown>(scopedStateKey("overleafCodex.localMirrors", "legacy-scope"))).toEqual([
        expect.objectContaining({ name: "Inside" })
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
