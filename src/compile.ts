import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CompileContext, CompileResult, ToolkitState } from "./types";
import { StateService } from "./state";
import { loadRecipeCatalog } from "./vscodeSettings";
import { compileOutputPdfRelpath, exists, isSubpath, safeWorkspaceRel, stripTexComments, toPosixPath, workspaceRel } from "./utils";

const COMMAND_TIMEOUT_MS = 120_000;
const SUBFILE_PATTERN = /\\subfile(?:\[[^\]]*\])?\{([^}]+)\}/g;

export class CompileService {
  constructor(private readonly rootDir: string, private readonly stateService: StateService) {}

  resolveContext(compileTarget: string): CompileContext {
    if (!compileTarget) throw new Error("No compile target selected.");
    const targetAbs = path.resolve(this.rootDir, compileTarget);
    if (!isSubpath(targetAbs, this.rootDir)) throw new Error(`Compile target is outside workspace: ${compileTarget}`);
    const compileCwd = path.dirname(targetAbs);
    const docfile = path.basename(targetAbs);
    const docstem = path.basename(targetAbs, path.extname(targetAbs));
    const defaultPdfAbs = path.join(compileCwd, `${docstem}.pdf`);
    return {
      targetRel: toPosixPath(compileTarget),
      targetAbs,
      compileCwd,
      docfile,
      docstem,
      defaultPdfAbs,
      defaultPdfRel: workspaceRel(this.rootDir, defaultPdfAbs)
    };
  }

  async compileFromPayload(payload: Record<string, unknown>): Promise<CompileResult> {
    const current = await this.stateService.loadState();
    const normalized = await this.stateService.normalizePayload(payload, current);
    await this.stateService.applyCompilePreferences(current, {
      compile_target: normalized.compile_target,
      compile_recipe: normalized.compile_recipe,
      compile_use_internal_fallback: normalized.compile_use_internal_fallback
    });
    await this.stateService.persistUiState(current);
    const result = await this.compileTexTarget(current.compile_target, current.compile_recipe, current.compile_use_internal_fallback);
    await this.stateService.applyCompileResult(current, result.success, result.pdfPath);
    await this.stateService.persistUiState(current);
    return {
      success: result.success,
      output: result.output,
      compile_target: current.compile_target,
      compile_recipe: current.compile_recipe,
      compile_use_internal_fallback: current.compile_use_internal_fallback,
      pdf_path: result.pdfPath,
      compile_output_pdf_expected: current.compile_output_pdf_expected,
      compile_last_compile_at: current.compile_last_compile_at,
      compile_last_success: current.compile_last_success,
      class_config: current.class_config,
      detected_document_class: current.detected_document_class,
      detected_document_class_has_chapter: current.detected_document_class_has_chapter,
      effective_theme_class: current.effective_theme_class
    };
  }

  async compileTexTarget(compileTarget: string, recipeId: string, useInternalFallback: boolean): Promise<{ success: boolean; output: string; pdfPath: string }> {
    const ctx = this.resolveContext(compileTarget);
    const targetStat = await fs.stat(ctx.targetAbs).catch(() => null);
    if (!targetStat?.isFile()) throw new Error(`Compile target does not exist: ${compileTarget}`);
    const preflight = await this.preflight(ctx);
    if (preflight) return preflight;
    if (useInternalFallback) return this.compileInternal(ctx);
    return this.compileRecipe(ctx, recipeId);
  }

  async expectedOutputPdfForSelection(state: ToolkitState): Promise<string> {
    if (state.compile_use_internal_fallback || !state.compile_recipe) return compileOutputPdfRelpath(state.compile_target);
    try {
      const catalog = await loadRecipeCatalog(this.rootDir);
      const ctx = this.resolveContext(state.compile_target);
      const recipe = catalog.recipes.find((entry) => entry.id === state.compile_recipe);
      if (!recipe) return compileOutputPdfRelpath(state.compile_target);
      for (const toolName of recipe.tools) {
        const tool = catalog.tools[toolName];
        if (!tool) continue;
        const outdir = this.extractOutdir(tool.args);
        if (outdir) return this.resolvePdfPathForOutdir(ctx, outdir);
      }
    } catch {
      return compileOutputPdfRelpath(state.compile_target);
    }
    return compileOutputPdfRelpath(state.compile_target);
  }

  private async compileInternal(ctx: CompileContext): Promise<{ success: boolean; output: string; pdfPath: string }> {
    const logs: string[] = [];
    const source = await fs.readFile(ctx.targetAbs, "utf8").catch(() => "");
    const isBeamer = /\\documentclass(?:\[[^\]]*\])?\{\s*beamer\s*\}/i.test(source);
    const hasBibliography = /\\(?:addbibresource|bibliography)\b/i.test(source);
    const latex = ["xelatex", ["-synctex=1", "-interaction=nonstopmode", "-file-line-error", ctx.docfile]] as const;
    const pipeline: ReadonlyArray<readonly [string, readonly string[]]> = isBeamer
      ? [latex]
      : [latex, ["biber", [ctx.docstem]], latex, latex];
    for (const [cmd, args] of pipeline) {
      const resolved = await this.resolveBinary(cmd);
      if (!resolved) {
        logs.push(`[${cmd}] command not found in PATH.`);
        return { success: false, output: logs.join("\n"), pdfPath: ctx.defaultPdfRel };
      }
      const result = await this.runCommand(resolved, args, ctx.compileCwd);
      this.appendStepLog(logs, cmd, ctx.compileCwd, [cmd, ...args], result.output, result.code);
      if (result.code !== 0) return { success: false, output: logs.join("\n"), pdfPath: ctx.defaultPdfRel };
    }
    if (isBeamer) {
      const bcfExists = await exists(path.join(ctx.compileCwd, `${ctx.docstem}.bcf`));
      const remaining: ReadonlyArray<readonly [string, readonly string[]]> = [
        ...(hasBibliography || bcfExists ? [["biber", [ctx.docstem]] as const] : []),
        latex,
        latex
      ];
      for (const [cmd, args] of remaining) {
        const resolved = await this.resolveBinary(cmd);
        if (!resolved) {
          logs.push(`[${cmd}] command not found in PATH.`);
          return { success: false, output: logs.join("\n"), pdfPath: ctx.defaultPdfRel };
        }
        const result = await this.runCommand(resolved, args, ctx.compileCwd);
        this.appendStepLog(logs, cmd, ctx.compileCwd, [cmd, ...args], result.output, result.code);
        if (result.code !== 0) return { success: false, output: logs.join("\n"), pdfPath: ctx.defaultPdfRel };
      }
    }
    return this.finalizeCompileOutput(ctx, logs, ctx.defaultPdfRel);
  }

  private async compileRecipe(ctx: CompileContext, recipeId: string): Promise<{ success: boolean; output: string; pdfPath: string }> {
    const catalog = await loadRecipeCatalog(this.rootDir);
    const recipe = catalog.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) throw new Error(`Unknown compile recipe: ${recipeId}`);
    const logs: string[] = [];
    let expectedPdfRel = ctx.defaultPdfRel;
    for (const toolName of recipe.tools) {
      const tool = catalog.tools[toolName];
      if (!tool) throw new Error(`Recipe '${recipe.name}' references missing tool '${toolName}'.`);
      const command = await this.resolveBinary(tool.command);
      if (!command) {
        logs.push(`[${toolName}] command not found in PATH: ${tool.command}`);
        return { success: false, output: logs.join("\n"), pdfPath: expectedPdfRel };
      }
      const outdir = this.extractOutdir(tool.args);
      if (outdir) expectedPdfRel = this.resolvePdfPathForOutdir(ctx, outdir);
      const args = tool.args.map((arg) => this.replaceRecipeTokens(arg, ctx, outdir ?? "."));
      const result = await this.runCommand(command, args, ctx.compileCwd);
      this.appendStepLog(logs, toolName, ctx.compileCwd, [tool.command, ...args], result.output, result.code);
      if (result.code !== 0) return { success: false, output: logs.join("\n"), pdfPath: expectedPdfRel };
    }
    return this.finalizeCompileOutput(ctx, logs, expectedPdfRel);
  }

  private async preflight(ctx: CompileContext): Promise<{ success: boolean; output: string; pdfPath: string } | null> {
    const issues: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const walk = async (filePath: string, chain: string[]): Promise<void> => {
      const resolved = path.resolve(filePath);
      if (visiting.has(resolved)) {
        issues.push(`Recursive subfile cycle detected: ${[...chain, resolved].map((item) => safeWorkspaceRel(this.rootDir, item) || item).join(" -> ")}`);
        return;
      }
      if (visited.has(resolved)) return;
      visited.add(resolved);
      visiting.add(resolved);
      let text = "";
      try {
        text = stripTexComments(await fs.readFile(resolved, "utf8"));
      } catch (err) {
        issues.push(`Failed to read source file: ${safeWorkspaceRel(this.rootDir, resolved)} (${(err as Error).message})`);
        visiting.delete(resolved);
        return;
      }
      for (const match of text.matchAll(SUBFILE_PATTERN)) {
        const raw = match[1].trim();
        const withExt = raw.endsWith(".tex") ? raw : `${raw}.tex`;
        const target = path.isAbsolute(withExt) ? withExt : path.resolve(path.dirname(resolved), withExt);
        const sourceRel = safeWorkspaceRel(this.rootDir, resolved) || resolved;
        const targetRel = safeWorkspaceRel(this.rootDir, target) || target;
        if (target === resolved) {
          issues.push(`Recursive subfile self-reference: ${sourceRel} includes '${raw}'.`);
          continue;
        }
        if (!isSubpath(target, this.rootDir)) {
          issues.push(`Subfile target outside workspace: ${sourceRel} -> '${raw}'.`);
          continue;
        }
        if (targetRel.includes("Sections/Sections/")) {
          issues.push(`Suspicious nested Sections path: ${sourceRel} -> ${targetRel}`);
        }
        if (!(await exists(target))) {
          issues.push(`Missing subfile target: ${sourceRel} -> ${targetRel}`);
          continue;
        }
        await walk(target, [...chain, resolved]);
      }
      visiting.delete(resolved);
    };
    await walk(ctx.targetAbs, []);
    if (issues.length === 0) return null;
    const logs = ["[preflight] Compile blocked due to invalid \\subfile references.", "", ...issues.slice(0, 8).map((issue) => `- ${issue}`)];
    if (issues.length > 8) logs.push(`- ... and ${issues.length - 8} more issue(s)`);
    logs.push("", "Hint: fix the listed section/include paths, then re-run compile.");
    return { success: false, output: logs.join("\n"), pdfPath: ctx.defaultPdfRel };
  }

  private replaceRecipeTokens(value: string, ctx: CompileContext, outdir: string): string {
    return value
      .replace(/%DOCFILE%/g, ctx.docfile)
      .replace(/%DOC%/g, ctx.targetAbs)
      .replace(/%DOC_EXT%/g, ctx.docfile)
      .replace(/%DOCFILE_EXT%/g, ctx.docfile)
      .replace(/%DOCFILE_NOEXT%/g, ctx.docstem)
      .replace(/%DOC_NOEXT%/g, path.join(ctx.compileCwd, ctx.docstem))
      .replace(/%OUTDIR%/g, outdir || ".");
  }

  private extractOutdir(args: string[]): string | null {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith("-outdir=")) return arg.slice("-outdir=".length);
      if (arg === "-outdir" && args[i + 1]) return args[i + 1];
      if (arg.startsWith("--output-directory=")) return arg.slice("--output-directory=".length);
      if (arg === "--output-directory" && args[i + 1]) return args[i + 1];
    }
    return null;
  }

  private resolvePdfPathForOutdir(ctx: CompileContext, outdir: string): string {
    const replaced = this.replaceRecipeTokens(outdir, ctx, ".");
    const outAbs = path.isAbsolute(replaced) ? path.resolve(replaced) : path.resolve(ctx.compileCwd, replaced);
    if (!isSubpath(outAbs, this.rootDir)) return ctx.defaultPdfRel;
    return workspaceRel(this.rootDir, path.join(outAbs, `${ctx.docstem}.pdf`));
  }

  private async finalizeCompileOutput(ctx: CompileContext, logs: string[], expectedPdfRel: string): Promise<{ success: boolean; output: string; pdfPath: string }> {
    let pdfRel = expectedPdfRel;
    const expectedAbs = path.resolve(this.rootDir, expectedPdfRel);
    if (!(await exists(expectedAbs)) && (await exists(ctx.defaultPdfAbs))) {
      pdfRel = ctx.defaultPdfRel;
    }
    const pdfAbs = path.resolve(this.rootDir, pdfRel);
    if (!(await exists(pdfAbs))) {
      logs.push("");
      logs.push(`[output] Expected PDF not found: ${pdfRel}`);
      return { success: false, output: logs.join("\n"), pdfPath: pdfRel };
    }
    logs.push("");
    logs.push(`[output] PDF: ${pdfRel}`);
    return { success: true, output: logs.join("\n"), pdfPath: pdfRel };
  }

  private appendStepLog(logs: string[], label: string, cwd: string, command: string[], output: string, code: number): void {
    logs.push(`$ ${command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ")}`);
    logs.push(`[${label}] cwd: ${workspaceRel(this.rootDir, cwd) || "."}`);
    logs.push(`[${label}] exit code: ${code}`);
    if (output.trim()) logs.push(output.trim());
    logs.push("");
  }

  private async runCommand(command: string, args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, [...args], {
        cwd,
        env: { ...process.env, TEXINPUTS: `.:${this.rootDir}//:${process.env.TEXINPUTS ?? ""}`, BIBINPUTS: `.:${this.rootDir}//:${process.env.BIBINPUTS ?? ""}` }
      });
      let output = "";
      const timer = setTimeout(() => {
        output += `\n[timeout] Command exceeded ${COMMAND_TIMEOUT_MS / 1000}s and was terminated.`;
        child.kill("SIGTERM");
      }, COMMAND_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: 127, output: `${output}\n${err.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, output });
      });
    });
  }

  private async resolveBinary(command: string): Promise<string | null> {
    if (path.isAbsolute(command) || command.includes(path.sep)) return (await exists(command)) ? command : null;
    const paths = (process.env.PATH ?? "").split(path.delimiter);
    const candidates = process.platform === "win32" ? [`${command}.exe`, `${command}.cmd`, command] : [command];
    for (const dir of paths) {
      for (const candidate of candidates) {
        const abs = path.join(dir, candidate);
        if (await exists(abs)) return abs;
      }
    }
    return null;
  }
}
