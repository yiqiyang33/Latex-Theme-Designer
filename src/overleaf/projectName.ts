/** Overleaf's limit on project name length. */
export const MAX_PROJECT_NAME_LENGTH = 150;

/**
 * Overleaf's own project-name rules, checked locally so a bad name is caught before any request.
 * Shared by the extension and the webview, which is why this module has no Node or VS Code imports.
 */
export function projectNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Project name is required.";
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters.`;
  if (trimmed.includes("/")) return "Project name cannot contain \"/\".";
  return undefined;
}
