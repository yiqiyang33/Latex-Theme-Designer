import * as path from "node:path";
import { BEAMER_CLASS_OPTIONS_FILE, BEAMER_CONFIG_DIR, BEAMER_SETTINGS_FILE, TEMPLATE_METADATA_REL } from "./beamer";
import { STARTER_TEMPLATE_DEFINITIONS } from "./schema";
import type { StarterTemplateDefinition } from "./types";
import { toPosixPath } from "./utils";

/**
 * Theme files every non-Beamer starter relies on. Copied into the workspace only when
 * absent, so a project's own edits survive.
 */
export const SHARED_THEME_ASSETS = ["theme.sty", "theorems.tex", "commands.tex", "references.bib"];

/** Subset replaced by an explicit theme upgrade; the bibliography stays with the project. */
export const UPGRADABLE_THEME_ASSETS = SHARED_THEME_ASSETS.filter((file) => file !== "references.bib");

/**
 * Support files a single starter brings on top of the shared set, e.g. homework.sty for
 * the homework starter. Declared per starter in schema.ts via assetManifest; this is the
 * one place that turns a manifest into "what a non-Beamer project actually receives".
 */
export function assetsForTemplate(definition: StarterTemplateDefinition | undefined): string[] {
  const extras = (definition?.kind !== "beamer" ? definition?.assetManifest ?? [] : [])
    .filter((file) => !SHARED_THEME_ASSETS.includes(file));
  return [...SHARED_THEME_ASSETS, ...extras];
}

/**
 * The subset of a starter's extra assets that an explicit upgrade may overwrite. A .sty
 * is a Toolkit-authored package, so replacing it is the whole point; a manifest also
 * names things the project owns (book-minimal's Fig/cover.png), which must survive —
 * the same distinction that keeps references.bib out of UPGRADABLE_THEME_ASSETS.
 */
export function upgradableTemplateExtras(definition: StarterTemplateDefinition | undefined): string[] {
  return assetsForTemplate(definition)
    .filter((file) => file.endsWith(".sty") && !SHARED_THEME_ASSETS.includes(file));
}

export interface TemplateFilePlan {
  definition: StarterTemplateDefinition;
  /** Asset files the generator may write, workspace-relative and posix-separated. */
  assets: string[];
  /** Directories the generator may create, workspace-relative. */
  directories: string[];
  /** Toolkit-managed metadata and config files. */
  metadata: string[];
}

/**
 * Single source of truth for "which files does generating this template touch".
 *
 * Three callers need this answer and used to each carry their own hand-written list: the
 * copier in state.ts, the undo snapshot in toolkitService.ts, and the create-project
 * preview in projectWorkflow.ts. They had already drifted apart — the preview omitted
 * everything under templates/, so undo and the preview disagreed with what landed on disk.
 * state.ts consumes assetsForTemplate below, so that drift cannot reopen.
 */
export function templateFilePlan(templateId: string | undefined, outputTarget = "main.tex"): TemplateFilePlan | undefined {
  const definition = templateId
    ? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === templateId)
    : undefined;
  if (!definition) return undefined;

  if (definition.kind !== "beamer") {
    return {
      definition,
      // Deduplicated: book-minimal already names Fig/cover.png in its own manifest.
      assets: [...new Set([
        ...assetsForTemplate(definition),
        "Fig/cover.png",
        ...STARTER_TEMPLATE_DEFINITIONS.map((entry) => `templates/${entry.filename}`)
      ])],
      directories: ["Fig", "templates"],
      metadata: [TEMPLATE_METADATA_REL]
    };
  }

  // Beamer theme files are resolved relative to the deck, so they live beside it.
  const baseDir = toPosixPath(path.dirname(toPosixPath(outputTarget)));
  const inBaseDir = (rel: string) => (baseDir === "." || baseDir === "" ? rel : `${baseDir}/${rel}`);
  return {
    definition,
    assets: definition.assetManifest.map(inBaseDir),
    directories: [inBaseDir(BEAMER_CONFIG_DIR)],
    metadata: [
      TEMPLATE_METADATA_REL,
      inBaseDir(BEAMER_CLASS_OPTIONS_FILE),
      inBaseDir(BEAMER_SETTINGS_FILE)
    ]
  };
}

/** Everything templateFilePlan covers, flattened — what undo has to snapshot. */
export function templateFilePlanPaths(templateId: string | undefined, outputTarget = "main.tex"): string[] {
  const plan = templateFilePlan(templateId, outputTarget);
  if (!plan) return [];
  return [...plan.directories, ...plan.assets, ...plan.metadata];
}
