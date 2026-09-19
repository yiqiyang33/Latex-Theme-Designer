/**
 * Minimal stand-in for the `vscode` module so the Overleaf realtime sync engine can be unit
 * tested. Only the surface `src/overleaf/realtimeSync.ts` actually touches is implemented; the
 * rest throws or returns inert values so an accidental new dependency shows up as a test failure
 * rather than a silent no-op.
 *
 * Wired up by the `vscode` alias in vitest.config.ts.
 */

export class Disposable {
  constructor(private readonly onDispose: () => void = () => undefined) {}
  dispose(): void {
    this.onDispose();
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  readonly event = (listener: (value: T) => void, thisArg?: unknown, disposables?: Disposable[]): Disposable => {
    const bound = thisArg ? listener.bind(thisArg) : listener;
    this.listeners.add(bound);
    const disposable = new Disposable(() => this.listeners.delete(bound));
    disposables?.push(disposable);
    return disposable;
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  private constructor(public readonly fsPath: string) {}
  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }
  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export class Range {
  constructor(
    public readonly startLine: number,
    public readonly startCharacter: number,
    public readonly endLine: number,
    public readonly endCharacter: number
  ) {}
}

export class Selection extends Range {}

export class RelativePattern {
  constructor(public readonly base: string, public readonly pattern: string) {}
}

export class MarkdownString {
  constructor(public value = '') {}
  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }
}

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 } as const;
export const DecorationRangeBehavior = { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 } as const;
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

export interface StatusBarItemMock {
  command?: string;
  text: string;
  tooltip?: unknown;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface OutputChannelMock {
  readonly lines: string[];
  appendLine(value: string): void;
  append(value: string): void;
  clear(): void;
  show(): void;
  dispose(): void;
}

export function createOutputChannelMock(): OutputChannelMock {
  const lines: string[] = [];
  return {
    lines,
    appendLine: (value: string) => void lines.push(value),
    append: (value: string) => void lines.push(value),
    clear: () => void lines.splice(0, lines.length),
    show: () => undefined,
    dispose: () => undefined
  };
}

/** Values tests can assert on or override between cases. */
export const testState = {
  configuration: new Map<string, Record<string, unknown>>(),
  shownErrors: [] as string[],
  shownWarnings: [] as string[],
  shownInformation: [] as string[],
  createdWatchers: [] as Array<{ pattern: RelativePattern; disposed: boolean }>
};

export function resetTestState(): void {
  testState.configuration.clear();
  testState.shownErrors.length = 0;
  testState.shownWarnings.length = 0;
  testState.shownInformation.length = 0;
  testState.createdWatchers.length = 0;
}

function createStatusBarItem(): StatusBarItemMock {
  return {
    text: '',
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined
  };
}

export const window = {
  createOutputChannel: (_name: string) => createOutputChannelMock(),
  createStatusBarItem: (_alignment?: number, _priority?: number) => createStatusBarItem(),
  createTextEditorDecorationType: (_options: unknown) => ({ dispose: () => undefined }),
  onDidChangeTextEditorSelection: (_listener: unknown) => new Disposable(),
  onDidChangeVisibleTextEditors: (_listener: unknown) => new Disposable(),
  showErrorMessage: (message: string) => {
    testState.shownErrors.push(message);
    return Promise.resolve(undefined);
  },
  showWarningMessage: (message: string) => {
    testState.shownWarnings.push(message);
    return Promise.resolve(undefined);
  },
  showInformationMessage: (message: string) => {
    testState.shownInformation.push(message);
    return Promise.resolve(undefined);
  },
  showQuickPick: (_items: unknown) => Promise.resolve(undefined),
  showTextDocument: (_document: unknown) => Promise.resolve(undefined),
  visibleTextEditors: [] as unknown[]
};

export const workspace = {
  createFileSystemWatcher: (pattern: RelativePattern) => {
    const entry = { pattern, disposed: false };
    testState.createdWatchers.push(entry);
    return {
      onDidCreate: (_l: unknown, _t?: unknown, disposables?: Disposable[]) => {
        const d = new Disposable();
        disposables?.push(d);
        return d;
      },
      onDidChange: (_l: unknown, _t?: unknown, disposables?: Disposable[]) => {
        const d = new Disposable();
        disposables?.push(d);
        return d;
      },
      onDidDelete: (_l: unknown, _t?: unknown, disposables?: Disposable[]) => {
        const d = new Disposable();
        disposables?.push(d);
        return d;
      },
      dispose: () => {
        entry.disposed = true;
      }
    };
  },
  getConfiguration: (section: string) => ({
    get: <T>(key: string, fallback?: T): T | undefined =>
      (testState.configuration.get(section)?.[key] as T | undefined) ?? fallback,
    has: (key: string) => testState.configuration.get(section)?.[key] !== undefined,
    inspect: () => undefined,
    update: () => Promise.resolve()
  }),
  onDidRenameFiles: (_listener: unknown) => new Disposable(),
  openTextDocument: (_uri: unknown) => Promise.resolve(undefined),
  textDocuments: [] as unknown[],
  workspaceFolders: undefined as unknown
};

export const commands = {
  executeCommand: (_command: string, ..._args: unknown[]) => Promise.resolve(undefined)
};

export const languages = {
  createDiagnosticCollection: (name?: string) => ({
    name,
    set: () => undefined,
    clear: () => undefined,
    dispose: () => undefined
  })
};

/** Minimal ExtensionContext: only `subscriptions` is used by the sync engine. */
export function createExtensionContextMock(): { subscriptions: Array<{ dispose(): void }> } {
  return { subscriptions: [] };
}

export default {
  Disposable,
  EventEmitter,
  Uri,
  Range,
  Selection,
  RelativePattern,
  MarkdownString,
  StatusBarAlignment,
  OverviewRulerLane,
  DecorationRangeBehavior,
  DiagnosticSeverity,
  window,
  workspace,
  commands,
  languages
};
