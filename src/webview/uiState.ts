export type ToolkitSection = "style" | "build" | "document" | "colors" | "setup" | "structure" | "diagnostics";
export type StructureTask = "split" | "renumber" | "unsplit";

export interface ToolkitWebviewUiState {
  version: 2;
  workspaces: Record<string, { activeSection: ToolkitSection; activeStructureTask: StructureTask }>;
}

export const TOOLKIT_SECTIONS: ToolkitSection[] = ["style", "build", "document", "colors", "setup", "structure", "diagnostics"];
export const STRUCTURE_TASKS: StructureTask[] = ["split", "renumber", "unsplit"];

export function readWorkspaceUiState(value: unknown, workspaceKey: string): { activeSection: ToolkitSection; activeStructureTask: StructureTask } {
  const root = record(value);
  const workspaces = record(root?.workspaces);
  const workspace = record(workspaces?.[workspaceKey]);
  const activeSection = TOOLKIT_SECTIONS.includes(workspace?.activeSection as ToolkitSection)
    ? workspace?.activeSection as ToolkitSection
    : "style";
  const activeStructureTask = root?.version === 2 && STRUCTURE_TASKS.includes(workspace?.activeStructureTask as StructureTask)
    ? workspace?.activeStructureTask as StructureTask
    : "split";
  return { activeSection, activeStructureTask };
}

export function updateWorkspaceUiState(
  value: unknown,
  workspaceKey: string,
  activeSection: ToolkitSection,
  activeStructureTask: StructureTask
): ToolkitWebviewUiState {
  const root = record(value);
  const existing = record(root?.workspaces);
  const workspaces: ToolkitWebviewUiState["workspaces"] = {};
  for (const [key, raw] of Object.entries(existing || {})) {
    const normalized = readWorkspaceUiState(value, key);
    workspaces[key] = normalized;
  }
  workspaces[workspaceKey] = { activeSection, activeStructureTask };
  return { version: 2, workspaces };
}

function record(value: unknown): Record<string, any> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, any> : undefined;
}
