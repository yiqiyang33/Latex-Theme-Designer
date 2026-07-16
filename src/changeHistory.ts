import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { StateService } from "./state";
import type {
  ToolkitChangeRecord,
  ToolkitEditableState,
  ToolkitFileSnapshot,
  ToolkitHistoryState,
  ToolkitSnapshotValue,
  ToolkitState
} from "./types";
import { isSubpath, workspaceRel } from "./utils";

export class HistoryConflictError extends Error {
  constructor(readonly conflicts: string[]) {
    super(`Files or settings changed after the recorded operation: ${conflicts.join(", ")}`);
    this.name = "HistoryConflictError";
  }
}

export class ChangeHistoryService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly storageDir: string | undefined,
    private readonly stateService: StateService
  ) {}

  async historyState(): Promise<ToolkitHistoryState> {
    const record = await this.readRecord();
    return {
      canUndo: record?.state === "applied",
      canRedo: record?.state === "undone",
      label: record?.label ?? "",
      createdAt: record?.createdAt ?? ""
    };
  }

  runStateChange<T>(command: string, label: string, task: () => Promise<T>, enabled = true): Promise<T> {
    if (!this.storageDir || !enabled) return task();
    return this.runSerialized(async () => {
      const before = this.editableState(await this.stateService.loadState());
      const configTargets = this.normalizePaths(["theme.ui.json", "theme.overrides.tex", "theme.colors.tex"]);
      const beforeFiles = await this.captureValues(configTargets);
      try {
        const result = await task();
        const after = this.editableState(await this.stateService.loadState());
        await this.commit({ command, label, beforeEditableState: before, afterEditableState: after, files: [] });
        return result;
      } catch (err) {
        await this.restoreValues(configTargets.map((target, index) => ({ target, value: beforeFiles[index] }))).catch(() => undefined);
        throw err;
      }
    });
  }

  runFileChange<T>(command: string, label: string, paths: string[], task: () => Promise<T>, enabled = true): Promise<T> {
    if (!this.storageDir || !enabled) return task();
    return this.runSerialized(async () => {
      const targets = this.normalizePaths(paths);
      const before = await this.captureValues(targets);
      try {
        const result = await task();
        const after = await this.captureValues(targets);
        const files = targets.map((target, index): ToolkitFileSnapshot => ({
          path: workspaceRel(this.rootDir, target),
          before: before[index],
          after: after[index]
        }));
        await this.commit({ command, label, files });
        return result;
      } catch (err) {
        await this.restoreValues(targets.map((target, index) => ({ target, value: before[index] }))).catch(() => undefined);
        throw err;
      }
    });
  }

  undo(force = false): Promise<ToolkitHistoryState> {
    return this.runSerialized(async () => this.restoreDirection("undo", force));
  }

  redo(force = false): Promise<ToolkitHistoryState> {
    return this.runSerialized(async () => this.restoreDirection("redo", force));
  }

  private async restoreDirection(direction: "undo" | "redo", force: boolean): Promise<ToolkitHistoryState> {
    const record = await this.readRecord();
    if (!record) throw new Error("No Toolkit change is available to restore.");
    if (direction === "undo" && record.state !== "applied") throw new Error("The last Toolkit change is already undone.");
    if (direction === "redo" && record.state !== "undone") throw new Error("No Toolkit change is available to redo.");
    const expectedState = direction === "undo" ? record.afterEditableState : record.beforeEditableState;
    const restoreState = direction === "undo" ? record.beforeEditableState : record.afterEditableState;
    const conflicts: string[] = [];

    if (expectedState) {
      const current = this.editableState(await this.stateService.loadState());
      if (JSON.stringify(current) !== JSON.stringify(expectedState)) conflicts.push("Toolkit settings");
    }
    for (const file of record.files) {
      const target = path.resolve(this.rootDir, file.path);
      const current = await this.captureValue(target);
      const expected = direction === "undo" ? file.after : file.before;
      if (current.fingerprint !== expected.fingerprint) conflicts.push(file.path);
    }
    if (conflicts.length > 0 && !force) throw new HistoryConflictError(conflicts);

    if (restoreState) {
      await this.restoreEditableState(restoreState);
      const actual = this.editableState(await this.stateService.loadState());
      if (direction === "undo") record.beforeEditableState = actual;
      else record.afterEditableState = actual;
    }
    if (record.files.length > 0) {
      await this.restoreValues(record.files.map((file) => ({
        target: path.resolve(this.rootDir, file.path),
        value: direction === "undo" ? file.before : file.after
      })));
    }
    record.state = direction === "undo" ? "undone" : "applied";
    await this.writeRecord(record);
    return this.historyState();
  }

  private editableState(state: ToolkitState): ToolkitEditableState {
    return {
      toggles: { ...state.toggles },
      colors: { ...state.colors },
      style_preset: state.style_preset,
      style_base_preset: state.style_base_preset,
      body_font_size_pt: state.body_font_size_pt,
      class_config: { ...state.class_config },
      compile_target: state.compile_target,
      compile_recipe: state.compile_recipe,
      compile_use_internal_fallback: state.compile_use_internal_fallback
    };
  }

  private async restoreEditableState(snapshot: ToolkitEditableState): Promise<void> {
    const current = await this.stateService.loadState();
    current.toggles = { ...snapshot.toggles };
    current.colors = { ...snapshot.colors };
    current.style_preset = current.style_presets.some((preset) => preset.id === snapshot.style_preset)
      ? snapshot.style_preset
      : snapshot.style_base_preset;
    current.style_base_preset = snapshot.style_base_preset;
    current.body_font_size_pt = snapshot.body_font_size_pt;
    current.class_config = { ...snapshot.class_config };
    current.compile_target = snapshot.compile_target;
    current.compile_recipe = snapshot.compile_recipe;
    current.compile_use_internal_fallback = snapshot.compile_use_internal_fallback;
    await this.stateService.writeOverrideFiles(current);
  }

  private async captureValues(targets: string[]): Promise<ToolkitSnapshotValue[]> {
    return Promise.all(targets.map((target) => this.captureValue(target)));
  }

  private async captureValue(target: string): Promise<ToolkitSnapshotValue> {
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) {
        const link = await fs.readlink(target);
        return { kind: "symlink", link_target: link, mode: stat.mode, fingerprint: hash(`symlink:${link}`) };
      }
      if (stat.isDirectory()) {
        const entries = (await fs.readdir(target)).sort();
        return { kind: "directory", mode: stat.mode, fingerprint: hash(`directory:${entries.join("\0")}`) };
      }
      if (stat.isFile()) {
        const content = await fs.readFile(target);
        return { kind: "file", content_base64: content.toString("base64"), mode: stat.mode, fingerprint: hashBuffer(content) };
      }
      return { kind: "missing", fingerprint: hash("missing") };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing", fingerprint: hash("missing") };
      throw err;
    }
  }

  private async restoreValues(entries: Array<{ target: string; value: ToolkitSnapshotValue }>): Promise<void> {
    for (const { target, value } of entries.filter((entry) => entry.value.kind === "directory")) {
      await fs.mkdir(target, { recursive: true });
      if (value.mode !== undefined) await fs.chmod(target, value.mode).catch(() => undefined);
    }
    for (const { target, value } of entries.filter((entry) => entry.value.kind === "file" || entry.value.kind === "symlink")) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rm(target, { recursive: true, force: true });
      if (value.kind === "file") {
        const temp = `${target}.restore-${randomUUID()}`;
        await fs.writeFile(temp, Buffer.from(value.content_base64 ?? "", "base64"));
        await fs.rename(temp, target);
        if (value.mode !== undefined) await fs.chmod(target, value.mode).catch(() => undefined);
      } else {
        await fs.symlink(value.link_target ?? "", target);
      }
    }
    const missing = entries.filter((entry) => entry.value.kind === "missing");
    for (const { target } of missing) {
      try {
        const stat = await fs.lstat(target);
        if (!stat.isDirectory()) await fs.unlink(target);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }
    for (const { target } of [...missing].reverse()) {
      try {
        if ((await fs.lstat(target)).isDirectory()) await fs.rmdir(target);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY") throw err;
      }
    }
  }

  private normalizePaths(rawPaths: string[]): string[] {
    const unique = new Set<string>();
    for (const raw of rawPaths) {
      const target = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(this.rootDir, raw);
      if (!isSubpath(target, this.rootDir)) throw new Error(`History target is outside workspace: ${raw}`);
      unique.add(target);
    }
    return [...unique];
  }

  private async commit(input: Pick<ToolkitChangeRecord, "command" | "label" | "files"> & Partial<Pick<ToolkitChangeRecord, "beforeEditableState" | "afterEditableState">>): Promise<void> {
    await this.writeRecord({
      version: 1,
      id: randomUUID(),
      rootPath: this.rootDir,
      command: input.command,
      label: input.label,
      createdAt: new Date().toISOString(),
      state: "applied",
      beforeEditableState: input.beforeEditableState,
      afterEditableState: input.afterEditableState,
      files: input.files
    });
  }

  private manifestPath(): string | undefined {
    return this.storageDir ? path.join(this.storageDir, "last-change.json") : undefined;
  }

  private async readRecord(): Promise<ToolkitChangeRecord | undefined> {
    const manifest = this.manifestPath();
    if (!manifest) return undefined;
    try {
      const parsed = JSON.parse(await fs.readFile(manifest, "utf8")) as ToolkitChangeRecord;
      return parsed?.version === 1 && parsed.rootPath === this.rootDir ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeRecord(record: ToolkitChangeRecord): Promise<void> {
    const manifest = this.manifestPath();
    if (!manifest) return;
    await fs.mkdir(path.dirname(manifest), { recursive: true });
    const temp = `${manifest}.tmp-${randomUUID()}`;
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, "utf8");
    await fs.rename(temp, manifest);
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export function workspaceHistoryStorageRoot(globalStoragePath: string, rootPath: string): string {
  const resolved = path.resolve(rootPath);
  const canonical = process.platform === "win32" || process.platform === "darwin" ? resolved.toLocaleLowerCase() : resolved;
  return path.join(globalStoragePath, "history", createHash("sha256").update(canonical).digest("hex"));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
