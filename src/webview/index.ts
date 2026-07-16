type ToolkitRequest = { id: string; command: string; payload?: Record<string, unknown> };
type ToolkitResponse = { id: string; ok: boolean; data?: any; error?: string };

declare const acquireVsCodeApi: () => {
  postMessage(message: ToolkitRequest): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();
const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
let model: any = null;
let latestSplit: any = null;
let latestRenumber: any = null;
let latestUnsplit: any = null;
let latestOperation = "";
let starterTemplateSelection = "";
let previewStylePresetId = "";
let persistedState: any = null;
let draftRevision = 0;
let saveTimer: number | undefined;
let savePending = false;
let saveDrain: Promise<void> | null = null;
let lastSaveError: Error | null = null;

function request(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  vscode.postMessage({ id, command, payload });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "toolkit-state-refresh") {
    acceptServerModel(event.data.data);
    return;
  }
  const response = event.data as ToolkitResponse;
  const waiter = pending.get(response.id);
  if (!waiter) return;
  pending.delete(response.id);
  if (response.ok) waiter.resolve(response.data);
  else waiter.reject(new Error(response.error || "Toolkit request failed."));
});

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

function setStatus(message: string, kind = ""): void {
  const el = byId<HTMLDivElement>("status");
  el.textContent = message;
  el.dataset.kind = kind;
}

function setSaveStatus(message: string, kind = ""): void {
  const el = byId<HTMLSpanElement>("saveIndicator");
  el.textContent = message;
  el.dataset.kind = kind;
  byId<HTMLButtonElement>("retrySaveBtn").hidden = kind !== "error";
}

function scheduleAutosave(delay = 0): void {
  draftRevision += 1;
  savePending = true;
  lastSaveError = null;
  setSaveStatus("Saving…", "saving");
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void drainAutosave().catch(() => undefined);
  }, delay);
}

async function drainAutosave(): Promise<void> {
  if (saveDrain) return saveDrain;
  saveDrain = (async () => {
    while (savePending) {
      savePending = false;
      const revision = draftRevision;
      const snapshot = clone(model.state);
      try {
        const result = await request("autosave", { revision, state: snapshot });
        persistedState = clone(result.state);
        model.schema = result.schema;
        model.history = result.history;
        if (revision === draftRevision && !savePending) model.state = clone(result.state);
        lastSaveError = null;
        setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, "ok");
        renderHistoryActions();
        renderPresets();
      } catch (err) {
        lastSaveError = err as Error;
        setSaveStatus("Could not save", "error");
        throw err;
      }
    }
  })();
  try {
    await saveDrain;
  } finally {
    saveDrain = null;
  }
}

async function flushAutosave(): Promise<void> {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (savePending) await drainAutosave();
  else if (saveDrain) await saveDrain;
  if (lastSaveError) throw lastSaveError;
}

function acceptServerModel(next: any): void {
  model = next;
  persistedState = clone(next.state);
  previewStylePresetId = "";
  lastSaveError = null;
  renderAll();
}

function stateColor(token: string): string {
  return model?.state?.colors?.[token] || "#808080";
}

function previewColor(token: string): string {
  const pendingPreset = (model?.schema?.style_presets || []).find((preset: any) => preset.id === previewStylePresetId);
  return pendingPreset?.colors?.[token] || stateColor(token);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toggleOn(id: string): boolean {
  return !!model?.state?.toggles?.[id];
}

function bodyFontSize(): number {
  const schema = model.schema.body_font_size;
  return Number(model.state[schema.id] || schema.default || 10);
}

function recipeName(id: string): string {
  return (model.state.compile_recipes || []).find((recipe: any) => recipe.id === id)?.name || "";
}

function currentPdfPath(): string {
  return model.state.compile_output_pdf || model.state.compile_output_pdf_expected || pdfForTarget(model.state.compile_target);
}

function pdfForTarget(target: string): string {
  return target && target.endsWith(".tex") ? `${target.slice(0, -4)}.pdf` : "main.pdf";
}

function classConfigValue(id: string): string {
  const fallback = (model.schema.class_config || []).find((field: any) => field.id === id)?.options?.[0]?.value || "auto";
  return model.state.class_config?.[id] || fallback;
}

function effectiveThemeClass(): string {
  const mode = classConfigValue("theme_class_mode");
  if (mode === "book" || mode === "article") return mode;
  return model.state.effective_theme_class || "article";
}

function chapterStyleStatus(): { active: boolean; message: string } {
  if (!model.state.detected_document_class_has_chapter && effectiveThemeClass() !== "book") {
    return { active: false, message: "inactive (target class has no chapter)" };
  }
  const mode = classConfigValue("theme_heading_chapter_mode");
  if (mode === "off") return { active: false, message: "inactive (forced off)" };
  if (mode === "on") return { active: true, message: "active (forced on)" };
  return effectiveThemeClass() === "book"
    ? { active: true, message: "active (auto + effective class book)" }
    : { active: false, message: "inactive (auto + effective class article)" };
}

function renderSelect(select: HTMLSelectElement, entries: Array<{ value: string; label: string }>, preferred: string): string {
  select.innerHTML = "";
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    select.appendChild(option);
  }
  const values = new Set(entries.map((entry) => entry.value));
  select.value = values.has(preferred) ? preferred : entries[0]?.value || "";
  select.disabled = entries.length === 0;
  return select.value;
}

function renderAll(): void {
  renderHistoryActions();
  renderConfigWarnings();
  renderStarter();
  renderPresets();
  renderBodyFontSize();
  renderToggles();
  renderColors();
  renderTargets();
  renderRecipes();
  renderClassConfig();
  renderSplitControls();
  renderPreview();
  renderStyleDifferences();
  renderSplitResult();
  refreshPdf().catch(() => undefined);
}

function renderHistoryActions(): void {
  const history = model?.history || {};
  const undo = byId<HTMLButtonElement>("undoBtn");
  const redo = byId<HTMLButtonElement>("redoBtn");
  undo.disabled = !history.canUndo;
  redo.disabled = !history.canRedo;
  undo.title = history.canUndo ? `Undo ${history.label}` : "Nothing to undo";
  redo.title = history.canRedo ? `Redo ${history.label}` : "Nothing to redo";
}

function renderStarter(): void {
  const select = byId<HTMLSelectElement>("starterTemplateSelect");
  const output = byId<HTMLInputElement>("starterOutputTarget");
  const templates = model.schema.starter_templates || [];
  const preferred = starterTemplateSelection || select.value || model.schema.starter_default_template || "book-minimal";
  starterTemplateSelection = renderSelect(select, templates.map((item: any) => ({ value: item.id, label: item.label })), preferred);
  renderStarterDescription();
  if (!output.value) output.value = model.schema.starter_default_output_target || "main.tex";
}

function renderStarterDescription(): void {
  const templates = model.schema.starter_templates || [];
  const selected = byId<HTMLSelectElement>("starterTemplateSelect").value;
  const info = templates.find((item: any) => item.id === selected);
  byId("starterTemplateDesc").textContent = info?.description || "";
}

function renderPresets(): void {
  const presets = model.schema.style_presets || [];
  const grid = byId("stylePresetCards");
  grid.innerHTML = "";
  const customized = isCurrentStyleCustomized();
  for (const source of ["builtin", "personal"]) {
    const group = presets.filter((preset: any) => (preset.source || "builtin") === source);
    if (source === "personal" && group.length === 0) continue;
    const heading = document.createElement("h3");
    heading.className = "preset-group-title";
    heading.textContent = source === "builtin" ? "Built-in Styles" : "My Styles";
    grid.appendChild(heading);
    const groupGrid = document.createElement("div");
    groupGrid.className = "style-card-grid";
    for (const preset of group) groupGrid.appendChild(stylePresetCard(preset, customized));
    grid.appendChild(groupGrid);
  }
  const changes = styleChanges();
  const summary = byId("customizedSummary");
  summary.textContent = changes.length > 0 ? `Customized from ${currentPreset()?.label || model.state.style_base_preset} · ${changes.length} change(s)` : "";
  summary.hidden = changes.length === 0;
  const current = currentPreset();
  byId<HTMLButtonElement>("savePersonalStyleBtn").hidden = changes.length === 0;
  byId<HTMLButtonElement>("updatePersonalStyleBtn").hidden = !(changes.length > 0 && current?.source === "personal");
}

function stylePresetCard(preset: any, customized: boolean): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "style-card-wrap";
    const card = document.createElement("button");
    const isApplied = preset.id === persistedState?.style_preset;
    const isDraft = preset.id === model.state.style_preset;
    const isPreview = preset.id === previewStylePresetId;
    card.type = "button";
    card.className = "style-card";
    card.dataset.applied = String(isApplied);
    card.dataset.preview = String(isPreview);
    card.setAttribute("aria-pressed", String(isDraft));
    card.setAttribute("aria-label", `${preset.label}: ${preset.description}`);
    const badges = [
      isApplied ? `<span class="preset-badge">Applied</span>` : "",
      isDraft && customized ? `<span class="preset-badge customized">Customized</span>` : "",
      isPreview ? `<span class="preset-badge preview">Preview</span>` : ""
    ].join("");
    const swatches = ["theme-section", "inline-key-fg", "theorem-body-bg", "theorem-accent"]
      .map((token) => `<span title="${token}" style="background:${preset.colors?.[token] || "#808080"}"></span>`)
      .join("");
    card.innerHTML = `<span class="style-card-heading"><strong>${preset.label}</strong><span class="preset-badges">${badges}</span></span><span class="style-card-description">${preset.description || ""}</span><span class="style-card-swatches">${swatches}</span>`;
    card.addEventListener("mouseenter", () => setStylePreview(preset.id));
    card.addEventListener("mouseleave", clearStylePreview);
    card.addEventListener("focus", () => setStylePreview(preset.id));
    card.addEventListener("blur", clearStylePreview);
    card.addEventListener("click", () => {
      model.state.style_preset = preset.id;
      model.state.style_base_preset = preset.base_preset_id || preset.id;
      model.state.colors = { ...preset.colors };
      previewStylePresetId = "";
      scheduleAutosave(0);
      renderPresets();
      renderColors();
      renderPreview();
      renderStyleDifferences();
    });
    wrap.appendChild(card);
    if (preset.source === "personal") {
      const actions = document.createElement("div");
      actions.className = "personal-style-actions";
      for (const [label, command] of [["Rename", "personal-style-rename"], ["Export", "personal-style-export"], ["Delete", "personal-style-delete"]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (label === "Delete") button.className = "danger";
        button.addEventListener("click", () => run(() => managePersonalStyle(command, preset.id)));
        actions.appendChild(button);
      }
      wrap.appendChild(actions);
    }
    return wrap;
}

function isCurrentStyleCustomized(): boolean {
  const preset = currentPreset();
  if (!preset?.colors) return false;
  return Object.entries(preset.colors).some(([token, value]) => stateColor(token).toUpperCase() !== String(value).toUpperCase());
}

function currentPreset(): any {
  return (model.schema.style_presets || []).find((item: any) => item.id === model.state.style_preset)
    || (model.schema.style_presets || []).find((item: any) => item.id === model.state.style_base_preset);
}

function setStylePreview(id: string): void {
  previewStylePresetId = id;
  renderPreview();
}

function clearStylePreview(): void {
  if (!previewStylePresetId) return;
  previewStylePresetId = "";
  renderPreview();
}

function styleChanges(): Array<{ token: string; baseline: string; current: string; label: string; group: string }> {
  const preset = currentPreset();
  if (!preset?.colors) return [];
  const labels = new Map<string, { label: string; group: string }>();
  for (const group of model.schema.groups || []) for (const item of group.items || []) labels.set(item.id, { label: item.label, group: group.title });
  return Object.entries(preset.colors)
    .filter(([token, value]) => stateColor(token).toUpperCase() !== String(value).toUpperCase())
    .map(([token, value]) => ({ token, baseline: String(value), current: stateColor(token), label: labels.get(token)?.label || token, group: labels.get(token)?.group || "Other" }));
}

function renderConfigWarnings(): void {
  const warnings = model?.state?.config_warnings || [];
  const panel = byId<HTMLDetailsElement>("configWarnings");
  panel.hidden = warnings.length === 0;
  byId("configWarningSummary").textContent = warnings.length === 1 ? "1 configuration warning" : `${warnings.length} configuration warnings`;
  const list = byId<HTMLUListElement>("configWarningList");
  list.innerHTML = "";
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    list.appendChild(item);
  }
  if (warnings.length > 0) openSection("sectionDiagnostics");
}

function renderStyleDifferences(): void {
  const box = byId("styleDifferenceList");
  const changes = styleChanges();
  box.innerHTML = "";
  byId<HTMLDetailsElement>("styleDifferences").hidden = changes.length === 0;
  const grouped = new Map<string, typeof changes>();
  for (const change of changes) grouped.set(change.group, [...(grouped.get(change.group) || []), change]);
  for (const [group, entries] of grouped) {
    const heading = document.createElement("h4");
    heading.textContent = group;
    box.appendChild(heading);
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "style-diff-row";
      row.innerHTML = `<span>${entry.label}<code>${entry.token}</code></span><span class="diff-color"><i style="background:${entry.baseline}"></i>${entry.baseline}</span><span>→</span><span class="diff-color"><i style="background:${entry.current}"></i>${entry.current}</span>`;
      const revert = document.createElement("button");
      revert.type = "button";
      revert.textContent = "Revert";
      revert.addEventListener("click", () => {
        model.state.colors[entry.token] = entry.baseline;
        scheduleAutosave(0);
        renderColors();
        renderPreview();
        renderPresets();
        renderStyleDifferences();
      });
      row.appendChild(revert);
      box.appendChild(row);
    }
  }
}

async function managePersonalStyle(command: string, styleId = ""): Promise<void> {
  await flushAutosave();
  const result = await request(command, { style_id: styleId, state: model.state, revision: ++draftRevision });
  if (result?.state) acceptServerModel(result);
  if (result?.personal_style_import) setStatus(`Imported ${result.personal_style_import.imported} style(s); skipped ${result.personal_style_import.skipped}.`, "ok");
}

function renderBodyFontSize(): void {
  const schema = model.schema.body_font_size;
  const slider = byId<HTMLInputElement>("bodyFontSizeSlider");
  slider.min = String(schema.min);
  slider.max = String(schema.max);
  slider.step = String(schema.step);
  slider.value = String(bodyFontSize());
  byId("bodyFontSizeValue").textContent = `${Number(slider.value).toFixed(1)}pt`;
  byId("bodyFontSizeHelp").textContent = schema.help;
}

function renderToggles(): void {
  const box = byId("toggleBox");
  box.innerHTML = "";
  for (const item of model.schema.toggles || []) {
    const label = document.createElement("label");
    label.className = "toggle-row";
    label.innerHTML = `<input type="checkbox" ${toggleOn(item.id) ? "checked" : ""}><span>${item.label}</span>`;
    label.title = item.help || "";
    label.querySelector("input")?.addEventListener("change", (ev) => {
      model.state.toggles[item.id] = (ev.target as HTMLInputElement).checked;
      scheduleAutosave(0);
      renderPreview();
    });
    box.appendChild(label);
  }
}

function renderColors(): void {
  const box = byId("groupBox");
  box.innerHTML = "";
  const chapterStatus = chapterStyleStatus();
  for (const group of model.schema.groups || []) {
    const details = document.createElement("details");
    details.open = ["Document", "Definition", "Theorem"].includes(group.title);
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.appendChild(summary);
    const rows = document.createElement("div");
    rows.className = "color-grid";
    for (const item of group.items || []) {
      const row = document.createElement("label");
      row.className = "color-row";
      const inactiveChapter = item.id === "theme-chapter" && !chapterStatus.active;
      row.innerHTML = `<span>${item.label}${inactiveChapter ? " (inactive)" : ""}</span><input type="color"><input type="text">`;
      const colorInput = row.children[1] as HTMLInputElement;
      const textInput = row.children[2] as HTMLInputElement;
      colorInput.value = stateColor(item.id);
      textInput.value = stateColor(item.id);
      colorInput.addEventListener("input", () => {
        model.state.colors[item.id] = colorInput.value.toUpperCase();
        textInput.value = model.state.colors[item.id];
        clearStylePreview();
        renderPreview();
        renderPresets();
        renderStyleDifferences();
      });
      colorInput.addEventListener("change", () => scheduleAutosave(0));
      textInput.addEventListener("input", () => {
        if (/^#?[0-9a-fA-F]{6}$/.test(textInput.value.trim())) {
          textInput.removeAttribute("aria-invalid");
          const value = `#${textInput.value.trim().replace(/^#/, "").toUpperCase()}`;
          model.state.colors[item.id] = value;
          colorInput.value = value;
          clearStylePreview();
          scheduleAutosave(500);
          renderPreview();
          renderPresets();
          renderStyleDifferences();
        } else {
          textInput.setAttribute("aria-invalid", "true");
        }
      });
      rows.appendChild(row);
    }
    details.appendChild(rows);
    box.appendChild(details);
  }
}

function renderTargets(): void {
  const target = byId<HTMLSelectElement>("targetSelect");
  renderSelect(target, (model.state.compile_targets || []).map((value: string) => ({ value, label: value })), model.state.compile_target || "");
  const info = byId("targetInfo");
  const chapter = chapterStyleStatus();
  info.textContent = `target: ${model.state.compile_target || "(none)"} | mode: ${currentCompileLabel()} | class: ${model.state.detected_document_class || "(unknown)"} -> ${effectiveThemeClass()} | chapter-style: ${chapter.message}`;
  byId("outputInfo").textContent = `current pdf: ${currentPdfPath()} | expected: ${model.state.compile_output_pdf_expected || pdfForTarget(model.state.compile_target)} | last compile: ${model.state.compile_last_compile_at || "never"}`;
}

function currentCompileLabel(): string {
  return model.state.compile_use_internal_fallback ? "internal fallback" : (recipeName(model.state.compile_recipe) || model.state.compile_recipe || "recipe");
}

function renderRecipes(): void {
  const select = byId<HTMLSelectElement>("recipeSelect");
  const recipes = model.state.compile_recipes || [];
  renderSelect(select, recipes.map((item: any) => ({ value: item.id, label: item.name })), model.state.compile_recipe || "");
  byId<HTMLInputElement>("useInternalFallback").checked = !!model.state.compile_use_internal_fallback;
  const errors = model.state.compile_recipe_errors || [];
  byId("compileHelp").textContent = model.state.compile_use_internal_fallback
    ? "Internal fallback mode ignores recipe selection."
    : errors.length ? `Recipe settings warning: ${errors.join(" ")}` : "Recipe mode uses .vscode/settings.json.";
}

function renderClassConfig(): void {
  const box = byId("classConfigBox");
  box.innerHTML = "";
  for (const field of model.schema.class_config || []) {
    const label = document.createElement("label");
    label.className = "config-row";
    const select = document.createElement("select");
    renderSelect(select, (field.options || []).map((opt: any) => ({ value: opt.value, label: opt.label })), classConfigValue(field.id));
    select.addEventListener("change", () => {
      model.state.class_config[field.id] = select.value;
      scheduleAutosave(0);
      renderPreview();
      renderTargets();
    });
    const span = document.createElement("span");
    span.textContent = field.label;
    label.append(span, select);
    label.title = field.help || "";
    box.appendChild(label);
  }
}

function renderSplitControls(): void {
  const select = byId<HTMLSelectElement>("splitSourceSelect");
  renderSelect(select, (model.state.compile_targets || []).map((value: string) => ({ value, label: value })), model.state.compile_target || "");
  byId("splitModeTag").textContent = "subfiles";
  byId<HTMLInputElement>("unsplitDeleteSource").checked = true;
}

function renderSplitResult(): void {
  const box = byId("splitResult");
  const result = latestOperation === "split" ? latestSplit : latestOperation === "renumber" ? latestRenumber : latestOperation === "unsplit" ? latestUnsplit : null;
  if (!result) {
    box.textContent = "No split run yet.";
    return;
  }
  const lines = [`${latestOperation} ${result.success ? "succeeded" : "failed"}${result.dry_run ? " (dry run)" : ""}.`];
  if (latestOperation === "split") {
    lines.push(`generated: ${(result.generated_subfile_targets || []).length}`);
    for (const item of result.generated_subfile_targets || []) lines.push(`- ${item}`);
  }
  if (latestOperation === "renumber") {
    for (const [from, to] of Object.entries(result.renamed || {})) lines.push(`- ${from} -> ${to}`);
  }
  if (latestOperation === "unsplit") {
    lines.push(`root: ${result.root_target}`);
    lines.push(`source: ${result.source_target}`);
  }
  for (const item of result.updated_files || []) lines.push(`updated: ${item}`);
  for (const item of result.warnings || []) lines.push(`warning: ${item}`);
  box.textContent = lines.join("\n");
}

function renderPreview(): void {
  const preview = byId("preview");
  preview.innerHTML = "";
  preview.append(
    sampleCard("Definition", previewColor("definition-title-bg"), previewColor("definition-title-fg"), previewColor("definition-body-bg"), previewColor("definition-accent")),
    sampleCard("Theorem", previewColor("theorem-title-bg"), previewColor("theorem-title-fg"), previewColor("theorem-body-bg"), previewColor("theorem-accent")),
    sampleCard("Note", previewColor("note-title-bg"), previewColor("note-title-fg"), previewColor("note-bg"), previewColor("note-accent"))
  );
  const chip = "display:inline-block;border-radius:4px;border:1px solid;padding:0 .28em;line-height:1.45";
  byId("docPreview").innerHTML = `<h1 style="color:${previewColor("theme-chapter")}">Chapter Heading</h1><h2 style="color:${previewColor("theme-section")}">Section Heading</h2><p style="font-size:${bodyFontSize()}pt">A short note preview with <b style="color:${previewColor("theme-bold")}">bold emphasis</b>, <b style="color:${previewColor("inline-key-fg")}">key idea</b>, <span style="${chip};background:${previewColor("inline-term-bg")};border-color:${previewColor("inline-term-fg")}55;color:${previewColor("inline-term-fg")}">term</span>, <b style="color:${previewColor("inline-warn-fg")}">warning</b>, <span style="${chip};background:${previewColor("inline-todo-bg")};border-color:${previewColor("inline-todo-fg")}55;color:${previewColor("inline-todo-fg")};font-weight:700">TODO task</span>, and <code style="${chip};background:${previewColor("inline-code-bg")};border-color:${previewColor("inline-code-fg")}44;color:${previewColor("inline-code-fg")}">inline code</code>.</p>`;
}

function sampleCard(title: string, titleBg: string, titleFg: string, bodyBg: string, accent: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "sample-card";
  card.style.background = bodyBg;
  card.style.borderColor = accent;
  card.style.boxShadow = toggleOn("enable_block_shadow") ? "3px 3px 0 rgba(0,0,0,.12)" : "none";
  card.innerHTML = `<div style="background:${titleBg};color:${titleFg};border-bottom-color:${accent}">${title}</div><p>Sample block body. Label prefixes and theorem commands remain compatible.</p>`;
  return card;
}

async function refreshPdf(): Promise<void> {
  try {
    const result = await request("pdf-uri", { path: currentPdfPath() });
    const frame = byId<HTMLIFrameElement>("pdfFrame");
    frame.src = `${result.uri}`;
    byId<HTMLButtonElement>("openPdfBtn").disabled = false;
  } catch {
    byId<HTMLIFrameElement>("pdfFrame").removeAttribute("src");
    byId<HTMLButtonElement>("openPdfBtn").disabled = true;
  }
}

async function loadState(): Promise<void> {
  acceptServerModel(await request("state"));
  setSaveStatus("Saved", "ok");
}

async function bootstrapStarter(): Promise<void> {
  await flushAutosave();
  const output = byId<HTMLInputElement>("starterOutputTarget").value.trim();
  const overwrite = byId<HTMLInputElement>("starterOverwrite").checked;
  if (overwrite && !confirm(`Overwrite target file if it already exists?\n\n${output}`)) return;
  const result = await request("template-bootstrap", {
    template_id: byId<HTMLSelectElement>("starterTemplateSelect").value,
    output_target: output,
    overwrite
  });
  starterTemplateSelection = byId<HTMLSelectElement>("starterTemplateSelect").value;
  setStatus(`Generated ${result.generated_target}.`, "ok");
  acceptServerModel(result);
}

async function upgradeThemeAssets(): Promise<void> {
  await flushAutosave();
  const policy = byId<HTMLSelectElement>("upgradeColorPolicy").value === "default" ? "default" : "preserve";
  const explanation = policy === "default"
    ? "The complete Default color package will replace current colors. Compile, class, toggle, recipe, target, and status settings are preserved."
    : "Current colors and all Toolkit settings will be preserved.";
  if (!confirm(`Back up and replace theme.sty, theorems.tex, and commands.tex with the bundled extension versions?\n\n${explanation}`)) return;
  const result = await request("upgrade-theme-assets", { color_policy: policy });
  acceptServerModel(await request("state", {}));
  setStatus(`Upgraded ${result.upgraded_files?.length || 0} theme asset(s) with ${policy === "default" ? "Default colors" : "colors preserved"}. Backup: ${result.backup_dir}.`, "ok");
}

async function compilePdf(): Promise<void> {
  await flushAutosave();
  setStatus("Compiling...", "");
  const result = await request("compile", {
    ...model.state,
    compile_target: byId<HTMLSelectElement>("targetSelect").value,
    compile_recipe: byId<HTMLSelectElement>("recipeSelect").value,
    compile_use_internal_fallback: byId<HTMLInputElement>("useInternalFallback").checked
  });
  byId("logBox").textContent = result.output || "";
  model.state.compile_output_pdf = result.pdf_path || model.state.compile_output_pdf;
  model.state.compile_output_pdf_expected = result.compile_output_pdf_expected || model.state.compile_output_pdf_expected;
  model.state.compile_last_compile_at = result.compile_last_compile_at;
  model.state.compile_last_success = result.compile_last_success;
  if (persistedState) {
    persistedState.compile_output_pdf = model.state.compile_output_pdf;
    persistedState.compile_output_pdf_expected = model.state.compile_output_pdf_expected;
    persistedState.compile_last_compile_at = result.compile_last_compile_at;
    persistedState.compile_last_success = result.compile_last_success;
  }
  setStatus(result.success ? "Compile succeeded." : "Compile failed.", result.success ? "ok" : "error");
  if (!result.success) openSection("sectionDiagnostics");
  renderAll();
}

async function splitCurrent(): Promise<void> {
  await flushAutosave();
  const result = await request("split", {
    compile_target: byId<HTMLSelectElement>("splitSourceSelect").value,
    dry_run: byId<HTMLInputElement>("splitDryRun").checked,
    sections_dir: "Sections"
  });
  latestSplit = result.split;
  latestOperation = "split";
  setStatus("Split finished.", "ok");
  acceptServerModel(result);
}

async function renumberCurrent(): Promise<void> {
  await flushAutosave();
  const result = await request("renumber", {
    compile_target: byId<HTMLSelectElement>("splitSourceSelect").value,
    mode: byId<HTMLSelectElement>("renumberModeSelect").value,
    dry_run: byId<HTMLInputElement>("splitDryRun").checked
  });
  latestRenumber = result.renumber;
  latestOperation = "renumber";
  setStatus("Renumber finished.", "ok");
  acceptServerModel(result);
}

async function unsplitCurrent(): Promise<void> {
  await flushAutosave();
  const deleteSource = byId<HTMLInputElement>("unsplitDeleteSource").checked;
  if (deleteSource && !confirm("Merge selected unit back to root and delete the source file?")) return;
  const result = await request("unsplit", {
    compile_target: byId<HTMLSelectElement>("splitSourceSelect").value,
    dry_run: byId<HTMLInputElement>("splitDryRun").checked,
    delete_source: deleteSource
  });
  latestUnsplit = result.unsplit;
  latestOperation = "unsplit";
  setStatus("Merge finished.", "ok");
  acceptServerModel(result);
}

function wire(): void {
  byId("starterTemplateSelect").addEventListener("change", () => {
    starterTemplateSelection = byId<HTMLSelectElement>("starterTemplateSelect").value;
    renderStarterDescription();
  });
  byId("generateTemplateBtn").addEventListener("click", () => run(bootstrapStarter));
  byId("generateVscodeSettingsBtn").addEventListener("click", () => run(async () => {
    await flushAutosave();
    const result = await request("vscode-settings-generate", {});
    setStatus(result.message || "Checked VS Code settings.", "ok");
    acceptServerModel(result);
  }));
  byId("bodyFontSizeSlider").addEventListener("input", () => {
    const slider = byId<HTMLInputElement>("bodyFontSizeSlider");
    model.state.body_font_size_pt = Number(slider.value);
    byId("bodyFontSizeValue").textContent = `${Number(slider.value).toFixed(1)}pt`;
    renderPreview();
  });
  byId("bodyFontSizeSlider").addEventListener("change", () => scheduleAutosave(0));
  byId("targetSelect").addEventListener("change", () => {
    model.state.compile_target = byId<HTMLSelectElement>("targetSelect").value;
    scheduleAutosave(0);
    renderTargets();
    renderSplitControls();
  });
  byId("recipeSelect").addEventListener("change", () => {
    model.state.compile_recipe = byId<HTMLSelectElement>("recipeSelect").value;
    scheduleAutosave(0);
    renderTargets();
  });
  byId("useInternalFallback").addEventListener("change", () => {
    model.state.compile_use_internal_fallback = byId<HTMLInputElement>("useInternalFallback").checked;
    scheduleAutosave(0);
    renderTargets();
    renderRecipes();
  });
  byId("upgradeThemeAssetsBtn").addEventListener("click", () => run(upgradeThemeAssets));
  byId("compileBtn").addEventListener("click", () => run(compilePdf));
  byId("refreshPdfBtn").addEventListener("click", () => run(refreshPdf));
  byId("openPdfBtn").addEventListener("click", () => run(async () => request("open-pdf", { path: currentPdfPath() })));
  byId("splitBtn").addEventListener("click", () => run(splitCurrent));
  byId("renumberBtn").addEventListener("click", () => run(renumberCurrent));
  byId("unsplitBtn").addEventListener("click", () => run(unsplitCurrent));
  byId("retrySaveBtn").addEventListener("click", () => {
    savePending = true;
    void drainAutosave().catch(() => undefined);
  });
  byId("undoBtn").addEventListener("click", () => run(() => restoreHistory("undo-last-change")));
  byId("redoBtn").addEventListener("click", () => run(() => restoreHistory("redo-last-change")));
  byId("savePersonalStyleBtn").addEventListener("click", () => run(() => managePersonalStyle("personal-style-save")));
  byId("updatePersonalStyleBtn").addEventListener("click", () => run(() => managePersonalStyle("personal-style-update", model.state.style_preset)));
  byId("importStylesBtn").addEventListener("click", () => run(() => managePersonalStyle("personal-style-import")));
  byId("exportStylesBtn").addEventListener("click", () => run(() => managePersonalStyle("personal-style-export")));
  byId("revertAllStyleBtn").addEventListener("click", () => {
    const preset = currentPreset();
    if (!preset) return;
    model.state.colors = { ...preset.colors };
    scheduleAutosave(0);
    renderColors();
    renderPresets();
    renderPreview();
    renderStyleDifferences();
  });
  byId("resetBtn").addEventListener("click", () => run(async () => {
    await flushAutosave();
    if (!confirm("Reset all Toolkit overrides?\n\nThis deletes theme.ui.json, theme.overrides.tex, and theme.colors.tex, including theme, compile, class, toggle, recipe, target, and status settings.")) return;
    acceptServerModel(await request("reset", {}));
    setStatus("Reset all Toolkit override files.", "ok");
  }));
  byId("cleanBtn").addEventListener("click", () => run(async () => {
    await flushAutosave();
    if (!confirm("Clean LaTeX build artifacts in this workspace?")) return;
    const result = await request("clean", { dry_run: false });
    byId("logBox").textContent = [`Cleaned ${result.deleted_count || 0} file(s).`, ...(result.deleted_files || []), ...(result.errors || []).map((x: string) => `error: ${x}`)].join("\n");
    setStatus("Cleanup finished.", result.success ? "ok" : "error");
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearStylePreview();
  });
  wireSectionPersistence();
}

async function restoreHistory(command: "undo-last-change" | "redo-last-change"): Promise<void> {
  await flushAutosave();
  acceptServerModel(await request(command, {}));
  setStatus(command.startsWith("undo") ? "Undid last Toolkit change." : "Redid last Toolkit change.", "ok");
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    setStatus((err as Error).message, "error");
    openSection("sectionDiagnostics");
  }
}

function openSection(id: string): void {
  const section = document.getElementById(id) as HTMLDetailsElement | null;
  if (!section) return;
  section.open = true;
  persistSectionState();
}

function wireSectionPersistence(): void {
  const saved = vscode.getState()?.sections || {};
  document.querySelectorAll<HTMLDetailsElement>("details.major-section").forEach((section) => {
    if (section.id in saved) section.open = Boolean(saved[section.id]);
    section.addEventListener("toggle", persistSectionState);
  });
}

function persistSectionState(): void {
  const sections: Record<string, boolean> = {};
  document.querySelectorAll<HTMLDetailsElement>("details.major-section").forEach((section) => { sections[section.id] = section.open; });
  vscode.setState({ ...(vscode.getState() || {}), sections });
}

function shell(): void {
  const initial = JSON.parse(document.getElementById("app")?.getAttribute("data-initial") || "{}");
  document.body.innerHTML = `
    <main class="app-shell">
      <header class="topbar panel">
        <div>
          <p class="eyebrow">LaTeX Editing Toolkit</p>
          <h1>${initial.workspaceName || "Workspace"}</h1>
          <p class="path">${initial.workspacePath || ""}</p>
        </div>
        <div class="save-strip"><span id="saveIndicator">Loading…</span><button id="retrySaveBtn" hidden>Retry</button><button id="undoBtn" disabled>Undo</button><button id="redoBtn" disabled>Redo</button></div>
      </header>
      <div class="layout">
      <aside class="panel left">
        <details id="sectionStyle" class="major-section" open>
          <summary>Style</summary>
          <div id="stylePresetCards" role="group" aria-label="Style presets"></div>
          <p id="customizedSummary" class="customized-summary" hidden></p>
          <div class="toolbar"><button id="savePersonalStyleBtn" hidden>Save as Personal Style</button><button id="updatePersonalStyleBtn" hidden>Update Personal Style</button><button id="importStylesBtn">Import</button><button id="exportStylesBtn">Export Library</button></div>
          <details id="styleDifferences" hidden><summary>View Changes</summary><div class="toolbar"><button id="revertAllStyleBtn">Revert All</button></div><div id="styleDifferenceList"></div></details>
          <h2>Live Style Preview</h2>
          <div id="docPreview" class="doc-preview"></div>
          <div id="preview" class="preview-grid"></div>
        </details>
        <details id="sectionDocument" class="major-section">
          <summary>Document Settings</summary>
          <h2>Theme Toggles</h2>
          <div id="toggleBox" class="toggles"></div>
          <h2>Body Text</h2>
          <div class="row"><input id="bodyFontSizeSlider" type="range"><code id="bodyFontSizeValue"></code></div>
          <p id="bodyFontSizeHelp" class="hint"></p>
          <h2>Class Rules</h2>
          <div id="classConfigBox" class="class-config"></div>
        </details>
        <details id="sectionColors" class="major-section">
          <summary>Advanced Colors</summary>
          <div id="groupBox"></div>
        </details>
      </aside>
      <section class="panel right">
        <details id="sectionBuild" class="major-section" open>
          <summary>Build &amp; PDF</summary>
          <div class="row"><select id="targetSelect"></select></div>
          <div class="row"><select id="recipeSelect"></select><label class="inline"><input id="useInternalFallback" type="checkbox"> internal fallback</label></div>
          <p id="compileHelp" class="hint"></p>
          <code id="targetInfo" class="meta"></code>
          <code id="outputInfo" class="meta"></code>
          <div class="toolbar"><button id="compileBtn" class="primary">Compile PDF</button><button id="refreshPdfBtn">Refresh PDF</button><button id="openPdfBtn">Open PDF</button><button id="cleanBtn">Clean</button></div>
          <iframe id="pdfFrame"></iframe>
        </details>
        <details id="sectionSetup" class="major-section">
          <summary>Project Setup</summary>
          <h2>Starter Template</h2>
          <div class="row"><select id="starterTemplateSelect"></select><input id="starterOutputTarget" placeholder="main.tex"><label class="inline"><input id="starterOverwrite" type="checkbox"> overwrite</label><button id="generateTemplateBtn">Generate</button></div>
          <p id="starterTemplateDesc" class="hint"></p>
          <div class="toolbar"><button id="generateVscodeSettingsBtn">Generate VS Code Settings</button></div>
          <div class="upgrade-row"><label for="upgradeColorPolicy">Theme upgrade colors</label><select id="upgradeColorPolicy"><option value="preserve" selected>Preserve Colors</option><option value="default">Reset to Default</option></select><button id="upgradeThemeAssetsBtn">Upgrade Theme Assets</button></div>
          <button id="resetBtn" class="danger">Reset All Toolkit Overrides</button>
        </details>
        <details id="sectionStructure" class="major-section">
          <summary>Structure Tools</summary>
          <h2>Split + Subfiles Standalone</h2>
          <div class="row"><select id="splitSourceSelect"></select><code id="splitModeTag">subfiles</code><label class="inline"><input id="splitDryRun" type="checkbox"> dry run</label></div>
          <div class="row"><button id="splitBtn">Split Current Target</button><select id="renumberModeSelect"><option value="add">add</option><option value="remove">remove</option></select><button id="renumberBtn">Renumber</button><label class="inline"><input id="unsplitDeleteSource" type="checkbox" checked> delete source</label><button id="unsplitBtn">Merge Selected</button></div>
          <pre id="splitResult" class="result"></pre>
        </details>
        <details id="sectionDiagnostics" class="major-section">
          <summary>Diagnostics</summary>
          <details id="configWarnings" class="config-warnings" hidden><summary id="configWarningSummary">Configuration warnings</summary><ul id="configWarningList"></ul></details>
          <pre id="logBox" class="log">(click Compile PDF to run)</pre>
        </details>
        <div id="status" class="status"></div>
      </section>
      </div>
    </main>`;
}

shell();
wire();
run(loadState);
