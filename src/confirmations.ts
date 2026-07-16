import type { ConfirmAction } from "./types";

export interface ConfirmationSpec {
  message: string;
  detail: string;
  confirmLabel: string;
}

export const CONFIRM_ACTIONS: ConfirmAction[] = [
  "starter-overwrite",
  "upgrade-theme-assets",
  "reset-overrides",
  "clean-artifacts",
  "unsplit-delete-source"
];

export function isConfirmAction(value: unknown): value is ConfirmAction {
  return typeof value === "string" && CONFIRM_ACTIONS.includes(value as ConfirmAction);
}

export function confirmationSpec(action: ConfirmAction, detail = ""): ConfirmationSpec {
  switch (action) {
    case "starter-overwrite":
      return {
        message: "Overwrite the existing starter target?",
        detail: detail ? `The existing file will be replaced:\n${detail}` : "The existing starter target will be replaced.",
        confirmLabel: "Overwrite"
      };
    case "upgrade-theme-assets": {
      const resetColors = detail === "default";
      return {
        message: "Upgrade Toolkit theme assets?",
        detail: resetColors
          ? "The current assets will be backed up and replaced. The complete Default color package will replace current colors; compile and document settings are preserved."
          : "The current assets will be backed up and replaced. Existing colors and Toolkit settings will be preserved.",
        confirmLabel: "Upgrade"
      };
    }
    case "reset-overrides":
      return {
        message: "Reset all Toolkit overrides?",
        detail: "This deletes theme.ui.json, theme.overrides.tex, and theme.colors.tex, including theme, compile, class, toggle, recipe, target, and status settings.",
        confirmLabel: "Reset Overrides"
      };
    case "clean-artifacts":
      return {
        message: "Clean LaTeX build artifacts?",
        detail: "Generated auxiliary build files in this workspace will be deleted. Source files and PDFs are preserved.",
        confirmLabel: "Clean"
      };
    case "unsplit-delete-source":
      return {
        message: "Merge the selected unit and delete its source file?",
        detail: "The unit body will be restored to the root target. The source subfile will be deleted after the merge.",
        confirmLabel: "Merge and Delete"
      };
  }
}
