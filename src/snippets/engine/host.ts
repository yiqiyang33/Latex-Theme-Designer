import * as vscode from 'vscode';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { openExplorer } from './openFileExplorer';
import { HSnippet } from './hsnippet';
import { HSnippetInstance } from './hsnippetInstance';
import { parse } from './parser';
import { getSnippetDir } from './utils';
import { getAutomaticCompletion, getCompletions, CompletionInfo } from './completion';
import {
    getLatexContext,
    getSmartEnterPlan,
    getSmartEnterRecoveryPlan,
    shouldInsertAlignmentSeparator,
    LatexContextOptions,
    TextEdit,
} from './latexEdit';
import {
    CONVERTIBLE_ENVIRONMENTS,
    WRAPPABLE_MATH_ENVIRONMENTS,
    conversionNeedsTableArguments,
    createEnvironmentNameOnlyRenamePlan,
    createEnvironmentNameSyncPlan,
    createEnvironmentConversionPlan,
    createUnwrapMathStructurePlan,
    createWrapCurrentMathStructurePlan,
    createWrapEnvironmentPlan,
    findDisplayMathDelimiterAt,
    findLatexEnvironmentPairAt,
    formatTableArguments,
    isValidEnvironmentName,
    isTableLikeEnvironment,
    SingleTextChange,
} from './environmentConvert';
import {
    discoverSnippetProfiles,
    ensureProfileDir,
    getSnippetFiles,
    getSnippetFilesForProfile,
    getWorkspaceSnippetDir,
    getWorkspaceSnippetFiles,
    SnippetFileEntry,
    normalizeProfileName,
} from './snippetProfiles';

const GLOBAL_SNIPPETS_BY_LANGUAGE: Map<string, HSnippet[]> = new Map();
const WORKSPACE_SNIPPETS_BY_FOLDER: Map<string, Map<string, HSnippet[]>> = new Map();
const SNIPPET_STACK: HSnippetInstance[] = [];

let insertingSnippet = false;
let applyingLatexEdit = false;
let latexContextCache:
    | {
        document: vscode.TextDocument;
        version: number;
        offset: number;
        optionsKey: string;
        context: ReturnType<typeof getLatexContext>;
    }
    | undefined;
let latexContextOptionsCache:
    | {
        options: LatexContextOptions;
        key: string;
    }
    | undefined;
const DOCUMENT_TEXT_CACHE = new WeakMap<vscode.TextDocument, string>();
let snippetOutput: vscode.OutputChannel | undefined;

function isLatexLikeDocument(document: vscode.TextDocument) {
    return ['latex', 'tex', 'markdown'].includes(document.languageId.toLowerCase());
}

function getStringArrayConfiguration(path: string) {
    let value = vscode.workspace.getConfiguration('hsnips').get<string[]>(path);
    return Array.isArray(value) ? value.filter((item) => typeof item == 'string') : [];
}

function getActiveSnippetProfile() {
    return normalizeProfileName(
        vscode.workspace.getConfiguration('hsnips').get<string>('profiles.activeProfile')
    );
}

function readLatexContextOptions(): LatexContextOptions {
    return {
        extraMathEnvironments: getStringArrayConfiguration('context.extraMathEnvironments'),
        extraRowBreakEnvironments: getStringArrayConfiguration('context.extraRowBreakEnvironments'),
        extraAlignmentEnvironments: getStringArrayConfiguration('context.extraAlignmentEnvironments'),
        extraTextLikeCommands: getStringArrayConfiguration('context.extraTextLikeCommands'),
    };
}

function getLatexContextOptionsState() {
    if (!latexContextOptionsCache) {
        let options = readLatexContextOptions();
        latexContextOptionsCache = {
            options,
            key: JSON.stringify(options),
        };
    }
    return latexContextOptionsCache;
}

function getLatexContextOptions(): LatexContextOptions {
    return getLatexContextOptionsState().options;
}

function getCachedLatexContext(document: vscode.TextDocument, position: vscode.Position) {
    if (!isLatexLikeDocument(document)) {
        return undefined;
    }

    let { options, key: optionsKey } = getLatexContextOptionsState();
    let offset = document.offsetAt(position);
    if (
        latexContextCache &&
        latexContextCache.document == document &&
        latexContextCache.version == document.version &&
        latexContextCache.offset == offset &&
        latexContextCache.optionsKey == optionsKey
    ) {
        return latexContextCache.context;
    }

    let context = getLatexContext(document.getText(), offset, options);
    latexContextCache = {
        document,
        version: document.version,
        offset,
        optionsKey,
        context,
    };
    return context;
}

function updateMathContext(editor: vscode.TextEditor | undefined) {
    let inLatexMath = false;
    let canSmartEnter = false;
    let canSmartTab = false;

    if (editor) {
        let context = getCachedLatexContext(editor.document, editor.selection.active);
        if (context) {
            inLatexMath = context.inMath;
            canSmartEnter = context.canSmartEnter;
            canSmartTab = context.canSmartTab;
        }
    }

    vscode.commands.executeCommand('setContext', 'hsnips.inLatexMath', inLatexMath);
    vscode.commands.executeCommand('setContext', 'hsnips.canSmartEnter', canSmartEnter);
    vscode.commands.executeCommand('setContext', 'hsnips.canSmartTab', canSmartTab);
    vscode.commands.executeCommand('setContext', 'hsnips.canInsertAlignmentSeparator', canSmartTab);
}

async function typeText(text: string) {
    await vscode.commands.executeCommand('type', { text });
}

async function applyEdits(editor: vscode.TextEditor, edits: TextEdit[]) {
    applyingLatexEdit = true;
    try {
        return await editor.edit((editBuilder) => {
            for (let edit of edits) {
                editBuilder.replace(
                    new vscode.Range(
                        editor.document.positionAt(edit.start),
                        editor.document.positionAt(edit.end)
                    ),
                    edit.text
                );
            }
        });
    } finally {
        applyingLatexEdit = false;
    }
}

async function smartEnter(editor: vscode.TextEditor) {
    if (editor.selections.length != 1 || !editor.selection.isEmpty) {
        await typeText('\n');
        return;
    }

    let text = editor.document.getText();
    let offset = editor.document.offsetAt(editor.selection.active);
    let plan = getSmartEnterPlan(text, offset, getLatexContextOptions());

    if (!plan.handled) {
        await typeText('\n');
        return;
    }

    let inserted = await applyEdits(editor, plan.edits);
    if (inserted) {
        let newPosition = editor.document.positionAt(plan.cursorOffset as number);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
    }
}

function isPlainEnterChange(change: vscode.TextDocumentContentChangeEvent) {
    return change.rangeLength == 0 && /^\r?\n[ \t]*$/.test(change.text);
}

async function recoverSmartEnterAfterPlainEnter(
    editor: vscode.TextEditor,
    change: vscode.TextDocumentContentChangeEvent
) {
    if (applyingLatexEdit || !isPlainEnterChange(change)) {
        return false;
    }

    let currentText = editor.document.getText();
    let beforeEnterText = (
        currentText.slice(0, change.rangeOffset) +
        currentText.slice(change.rangeOffset + change.text.length)
    );
    let plan = getSmartEnterRecoveryPlan(
        beforeEnterText,
        change.rangeOffset,
        currentText,
        getLatexContextOptions()
    );

    if (!plan.handled) {
        return false;
    }

    let inserted = await applyEdits(editor, plan.edits);
    if (inserted && typeof plan.cursorOffset == 'number') {
        let newPosition = editor.document.positionAt(plan.cursorOffset);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
    }

    return inserted;
}

function getTextBeforeChange(currentText: string, change: vscode.TextDocumentContentChangeEvent) {
    return (
        currentText.slice(0, change.rangeOffset) +
        currentText.slice(change.rangeOffset + change.text.length)
    );
}

async function recoverEnvironmentNameSyncAfterChange(
    editor: vscode.TextEditor,
    change: vscode.TextDocumentContentChangeEvent,
    beforeText: string,
    currentText: string
) {
    if (applyingLatexEdit || !isLatexLikeDocument(editor.document)) {
        return false;
    }

    let plan = createEnvironmentNameSyncPlan(
        beforeText,
        currentText,
        {
            rangeOffset: change.rangeOffset,
            rangeLength: change.rangeLength,
            text: change.text,
        },
        getLatexContextOptions()
    );

    if (!plan.handled) {
        return false;
    }

    applyingLatexEdit = true;
    try {
        return await editor.edit(
            (editBuilder) => {
                for (let edit of plan.edits) {
                    editBuilder.replace(
                        new vscode.Range(
                            editor.document.positionAt(edit.start),
                            editor.document.positionAt(edit.end)
                        ),
                        edit.text
                    );
                }
            },
            { undoStopBefore: false, undoStopAfter: false }
        );
    } finally {
        applyingLatexEdit = false;
    }
}

async function nextSnippetPlaceholder() {
    if (SNIPPET_STACK[0] && !SNIPPET_STACK[0].nextPlaceholder()) {
        SNIPPET_STACK.shift();
    }
    await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder');
}

async function fallbackTab() {
    if (SNIPPET_STACK.length) {
        await nextSnippetPlaceholder();
        return;
    }

    try {
        await vscode.commands.executeCommand('editor.action.insertTab');
    } catch {
        await typeText('\t');
    }
}

async function smartTab(editor: vscode.TextEditor) {
    let text = editor.document.getText();
    let options = getLatexContextOptions();
    let shouldInsertSeparator = editor.selections.every((selection) => {
        return shouldInsertAlignmentSeparator(text, editor.document.offsetAt(selection.active), options);
    });

    if (!shouldInsertSeparator) {
        await fallbackTab();
        return;
    }

    await editor.edit((editBuilder) => {
        for (let selection of editor.selections) {
            editBuilder.replace(selection, ' & ');
        }
    });
}

async function convertEnvironment(editor: vscode.TextEditor) {
    let text = editor.document.getText();
    let options = getLatexContextOptions();
    let selection = editor.selection;
    let offset = editor.document.offsetAt(selection.active);
    let selectionStart = editor.document.offsetAt(selection.start);
    let selectionEnd = editor.document.offsetAt(selection.end);
    let environmentPair = findLatexEnvironmentPairAt(text, offset, options);
    let delimiterPair = findDisplayMathDelimiterAt(text, offset);
    let currentName = environmentPair?.name;
    let target = await vscode.window.showQuickPick(
        CONVERTIBLE_ENVIRONMENTS
            .filter((environment) => environment != currentName)
            .map((environment) => ({
                label: environment,
                description: isTableLikeEnvironment(environment) ? 'table-like environment' : 'math environment',
            })),
        {
            placeHolder: currentName
                ? `Convert ${currentName} to...`
                : selection.isEmpty
                    ? 'Convert display math to...'
                    : 'Wrap selection with...',
        }
    );

    if (!target) {
        return;
    }

    let targetArguments = '';
    if (isTableLikeEnvironment(target.label)) {
        let needsArguments = !environmentPair || conversionNeedsTableArguments(text, offset, target.label);
        if (needsArguments) {
            let columnSpec = await vscode.window.showInputBox({
                prompt: `Column specification for ${target.label}`,
                value: 'c',
                ignoreFocusOut: true,
            });
            if (columnSpec === undefined) {
                return;
            }
            targetArguments = formatTableArguments(target.label, columnSpec);
        }
    }

    let plan = !selection.isEmpty && !environmentPair && !delimiterPair
        ? createWrapEnvironmentPlan(text, selectionStart, selectionEnd, target.label, targetArguments)
        : createEnvironmentConversionPlan(text, offset, target.label, targetArguments, options);

    if (!plan.handled) {
        vscode.window.showInformationMessage('No LaTeX environment or display math delimiter found at the cursor.');
        return;
    }

    let inserted = await applyEdits(editor, plan.edits);
    if (inserted && typeof plan.cursorOffset == 'number') {
        let newPosition = editor.document.positionAt(plan.cursorOffset);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
    }
}

async function renameMatchingEnvironment(editor: vscode.TextEditor) {
    let text = editor.document.getText();
    let offset = editor.document.offsetAt(editor.selection.active);
    let pair = findLatexEnvironmentPairAt(text, offset, getLatexContextOptions());
    if (!pair) {
        vscode.window.showInformationMessage('No LaTeX environment found at the cursor.');
        return;
    }

    let targetName = await vscode.window.showInputBox({
        prompt: `Rename matching \\begin/\\end for ${pair.name}`,
        value: pair.name,
        ignoreFocusOut: true,
        validateInput(value) {
            return isValidEnvironmentName(value.trim()) ? undefined : 'Environment name cannot be empty or contain braces/whitespace.';
        },
    });
    if (targetName === undefined) {
        return;
    }

    let plan = createEnvironmentNameOnlyRenamePlan(pair, targetName);
    if (!plan.handled) {
        return;
    }

    let inserted = await applyEdits(editor, plan.edits);
    if (inserted && typeof plan.cursorOffset == 'number') {
        let newPosition = editor.document.positionAt(plan.cursorOffset);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
    }
}

async function pickMathStructureTarget() {
    let target = await vscode.window.showQuickPick(
        WRAPPABLE_MATH_ENVIRONMENTS.map((environment) => ({
            label: environment,
            description: isTableLikeEnvironment(environment) ? 'matrix/table-like environment' : 'math environment',
        })),
        { placeHolder: 'Wrap with...' }
    );
    return target?.label;
}

async function getTargetArgumentsIfNeeded(targetName: string) {
    if (!isTableLikeEnvironment(targetName)) {
        return '';
    }

    let columnSpec = await vscode.window.showInputBox({
        prompt: `Column specification for ${targetName}`,
        value: 'c',
        ignoreFocusOut: true,
    });
    if (columnSpec === undefined) {
        return undefined;
    }
    return formatTableArguments(targetName, columnSpec);
}

async function wrapMathStructure(editor: vscode.TextEditor) {
    let targetName = await pickMathStructureTarget();
    if (!targetName) {
        return;
    }

    let targetArguments = await getTargetArgumentsIfNeeded(targetName);
    if (targetArguments === undefined) {
        return;
    }

    let text = editor.document.getText();
    let selection = editor.selection;
    let selectionStart = editor.document.offsetAt(selection.start);
    let selectionEnd = editor.document.offsetAt(selection.end);
    let plan = !selection.isEmpty
        ? createWrapEnvironmentPlan(text, selectionStart, selectionEnd, targetName, targetArguments)
        : createWrapCurrentMathStructurePlan(
            text,
            editor.document.offsetAt(selection.active),
            targetName,
            targetArguments,
            getLatexContextOptions()
        );

    if (!plan.handled) {
        vscode.window.showInformationMessage('Select text or place the cursor inside a math structure to wrap.');
        return;
    }

    let inserted = await applyEdits(editor, plan.edits);
    if (inserted && typeof plan.cursorOffset == 'number') {
        let newPosition = editor.document.positionAt(plan.cursorOffset);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
    }
}

async function unwrapMathStructure(editor: vscode.TextEditor) {
    let text = editor.document.getText();
    let plan = createUnwrapMathStructurePlan(
        text,
        editor.document.offsetAt(editor.selection.active),
        getLatexContextOptions()
    );

    if (!plan.handled) {
        vscode.window.showInformationMessage('No supported math structure found at the cursor.');
        return;
    }

    let inserted = await applyEdits(editor, plan.edits);
    if (inserted && typeof plan.cursorOffset == 'number') {
        let newPosition = editor.document.positionAt(plan.cursorOffset);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition));
    }
}

function reportSnippetLoadErrors(errors: string[]) {
    if (!errors.length) {
        return;
    }

    for (let error of errors) snippetOutput?.appendLine(`[${new Date().toISOString()}] SNIPPET PARSE ${error}`);
    snippetOutput?.appendLine(`Skipped ${errors.length} snippet file${errors.length == 1 ? '' : 's'}; the Snippets inspector remains available.`);
    snippetOutput?.appendLine('');
}

function readSnippetMap(entries: SnippetFileEntry[]) {
    let snippetsByLanguage: Map<string, HSnippet[]> = new Map();
    let errors: string[] = [];

    for (let entry of entries) {
        try {
            let fileData = readFileSync(entry.filePath, 'utf8');
            let snippetList = snippetsByLanguage.get(entry.language);
            if (!snippetList) {
                snippetList = [];
                snippetsByLanguage.set(entry.language, snippetList);
            }
            snippetList.push(...parse(fileData));
        } catch (error) {
            let message = error instanceof Error ? error.message : String(error);
            errors.push(`${entry.filePath}: ${message}`);
        }
    }

    return { snippetsByLanguage, errors };
}

async function loadSnippets() {
    GLOBAL_SNIPPETS_BY_LANGUAGE.clear();
    WORKSPACE_SNIPPETS_BY_FOLDER.clear();

    let snippetDir = getSnippetDir();
    if (!existsSync(snippetDir)) {
        mkdirSync(snippetDir, { recursive: true });
    }

    let { snippetsByLanguage, errors } = readSnippetMap(
        getSnippetFilesForProfile(snippetDir, getActiveSnippetProfile())
    );
    for (let [language, snippets] of snippetsByLanguage.entries()) {
        GLOBAL_SNIPPETS_BY_LANGUAGE.set(language, snippets);
    }
    reportSnippetLoadErrors(errors);
}

function getWorkspaceFolderForDocument(document: vscode.TextDocument) {
    if (document.uri.scheme != 'file') {
        return undefined;
    }
    return vscode.workspace.getWorkspaceFolder(document.uri);
}

function loadWorkspaceSnippets(workspaceFolder: vscode.WorkspaceFolder) {
    let key = workspaceFolder.uri.fsPath;
    let cached = WORKSPACE_SNIPPETS_BY_FOLDER.get(key);
    if (cached) {
        return cached;
    }

    let { snippetsByLanguage, errors } = readSnippetMap(getWorkspaceSnippetFiles(key));
    WORKSPACE_SNIPPETS_BY_FOLDER.set(key, snippetsByLanguage);
    reportSnippetLoadErrors(errors);
    return snippetsByLanguage;
}

function appendSnippetsForLanguage(
    target: HSnippet[],
    snippetsByLanguage: Map<string, HSnippet[]>,
    language: string
) {
    let languageSnippets = snippetsByLanguage.get(language);
    if (languageSnippets) {
        target.push(...languageSnippets);
    }

    if (language != 'all') {
        let globalSnippets = snippetsByLanguage.get('all');
        if (globalSnippets) {
            target.push(...globalSnippets);
        }
    }
}

function getSnippetsForDocument(document: vscode.TextDocument) {
    let language = document.languageId.toLowerCase();
    let snippets: HSnippet[] = [];
    appendSnippetsForLanguage(snippets, GLOBAL_SNIPPETS_BY_LANGUAGE, language);

    let workspaceFolder = getWorkspaceFolderForDocument(document);
    if (workspaceFolder) {
        appendSnippetsForLanguage(snippets, loadWorkspaceSnippets(workspaceFolder), language);
    }

    snippets.sort((a, b) => b.priority - a.priority);
    return snippets.length ? snippets : undefined;
}

function getActiveWorkspaceFolder() {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        let workspaceFolder = getWorkspaceFolderForDocument(editor.document);
        if (workspaceFolder) {
            return workspaceFolder;
        }
    }
    return vscode.workspace.workspaceFolders?.[0];
}

function getActiveWorkspaceSnippetDir() {
    let workspaceFolder = getActiveWorkspaceFolder();
    return workspaceFolder ? getWorkspaceSnippetDir(workspaceFolder.uri.fsPath) : undefined;
}

function getWorkspaceSnippetLanguageChoices(workspaceFolder: vscode.WorkspaceFolder) {
    let activeLanguage = vscode.window.activeTextEditor?.document.languageId.toLowerCase();
    let languages = new Set(['latex', 'tex', 'all']);

    for (let entry of getWorkspaceSnippetFiles(workspaceFolder.uri.fsPath)) {
        languages.add(entry.language);
    }

    if (activeLanguage && activeLanguage != 'hsnips' && activeLanguage != 'plaintext') {
        languages.add(activeLanguage);
    }

    return [...languages];
}

async function openWorkspaceSnippetFile() {
    let workspaceFolder = getActiveWorkspaceFolder();
    if (!workspaceFolder) {
        vscode.window.showInformationMessage('Open a workspace folder to create workspace snippets.');
        return;
    }

    let workspaceSnippetDir = getWorkspaceSnippetDir(workspaceFolder.uri.fsPath);
    mkdirSync(workspaceSnippetDir, { recursive: true });

    let picked = await vscode.window.showQuickPick(
        getWorkspaceSnippetLanguageChoices(workspaceFolder).map((language) => {
            let filePath = path.join(workspaceSnippetDir, `${language}.hsnips`);
            return {
                label: `${language}.hsnips`,
                description: existsSync(filePath) ? 'workspace' : 'create',
                detail: filePath,
                filePath,
            };
        }),
        { placeHolder: 'Create or open workspace snippet file' }
    );

    if (!picked) {
        return;
    }

    if (!existsSync(picked.filePath)) {
        writeFileSync(picked.filePath, '', 'utf8');
        WORKSPACE_SNIPPETS_BY_FOLDER.delete(workspaceFolder.uri.fsPath);
    }

    let document = await vscode.workspace.openTextDocument(picked.filePath);
    await vscode.window.showTextDocument(document);
}

async function selectSnippetProfile() {
    let snippetDir = getSnippetDir();
    if (!existsSync(snippetDir)) {
        mkdirSync(snippetDir, { recursive: true });
    }

    let activeProfile = getActiveSnippetProfile();
    let profiles = discoverSnippetProfiles(snippetDir);
    let picked = await vscode.window.showQuickPick(
        [
            {
                label: 'Base only',
                description: activeProfile ? undefined : 'current',
                profile: '',
            },
            ...profiles.map((profile) => ({
                label: profile,
                description: profile == activeProfile ? 'current' : undefined,
                profile,
            })),
        ],
        { placeHolder: 'Select active snippet profile' }
    );

    if (!picked) {
        return;
    }

    await vscode.workspace
        .getConfiguration('hsnips')
        .update('profiles.activeProfile', picked.profile, vscode.ConfigurationTarget.Global);
    await loadSnippets();
    vscode.window.showInformationMessage(
        picked.profile ? `LaTeX Toolkit snippet profile: ${picked.profile}` : "LaTeX Toolkit snippet profile: base only"
    );
}

async function openActiveSnippetProfile() {
    let snippetDir = getSnippetDir();
    let activeProfile = getActiveSnippetProfile();
    if (!activeProfile) {
        vscode.window.showInformationMessage('No active snippet profile selected. Opening the base snippets directory.');
        openExplorer(snippetDir);
        return;
    }

    openExplorer(ensureProfileDir(snippetDir, activeProfile));
}

// This function may be called after a snippet expansion, in which case the original text was
// replaced by the snippet label, or it may be called directly, as in the case of an automatic
// expansion. Depending on which case it is, we have to delete a different editor range before
// triggering the real hsnip expansion.
export async function expandSnippet(
    completion: CompletionInfo,
    editor: vscode.TextEditor,
    snippetExpansion = false
) {
    let snippetInstance = new HSnippetInstance(
        completion.snippet,
        editor,
        completion.range.start,
        completion.groups
    );

    let insertionRange: vscode.Range | vscode.Position = completion.range.start;

    // The separate deletion is a workaround for a VsCodeVim bug, where when we trigger a snippet which
    // has a replacement range, it will go into NORMAL mode, see issues #28 and #36.

    // TODO: Go back to inserting the snippet and removing in a single command once the VsCodeVim bug
    // is fixed.

    insertingSnippet = true;
    await editor.edit(
        (eb) => {
            eb.delete(snippetExpansion ? completion.completionRange : completion.range);
        },
        { undoStopAfter: false, undoStopBefore: !snippetExpansion }
    );

    await editor.insertSnippet(snippetInstance.snippetString, insertionRange, {
        undoStopAfter: false,
        undoStopBefore: false,
    });

    if (snippetInstance.selectedPlaceholder != 0) SNIPPET_STACK.unshift(snippetInstance);
    insertingSnippet = false;
}

function snippetCommandError(output: vscode.OutputChannel, commandId: string, error: unknown): void {
    let normalized = error instanceof Error ? error : new Error(String(error));
    output.appendLine(`[${new Date().toISOString()}] ERROR ${commandId}`);
    output.appendLine(`Workspace: ${vscode.window.activeTextEditor?.document.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '(no local workspace)'}`);
    output.appendLine(normalized.stack || normalized.message);
    output.appendLine('');
}

function snippetCommandCancelled(error: unknown): boolean {
    return error instanceof vscode.CancellationError || (error instanceof Error && /cancelled|canceled/i.test(error.message));
}

export function registerSnippetHost(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    snippetOutput = output;
    const guarded = <T extends unknown[]>(commandId: string, handler: (...args: T) => unknown) => async (...args: T) => {
        try {
            return await handler(...args);
        } catch (error) {
            if (snippetCommandCancelled(error)) return undefined;
            snippetCommandError(output, commandId, error);
            let action = await vscode.window.showErrorMessage(`LaTeX Editing Toolkit: ${error instanceof Error ? error.message : String(error)}`, 'Show Log');
            if (action == 'Show Log') output.show(true);
            return undefined;
        }
    };

    loadSnippets();
    if (vscode.window.activeTextEditor) {
        DOCUMENT_TEXT_CACHE.set(
            vscode.window.activeTextEditor.document,
            vscode.window.activeTextEditor.document.getText()
        );
    }
    updateMathContext(vscode.window.activeTextEditor);

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.openSnippetsDir', guarded('hsnips.openSnippetsDir', () => openExplorer(getSnippetDir())))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.openSnippetFile', guarded('hsnips.openSnippetFile', async () => {
            let snippetDir = getSnippetDir();
            if (!existsSync(snippetDir)) {
                mkdirSync(snippetDir, { recursive: true });
            }

            let files = getSnippetFiles(
                snippetDir,
                getActiveSnippetProfile(),
                getActiveWorkspaceSnippetDir(),
                getActiveWorkspaceFolder()?.uri.fsPath
            );
            let selectedFile = await vscode.window.showQuickPick(
                files.map((entry) => ({
                    label: path.basename(entry.filePath),
                    description: entry.scope == 'profile'
                        ? `profile:${entry.profile}`
                        : entry.scope,
                    detail: entry.filePath,
                    filePath: entry.filePath,
                })),
                { placeHolder: 'Open snippet file' }
            );

            if (selectedFile) {
                let document = await vscode.workspace.openTextDocument(selectedFile.filePath);
                vscode.window.showTextDocument(document);
            }
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.openWorkspaceSnippetsDir', guarded('hsnips.openWorkspaceSnippetsDir', () => {
            let workspaceSnippetDir = getActiveWorkspaceSnippetDir();
            if (!workspaceSnippetDir) {
                vscode.window.showInformationMessage('Open a workspace folder to use workspace snippets.');
                return;
            }
            mkdirSync(workspaceSnippetDir, { recursive: true });
            openExplorer(workspaceSnippetDir);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.openWorkspaceSnippetFile', guarded('hsnips.openWorkspaceSnippetFile', () => openWorkspaceSnippetFile()))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.reloadSnippets', guarded('hsnips.reloadSnippets', () => loadSnippets()))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.selectProfile', guarded('hsnips.selectProfile', () => selectSnippetProfile()))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.openActiveProfile', guarded('hsnips.openActiveProfile', () => openActiveSnippetProfile()))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.leaveSnippet', guarded('hsnips.leaveSnippet', () => {
            while (SNIPPET_STACK.length) SNIPPET_STACK.pop();
            vscode.commands.executeCommand('leaveSnippet');
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.nextPlaceholder', guarded('hsnips.nextPlaceholder', () => {
            return nextSnippetPlaceholder();
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hsnips.prevPlaceholder', guarded('hsnips.prevPlaceholder', () => {
            if (SNIPPET_STACK[0] && !SNIPPET_STACK[0].prevPlaceholder()) {
                SNIPPET_STACK.shift();
            }
            vscode.commands.executeCommand('jumpToPrevSnippetPlaceholder');
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.smartEnter', guarded('hsnips.smartEnter', (editor: vscode.TextEditor) => {
            return smartEnter(editor);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.matrixTab', guarded('hsnips.matrixTab', (editor: vscode.TextEditor) => {
            return smartTab(editor);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.smartTab', guarded('hsnips.smartTab', (editor: vscode.TextEditor) => {
            return smartTab(editor);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.convertEnvironment', guarded('hsnips.convertEnvironment', (editor: vscode.TextEditor) => {
            return convertEnvironment(editor);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.renameMatchingEnvironment', guarded('hsnips.renameMatchingEnvironment', (editor: vscode.TextEditor) => {
            return renameMatchingEnvironment(editor);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.wrapMathStructure', guarded('hsnips.wrapMathStructure', (editor: vscode.TextEditor) => {
            return wrapMathStructure(editor);
        }))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hsnips.unwrapMathStructure', guarded('hsnips.unwrapMathStructure', (editor: vscode.TextEditor) => {
            return unwrapMathStructure(editor);
        }))
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId == 'hsnips') {
                loadSnippets();
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            WORKSPACE_SNIPPETS_BY_FOLDER.clear();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(
            'hsnips.expand',
            guarded('hsnips.expand', (editor: vscode.TextEditor, _: vscode.TextEditorEdit, completion: CompletionInfo) => {
                expandSnippet(completion, editor, true);
            })
        )
    );

    function getDocumentLatexContext(document: vscode.TextDocument, offset: number) {
        return getCachedLatexContext(document, document.positionAt(offset));
    }

    function getEditorLatexContext(editor: vscode.TextEditor, position = editor.selection.start) {
        return getDocumentLatexContext(editor.document, editor.document.offsetAt(position));
    }

    function canExpandSnippetInContext(
        snippet: HSnippet,
        latexContext: ReturnType<typeof getEditorLatexContext>
    ) {
        if (snippet.math) {
            return Boolean(latexContext?.canExpandMathSnippet);
        }
        if (snippet.text && latexContext?.inMath) {
            return false;
        }
        return true;
    }

    // Forward all document changes so that the active snippet can update its related blocks.
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            let previousText = DOCUMENT_TEXT_CACHE.get(e.document);
            let currentText = e.document.getText();
            let activeEditor = vscode.window.activeTextEditor;
            try {
                if (activeEditor && e.document == activeEditor.document) {
                    updateMathContext(activeEditor);
                }

                if (SNIPPET_STACK.length && SNIPPET_STACK[0].editor.document == e.document) {
                    SNIPPET_STACK[0].update(e.contentChanges);
                }

                if (insertingSnippet) return;

                let mainChange = e.contentChanges[0];

                if (!mainChange) return;

                if (
                    activeEditor &&
                    e.document == activeEditor.document &&
                    e.contentChanges.length == 1 &&
                    await recoverEnvironmentNameSyncAfterChange(
                        activeEditor,
                        mainChange,
                        previousText || getTextBeforeChange(currentText, mainChange),
                        currentText
                    )
                ) {
                    return;
                }

                if (activeEditor && e.document == activeEditor.document && isPlainEnterChange(mainChange)) {
                    void recoverSmartEnterAfterPlainEnter(activeEditor, mainChange).then(undefined, console.error);
                    return;
                }

                // Let's try to detect only events that come from keystrokes.
                if (mainChange.text.length != 1) return;

                let snippets = getSnippetsForDocument(e.document);
                if (!snippets) return;
                let editor = vscode.window.activeTextEditor;
                if (!editor || e.document != editor.document) return;

                let latexContext = getEditorLatexContext(editor);
                snippets = snippets.filter((snippet) => canExpandSnippetInContext(snippet, latexContext));

                let mainChangePosition = mainChange.range.start.translate(0, mainChange.text.length);
                let completion = getAutomaticCompletion(e.document, mainChangePosition, snippets);

                if (completion) {
                    expandSnippet(completion, editor);
                    return;
                }
            } finally {
                DOCUMENT_TEXT_CACHE.set(e.document, e.document.getText());
            }
        })
    );

    // Remove any stale snippet instances.
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(() => {
            while (SNIPPET_STACK.length) SNIPPET_STACK.pop();
            updateMathContext(vscode.window.activeTextEditor);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                DOCUMENT_TEXT_CACHE.set(editor.document, editor.document.getText());
            }
            updateMathContext(editor);
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((e) => {
            while (SNIPPET_STACK.length) {
                if (e.selections.some((s) => SNIPPET_STACK[0].range.contains(s))) {
                    break;
                }
                SNIPPET_STACK.shift();
            }
            updateMathContext(e.textEditor);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('hsnips.context')) {
                latexContextCache = undefined;
                latexContextOptionsCache = undefined;
                updateMathContext(vscode.window.activeTextEditor);
            }
            if (event.affectsConfiguration('hsnips.profiles.activeProfile')) {
                loadSnippets();
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider([{ scheme: 'untitled' }, { scheme: 'file' }], {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                let snippets = getSnippetsForDocument(document);
                if (!snippets) return;
                let editor = vscode.window.activeTextEditor;
                if (!editor || document != editor.document) return;
                let latexContext = getDocumentLatexContext(document, document.offsetAt(position));
                snippets = snippets.filter((snippet) => canExpandSnippetInContext(snippet, latexContext));

                let completions = getCompletions(document, position, snippets);
                if (completions && Array.isArray(completions)) {
                    return completions.map((c) => c.toCompletionItem());
                }
            },
        })
    );
}
