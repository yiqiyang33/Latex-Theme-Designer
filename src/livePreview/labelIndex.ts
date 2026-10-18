import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { expandOutDir, parseAux, type LabelInfo, type RootHint } from './references';

const RELOAD_DELAY_MS = 300;
/** How deep \@input chains are followed, which also stops cycles. */
const MAX_INPUT_DEPTH = 8;

interface DocumentRoot {
  hint: string;
  /** Aux file of the document's root, once found, even before a compile writes it. */
  aux?: string;
}

/**
 * The labels of each document's root, read from the aux file its last compile wrote and read again
 * whenever a compile rewrites it.
 */
export class LabelIndex implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when labels are read, so what shows them can refresh. */
  readonly onDidChange = this.changed.event;
  /** Changes whenever any labels do. */
  generation = 0;
  private readonly roots = new Map<string, DocumentRoot>();
  private readonly labels = new Map<string, Map<string, LabelInfo>>();
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly reloadTimers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly output: vscode.OutputChannel) {
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('latex-workshop.latex.outDir')
        || event.affectsConfiguration('latex-workshop.latex.search.rootFiles.include')) {
        this.roots.clear();
        this.bump();
      }
    }));
  }

  /** The labels of the document's root, once read; undefined before that and when nothing was compiled. */
  labelsFor(document: vscode.TextDocument, hint: RootHint): ReadonlyMap<string, LabelInfo> | undefined {
    if (document.uri.scheme !== 'file') return undefined;
    const key = document.uri.toString();
    const hintKey = JSON.stringify(hint);
    let root = this.roots.get(key);
    if (!root || root.hint !== hintKey) {
      root = { hint: hintKey };
      this.roots.set(key, root);
      void this.locate(document, hint, root);
    }
    return root.aux ? this.labels.get(root.aux) : undefined;
  }

  dispose(): void {
    for (const timer of this.reloadTimers.values()) clearTimeout(timer);
    for (const watcher of this.watchers.values()) watcher.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private async locate(document: vscode.TextDocument, hint: RootHint, root: DocumentRoot): Promise<void> {
    const rootFile = await this.findRoot(document, hint);
    const aux = rootFile && await this.findAux(rootFile);
    if (!aux || this.roots.get(document.uri.toString()) !== root) return;
    root.aux = aux;
    this.watch(aux);
    if (!this.labels.has(aux)) await this.load(aux);
    this.bump();
  }

  /**
   * The root, in the order LaTeX Workshop looks for it: a root the document names, the document
   * itself, the roots the workspace lists, then main.tex at the top of the workspace.
   */
  private async findRoot(document: vscode.TextDocument, hint: RootHint): Promise<string | undefined> {
    const documentDir = path.dirname(document.uri.fsPath);
    if (hint.root) {
      const named = path.resolve(documentDir, hint.root);
      for (const candidate of [named, `${named}.tex`]) if (await isFile(candidate)) return candidate;
    }
    if (hint.isRoot) return document.uri.fsPath;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    if (!folder) return undefined;
    const listed = vscode.workspace.getConfiguration('latex-workshop', document.uri)
      .get<string[]>('latex.search.rootFiles.include', []);
    // Only plain paths: globs such as the default **/*.tex do not single out one root.
    for (const entry of listed.filter(entry => !/[*?[\]{}]/.test(entry))) {
      const candidate = path.resolve(folder, entry);
      if (await isFile(candidate)) return candidate;
    }
    const main = path.join(folder, 'main.tex');
    return await isFile(main) ? main : undefined;
  }

  /** The root's aux file in LaTeX Workshop's output folder, else beside the root. */
  private async findAux(rootFile: string): Promise<string | undefined> {
    const rootDir = path.dirname(rootFile);
    const name = `${path.basename(rootFile, path.extname(rootFile))}.aux`;
    const uri = vscode.Uri.file(rootFile);
    const setting = vscode.workspace.getConfiguration('latex-workshop', uri).get<string>('latex.outDir', '%DIR%');
    const outDir = expandOutDir(setting, { rootDir, workspaceFolder: vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath });
    const candidates = [...new Set([outDir, rootDir].filter((dir): dir is string => !!dir).map(dir => path.join(dir, name)))];
    for (const candidate of candidates) if (await isFile(candidate)) return candidate;
    // Not compiled yet: watch where the output folder will receive it.
    for (const candidate of candidates) if (await isDirectory(path.dirname(candidate))) return candidate;
    return undefined;
  }

  /** LaTeX rewrites the root's aux file on every run, so watching it alone catches every compile. */
  private watch(aux: string): void {
    if (this.watchers.has(aux)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(aux)), path.basename(aux)));
    const reload = () => {
      clearTimeout(this.reloadTimers.get(aux));
      this.reloadTimers.set(aux, setTimeout(() => {
        this.reloadTimers.delete(aux);
        void this.load(aux).then(() => this.bump());
      }, RELOAD_DELAY_MS));
    };
    watcher.onDidCreate(reload);
    watcher.onDidChange(reload);
    watcher.onDidDelete(reload);
    this.watchers.set(aux, watcher);
  }

  /** Reads the aux file and those of \include'd parts, which a compile writes beside it. */
  private async load(aux: string): Promise<void> {
    const labels = new Map<string, LabelInfo>();
    const read = async (file: string, depth: number): Promise<boolean> => {
      const text = await fs.readFile(file, 'utf8').catch(() => undefined);
      if (text === undefined) return false;
      const parsed = parseAux(text);
      for (const [key, label] of parsed.labels) labels.set(key, label);
      if (depth < MAX_INPUT_DEPTH) {
        for (const input of parsed.inputs) await read(path.resolve(path.dirname(aux), input), depth + 1);
      }
      return true;
    };
    if (await read(aux, 0)) {
      this.labels.set(aux, labels);
      this.output.appendLine(`[${new Date().toISOString()}] Live preview read ${labels.size} labels from ${aux}.`);
    } else {
      this.labels.delete(aux);
    }
  }

  private bump(): void {
    this.generation += 1;
    this.changed.fire();
  }
}

async function isFile(file: string): Promise<boolean> {
  return fs.stat(file).then(stat => stat.isFile(), () => false);
}

async function isDirectory(dir: string): Promise<boolean> {
  return fs.stat(dir).then(stat => stat.isDirectory(), () => false);
}
