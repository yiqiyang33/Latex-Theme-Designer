import * as path from "node:path";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import { localResourceNode, type ToolkitTreeNode } from "./treeNodes";
import type { LocalNoteProjectStatus } from "./types";

export function localProjectNode(project: LocalNoteProjectStatus, isOpen: boolean): ToolkitTreeNode {
  const parent = path.basename(path.dirname(project.rootPath)) || path.dirname(project.rootPath);
  const template = STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === project.templateId);
  const presentationDescription = project.templateId === "beamer-generic"
    ? "Beamer · Generic Beamer · main.tex"
    : template?.kind === "beamer"
      ? `Beamer · ${template.label} · main.tex`
      : undefined;
  return localResourceNode({
    id: `local-project:${project.id}`,
    identity: { projectId: project.id },
    label: project.label,
    description: project.missing ? "Missing" : presentationDescription || (isOpen ? `Open · ${parent}` : parent),
    tooltip: project.missing ? "Project folder not found in this environment" : "Local note project",
    iconId: project.missing ? "warning" : isOpen ? "root-folder-opened" : "folder",
    commandId: "latexEditingToolkit.openLocalProject",
    contextValue: project.missing ? "localProjectMissing" : "localProject"
  });
}
