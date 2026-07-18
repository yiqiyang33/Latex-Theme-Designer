export type ToolkitSection = "style" | "build" | "document" | "colors" | "setup" | "structure" | "diagnostics" | "snippets" | "sync";
export type StructureTask = "split" | "renumber" | "unsplit";

export interface ToolkitWebviewUiState {
  version: 4;
  workspaces: Record<string, {
    activeSection: ToolkitSection;
    activeStructureTask: StructureTask;
    selectedSnippetFile?: string;
    snippetSearch?: string;
    selectedRemoteProjectId?: string;
    selectedSyncPath?: string;
  }>;
}

export const TOOLKIT_SECTIONS: ToolkitSection[] = ["style", "build", "document", "colors", "setup", "structure", "snippets", "sync", "diagnostics"];
export const STRUCTURE_TASKS: StructureTask[] = ["split", "renumber", "unsplit"];

export function readWorkspaceUiState(value: unknown, workspaceKey: string): {
  activeSection: ToolkitSection;
  activeStructureTask: StructureTask;
  selectedSnippetFile?: string;
  snippetSearch?: string;
  selectedRemoteProjectId?: string;
  selectedSyncPath?: string;
} {
  const root = record(value);
  const workspaces = record(root?.workspaces);
  const workspace = record(workspaces?.[workspaceKey]);
  const activeSection = TOOLKIT_SECTIONS.includes(workspace?.activeSection as ToolkitSection)
    ? workspace?.activeSection as ToolkitSection
    : "style";
  const activeStructureTask = (root?.version === 2 || root?.version === 3 || root?.version === 4) && STRUCTURE_TASKS.includes(workspace?.activeStructureTask as StructureTask)
    ? workspace?.activeStructureTask as StructureTask
    : "split";
  const selectedSnippetFile = typeof workspace?.selectedSnippetFile === "string" ? workspace.selectedSnippetFile : undefined;
  const snippetSearch = typeof workspace?.snippetSearch === "string" ? workspace.snippetSearch : undefined;
  const selectedRemoteProjectId = typeof workspace?.selectedRemoteProjectId === "string" ? workspace.selectedRemoteProjectId : undefined;
  const selectedSyncPath = typeof workspace?.selectedSyncPath === "string" ? workspace.selectedSyncPath : undefined;
  const result: {
    activeSection: ToolkitSection;
    activeStructureTask: StructureTask;
    selectedSnippetFile?: string;
    snippetSearch?: string;
    selectedRemoteProjectId?: string;
    selectedSyncPath?: string;
  } = { activeSection, activeStructureTask };
  if (selectedSnippetFile !== undefined) result.selectedSnippetFile = selectedSnippetFile;
  if (snippetSearch !== undefined) result.snippetSearch = snippetSearch;
  if (selectedRemoteProjectId !== undefined) result.selectedRemoteProjectId = selectedRemoteProjectId;
  if (selectedSyncPath !== undefined) result.selectedSyncPath = selectedSyncPath;
  return result;
}

export function updateWorkspaceUiState(
  value: unknown,
  workspaceKey: string,
  activeSection: ToolkitSection,
  activeStructureTask: StructureTask,
  snippets: { selectedSnippetFile?: string; snippetSearch?: string; selectedRemoteProjectId?: string; selectedSyncPath?: string } = {}
): ToolkitWebviewUiState {
  const root = record(value);
  const existing = record(root?.workspaces);
  const workspaces: ToolkitWebviewUiState["workspaces"] = {};
  for (const [key, raw] of Object.entries(existing || {})) {
    const normalized = readWorkspaceUiState(value, key);
    workspaces[key] = normalized;
  }
  workspaces[workspaceKey] = { activeSection, activeStructureTask, ...snippets };
  return { version: 4, workspaces };
}

function record(value: unknown): Record<string, any> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, any> : undefined;
}
