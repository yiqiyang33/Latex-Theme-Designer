import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { readSnippetDocuments } from "./snippetManagerModel";
import { assertExpectedSnippetDocumentHash, parseSnippetDocument } from "./engine/snippetDocument";
import { discoverSnippetProfiles, getProfilesDir, getWorkspaceSnippetDir, normalizeProfileName } from "./engine/snippetProfiles";
import { getSnippetDir } from "./engine/utils";
import { assertSnippetPathAllowed } from "./pathPolicy";

export interface SnippetManagerDocumentState {
  filePath: string;
  fileName: string;
  sourceScope: "base" | "profile" | "workspace";
  profile: string;
  workspaceFolder: string;
  language: string;
  content: string;
  hash: string;
  mtimeMs?: number;
  diagnostics: unknown[];
  snippets: unknown[];
}

export interface SnippetManagerState {
  activeProfile: string;
  profiles: string[];
  snippetDir: string;
  workspaceSnippetDir?: string;
  documents: SnippetManagerDocumentState[];
}

export class SnippetService {
  constructor(private readonly workspaceRoot?: string) {}

  async state(): Promise<SnippetManagerState> {
    const snippetDir = getSnippetDir();
    await fs.mkdir(snippetDir, { recursive: true });
    const activeProfile = normalizeProfileName(vscode.workspace.getConfiguration("hsnips").get<string>("profiles.activeProfile"));
    const workspaceSnippetDir = this.workspaceRoot ? getWorkspaceSnippetDir(this.workspaceRoot) : undefined;
    const documents = readSnippetDocuments(snippetDir, activeProfile, workspaceSnippetDir, this.workspaceRoot)
      .map((document: any) => ({
        filePath: document.filePath,
        fileName: path.basename(document.filePath),
        sourceScope: document.sourceScope || "base",
        profile: document.profile || "",
        workspaceFolder: document.workspaceFolder || "",
        language: document.language,
        content: document.content,
        hash: document.hash,
        mtimeMs: document.mtimeMs,
        diagnostics: document.diagnostics || [],
        snippets: document.snippets || []
      }));
    return {
      activeProfile,
      profiles: discoverSnippetProfiles(snippetDir),
      snippetDir,
      workspaceSnippetDir,
      documents
    };
  }

  async analyze(filePath: string, content: string): Promise<SnippetManagerDocumentState> {
    await this.assertAllowed(filePath, true);
    const document = parseSnippetDocument(content, filePath, path.basename(filePath, ".hsnips"));
    return {
      filePath,
      fileName: path.basename(filePath),
      sourceScope: this.scopeFor(filePath),
      profile: this.profileFor(filePath),
      workspaceFolder: this.workspaceRoot || "",
      language: document.language,
      content: document.content,
      hash: document.hash,
      diagnostics: document.diagnostics,
      snippets: document.snippets
    };
  }

  async save(filePath: string, content: string, expectedHash?: string, expectedMtimeMs?: number): Promise<SnippetManagerState> {
    await this.assertAllowed(filePath, true);
    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && path.resolve(document.uri.fsPath) === path.resolve(filePath));
    if (openDocument?.isDirty) {
      throw new Error("The snippet file has unsaved changes in the editor. Save or discard them before using the manager.");
    }
    const currentStat = await fs.stat(filePath);
    if (expectedMtimeMs !== undefined && Math.abs(currentStat.mtimeMs - expectedMtimeMs) > 1) {
      throw new Error("The snippet file timestamp changed on disk. Reload the manager before saving.");
    }
    const current = await fs.readFile(filePath, "utf8");
    assertExpectedSnippetDocumentHash(current, expectedHash);
    await this.atomicWrite(filePath, content);
    await vscode.commands.executeCommand("hsnips.reloadSnippets");
    return this.state();
  }

  async create(language: string, scope: "base" | "profile" | "workspace"): Promise<SnippetManagerState> {
    if (!/^[a-z0-9_-]+$/i.test(language)) throw new Error("Snippet language must contain only letters, digits, underscores, or hyphens.");
    const snippetDir = getSnippetDir();
    const activeProfile = normalizeProfileName(vscode.workspace.getConfiguration("hsnips").get<string>("profiles.activeProfile"));
    let directory = snippetDir;
    if (scope === "profile") {
      if (!activeProfile) throw new Error("Select an active snippet profile before creating a profile file.");
      directory = path.join(getProfilesDir(snippetDir), activeProfile);
    } else if (scope === "workspace") {
      if (!this.workspaceRoot) throw new Error("Open a local workspace before creating workspace snippets.");
      directory = getWorkspaceSnippetDir(this.workspaceRoot);
    }
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${language.toLowerCase()}.hsnips`);
    await this.assertAllowed(filePath, false);
    try {
      await fs.writeFile(filePath, "", { encoding: "utf8", flag: "wx" });
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }
    await vscode.commands.executeCommand("hsnips.reloadSnippets");
    return this.state();
  }

  async openSource(filePath: string, line = 1): Promise<void> {
    await this.assertAllowed(filePath, true);
    const document = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }

  private allowedRoots(): string[] {
    const snippetDir = path.resolve(getSnippetDir());
    return this.workspaceRoot
      ? [snippetDir, path.resolve(getWorkspaceSnippetDir(this.workspaceRoot))]
      : [snippetDir];
  }

  private async assertAllowed(filePath: string, mustExist: boolean): Promise<void> {
    await assertSnippetPathAllowed(filePath, this.allowedRoots(), mustExist);
  }

  private scopeFor(filePath: string): "base" | "profile" | "workspace" {
    if (this.workspaceRoot && path.resolve(filePath).startsWith(`${path.resolve(getWorkspaceSnippetDir(this.workspaceRoot))}${path.sep}`)) return "workspace";
    if (path.resolve(filePath).startsWith(`${path.resolve(getProfilesDir(getSnippetDir()))}${path.sep}`)) return "profile";
    return "base";
  }

  private profileFor(filePath: string): string {
    if (this.scopeFor(filePath) !== "profile") return "";
    return path.relative(getProfilesDir(getSnippetDir()), filePath).split(path.sep)[0] || "";
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const temp = `${filePath}.toolkit-${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, filePath);
  }
}
