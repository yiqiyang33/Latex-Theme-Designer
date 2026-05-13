import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RecipeCatalog } from "./types";
import { slugify } from "./utils";

export function toolkitVscodeSettingsTemplate(): Record<string, unknown> {
  return {
    "latex-workshop.latex.autoBuild.run": "onSave",
    "latex-workshop.showContextMenu": true,
    "latex-workshop.intellisense.package.enabled": true,
    "latex-workshop.message.error.show": false,
    "latex-workshop.message.warning.show": false,
    "latex-workshop.latex.rootFile.useSubFile": true,
    "latex-workshop.latex.rootFile.doNotPrompt": false,
    "latex-workshop.latex.build.enableMagicComments": false,
    "latex-workshop.latex.tools": [
      {
        name: "xelatex",
        command: "xelatex",
        args: ["-synctex=1", "-interaction=nonstopmode", "-file-line-error", "%DOCFILE%"]
      },
      {
        name: "latexmk",
        command: "latexmk",
        args: ["-synctex=1", "-interaction=nonstopmode", "-file-line-error", "-xelatex", "-outdir=%OUTDIR%", "%DOCFILE%"]
      },
      {
        name: "biber",
        command: "biber",
        args: ["%DOCFILE%"]
      }
    ],
    "latex-workshop.latex.recipes": [
      { name: "XeLaTeX", tools: ["xelatex"] },
      { name: "Biber", tools: ["biber"] },
      { name: "LaTeXmk", tools: ["latexmk"] },
      { name: "xelatex -> biber -> xelatex*2", tools: ["xelatex", "biber", "xelatex", "xelatex"] }
    ],
    "latex-workshop.latex.clean.fileTypes": [
      "*.aux", "*.bbl", "*.blg", "*.idx", "*.ind", "*.lof", "*.lot", "*.out", "*.toc",
      "*.acn", "*.acr", "*.alg", "*.glg", "*.glo", "*.gls", "*.ist", "*.fls", "*.log", "*.fdb_latexmk"
    ],
    "latex-workshop.latex.autoClean.run": "onFailed",
    "latex-workshop.latex.recipe.default": "LaTeXmk",
    "latex-workshop.view.pdf.internal.synctex.keybinding": "double-click",
    "editor.unicodeHighlight.allowedLocales": {
      "zh-hans": true,
      "zh-hant": true
    },
    "[latex]": {
      "editor.defaultFormatter": "James-Yu.latex-workshop"
    }
  };
}

export async function loadVscodeSettings(rootDir: string): Promise<Record<string, unknown>> {
  const settingsPath = path.join(rootDir, ".vscode", "settings.json");
  try {
    const text = await fs.readFile(settingsPath, "utf8");
    if (!text.trim()) return {};
    const parsed = parseJsonc(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSONC content must be a top-level object.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw err;
  }
}

export function parseJsonc(raw: string): unknown {
  return JSON.parse(stripJsonTrailingCommas(stripJsoncComments(raw)));
}

function stripJsoncComments(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && raw[i + 1] === "/") {
      i += 2;
      while (i < raw.length && raw[i] !== "\n" && raw[i] !== "\r") i += 1;
      i -= 1;
      continue;
    }
    if (char === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i + 1 < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

function stripJsonTrailingCommas(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      let lookahead = i + 1;
      while (lookahead < raw.length && /\s/.test(raw[lookahead])) lookahead += 1;
      if (raw[lookahead] === "}" || raw[lookahead] === "]") continue;
    }
    out += char;
  }
  return out;
}

export async function loadRecipeCatalog(rootDir: string): Promise<RecipeCatalog> {
  const catalog: RecipeCatalog = { tools: {}, recipes: [], errors: [] };
  let settings: Record<string, unknown>;
  try {
    settings = await loadVscodeSettings(rootDir);
  } catch (err) {
    catalog.errors.push(`Failed to parse .vscode/settings.json: ${(err as Error).message}`);
    return catalog;
  }

  const rawTools = settings["latex-workshop.latex.tools"];
  if (Array.isArray(rawTools)) {
    rawTools.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        catalog.errors.push(`Tool entry at index ${index} is not an object.`);
        return;
      }
      const item = entry as Record<string, unknown>;
      const name = String(item.name ?? "").trim();
      const command = String(item.command ?? "").trim();
      const args = Array.isArray(item.args) ? item.args.map(String) : [];
      if (!name) catalog.errors.push(`Tool entry at index ${index} is missing 'name'.`);
      if (!command) catalog.errors.push(`Tool '${name || index}' is missing 'command'.`);
      if (name && command) catalog.tools[name] = { name, command, args };
    });
  } else if (rawTools !== undefined) {
    catalog.errors.push("latex-workshop.latex.tools must be a list.");
  }

  const rawRecipes = settings["latex-workshop.latex.recipes"];
  if (Array.isArray(rawRecipes)) {
    rawRecipes.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        catalog.errors.push(`Recipe entry at index ${index} is not an object.`);
        return;
      }
      const item = entry as Record<string, unknown>;
      const name = String(item.name ?? "").trim();
      const tools = Array.isArray(item.tools) ? item.tools.map(String).filter((value) => value.trim()) : [];
      if (!name) catalog.errors.push(`Recipe entry at index ${index} is missing 'name'.`);
      if (tools.length === 0) catalog.errors.push(`Recipe '${name || index}' has no tools.`);
      if (name && tools.length > 0) {
        catalog.recipes.push({ id: `vscode-${index + 1}-${slugify(name)}`, name, tools });
      }
    });
  } else if (rawRecipes !== undefined) {
    catalog.errors.push("latex-workshop.latex.recipes must be a list.");
  }
  return catalog;
}

export async function generateVscodeSettingsIfMissing(rootDir: string): Promise<{ generated: boolean; generated_path: string; message: string }> {
  const settingsPath = path.join(rootDir, ".vscode", "settings.json");
  try {
    const stat = await fs.stat(settingsPath);
    if (stat.isDirectory()) throw new Error(".vscode/settings.json is a directory.");
    return { generated: false, generated_path: ".vscode/settings.json", message: ".vscode/settings.json already exists; left unchanged." };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(toolkitVscodeSettingsTemplate(), null, 2)}\n`, "utf8");
  return { generated: true, generated_path: ".vscode/settings.json", message: "Generated .vscode/settings.json." };
}

export async function cleanPatternsFromVscodeSettings(rootDir: string, fallback: string[]): Promise<string[]> {
  try {
    const settings = await loadVscodeSettings(rootDir);
    const raw = settings["latex-workshop.latex.clean.fileTypes"];
    if (Array.isArray(raw)) {
      const patterns = raw.map(String).map((value) => value.trim()).filter(Boolean);
      if (patterns.length > 0) return Array.from(new Set(patterns));
    }
  } catch {
    // Keep cleanup usable even when settings are malformed.
  }
  return fallback;
}
