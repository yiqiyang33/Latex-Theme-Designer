"use strict";
(() => {
  // src/webview/uiState.ts
  var TOOLKIT_SECTIONS = ["style", "build", "document", "colors", "setup", "structure", "snippets", "sync", "diagnostics"];
  var STRUCTURE_TASKS = ["split", "renumber", "unsplit"];
  function readWorkspaceUiState(value, workspaceKey) {
    const root = record(value);
    const workspaces = record(root?.workspaces);
    const workspace = record(workspaces?.[workspaceKey]);
    const activeSection2 = TOOLKIT_SECTIONS.includes(workspace?.activeSection) ? workspace?.activeSection : "style";
    const activeStructureTask2 = (root?.version === 2 || root?.version === 3 || root?.version === 4) && STRUCTURE_TASKS.includes(workspace?.activeStructureTask) ? workspace?.activeStructureTask : "split";
    const selectedSnippetFile2 = typeof workspace?.selectedSnippetFile === "string" ? workspace.selectedSnippetFile : void 0;
    const snippetSearch2 = typeof workspace?.snippetSearch === "string" ? workspace.snippetSearch : void 0;
    const selectedRemoteProjectId = typeof workspace?.selectedRemoteProjectId === "string" ? workspace.selectedRemoteProjectId : void 0;
    const selectedSyncPath = typeof workspace?.selectedSyncPath === "string" ? workspace.selectedSyncPath : void 0;
    const result = { activeSection: activeSection2, activeStructureTask: activeStructureTask2 };
    if (selectedSnippetFile2 !== void 0) result.selectedSnippetFile = selectedSnippetFile2;
    if (snippetSearch2 !== void 0) result.snippetSearch = snippetSearch2;
    if (selectedRemoteProjectId !== void 0) result.selectedRemoteProjectId = selectedRemoteProjectId;
    if (selectedSyncPath !== void 0) result.selectedSyncPath = selectedSyncPath;
    return result;
  }
  function updateWorkspaceUiState(value, workspaceKey, activeSection2, activeStructureTask2, snippets = {}) {
    const root = record(value);
    const existing = record(root?.workspaces);
    const workspaces = {};
    for (const [key, raw] of Object.entries(existing || {})) {
      const normalized = readWorkspaceUiState(value, key);
      workspaces[key] = normalized;
    }
    workspaces[workspaceKey] = { activeSection: activeSection2, activeStructureTask: activeStructureTask2, ...snippets };
    return { version: 4, workspaces };
  }
  function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
  }

  // src/webview/structureSummary.ts
  function buildStructureSummary(operation, result) {
    const created = operation === "split" ? strings(result?.generated_subfile_targets) : [];
    let updated = [...new Set(strings(result?.updated_files))];
    const renamed = operation === "renumber" ? Object.entries(result?.renamed || {}).map(([from, to]) => `${from} \u2192 ${String(to)}`) : [];
    const deleted = operation === "unsplit" && result?.delete_source && typeof result?.source_target === "string" ? [result.source_target] : [];
    if (deleted.length > 0) updated = updated.filter((value) => !deleted.includes(value));
    const warnings = strings(result?.warnings);
    return {
      created: created.length,
      updated: updated.length,
      renamed: renamed.length,
      deleted: deleted.length,
      warnings: warnings.length,
      entries: [
        ...created.map((value) => ({ kind: "Created", value })),
        ...updated.map((value) => ({ kind: "Updated", value })),
        ...renamed.map((value) => ({ kind: "Renamed", value })),
        ...deleted.map((value) => ({ kind: "Deleted", value })),
        ...warnings.map((value) => ({ kind: "Warning", value }))
      ]
    };
  }
  function strings(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }

  // src/webview/index.ts
  var vscode = acquireVsCodeApi();
  var initialData = JSON.parse(document.getElementById("app")?.getAttribute("data-initial") || "{}");
  var pending = /* @__PURE__ */ new Map();
  var model = null;
  var latestSplit = null;
  var latestRenumber = null;
  var latestUnsplit = null;
  var latestOperation = "";
  var starterTemplateSelection = "";
  var previewStylePresetId = "";
  var persistedState = null;
  var draftRevision = 0;
  var saveTimer;
  var savePending = false;
  var saveDrain = null;
  var lastSaveError = null;
  var activeSection = "style";
  var activeStructureTask = "split";
  var pdfStatus = { path: "", exists: false, checking: true };
  var noticeTimer;
  var saveIdleTimer;
  var lastPersonalStyleMenuTrigger = null;
  var lastCompileDurationMs = null;
  var snippetState = null;
  var selectedSnippetFile = "";
  var selectedSnippetId = "";
  var snippetSearch = "";
  var snippetEditorContent = "";
  var snippetSavedHash = "";
  var snippetSavedMtimeMs;
  var snippetDirty = false;
  var snippetAnalysis = null;
  var snippetAnalyzeTimer;
  var snippetEditor = null;
  var snippetEditorLoading = null;
  var snippetApplyingContent = false;
  var overleafState = null;
  function request(command, payload = {}) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    vscode.postMessage({ id, command, payload });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  window.addEventListener("message", (event) => {
    if (event.data?.type === "toolkit-state-refresh") {
      acceptServerModel(event.data.data);
      return;
    }
    if (event.data?.type === "toolkit-open-section" && (event.data.section === "snippets" || event.data.section === "sync")) {
      selectSection(event.data.section, true, true);
      if (event.data.section === "snippets") void ensureSnippetsLoaded();
      if (event.data.section === "sync") void refreshOverleafState();
      return;
    }
    const response = event.data;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.ok) waiter.resolve(response.data);
    else waiter.reject(new Error(response.error || "Toolkit request failed."));
  });
  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element: ${id}`);
    return el;
  }
  function setStatus(message, kind = "") {
    if (!message) {
      clearNotice();
      return;
    }
    showNotice({
      kind: kind === "error" ? "error" : kind === "ok" ? "success" : "warning",
      message,
      action: kind === "error" ? "show-log" : void 0,
      dismissible: kind === "error"
    });
  }
  function setSaveStatus(message, kind = "") {
    if (saveIdleTimer !== void 0) window.clearTimeout(saveIdleTimer);
    const el = byId("saveIndicator");
    el.textContent = message;
    el.dataset.kind = kind;
    byId("retrySaveBtn").hidden = kind !== "error";
    byId("saveShowLogBtn").hidden = kind !== "error";
    if (kind === "ok" && message !== "Saved") {
      saveIdleTimer = window.setTimeout(() => {
        el.textContent = "Saved";
        saveIdleTimer = void 0;
      }, 3e3);
    }
  }
  function showNotice(notice) {
    if (noticeTimer !== void 0) window.clearTimeout(noticeTimer);
    const box = byId("notice");
    const icon = byId("noticeIcon");
    const message = byId("noticeMessage");
    const action = byId("noticeActionBtn");
    const dismiss = byId("dismissNoticeBtn");
    box.hidden = false;
    box.dataset.kind = notice.kind;
    message.textContent = notice.message;
    icon.className = `codicon codicon-${notice.kind === "success" ? "pass-filled" : notice.kind === "error" ? "error" : "info"}`;
    action.hidden = !notice.action;
    action.dataset.action = notice.action || "";
    action.textContent = notice.action === "retry" ? "Retry" : notice.action === "open-diagnostics" ? "Open Diagnostics" : "Show Log";
    dismiss.hidden = !notice.dismissible;
    if (notice.kind === "success") {
      noticeTimer = window.setTimeout(() => clearNotice(), 3e3);
    }
  }
  function clearNotice() {
    if (noticeTimer !== void 0) window.clearTimeout(noticeTimer);
    noticeTimer = void 0;
    const box = document.getElementById("notice");
    if (box) box.hidden = true;
  }
  async function confirmAction(action, detail = "") {
    const result = await request("confirm-action", { action, detail });
    return Boolean(result.confirmed);
  }
  function scheduleAutosave(delay = 0) {
    draftRevision += 1;
    savePending = true;
    lastSaveError = null;
    setSaveStatus("Saving\u2026", "saving");
    if (saveTimer !== void 0) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = void 0;
      void drainAutosave().catch(() => void 0);
    }, delay);
  }
  async function drainAutosave() {
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
          setSaveStatus(`Saved ${(/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, "ok");
          renderHistoryActions();
          renderPresets();
        } catch (err) {
          lastSaveError = err;
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
  async function flushAutosave() {
    if (saveTimer !== void 0) {
      window.clearTimeout(saveTimer);
      saveTimer = void 0;
    }
    if (savePending) await drainAutosave();
    else if (saveDrain) await saveDrain;
    if (lastSaveError) throw lastSaveError;
  }
  function acceptServerModel(next) {
    model = next;
    persistedState = clone(next.state);
    previewStylePresetId = "";
    lastSaveError = null;
    renderAll();
  }
  function stateColor(token) {
    return model?.state?.colors?.[token] || "#808080";
  }
  function previewColor(token) {
    const pendingPreset = (model?.schema?.style_presets || []).find((preset) => preset.id === previewStylePresetId);
    return pendingPreset?.colors?.[token] || stateColor(token);
  }
  function clone(value) {
    return structuredClone(value);
  }
  function toggleOn(id) {
    return !!model?.state?.toggles?.[id];
  }
  function bodyFontSize() {
    const schema = model.schema.body_font_size;
    return Number(model.state[schema.id] || schema.default || 10);
  }
  function recipeName(id) {
    return (model.state.compile_recipes || []).find((recipe) => recipe.id === id)?.name || "";
  }
  function currentPdfPath() {
    return model.state.compile_output_pdf || model.state.compile_output_pdf_expected || pdfForTarget(model.state.compile_target);
  }
  function pdfForTarget(target) {
    return target && target.endsWith(".tex") ? `${target.slice(0, -4)}.pdf` : "main.pdf";
  }
  function classConfigValue(id) {
    const fallback = (model.schema.class_config || []).find((field) => field.id === id)?.options?.[0]?.value || "auto";
    return model.state.class_config?.[id] || fallback;
  }
  function effectiveThemeClass() {
    const mode = classConfigValue("theme_class_mode");
    if (mode === "book" || mode === "article") return mode;
    return model.state.effective_theme_class || "article";
  }
  function chapterStyleStatus() {
    if (!model.state.detected_document_class_has_chapter && effectiveThemeClass() !== "book") {
      return { active: false, message: "inactive (target class has no chapter)" };
    }
    const mode = classConfigValue("theme_heading_chapter_mode");
    if (mode === "off") return { active: false, message: "inactive (forced off)" };
    if (mode === "on") return { active: true, message: "active (forced on)" };
    return effectiveThemeClass() === "book" ? { active: true, message: "active (auto + effective class book)" } : { active: false, message: "inactive (auto + effective class article)" };
  }
  function renderSelect(select, entries, preferred) {
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
  function renderAll() {
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
    renderContextPanels();
    void refreshOverleafState();
    void refreshPdfStatus();
  }
  async function refreshOverleafState() {
    if (initialData.snippetsOnly) return;
    try {
      overleafState = await request("overleaf-state", {});
      if (overleafState?.available && overleafState.compileMode === "overleaf") {
        const remotePdf = await request("overleaf-pdf-status", {});
        if (remotePdf?.exists) pdfStatus = { path: remotePdf.path, exists: true, checking: false };
      }
    } catch {
      overleafState = null;
    }
    renderSyncPanel();
    if (model) {
      renderTargets();
      renderBuildContext();
    }
  }
  function renderSyncPanel() {
    const state = overleafState;
    const unavailable = byId("syncUnavailable");
    const details = byId("syncDetails");
    unavailable.hidden = Boolean(state?.available);
    details.hidden = !state?.available;
    if (!state?.available) {
      byId("syncContextTitle").textContent = "No mirror selected";
      byId("syncContextBadge").textContent = "";
      byId("syncContextDescription").textContent = "Open an Overleaf mirror to inspect realtime status.";
      byId("syncContextEmpty").hidden = false;
      byId("syncContextSummary").hidden = true;
      return;
    }
    byId("syncServer").textContent = state.serverUrl || "\u2014";
    byId("syncProject").textContent = state.projectName || "\u2014";
    byId("syncMirror").textContent = state.mirrorRoot || "\u2014";
    const status = state.conflicts?.length ? "Conflict" : state.running ? "Syncing" : state.syncStatus?.hasBlocking ? "Needs attention" : "Ready";
    byId("syncStatus").textContent = status;
    byId("syncContextTitle").textContent = state.projectName || "Overleaf mirror";
    byId("syncContextBadge").textContent = status;
    byId("syncContextDescription").textContent = state.error || (state.authenticated ? "Remote mirror is available for synchronization." : "Login is required before starting sync.");
    byId("syncContextEmpty").hidden = true;
    byId("syncContextSummary").hidden = false;
    byId("syncContextServer").textContent = state.serverUrl || "\u2014";
    byId("syncContextLastSync").textContent = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : "\u2014";
    byId("syncContextFiles").textContent = `${state.syncItems?.length || 0} needing attention \xB7 ${state.conflicts?.length || 0} conflicts`;
    const items = (state.syncItems || []).filter((item) => item.status !== "synced");
    byId("syncItemCount").textContent = String(items.length);
    const itemList = byId("syncItemList");
    itemList.innerHTML = items.length ? items.map((item) => `<div class="sync-item"><span><strong>${escapeHtml(item.path)}</strong><small>${escapeHtml(item.status)}${item.message ? ` \xB7 ${escapeHtml(item.message)}` : ""}</small></span><span class="toolbar compact"><button class="icon-button" data-sync-action="diff" data-sync-path="${escapeHtml(item.path)}" aria-label="Open diff for ${escapeHtml(item.path)}" title="Open diff"><i class="codicon codicon-diff"></i></button><button class="icon-button" data-sync-action="push" data-sync-path="${escapeHtml(item.path)}" aria-label="Push ${escapeHtml(item.path)}" title="Push local"><i class="codicon codicon-cloud-upload"></i></button><button class="icon-button" data-sync-action="pull" data-sync-path="${escapeHtml(item.path)}" aria-label="Pull ${escapeHtml(item.path)}" title="Pull remote"><i class="codicon codicon-cloud-download"></i></button></span></div>`).join("") : `<div class="empty-state compact"><i class="codicon codicon-pass-filled"></i><div><strong>Everything is synced</strong><p>No file needs attention.</p></div></div>`;
    const conflicts = state.conflicts || [];
    byId("syncConflictCount").textContent = String(conflicts.length);
    const conflictList = byId("syncConflictList");
    conflictList.innerHTML = conflicts.length ? conflicts.map((item) => `<div class="sync-item"><span><strong>${escapeHtml(item.relPath)}</strong><small>${escapeHtml(item.reason || "manual resolution required")}</small></span><span class="toolbar compact"><button class="icon-button" data-conflict-action="diff" data-conflict-path="${escapeHtml(item.relPath)}" aria-label="Open conflict diff for ${escapeHtml(item.relPath)}" title="Open conflict diff"><i class="codicon codicon-diff"></i></button><button class="icon-button" data-conflict-action="local" data-conflict-path="${escapeHtml(item.relPath)}" aria-label="Use local version for ${escapeHtml(item.relPath)}" title="Use local"><i class="codicon codicon-cloud-upload"></i></button><button class="icon-button" data-conflict-action="remote" data-conflict-path="${escapeHtml(item.relPath)}" aria-label="Accept remote version for ${escapeHtml(item.relPath)}" title="Accept remote"><i class="codicon codicon-cloud-download"></i></button></span></div>`).join("") : `<div class="empty-state compact"><i class="codicon codicon-pass-filled"></i><div><strong>No conflicts</strong><p>Conflicts will appear here instead of being overwritten silently.</p></div></div>`;
    itemList.querySelectorAll("[data-sync-action]").forEach((button) => button.addEventListener("click", () => run(async () => {
      const command = button.dataset.syncAction === "diff" ? "overleaf-open-diff" : button.dataset.syncAction === "push" ? "overleaf-push" : "overleaf-pull";
      await request(command, { path: button.dataset.syncPath });
      await refreshOverleafState();
    })));
    conflictList.querySelectorAll("[data-conflict-action]").forEach((button) => button.addEventListener("click", () => run(async () => {
      const action = button.dataset.conflictAction;
      await request("overleaf-resolve-conflict", { path: button.dataset.conflictPath, resolution: action === "local" ? "local" : action === "remote" ? "remote" : "diff" });
      await refreshOverleafState();
    })));
  }
  function renderHistoryActions() {
    const history = model?.history || {};
    const undo = byId("undoBtn");
    const redo = byId("redoBtn");
    undo.disabled = !history.canUndo;
    redo.disabled = !history.canRedo;
    undo.title = history.canUndo ? `Undo ${history.label}` : "Nothing to undo";
    redo.title = history.canRedo ? `Redo ${history.label}` : "Nothing to redo";
    undo.setAttribute("aria-label", undo.title);
    redo.setAttribute("aria-label", redo.title);
  }
  function renderStarter() {
    const select = byId("starterTemplateSelect");
    const output = byId("starterOutputTarget");
    const templates = model.schema.starter_templates || [];
    const preferred = starterTemplateSelection || select.value || model.schema.starter_default_template || "book-minimal";
    starterTemplateSelection = renderSelect(select, templates.map((item) => ({ value: item.id, label: item.label })), preferred);
    renderStarterDescription();
    if (!output.value) output.value = model.schema.starter_default_output_target || "main.tex";
  }
  function renderStarterDescription() {
    const templates = model.schema.starter_templates || [];
    const selected = byId("starterTemplateSelect").value;
    const info = templates.find((item) => item.id === selected);
    byId("starterTemplateDesc").textContent = info?.description || "";
    byId("setupContextTitle").textContent = info?.label || "Starter template";
    byId("setupContextDescription").textContent = info?.description || "Choose a starter template for this workspace.";
    byId("setupContextPolicy").textContent = byId("upgradeColorPolicy").value === "default" ? "Reset colors to Default" : "Preserve current colors";
  }
  function renderPresets() {
    const presets = model.schema.style_presets || [];
    const grid = byId("stylePresetCards");
    grid.innerHTML = "";
    const changes = styleChanges();
    for (const source of ["builtin", "personal"]) {
      const group = presets.filter((preset) => (preset.source || "builtin") === source);
      const heading = document.createElement("h3");
      heading.className = "preset-group-title";
      heading.textContent = source === "builtin" ? "Built-in Styles" : "My Styles";
      grid.appendChild(heading);
      if (source === "personal" && group.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state compact";
        empty.innerHTML = `<i class="codicon codicon-symbol-color" aria-hidden="true"></i><div><strong>No personal styles yet</strong><p>Customize a built-in style, then save it to My Styles.</p></div>`;
        grid.appendChild(empty);
        continue;
      }
      const groupGrid = document.createElement("div");
      groupGrid.className = "style-card-grid";
      for (const preset of group) groupGrid.appendChild(stylePresetCard(preset, changes.length));
      grid.appendChild(groupGrid);
    }
    const summary = byId("customizedSummary");
    summary.textContent = changes.length > 0 ? `Customized from ${currentPreset()?.label || model.state.style_base_preset} \xB7 ${changes.length} change(s)` : "";
    summary.hidden = changes.length === 0;
    const current = currentPreset();
    byId("savePersonalStyleBtn").hidden = changes.length === 0;
    byId("updatePersonalStyleBtn").hidden = !(changes.length > 0 && current?.source === "personal");
  }
  function stylePresetCard(preset, customizedCount) {
    const wrap = document.createElement("div");
    wrap.className = "style-card-wrap";
    wrap.dataset.personal = String(preset.source === "personal");
    const card = document.createElement("button");
    const isApplied = preset.id === persistedState?.style_preset;
    const isDraft = preset.id === model.state.style_preset;
    const isPreview = preset.id === previewStylePresetId;
    card.type = "button";
    card.className = "style-card";
    card.dataset.presetId = preset.id;
    card.dataset.applied = String(isApplied);
    card.dataset.preview = String(isPreview);
    card.setAttribute("aria-pressed", String(isDraft));
    card.setAttribute("aria-label", `${preset.label}: ${preset.description}`);
    for (const [property, token] of [
      ["--preset-chapter", "theme-chapter"],
      ["--preset-section", "theme-section"],
      ["--preset-key", "inline-key-fg"],
      ["--preset-term", "inline-term-bg"],
      ["--preset-block", "theorem-body-bg"],
      ["--preset-block-title", "theorem-title-bg"],
      ["--preset-accent", "theorem-accent"]
    ]) card.style.setProperty(property, preset.colors?.[token] || "#808080");
    const heading = document.createElement("span");
    heading.className = "style-card-heading";
    const title = document.createElement("strong");
    title.textContent = preset.label;
    const badges = document.createElement("span");
    badges.className = "preset-badges";
    for (const [visible, text, className, icon] of [
      [isApplied, "Applied", "", "check"],
      [isDraft && customizedCount > 0, `${customizedCount} changed`, "customized", "edit"]
    ]) {
      if (!visible) continue;
      const badge = document.createElement("span");
      badge.className = `preset-badge ${className}`.trim();
      badge.innerHTML = `<i class="codicon codicon-${icon}" aria-hidden="true"></i><span>${text}</span>`;
      badges.appendChild(badge);
    }
    heading.append(title, badges);
    const miniature = document.createElement("span");
    miniature.className = "style-miniature";
    miniature.setAttribute("aria-hidden", "true");
    miniature.innerHTML = `<span class="mini-chapter"></span><span class="mini-section"></span><span class="mini-copy"><i></i><i></i><b></b></span><span class="mini-theorem"><i></i><b></b></span>`;
    const description = document.createElement("span");
    description.className = "style-card-description";
    description.textContent = preset.description || "";
    card.append(heading, miniature, description);
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
    if (preset.source === "personal") wrap.appendChild(personalStyleMenu(preset));
    return wrap;
  }
  function personalStyleMenu(preset) {
    const menu = document.createElement("details");
    menu.className = "personal-style-menu";
    const summary = document.createElement("summary");
    summary.className = "icon-button";
    summary.title = `Manage ${preset.label}`;
    summary.setAttribute("aria-label", `Manage ${preset.label}`);
    summary.innerHTML = `<i class="codicon codicon-ellipsis" aria-hidden="true"></i>`;
    summary.addEventListener("click", () => {
      lastPersonalStyleMenuTrigger = summary;
      closePersonalStyleMenus(false, menu);
    });
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      lastPersonalStyleMenuTrigger = summary;
      closePersonalStyleMenus(false, menu);
    });
    const actions = document.createElement("div");
    actions.className = "personal-style-actions";
    for (const [label, icon, command] of [
      ["Rename", "edit", "personal-style-rename"],
      ["Export", "export", "personal-style-export"],
      ["Delete", "trash", "personal-style-delete"]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = label === "Delete" ? "menu-action danger" : "menu-action";
      button.innerHTML = `<i class="codicon codicon-${icon}" aria-hidden="true"></i><span>${label}</span>`;
      button.addEventListener("click", () => run(() => managePersonalStyle(command, preset.id)));
      actions.appendChild(button);
    }
    menu.append(summary, actions);
    return menu;
  }
  function closePersonalStyleMenus(restoreFocus, except) {
    document.querySelectorAll(".personal-style-menu[open]").forEach((menu) => {
      if (menu !== except) menu.open = false;
    });
    if (restoreFocus && lastPersonalStyleMenuTrigger?.isConnected) lastPersonalStyleMenuTrigger.focus();
    if (restoreFocus) lastPersonalStyleMenuTrigger = null;
  }
  function currentPreset() {
    return (model.schema.style_presets || []).find((item) => item.id === model.state.style_preset) || (model.schema.style_presets || []).find((item) => item.id === model.state.style_base_preset);
  }
  function setStylePreview(id) {
    previewStylePresetId = id;
    document.querySelectorAll(".style-card").forEach((card) => {
      card.dataset.preview = String(card.dataset.presetId === id);
    });
    renderPreview();
  }
  function clearStylePreview() {
    if (!previewStylePresetId) return;
    previewStylePresetId = "";
    document.querySelectorAll(".style-card").forEach((card) => {
      card.dataset.preview = "false";
    });
    renderPreview();
  }
  function styleChanges() {
    const preset = currentPreset();
    if (!preset?.colors) return [];
    const labels = /* @__PURE__ */ new Map();
    for (const group of model.schema.groups || []) for (const item of group.items || []) labels.set(item.id, { label: item.label, group: group.title });
    return Object.entries(preset.colors).filter(([token, value]) => stateColor(token).toUpperCase() !== String(value).toUpperCase()).map(([token, value]) => ({ token, baseline: String(value), current: stateColor(token), label: labels.get(token)?.label || token, group: labels.get(token)?.group || "Other" }));
  }
  function renderConfigWarnings() {
    const warnings = model?.state?.config_warnings || [];
    const panel = byId("configWarnings");
    panel.hidden = warnings.length === 0;
    byId("configHealthyState").hidden = warnings.length > 0;
    byId("configWarningSummary").textContent = warnings.length === 1 ? "1 configuration warning" : `${warnings.length} configuration warnings`;
    const list = byId("configWarningList");
    list.innerHTML = "";
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      list.appendChild(item);
    }
    const badge = byId("navDiagnosticsBadge");
    badge.hidden = warnings.length === 0;
    badge.textContent = String(warnings.length);
    byId("diagnosticsContextTitle").textContent = warnings.length > 0 ? `${warnings.length} configuration warning${warnings.length === 1 ? "" : "s"}` : "No configuration warnings";
    byId("diagnosticsContextDescription").textContent = warnings.length > 0 ? "Review the warnings and save a normalized configuration when ready." : "Toolkit configuration loaded without field-level recovery warnings.";
  }
  function renderStyleDifferences() {
    const box = byId("styleDifferenceList");
    const changes = styleChanges();
    box.innerHTML = "";
    byId("styleDifferences").hidden = changes.length === 0;
    const grouped = /* @__PURE__ */ new Map();
    for (const change of changes) grouped.set(change.group, [...grouped.get(change.group) || [], change]);
    for (const [group, entries] of grouped) {
      const heading = document.createElement("h4");
      heading.textContent = group;
      box.appendChild(heading);
      for (const entry of entries) {
        const row = document.createElement("div");
        row.className = "style-diff-row";
        row.innerHTML = `<span class="diff-token" title="${entry.token}">${entry.label}<code>${entry.token}</code></span><span class="diff-color" title="Baseline ${entry.baseline}"><i style="background:${entry.baseline}"></i>${entry.baseline}</span><span aria-hidden="true">\u2192</span><span class="diff-color" title="Current ${entry.current}"><i style="background:${entry.current}"></i>${entry.current}</span>`;
        const revert = document.createElement("button");
        revert.type = "button";
        revert.className = "icon-button";
        revert.title = `Revert ${entry.token}`;
        revert.setAttribute("aria-label", revert.title);
        revert.innerHTML = `<i class="codicon codicon-discard" aria-hidden="true"></i>`;
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
  async function managePersonalStyle(command, styleId = "") {
    await flushAutosave();
    const result = await request(command, { style_id: styleId, state: model.state, revision: ++draftRevision });
    if (result?.state) acceptServerModel(result);
    if (result?.personal_style_import) setStatus(`Imported ${result.personal_style_import.imported} style(s); skipped ${result.personal_style_import.skipped}.`, "ok");
  }
  function renderBodyFontSize() {
    const schema = model.schema.body_font_size;
    const slider = byId("bodyFontSizeSlider");
    slider.min = String(schema.min);
    slider.max = String(schema.max);
    slider.step = String(schema.step);
    slider.value = String(bodyFontSize());
    byId("bodyFontSizeValue").textContent = `${Number(slider.value).toFixed(1)}pt`;
    byId("bodyFontSizeHelp").textContent = schema.help;
  }
  function renderToggles() {
    const box = byId("toggleBox");
    box.innerHTML = "";
    for (const item of model.schema.toggles || []) {
      const label = document.createElement("label");
      label.className = "toggle-row";
      label.innerHTML = `<span class="toggle-copy"><strong>${item.label}</strong><small>${item.help || ""}</small></span><span class="switch"><input type="checkbox" ${toggleOn(item.id) ? "checked" : ""}><span aria-hidden="true"></span></span>`;
      label.title = item.help || "";
      label.querySelector("input")?.addEventListener("change", (ev) => {
        model.state.toggles[item.id] = ev.target.checked;
        scheduleAutosave(0);
        renderPreview();
      });
      box.appendChild(label);
    }
  }
  function renderColors() {
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
        const row = document.createElement("div");
        row.className = "color-row";
        const inactiveChapter = item.id === "theme-chapter" && !chapterStatus.active;
        const label = document.createElement("label");
        label.htmlFor = `color-${item.id}`;
        label.innerHTML = `<span>${item.label}${inactiveChapter ? " (inactive)" : ""}</span><code>${item.id}</code>`;
        const colorInput = document.createElement("input");
        colorInput.id = `color-${item.id}`;
        colorInput.type = "color";
        colorInput.setAttribute("aria-label", `${item.label} color`);
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.setAttribute("aria-label", `${item.label} hex value`);
        const revert = document.createElement("button");
        revert.type = "button";
        revert.className = "icon-button color-revert";
        revert.title = `Revert ${item.label} to the current style`;
        revert.setAttribute("aria-label", revert.title);
        revert.innerHTML = `<i class="codicon codicon-discard" aria-hidden="true"></i>`;
        colorInput.value = stateColor(item.id);
        textInput.value = stateColor(item.id);
        const baseline = currentPreset()?.colors?.[item.id];
        revert.disabled = !baseline || String(baseline).toUpperCase() === stateColor(item.id).toUpperCase();
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
        revert.addEventListener("click", () => {
          const next = currentPreset()?.colors?.[item.id];
          if (!next) return;
          model.state.colors[item.id] = next;
          scheduleAutosave(0);
          renderColors();
          renderPreview();
          renderPresets();
          renderStyleDifferences();
        });
        row.append(label, colorInput, textInput, revert);
        rows.appendChild(row);
      }
      details.appendChild(rows);
      box.appendChild(details);
    }
  }
  function renderTargets() {
    const mode = byId("compileModeSelect");
    mode.value = overleafState?.compileMode === "overleaf" ? "overleaf" : "local";
    const target = byId("targetSelect");
    renderSelect(target, (model.state.compile_targets || []).map((value) => ({ value, label: value })), model.state.compile_target || "");
    const info = byId("targetInfo");
    const chapter = chapterStyleStatus();
    info.textContent = `target: ${model.state.compile_target || "(none)"} | mode: ${currentCompileLabel()} | class: ${model.state.detected_document_class || "(unknown)"} -> ${effectiveThemeClass()} | chapter-style: ${chapter.message}`;
    byId("outputInfo").textContent = `current pdf: ${currentPdfPath()} | expected: ${model.state.compile_output_pdf_expected || pdfForTarget(model.state.compile_target)} | last compile: ${model.state.compile_last_compile_at || "never"}`;
    renderBuildContext();
  }
  function currentCompileLabel() {
    return model.state.compile_use_internal_fallback ? "internal fallback" : recipeName(model.state.compile_recipe) || model.state.compile_recipe || "recipe";
  }
  function renderBuildContext() {
    if (!model) return;
    const badge = byId("buildStatusBadge");
    const title = byId("buildContextTitle");
    const description = byId("buildContextDescription");
    const open = byId("openPdfBtn");
    const buildNavBadge = byId("navBuildBadge");
    const targets = model.state.compile_targets || [];
    const compile = byId("compileBtn");
    const noTargets = targets.length === 0;
    const remote = overleafState?.compileMode === "overleaf";
    byId("compileHelp").textContent = remote ? "Remote mode compiles through Overleaf and downloads output to the mirror." : "Local mode uses the configured Toolkit compiler and fallback.";
    byId("targetSelect").disabled = remote;
    byId("recipeSelect").disabled = remote;
    byId("useInternalFallback").disabled = remote;
    byId("buildNoTargets").hidden = !noTargets;
    compile.disabled = noTargets;
    if (noTargets) {
      badge.textContent = "No target";
      badge.dataset.kind = "warning";
      title.textContent = "No compile targets found";
      description.textContent = "Add a local .tex target or generate a starter before compiling.";
      open.disabled = true;
    } else if (remote && overleafState?.syncStatus?.checkedAt) {
      badge.textContent = overleafState.conflicts?.length ? "Conflict" : "Remote";
      badge.dataset.kind = overleafState.conflicts?.length ? "error" : "ok";
      title.textContent = overleafState.conflicts?.length ? "Remote sync needs attention" : "Overleaf Remote Compile";
      description.textContent = overleafState.mirrorRoot || "Open an Overleaf mirror before remote compile.";
      open.disabled = !pdfStatus.exists;
    } else if (pdfStatus.checking) {
      badge.textContent = "Checking";
      badge.dataset.kind = "";
      title.textContent = "Checking PDF status\u2026";
      description.textContent = currentPdfPath();
      open.disabled = true;
    } else if (model.state.compile_last_success === false) {
      badge.textContent = "Failed";
      badge.dataset.kind = "error";
      title.textContent = "Last compile failed";
      description.textContent = pdfStatus.exists ? "The previous PDF is still available." : "No generated PDF is currently available.";
      open.disabled = !pdfStatus.exists;
    } else if (pdfStatus.exists) {
      badge.textContent = "Available";
      badge.dataset.kind = "ok";
      title.textContent = "PDF available";
      description.textContent = pdfStatus.path;
      open.disabled = false;
    } else if (model.state.compile_last_success === true) {
      badge.textContent = "Missing";
      badge.dataset.kind = "warning";
      title.textContent = "Generated PDF is missing";
      description.textContent = "The last compile succeeded, but the expected PDF is no longer present.";
      open.disabled = true;
    } else {
      badge.textContent = "Missing";
      badge.dataset.kind = "warning";
      title.textContent = "No PDF generated yet";
      description.textContent = "Compile the selected target, then open it in the editor.";
      open.disabled = true;
    }
    buildNavBadge.textContent = noTargets ? "0" : model.state.compile_last_success === false ? "!" : pdfStatus.exists ? "PDF" : "";
    buildNavBadge.hidden = !buildNavBadge.textContent;
    byId("buildContextPath").textContent = currentPdfPath();
    byId("buildContextRecipe").textContent = currentCompileLabel();
    byId("buildContextLastCompile").textContent = formatCompileTime(model.state.compile_last_compile_at);
    byId("buildContextDuration").textContent = lastCompileDurationMs === null ? "Not measured" : formatDuration(lastCompileDurationMs);
    byId("openDiagnosticsBtn").hidden = model.state.compile_last_success !== false;
    byId("buildShowLogBtn").hidden = model.state.compile_last_success !== false;
  }
  function formatCompileTime(value) {
    if (!value) return "Never compiled";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : `Last compiled ${date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
  }
  function formatDuration(value) {
    if (value < 1e3) return `${Math.max(1, Math.round(value))} ms`;
    return `${(value / 1e3).toFixed(value < 1e4 ? 1 : 0)} s`;
  }
  function renderRecipes() {
    const select = byId("recipeSelect");
    const recipes = model.state.compile_recipes || [];
    renderSelect(select, recipes.map((item) => ({ value: item.id, label: item.name })), model.state.compile_recipe || "");
    byId("useInternalFallback").checked = !!model.state.compile_use_internal_fallback;
    const errors = model.state.compile_recipe_errors || [];
    byId("compileHelp").textContent = model.state.compile_use_internal_fallback ? "Internal fallback mode ignores recipe selection." : errors.length ? `Recipe settings warning: ${errors.join(" ")}` : "Recipe mode uses .vscode/settings.json.";
  }
  function renderClassConfig() {
    const box = byId("classConfigBox");
    box.innerHTML = "";
    for (const field of model.schema.class_config || []) {
      const label = document.createElement("label");
      label.className = "config-row";
      const select = document.createElement("select");
      renderSelect(select, (field.options || []).map((opt) => ({ value: opt.value, label: opt.label })), classConfigValue(field.id));
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
  function renderSplitControls() {
    const select = byId("splitSourceSelect");
    renderSelect(select, (model.state.compile_targets || []).map((value) => ({ value, label: value })), model.state.compile_target || "");
    byId("splitModeTag").textContent = "subfiles";
    byId("unsplitDeleteSource").checked = true;
  }
  function renderSplitResult() {
    const box = byId("splitResult");
    const result = latestOperation === "split" ? latestSplit : latestOperation === "renumber" ? latestRenumber : latestOperation === "unsplit" ? latestUnsplit : null;
    if (!result) {
      byId("structureEmptyState").hidden = false;
      byId("structureResultState").hidden = true;
      byId("structureResultBadge").hidden = true;
      box.innerHTML = "";
      byId("structureContextTitle").textContent = "No structure operation yet";
      byId("structureContextDescription").textContent = "Run a dry-run first to inspect planned file changes.";
      return;
    }
    byId("structureEmptyState").hidden = true;
    byId("structureResultState").hidden = false;
    const summary = buildStructureSummary(latestOperation, result);
    byId("structureCreatedCount").textContent = String(summary.created);
    byId("structureUpdatedCount").textContent = String(summary.updated);
    byId("structureRenamedCount").textContent = String(summary.renamed);
    byId("structureDeletedCount").textContent = String(summary.deleted);
    byId("structureWarningCount").textContent = String(summary.warnings);
    const badge = byId("structureResultBadge");
    badge.hidden = false;
    badge.textContent = result.success ? result.dry_run ? "Dry run" : "Completed" : "Failed";
    badge.dataset.kind = result.success ? result.dry_run ? "warning" : "ok" : "error";
    box.innerHTML = "";
    for (const entry of summary.entries) {
      const item = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = entry.kind;
      const text = document.createElement("code");
      text.textContent = entry.value;
      item.append(label, text);
      box.appendChild(item);
    }
    byId("structureFilesSummary").textContent = summary.entries.length === 1 ? "1 affected item" : `${summary.entries.length} affected items`;
    byId("structureContextTitle").textContent = `${latestOperation[0]?.toUpperCase() || ""}${latestOperation.slice(1)} ${result.success ? "completed" : "failed"}`;
    byId("structureContextDescription").textContent = result.dry_run ? "Dry run only; no project files were changed." : `${(result.updated_files || []).length} file(s) updated.`;
  }
  function renderPreview() {
    const preview = byId("preview");
    preview.innerHTML = "";
    preview.append(
      sampleCard("Definition", "A state representation that preserves the information needed for future decisions.", "definition"),
      sampleCard("Theorem", "Every contraction mapping on a complete metric space has a unique fixed point.", "theorem"),
      sampleCard("Note", "Keep notation close to the argument that first introduces it.", "note"),
      sampleCard("Insight", "Separate the semantic command from the colors supplied by the active style.", "insight")
    );
    const headingTheme = toggleOn("enable_heading_theme");
    const chapter = chapterStyleStatus();
    const activePreset = previewStylePresetId ? (model.schema.style_presets || []).find((preset) => preset.id === previewStylePresetId) : currentPreset();
    byId("previewModeLabel").textContent = previewStylePresetId ? `Previewing ${activePreset?.label || "style"} \u2014 click to apply` : `${activePreset?.label || "Custom"} \xB7 illustrative preview`;
    const sheet = byId("docPreview");
    sheet.style.setProperty("--preview-body-size", `${Math.max(12, bodyFontSize() * 1.2)}px`);
    sheet.innerHTML = `
    <div class="preview-running-head" style="border-color:${previewColor("theme-header-rule")}">STUDY NOTES <span>CHAPTER 4</span></div>
    <div class="preview-chapter ${chapter.active && headingTheme ? "" : "is-muted"}" style="color:${headingTheme ? previewColor("theme-chapter") : "inherit"}"><span>04</span><strong>Learning and Decisions</strong></div>
    <h2 class="preview-section-heading" style="color:${headingTheme ? previewColor("theme-section") : "inherit"}">4.2 Bellman Operators</h2>
    <h3 class="preview-subsection-heading" style="color:${headingTheme ? previewColor("theme-subsection") : "inherit"}">Contraction and fixed points</h3>
    <p class="preview-body-copy">A useful proof isolates the <strong style="color:${previewColor("theme-bold")}">key structure</strong> before expanding the algebra. Mark a <mark style="background:${previewColor("inline-term-bg")}">highlighted phrase</mark>, a <span class="preview-key" style="background:${previewColor("inline-term-bg")};color:${previewColor("inline-key-fg")};border-color:${previewColor("inline-key-fg")}55">key idea</span>, and a <span class="preview-term" style="background:${previewColor("inline-term-bg")};color:${previewColor("inline-term-fg")}">new term</span>.</p>
    <p class="preview-body-copy"><strong style="color:${previewColor("inline-warn-fg")}">Warning:</strong> confirm the norm before applying the bound. <span class="preview-todo" style="background:${previewColor("inline-todo-bg")};color:${previewColor("inline-todo-fg")}">TODO verify assumptions</span> <code style="background:${previewColor("inline-code-bg")};color:${previewColor("inline-code-fg")}">T(V)</code></p>
    <aside class="preview-sidenote" style="color:${previewColor("sidenote-fg")};border-color:${previewColor("sidenote-accent")}">Sidenote: the semantic commands stay stable when the style changes.</aside>
    <div class="preview-overview" style="background:${previewColor("chapter-overview-bg")};border-color:${previewColor("chapter-overview-accent")}"><strong style="background:${previewColor("chapter-overview-title-bg")};color:${previewColor("chapter-overview-title-fg")}">Chapter overview</strong><span>Definitions, operators, convergence, and practical checks.</span></div>`;
  }
  function sampleCard(title, body, prefix) {
    const card = document.createElement("div");
    card.className = "sample-card";
    const isPlain = prefix === "theorem" && toggleOn("enable_plain_amsthm_theorem");
    const isEnhanced = toggleOn("enable_enhanced_env_style") && !isPlain;
    card.dataset.mode = isPlain ? "plain" : isEnhanced ? "enhanced" : "simple";
    const bodyBg = previewColor(prefix === "note" ? "note-bg" : `${prefix}-bg`) === "#808080" ? previewColor(`${prefix}-body-bg`) : previewColor(prefix === "note" ? "note-bg" : `${prefix}-bg`);
    const titleBg = previewColor(`${prefix}-title-bg`) === "#808080" ? bodyBg : previewColor(`${prefix}-title-bg`);
    const titleFg = previewColor(`${prefix}-title-fg`) === "#808080" ? previewColor(`${prefix}-label-fg`) : previewColor(`${prefix}-title-fg`);
    const accent = previewColor(`${prefix}-accent`) === "#808080" ? previewColor(prefix === "note" ? "note-frame" : `${prefix}-accent`) : previewColor(`${prefix}-accent`);
    card.style.background = bodyBg;
    card.style.borderColor = accent;
    card.style.boxShadow = toggleOn("enable_block_shadow") ? "3px 3px 0 rgba(0,0,0,.12)" : "none";
    card.innerHTML = `<div style="background:${titleBg};color:${titleFg};border-bottom-color:${accent}">${title}</div><p>${body}</p>`;
    return card;
  }
  function snippetDocuments() {
    return Array.isArray(snippetState?.documents) ? snippetState.documents : [];
  }
  function selectedSnippetDocument() {
    return snippetAnalysis || snippetDocuments().find((document2) => document2.filePath === selectedSnippetFile);
  }
  async function ensureSnippetsLoaded() {
    if (!snippetState) await loadSnippetState("snippets-state");
    await initializeSnippetEditor();
    window.requestAnimationFrame(() => snippetEditor?.layout?.());
  }
  async function loadSnippetState(command = "snippets-state") {
    const preferred = selectedSnippetFile;
    const next = await request(command, {});
    acceptSnippetState(next, preferred);
  }
  function acceptSnippetState(next, preferredFile = "") {
    snippetState = next || { documents: [], profiles: [] };
    const documents = snippetDocuments();
    const saved = readWorkspaceUiState(vscode.getState(), workspaceStateKey());
    const preferred = preferredFile || selectedSnippetFile || saved.selectedSnippetFile || "";
    selectedSnippetFile = documents.some((document3) => document3.filePath === preferred) ? preferred : documents[0]?.filePath || "";
    snippetSearch = byId("snippetSearchInput").value || saved.snippetSearch || snippetSearch;
    const document2 = documents.find((entry) => entry.filePath === selectedSnippetFile);
    snippetSavedHash = document2?.hash || "";
    snippetSavedMtimeMs = typeof document2?.mtimeMs === "number" ? document2.mtimeMs : void 0;
    snippetEditorContent = document2?.content || "";
    snippetAnalysis = document2 || null;
    snippetDirty = false;
    selectedSnippetId = document2?.snippets?.[0]?.id || "";
    setSnippetEditorValue(snippetEditorContent);
    renderSnippets();
    persistNavigationState();
  }
  function renderSnippets() {
    if (!document.getElementById("snippetFileList")) return;
    const profile = byId("snippetProfileSelect");
    const profiles = [{ value: "", label: "Base only" }, ...(snippetState?.profiles || []).map((value) => ({ value, label: value }))];
    renderSelect(profile, profiles, snippetState?.activeProfile || "");
    byId("snippetSearchInput").value = snippetSearch;
    const languages = Array.from(new Set(snippetDocuments().map((document2) => document2.language))).sort();
    const language = byId("snippetLanguageFilter");
    const preferredLanguage = language.value;
    renderSelect(language, [{ value: "", label: "All languages" }, ...languages.map((value) => ({ value: String(value), label: String(value) }))], preferredLanguage);
    byId("snippetWorkspaceDirBtn").disabled = !snippetState?.workspaceSnippetDir;
    byId("snippetProfileDirBtn").disabled = !snippetState?.activeProfile;
    byId("snippetCreateScope").querySelector('option[value="workspace"]').disabled = !snippetState?.workspaceSnippetDir;
    byId("snippetCreateScope").querySelector('option[value="profile"]').disabled = !snippetState?.activeProfile;
    renderSnippetFileList();
    renderSnippetEditorHeader();
    renderSnippetContext();
  }
  function filteredSnippetDocuments() {
    const search = snippetSearch.trim().toLowerCase();
    const scope = byId("snippetScopeFilter").value;
    const language = byId("snippetLanguageFilter").value;
    const diagnostics = byId("snippetDiagnosticFilter").value;
    return snippetDocuments().filter((document2) => {
      if (scope && document2.sourceScope !== scope) return false;
      if (language && document2.language !== language) return false;
      if (diagnostics === "issues" && !(document2.diagnostics || []).some((item) => item.severity === "error" || item.severity === "warning")) return false;
      if (diagnostics === "errors" && !(document2.diagnostics || []).some((item) => item.severity === "error")) return false;
      if (!search) return true;
      const haystack = [document2.fileName, document2.filePath, ...(document2.snippets || []).flatMap((snippet) => [snippet.trigger, snippet.description, snippet.flags])].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }
  function renderSnippetFileList() {
    const list = byId("snippetFileList");
    list.innerHTML = "";
    const documents = filteredSnippetDocuments();
    byId("snippetFileCount").textContent = String(documents.length);
    byId("navSnippetsBadge").textContent = String(snippetDocuments().length);
    byId("navSnippetsBadge").hidden = snippetDocuments().length === 0;
    if (documents.length === 0) {
      list.innerHTML = '<div class="empty-state compact"><i class="codicon codicon-symbol-snippet" aria-hidden="true"></i><div><strong>No snippet files</strong><p>Create a .hsnips file or clear the current filters.</p></div></div>';
      return;
    }
    const groups = [["base", "Base"], ["profile", "Active Profile"], ["workspace", "Workspace"]];
    for (const [scope, label] of groups) {
      const entries = documents.filter((document2) => document2.sourceScope === scope);
      if (!entries.length) continue;
      const heading = document.createElement("h4");
      heading.textContent = label;
      list.appendChild(heading);
      for (const entry of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "snippet-file-item";
        button.dataset.active = String(entry.filePath === selectedSnippetFile);
        const errors = (entry.diagnostics || []).filter((item) => item.severity === "error").length;
        const warnings = (entry.diagnostics || []).filter((item) => item.severity === "warning").length;
        button.innerHTML = "<span><strong>" + escapeHtml(entry.fileName) + "</strong><small>" + escapeHtml(entry.language) + " \xB7 " + (entry.snippets || []).length + " snippets</small></span>" + (errors || warnings ? '<span class="snippet-issue-count" title="Diagnostics">' + (errors ? errors + "E" : "") + (errors && warnings ? " \xB7 " : "") + (warnings ? warnings + "W" : "") + "</span>" : "");
        button.title = entry.filePath;
        button.addEventListener("click", () => selectSnippetFile(entry.filePath));
        list.appendChild(button);
      }
    }
  }
  function selectSnippetFile(filePath) {
    if (filePath === selectedSnippetFile) return;
    if (snippetDirty) {
      showNotice({ kind: "warning", message: "Save or reload the current snippet file before switching files.", dismissible: true });
      return;
    }
    const document2 = snippetDocuments().find((entry) => entry.filePath === filePath);
    if (!document2) return;
    selectedSnippetFile = filePath;
    snippetSavedHash = document2.hash || "";
    snippetSavedMtimeMs = typeof document2.mtimeMs === "number" ? document2.mtimeMs : void 0;
    snippetEditorContent = document2.content || "";
    snippetAnalysis = document2;
    snippetDirty = false;
    selectedSnippetId = document2.snippets?.[0]?.id || "";
    setSnippetEditorValue(snippetEditorContent);
    renderSnippets();
    persistNavigationState();
  }
  function renderSnippetEditorHeader() {
    const document2 = selectedSnippetDocument();
    byId("snippetEditorFileName").textContent = document2?.fileName || "No file selected";
    byId("snippetEditorPath").textContent = document2?.filePath || "Create a snippet file to begin.";
    byId("snippetEditorPath").title = document2?.filePath || "";
    const badge = byId("snippetDirtyBadge");
    badge.textContent = snippetDirty ? "Unsaved" : document2 ? "Saved" : "Empty";
    badge.dataset.kind = snippetDirty ? "warning" : "ok";
    for (const id of ["snippetSaveBtn", "snippetReloadFileBtn", "snippetNewBtn", "snippetOpenSourceBtn"]) {
      byId(id).disabled = !document2;
    }
    byId("snippetSaveBtn").disabled = !document2 || !snippetDirty;
  }
  function renderSnippetContext() {
    const currentDocument = selectedSnippetDocument();
    const snippets = currentDocument?.snippets || [];
    if (selectedSnippetId && !snippets.some((snippet) => snippet.id === selectedSnippetId)) selectedSnippetId = snippets[0]?.id || "";
    const selected = snippets.find((snippet) => snippet.id === selectedSnippetId) || snippets[0];
    if (selected && !selectedSnippetId) selectedSnippetId = selected.id;
    byId("snippetContextTitle").textContent = currentDocument?.fileName || "No snippet file selected";
    byId("snippetContextScope").textContent = currentDocument ? currentDocument.sourceScope + (currentDocument.profile ? ":" + currentDocument.profile : "") : "\u2014";
    byId("snippetContextLanguage").textContent = currentDocument?.language || "\u2014";
    byId("snippetContextPath").textContent = currentDocument?.filePath || "\u2014";
    byId("snippetContextPath").title = currentDocument?.filePath || "";
    byId("snippetContextCounts").textContent = currentDocument ? snippets.length + " snippets \xB7 " + (currentDocument.diagnostics || []).length + " diagnostics" : "";
    const list = byId("snippetBlockList");
    list.innerHTML = "";
    for (const snippet of snippets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "snippet-block-item";
      button.dataset.active = String(snippet.id === selectedSnippetId);
      button.innerHTML = "<strong>" + escapeHtml(snippet.trigger || "(empty trigger)") + "</strong><small>" + escapeHtml(snippet.description || snippet.flags || "No description") + "</small>";
      button.addEventListener("click", () => {
        selectedSnippetId = snippet.id;
        revealSnippetLine(Number(snippet.startLine || 0) + 1);
        renderSnippetContext();
      });
      list.appendChild(button);
    }
    byId("snippetNoBlocks").hidden = snippets.length > 0;
    byId("snippetDeleteBtn").toggleAttribute("disabled", !selected?.isSimple);
    byId("snippetDetailTrigger").textContent = selected?.trigger || "\u2014";
    byId("snippetDetailDescription").textContent = selected?.description || "\u2014";
    byId("snippetDetailFlags").textContent = selected?.flags || "\u2014";
    byId("snippetDetailPriority").textContent = String(selected?.priority ?? "\u2014");
    byId("snippetDetailKind").textContent = selected ? [selected.isRegex ? "regex" : "literal", selected.isDynamic ? "dynamic" : "static", selected.isSimple ? "manager-editable" : "source-only"].join(" \xB7 ") : "\u2014";
    byId("snippetDetailBody").textContent = selected?.body || "No snippet selected.";
    const diagnostics = byId("snippetDiagnosticList");
    diagnostics.innerHTML = "";
    const items = currentDocument?.diagnostics || [];
    for (const item of items) {
      const row = document.createElement("li");
      row.dataset.severity = item.severity || "info";
      row.innerHTML = '<i class="codicon codicon-' + (item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "info") + '" aria-hidden="true"></i><span>' + escapeHtml(item.message) + "<small>Line " + (Number(item.line || 0) + 1) + "</small></span>";
      row.addEventListener("click", () => revealSnippetLine(Number(item.line || 0) + 1));
      diagnostics.appendChild(row);
    }
    byId("snippetNoDiagnostics").hidden = items.length > 0;
  }
  function setSnippetEditorValue(value) {
    snippetApplyingContent = true;
    snippetEditorContent = value;
    if (snippetEditor) snippetEditor.setValue(value);
    const textarea = byId("snippetFallbackEditor");
    textarea.value = value;
    snippetApplyingContent = false;
  }
  function currentSnippetEditorValue() {
    return snippetEditor ? snippetEditor.getValue() : byId("snippetFallbackEditor").value;
  }
  function onSnippetEditorChanged() {
    if (snippetApplyingContent || !selectedSnippetFile) return;
    snippetEditorContent = currentSnippetEditorValue();
    snippetDirty = true;
    renderSnippetEditorHeader();
    scheduleSnippetAnalysis();
  }
  function scheduleSnippetAnalysis() {
    if (snippetAnalyzeTimer !== void 0) window.clearTimeout(snippetAnalyzeTimer);
    snippetAnalyzeTimer = window.setTimeout(() => {
      snippetAnalyzeTimer = void 0;
      void analyzeSnippetBuffer();
    }, 180);
  }
  async function analyzeSnippetBuffer() {
    if (!selectedSnippetFile) return;
    try {
      snippetAnalysis = await request("snippets-analyze", { file_path: selectedSnippetFile, content: snippetEditorContent });
      renderSnippetContext();
      renderSnippetEditorHeader();
    } catch (err) {
      byId("snippetContextCounts").textContent = err.message;
    }
  }
  async function saveSnippetFile() {
    if (!selectedSnippetFile || !snippetDirty) return;
    const currentFile = selectedSnippetFile;
    const next = await request("snippets-save", {
      file_path: currentFile,
      content: currentSnippetEditorValue(),
      document_hash: snippetSavedHash,
      mtime_ms: snippetSavedMtimeMs
    });
    acceptSnippetState(next, currentFile);
    showNotice({ kind: "success", message: "Snippet file saved and snippets reloaded.", dismissible: false });
  }
  function appendNewSnippet() {
    const document2 = selectedSnippetDocument();
    if (!document2) return;
    const triggers = new Set((document2.snippets || []).map((snippet) => snippet.trigger));
    let trigger = "newSnippet";
    let suffix = 2;
    while (triggers.has(trigger)) trigger = "newSnippet" + suffix++;
    const current = currentSnippetEditorValue();
    const separator = !current ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    setSnippetEditorValue(current + separator + "snippet " + trigger + ' "New snippet"\n$1\nendsnippet\n');
    snippetDirty = true;
    renderSnippetEditorHeader();
    void analyzeSnippetBuffer().then(() => {
      const created = snippetAnalysis?.snippets?.find((snippet) => snippet.trigger === trigger);
      if (created) {
        selectedSnippetId = created.id;
        revealSnippetLine(Number(created.startLine || 0) + 1);
        renderSnippetContext();
      }
    });
  }
  function deleteSelectedSnippet() {
    const document2 = selectedSnippetDocument();
    const snippet = document2?.snippets?.find((entry) => entry.id === selectedSnippetId);
    if (!snippet?.isSimple) return;
    const content = currentSnippetEditorValue();
    const start = Number(snippet.priorityStart ?? snippet.headerStart ?? 0);
    const end = Number(snippet.endOffset ?? start);
    setSnippetEditorValue(content.slice(0, start) + content.slice(end));
    snippetDirty = true;
    selectedSnippetId = "";
    renderSnippetEditorHeader();
    void analyzeSnippetBuffer();
  }
  async function createSnippetFile() {
    const language = byId("snippetCreateLanguage").value.trim() || "latex";
    const scope = byId("snippetCreateScope").value;
    const next = await request("snippets-create-file", { language, scope });
    const created = (next.documents || []).find((document2) => document2.language === language.toLowerCase() && document2.sourceScope === scope);
    acceptSnippetState(next, created?.filePath || "");
  }
  async function initializeSnippetEditor() {
    if (snippetEditor || snippetEditorLoading || !initialData.monacoBaseUri) return snippetEditorLoading || Promise.resolve();
    snippetEditorLoading = new Promise((resolve) => {
      const fallback = () => {
        byId("snippetEditorFallbackNotice").hidden = false;
        byId("snippetFallbackEditor").hidden = false;
        resolve();
      };
      const begin = () => {
        try {
          const amd = window.require;
          window.MonacoEnvironment = {
            getWorkerUrl: () => {
              const source = "self.MonacoEnvironment={baseUrl:" + JSON.stringify(initialData.monacoBaseUri + "/") + "};importScripts(" + JSON.stringify(initialData.monacoBaseUri + "/base/worker/workerMain.js") + ");";
              return "data:text/javascript;charset=utf-8," + encodeURIComponent(source);
            }
          };
          amd.config({ paths: { vs: initialData.monacoBaseUri } });
          amd(["vs/editor/editor.main"], () => {
            const monaco = window.monaco;
            if (!monaco) return fallback();
            monaco.languages.register({ id: "hsnips" });
            monaco.languages.setMonarchTokensProvider("hsnips", {
              tokenizer: { root: [[/^snippet.*$/, "keyword"], [/^(global|endglobal|endsnippet|priority).*$/, "keyword"], [/``/, { token: "string", next: "@javascript" }]], javascript: [[/``/, { token: "string", next: "@pop" }], [/./, "string"]] }
            });
            snippetEditor = monaco.editor.create(byId("snippetMonacoHost"), {
              value: snippetEditorContent,
              language: "hsnips",
              automaticLayout: true,
              minimap: { enabled: false },
              fontFamily: "var(--vscode-editor-font-family)",
              fontSize: 12,
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              theme: document.body.classList.contains("vscode-light") ? "vs" : "vs-dark"
            });
            snippetEditor.onDidChangeModelContent(onSnippetEditorChanged);
            snippetEditor.onDidChangeCursorPosition((event) => selectSnippetAtLine(Number(event.position?.lineNumber || 1)));
            byId("snippetFallbackEditor").hidden = true;
            byId("snippetMonacoHost").hidden = false;
            byId("snippetEditorFallbackNotice").hidden = true;
            resolve();
          }, fallback);
        } catch {
          fallback();
        }
      };
      if (window.require) return begin();
      const loader = document.createElement("script");
      loader.src = initialData.monacoBaseUri + "/loader.js";
      loader.addEventListener("load", begin, { once: true });
      loader.addEventListener("error", fallback, { once: true });
      document.head.appendChild(loader);
    }).finally(() => {
      snippetEditorLoading = null;
    });
    return snippetEditorLoading;
  }
  function revealSnippetLine(line) {
    if (snippetEditor) {
      snippetEditor.revealLineInCenter(line);
      snippetEditor.setPosition({ lineNumber: line, column: 1 });
      snippetEditor.focus();
    } else {
      byId("snippetFallbackEditor").focus();
    }
  }
  function selectSnippetAtLine(line) {
    const snippets = selectedSnippetDocument()?.snippets || [];
    const match = snippets.find((snippet) => line - 1 >= Number(snippet.startLine || 0) && line - 1 <= Number(snippet.endLine || 0));
    if (!match || match.id === selectedSnippetId) return;
    selectedSnippetId = match.id;
    renderSnippetContext();
  }
  async function runSnippet(fn) {
    try {
      await fn();
    } catch (err) {
      showNotice({ kind: "error", message: err.message, action: "show-log", dismissible: true });
    }
  }
  function wireSnippets() {
    byId("snippetReloadBtn").addEventListener("click", () => void runSnippet(() => loadSnippetState("snippets-reload")));
    byId("snippetReloadFileBtn").addEventListener("click", () => void runSnippet(() => loadSnippetState("snippets-state")));
    byId("snippetSaveBtn").addEventListener("click", () => void runSnippet(saveSnippetFile));
    byId("snippetNewBtn").addEventListener("click", appendNewSnippet);
    byId("snippetDeleteBtn").addEventListener("click", deleteSelectedSnippet);
    byId("snippetCreateFileBtn").addEventListener("click", () => void runSnippet(createSnippetFile));
    byId("snippetOpenSourceBtn").addEventListener("click", () => void runSnippet(async () => {
      if (selectedSnippetFile) await request("snippets-open-source", { file_path: selectedSnippetFile, line: 1 });
    }));
    byId("snippetBaseDirBtn").addEventListener("click", () => void runSnippet(async () => request("snippets-open-directory", { scope: "base" })));
    byId("snippetProfileDirBtn").addEventListener("click", () => void runSnippet(async () => request("snippets-open-directory", { scope: "profile" })));
    byId("snippetWorkspaceDirBtn").addEventListener("click", () => void runSnippet(async () => request("snippets-open-directory", { scope: "workspace" })));
    byId("snippetProfileSelect").addEventListener("change", () => void runSnippet(async () => {
      if (snippetDirty) throw new Error("Save or reload the current snippet file before switching profiles.");
      const next = await request("snippets-select-profile", { profile: byId("snippetProfileSelect").value });
      acceptSnippetState(next);
    }));
    for (const id of ["snippetScopeFilter", "snippetLanguageFilter", "snippetDiagnosticFilter"]) {
      byId(id).addEventListener("change", renderSnippetFileList);
    }
    byId("snippetSearchInput").addEventListener("input", () => {
      snippetSearch = byId("snippetSearchInput").value;
      renderSnippetFileList();
      persistNavigationState();
    });
    byId("snippetFallbackEditor").addEventListener("input", onSnippetEditorChanged);
    byId("snippetFallbackEditor").addEventListener("keyup", () => {
      const textarea = byId("snippetFallbackEditor");
      selectSnippetAtLine(textarea.value.slice(0, textarea.selectionStart).split("\n").length);
    });
  }
  async function refreshPdfStatus() {
    const requestedPath = currentPdfPath();
    pdfStatus = { path: requestedPath, exists: false, checking: true };
    renderBuildContext();
    try {
      const result = overleafState?.compileMode === "overleaf" ? await request("overleaf-pdf-status", {}) : await request("pdf-status", { path: requestedPath });
      if (requestedPath !== currentPdfPath()) return;
      pdfStatus = { path: result.path || requestedPath, exists: Boolean(result.exists), checking: false };
    } catch {
      if (requestedPath !== currentPdfPath()) return;
      pdfStatus = { path: requestedPath, exists: false, checking: false };
    }
    renderBuildContext();
  }
  async function loadState() {
    setLoadingState("loading");
    try {
      if (initialData.snippetsOnly) {
        await loadSnippetState("snippets-state");
        activeSection = "snippets";
        selectSection("snippets", true);
        setSaveStatus("Explicit file save", "ok");
      } else {
        acceptServerModel(await request("state"));
        setSaveStatus("Saved", "ok");
        if (activeSection === "snippets") await ensureSnippetsLoaded();
      }
      setLoadingState("ready");
    } catch (err) {
      setLoadingState("error", err.message);
      throw err;
    }
  }
  function setLoadingState(state, message = "") {
    const shell2 = byId("appShell");
    const loading = byId("loadingState");
    const error = byId("loadErrorState");
    const workbench = byId("workbench");
    shell2.setAttribute("aria-busy", String(state === "loading"));
    loading.hidden = state !== "loading";
    error.hidden = state !== "error";
    workbench.hidden = state !== "ready";
    if (state === "error") byId("loadErrorMessage").textContent = message || "Toolkit state could not be loaded.";
  }
  async function bootstrapStarter() {
    await flushAutosave();
    const output = byId("starterOutputTarget").value.trim();
    const overwrite = byId("starterOverwrite").checked;
    if (overwrite && !await confirmAction("starter-overwrite", output)) return;
    const result = await request("template-bootstrap", {
      template_id: byId("starterTemplateSelect").value,
      output_target: output,
      overwrite
    });
    starterTemplateSelection = byId("starterTemplateSelect").value;
    setStatus(`Generated ${result.generated_target}.`, "ok");
    acceptServerModel(result);
  }
  async function upgradeThemeAssets() {
    await flushAutosave();
    const policy = byId("upgradeColorPolicy").value === "default" ? "default" : "preserve";
    if (!await confirmAction("upgrade-theme-assets", policy)) return;
    const result = await request("upgrade-theme-assets", { color_policy: policy });
    acceptServerModel(await request("state", {}));
    setStatus(`Upgraded ${result.upgraded_files?.length || 0} theme asset(s) with ${policy === "default" ? "Default colors" : "colors preserved"}. Backup: ${result.backup_dir}.`, "ok");
  }
  async function compilePdf() {
    await flushAutosave();
    if (overleafState?.compileMode === "overleaf") {
      const result = await request("overleaf-remote-compile", {});
      setStatus("Overleaf Remote compile finished.", "ok");
      await refreshOverleafState();
      await refreshPdfStatus();
      renderBuildContext();
      return result;
    }
    const compileButton = byId("compileBtn");
    const startedAt = performance.now();
    lastCompileDurationMs = null;
    compileButton.disabled = true;
    compileButton.innerHTML = `<i class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></i><span>Compiling\u2026</span>`;
    setStatus("Compiling...", "");
    try {
      const result = await request("compile", {
        ...model.state,
        compile_target: byId("targetSelect").value,
        compile_recipe: byId("recipeSelect").value,
        compile_use_internal_fallback: byId("useInternalFallback").checked
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
      lastCompileDurationMs = performance.now() - startedAt;
      if (result.success) {
        showNotice({ kind: "success", message: `Compile succeeded in ${formatDuration(lastCompileDurationMs)}.`, dismissible: false });
      } else {
        showNotice({ kind: "error", message: "Compile failed. Review Diagnostics for the complete output.", action: "open-diagnostics", dismissible: true });
        selectSection("diagnostics", true, true);
      }
      renderAll();
    } finally {
      compileButton.disabled = false;
      compileButton.innerHTML = `<i class="codicon codicon-play" aria-hidden="true"></i><span>Compile PDF</span>`;
    }
  }
  async function splitCurrent() {
    await flushAutosave();
    const result = await request("split", {
      compile_target: byId("splitSourceSelect").value,
      dry_run: byId("splitDryRun").checked,
      sections_dir: "Sections"
    });
    latestSplit = result.split;
    latestOperation = "split";
    setStatus(result.split?.dry_run ? "Split dry run finished." : "Split finished.", "ok");
    if (result.split && !result.split.success) selectSection("diagnostics", true, true);
    acceptServerModel(result);
  }
  async function renumberCurrent() {
    await flushAutosave();
    const result = await request("renumber", {
      compile_target: byId("splitSourceSelect").value,
      mode: byId("renumberModeSelect").value,
      dry_run: byId("splitDryRun").checked
    });
    latestRenumber = result.renumber;
    latestOperation = "renumber";
    setStatus(result.renumber?.dry_run ? "Renumber dry run finished." : "Renumber finished.", "ok");
    if (result.renumber && !result.renumber.success) selectSection("diagnostics", true, true);
    acceptServerModel(result);
  }
  async function unsplitCurrent() {
    await flushAutosave();
    const deleteSource = byId("unsplitDeleteSource").checked;
    if (deleteSource && !await confirmAction("unsplit-delete-source")) return;
    const result = await request("unsplit", {
      compile_target: byId("splitSourceSelect").value,
      dry_run: byId("splitDryRun").checked,
      delete_source: deleteSource
    });
    latestUnsplit = result.unsplit;
    latestOperation = "unsplit";
    setStatus(result.unsplit?.dry_run ? "Merge dry run finished." : "Merge finished.", "ok");
    if (result.unsplit && !result.unsplit.success) selectSection("diagnostics", true, true);
    acceptServerModel(result);
  }
  function wire() {
    wireNavigation();
    wireSnippets();
    byId("retryLoadBtn").addEventListener("click", () => {
      void loadState().catch(() => void 0);
    });
    byId("loadShowLogBtn").addEventListener("click", () => {
      void request("show-log");
    });
    byId("saveShowLogBtn").addEventListener("click", () => {
      void request("show-log");
    });
    byId("dismissNoticeBtn").addEventListener("click", clearNotice);
    byId("noticeActionBtn").addEventListener("click", () => {
      const action = byId("noticeActionBtn").dataset.action;
      if (action === "open-diagnostics") selectSection("diagnostics", true, true);
      else if (action === "show-log") void request("show-log");
      else if (action === "retry") {
        savePending = true;
        void drainAutosave().catch(() => void 0);
      }
    });
    byId("openDiagnosticsBtn").addEventListener("click", () => selectSection("diagnostics", true, true));
    byId("buildShowLogBtn").addEventListener("click", () => {
      void request("show-log");
    });
    byId("overleafRefreshBtn").addEventListener("click", () => run(refreshOverleafState));
    byId("syncLoginBtn").addEventListener("click", () => run(async () => {
      await request("overleaf-login", {});
      await refreshOverleafState();
    }));
    byId("syncStartBtn").addEventListener("click", () => run(async () => {
      await request("overleaf-start-sync", {});
      await refreshOverleafState();
    }));
    byId("syncStopBtn").addEventListener("click", () => run(async () => {
      await request("overleaf-stop-sync", {});
      await refreshOverleafState();
    }));
    byId("syncCheckBtn").addEventListener("click", () => run(async () => {
      await request("overleaf-check-sync", { mode: "incremental" });
      await refreshOverleafState();
    }));
    byId("compileModeSelect").addEventListener("change", () => run(async () => {
      const mode = byId("compileModeSelect").value === "overleaf" ? "overleaf" : "local";
      await request("overleaf-set-compile-mode", { mode });
      await refreshOverleafState();
      renderTargets();
    }));
    byId("starterTemplateSelect").addEventListener("change", () => {
      starterTemplateSelection = byId("starterTemplateSelect").value;
      renderStarterDescription();
    });
    byId("upgradeColorPolicy").addEventListener("change", () => {
      const reset = byId("upgradeColorPolicy").value === "default";
      byId("setupContextTitle").textContent = "Theme asset upgrade";
      byId("setupContextDescription").textContent = reset ? "Bundled assets will be backed up and current colors will be reset to the complete Default style." : "Bundled assets will be backed up and replaced while current colors and Toolkit settings stay intact.";
    });
    byId("generateTemplateBtn").addEventListener("click", () => run(bootstrapStarter));
    byId("generateVscodeSettingsBtn").addEventListener("click", () => run(async () => {
      await flushAutosave();
      const result = await request("vscode-settings-generate", {});
      setStatus(result.message || "Checked VS Code settings.", "ok");
      acceptServerModel(result);
    }));
    byId("bodyFontSizeSlider").addEventListener("input", () => {
      const slider = byId("bodyFontSizeSlider");
      model.state.body_font_size_pt = Number(slider.value);
      byId("bodyFontSizeValue").textContent = `${Number(slider.value).toFixed(1)}pt`;
      renderPreview();
    });
    byId("bodyFontSizeSlider").addEventListener("change", () => scheduleAutosave(0));
    byId("targetSelect").addEventListener("change", () => {
      model.state.compile_target = byId("targetSelect").value;
      scheduleAutosave(0);
      renderTargets();
      renderSplitControls();
      void refreshPdfStatus();
    });
    byId("recipeSelect").addEventListener("change", () => {
      model.state.compile_recipe = byId("recipeSelect").value;
      scheduleAutosave(0);
      renderTargets();
    });
    byId("useInternalFallback").addEventListener("change", () => {
      model.state.compile_use_internal_fallback = byId("useInternalFallback").checked;
      scheduleAutosave(0);
      renderTargets();
      renderRecipes();
    });
    byId("upgradeThemeAssetsBtn").addEventListener("click", () => run(upgradeThemeAssets));
    byId("upgradeColorPolicy").addEventListener("change", renderStarterDescription);
    byId("compileBtn").addEventListener("click", () => run(compilePdf));
    byId("openPdfBtn").addEventListener("click", () => run(async () => request("open-pdf", { path: currentPdfPath() })));
    byId("splitBtn").addEventListener("click", () => run(splitCurrent));
    byId("renumberBtn").addEventListener("click", () => run(renumberCurrent));
    byId("unsplitBtn").addEventListener("click", () => run(unsplitCurrent));
    byId("retrySaveBtn").addEventListener("click", () => {
      savePending = true;
      void drainAutosave().catch(() => void 0);
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
      if (!await confirmAction("reset-overrides")) return;
      acceptServerModel(await request("reset", {}));
      setStatus("Reset all Toolkit override files.", "ok");
    }));
    byId("cleanBtn").addEventListener("click", () => run(async () => {
      await flushAutosave();
      if (!await confirmAction("clean-artifacts")) return;
      const result = await request("clean", { dry_run: false });
      byId("logBox").textContent = [`Cleaned ${result.deleted_count || 0} file(s).`, ...result.deleted_files || [], ...(result.errors || []).map((x) => `error: ${x}`)].join("\n");
      setStatus("Cleanup finished.", result.success ? "ok" : "error");
    }));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        clearStylePreview();
        closePersonalStyleMenus(true);
        document.querySelectorAll(".overflow-menu[open]").forEach((menu) => {
          menu.open = false;
        });
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".personal-style-menu")) closePersonalStyleMenus(true);
      if (!event.target.closest(".overflow-menu")) {
        document.querySelectorAll(".overflow-menu[open]").forEach((menu) => {
          menu.open = false;
        });
      }
    });
  }
  async function restoreHistory(command) {
    await flushAutosave();
    acceptServerModel(await request(command, {}));
    setStatus(command.startsWith("undo") ? "Undid last Toolkit change." : "Redid last Toolkit change.", "ok");
  }
  async function run(fn) {
    try {
      await fn();
    } catch (err) {
      setStatus(err.message, "error");
      selectSection("diagnostics");
    }
  }
  function wireNavigation() {
    const workspace = workspaceStateKey();
    const saved = readWorkspaceUiState(vscode.getState(), workspace);
    activeSection = saved.activeSection;
    activeStructureTask = saved.activeStructureTask;
    selectedSnippetFile = saved.selectedSnippetFile || "";
    snippetSearch = saved.snippetSearch || "";
    if (initialData.snippetsOnly) activeSection = "snippets";
    document.querySelectorAll("[data-section-target]").forEach((button) => {
      button.addEventListener("click", () => selectSection(button.dataset.sectionTarget, true, true));
      button.addEventListener("keydown", (event) => {
        const sections = availableSections();
        const current = sections.indexOf(button.dataset.sectionTarget);
        let next = current;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % sections.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + sections.length) % sections.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = sections.length - 1;
        else return;
        event.preventDefault();
        selectSection(sections[next], true, true);
        document.querySelector(`[data-section-target="${sections[next]}"]`)?.focus();
      });
    });
    document.querySelectorAll("[data-structure-task]").forEach((button) => {
      button.addEventListener("click", () => selectStructureTask(button.dataset.structureTask));
    });
    selectStructureTask(activeStructureTask, false);
    selectSection(activeSection, false);
  }
  function selectSection(section, persist = true, focusPanel = false) {
    const sections = availableSections();
    activeSection = sections.includes(section) ? section : sections[0];
    document.querySelectorAll("[data-toolkit-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.toolkitPanel !== activeSection;
    });
    document.querySelectorAll("[data-section-target]").forEach((button) => {
      const selected = button.dataset.sectionTarget === activeSection;
      button.dataset.active = String(selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    renderContextPanels();
    if (activeSection === "snippets") void ensureSnippetsLoaded();
    if (persist) persistNavigationState();
    if (focusPanel) {
      window.requestAnimationFrame(() => {
        const heading = document.querySelector(`[data-toolkit-panel="${activeSection}"] .section-heading h2`);
        if (!heading) return;
        heading.tabIndex = -1;
        heading.focus();
      });
    }
  }
  function selectStructureTask(task, persist = true) {
    activeStructureTask = task;
    document.querySelectorAll("[data-structure-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.structurePanel !== activeStructureTask;
    });
    document.querySelectorAll("[data-structure-task]").forEach((button) => {
      const selected = button.dataset.structureTask === activeStructureTask;
      button.dataset.active = String(selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (persist) persistNavigationState();
  }
  function renderContextPanels() {
    const context = activeSection === "style" || activeSection === "document" || activeSection === "colors" ? "style" : activeSection;
    document.querySelectorAll("[data-context-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.contextPanel !== context;
    });
  }
  function persistNavigationState() {
    vscode.setState(updateWorkspaceUiState(vscode.getState(), workspaceStateKey(), activeSection, activeStructureTask, {
      selectedSnippetFile: selectedSnippetFile || void 0,
      snippetSearch: snippetSearch || void 0
    }));
  }
  function availableSections() {
    return initialData.snippetsOnly ? ["snippets"] : TOOLKIT_SECTIONS;
  }
  function workspaceStateKey() {
    return document.body.dataset.workspacePath || "workspace";
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function shell() {
    document.body.dataset.workspacePath = initialData.workspacePath || "workspace";
    document.body.dataset.snippetsOnly = String(Boolean(initialData.snippetsOnly));
    const workspaceName = escapeHtml(initialData.workspaceName || "Workspace");
    const workspacePath = escapeHtml(initialData.snippetsOnly ? "Global, profile, and programmable snippet library" : initialData.workspacePath || "");
    document.body.innerHTML = `
    <main id="appShell" class="app-shell" aria-busy="true">
      <header class="topbar surface">
        <div class="project-identity">
          <span class="project-mark"><i class="codicon codicon-book" aria-hidden="true"></i></span>
          <div class="project-copy">
          <p class="eyebrow">LaTeX Editing Toolkit</p>
          <h1>${workspaceName}</h1>
            <p class="path" title="${workspacePath}">${workspacePath}</p>
          </div>
        </div>
        <div class="save-strip">
          <span id="saveIndicator">Loading\u2026</span>
          <button id="retrySaveBtn" class="ghost-button" hidden><i class="codicon codicon-refresh" aria-hidden="true"></i><span>Retry</span></button>
          <button id="saveShowLogBtn" class="icon-button" hidden aria-label="Show Toolkit log" title="Show Toolkit log"><i class="codicon codicon-output" aria-hidden="true"></i></button>
          <span class="toolbar-divider" aria-hidden="true"></span>
          <button id="undoBtn" class="icon-button" disabled aria-label="Undo"><i class="codicon codicon-discard" aria-hidden="true"></i></button>
          <button id="redoBtn" class="icon-button" disabled aria-label="Redo"><i class="codicon codicon-redo" aria-hidden="true"></i></button>
        </div>
      </header>
      <div id="notice" class="inline-notice" role="status" hidden><i id="noticeIcon" class="codicon codicon-info" aria-hidden="true"></i><span id="noticeMessage"></span><button id="noticeActionBtn" class="notice-action" hidden></button><button id="dismissNoticeBtn" class="icon-button" aria-label="Dismiss notification" title="Dismiss"><i class="codicon codicon-close" aria-hidden="true"></i></button></div>
      <section id="loadingState" class="loading-state" aria-label="Loading Toolkit"><div class="skeleton skeleton-title"></div><div class="skeleton-grid"><div class="skeleton skeleton-nav"></div><div class="skeleton skeleton-content"></div><div class="skeleton skeleton-context"></div></div></section>
      <section id="loadErrorState" class="load-error empty-state" hidden><i class="codicon codicon-error" aria-hidden="true"></i><div><strong>Toolkit could not be loaded</strong><p id="loadErrorMessage"></p><div class="toolbar"><button id="retryLoadBtn" class="primary"><i class="codicon codicon-refresh" aria-hidden="true"></i><span>Retry</span></button><button id="loadShowLogBtn"><i class="codicon codicon-output" aria-hidden="true"></i><span>Show Log</span></button></div></div></section>
      <div id="workbench" class="workbench" hidden>
        <nav class="workspace-nav surface" role="tablist" aria-label="Toolkit sections">
          <button data-section-target="style" role="tab"><i class="codicon codicon-symbol-color" aria-hidden="true"></i><span>Style</span></button>
          <button data-section-target="build" role="tab"><i class="codicon codicon-play" aria-hidden="true"></i><span>Build</span><small id="navBuildBadge" class="nav-badge" hidden></small></button>
          <button data-section-target="document" role="tab"><i class="codicon codicon-book" aria-hidden="true"></i><span>Document</span></button>
          <button data-section-target="colors" role="tab"><i class="codicon codicon-symbol-property" aria-hidden="true"></i><span>Colors</span></button>
          <button data-section-target="setup" role="tab"><i class="codicon codicon-tools" aria-hidden="true"></i><span>Project Setup</span></button>
          <button data-section-target="structure" role="tab"><i class="codicon codicon-list-tree" aria-hidden="true"></i><span>Structure</span></button>
          <button data-section-target="snippets" role="tab"><i class="codicon codicon-symbol-snippet" aria-hidden="true"></i><span>Snippets</span><small id="navSnippetsBadge" class="nav-badge" hidden></small></button>
          <button data-section-target="sync" role="tab"><i class="codicon codicon-cloud" aria-hidden="true"></i><span>Sync</span><small id="navSyncBadge" class="nav-badge" hidden></small></button>
          <button data-section-target="diagnostics" role="tab"><i class="codicon codicon-warning" aria-hidden="true"></i><span>Diagnostics</span><small id="navDiagnosticsBadge" class="nav-badge warning" hidden></small></button>
        </nav>

        <section class="content-pane surface" aria-live="polite">
          <section id="panelStyle" class="toolkit-panel" data-toolkit-panel="style">
            <header class="section-heading">
              <div><p class="eyebrow">Appearance</p><h2>Style Gallery</h2><p class="hint">Hover to preview. Click a style to apply its complete color package.</p></div>
              <div class="toolbar compact"><button id="importStylesBtn" class="ghost-button"><i class="codicon codicon-library" aria-hidden="true"></i><span>Import</span></button><button id="exportStylesBtn" class="ghost-button"><i class="codicon codicon-export" aria-hidden="true"></i><span>Export Library</span></button></div>
            </header>
            <div id="stylePresetCards" role="group" aria-label="Style presets"></div>
            <div class="customized-row"><p id="customizedSummary" class="customized-summary" hidden></p><div class="toolbar compact"><button id="savePersonalStyleBtn" hidden>Save as Personal Style</button><button id="updatePersonalStyleBtn" hidden>Update Personal Style</button></div></div>
            <details id="styleDifferences" class="difference-panel" hidden><summary>View customized tokens</summary><div class="toolbar compact"><button id="revertAllStyleBtn" class="ghost-button"><i class="codicon codicon-discard" aria-hidden="true"></i><span>Revert All</span></button></div><div id="styleDifferenceList"></div></details>
          </section>

          <section id="panelBuild" class="toolkit-panel" data-toolkit-panel="build" hidden>
            <header class="section-heading"><div><p class="eyebrow">Build</p><h2>Compile Configuration</h2><p class="hint">Choose local or Overleaf Remote compilation for the next explicit build.</p></div></header>
            <div class="form-card"><label class="field"><span>Compile Mode</span><select id="compileModeSelect"><option value="local">Local</option><option value="overleaf">Overleaf Remote</option></select></label><label class="field"><span>Target</span><select id="targetSelect"></select></label><label class="field"><span>Recipe</span><select id="recipeSelect"></select></label><label class="toggle-row standalone"><span class="toggle-copy"><strong>Internal fallback</strong><small>Compile without the selected VS Code recipe.</small></span><span class="switch"><input id="useInternalFallback" type="checkbox"><span aria-hidden="true"></span></span></label><p id="compileHelp" class="hint"></p></div>
            <div id="buildNoTargets" class="empty-state compact" hidden><i class="codicon codicon-file-code" aria-hidden="true"></i><div><strong>No compile targets</strong><p>Generate a starter or add a local .tex file to this workspace.</p></div></div>
            <div class="technical-details"><code id="targetInfo" class="meta"></code><code id="outputInfo" class="meta"></code></div>
            <div class="secondary-actions"><details class="overflow-menu"><summary class="icon-button" aria-label="More build actions" title="More build actions"><i class="codicon codicon-ellipsis" aria-hidden="true"></i></summary><div class="overflow-menu-items"><button id="cleanBtn" class="menu-action"><i class="codicon codicon-trash" aria-hidden="true"></i><span>Clean Build Artifacts</span></button></div></details></div>
          </section>

          <section id="panelDocument" class="toolkit-panel" data-toolkit-panel="document" hidden>
            <header class="section-heading"><div><p class="eyebrow">Document</p><h2>Document Settings</h2><p class="hint">These settings save automatically and update the style preview immediately.</p></div></header>
            <div class="settings-group"><h3>Theme Features</h3><div id="toggleBox" class="toggles"></div></div>
            <div class="settings-group"><div class="group-heading"><h3>Body Text</h3><code id="bodyFontSizeValue" class="value-pill"></code></div><input id="bodyFontSizeSlider" class="range-control" type="range"><p id="bodyFontSizeHelp" class="hint"></p></div>
            <div class="settings-group"><h3>Class Rules</h3><div id="classConfigBox" class="class-config"></div></div>
          </section>

          <section id="panelColors" class="toolkit-panel" data-toolkit-panel="colors" hidden>
            <header class="section-heading"><div><p class="eyebrow">Advanced</p><h2>Color Tokens</h2><p class="hint">Drag a color to preview it; release or enter a valid hex value to save.</p></div></header>
            <div id="groupBox" class="color-groups"></div>
          </section>

          <section id="panelSetup" class="toolkit-panel" data-toolkit-panel="setup" hidden>
            <header class="section-heading"><div><p class="eyebrow">Workspace</p><h2>Project Setup</h2><p class="hint">Generate or safely upgrade Toolkit-managed project resources.</p></div></header>
            <article class="action-card"><div class="action-card-icon"><i class="codicon codicon-new-file" aria-hidden="true"></i></div><div class="action-card-body"><h3>Starter Template</h3><p id="starterTemplateDesc" class="hint"></p><p class="affected-files"><i class="codicon codicon-files" aria-hidden="true"></i> Creates the selected target and missing Toolkit theme assets.</p><div class="form-row"><select id="starterTemplateSelect"></select><input id="starterOutputTarget" placeholder="main.tex"><label class="inline"><input id="starterOverwrite" type="checkbox"> overwrite</label></div><div class="action-card-footer"><button id="generateTemplateBtn">Generate</button></div></div></article>
            <article class="action-card"><div class="action-card-icon"><i class="codicon codicon-settings-gear" aria-hidden="true"></i></div><div class="action-card-body"><h3>VS Code Settings</h3><p class="hint">Generate the recommended LaTeX Workshop recipe and output-directory settings.</p><p class="affected-files"><i class="codicon codicon-file-code" aria-hidden="true"></i> Creates .vscode/settings.json only when it is missing.</p><div class="action-card-footer"><button id="generateVscodeSettingsBtn">Generate VS Code Settings</button></div></div></article>
            <article class="action-card"><div class="action-card-icon"><i class="codicon codicon-cloud-download" aria-hidden="true"></i></div><div class="action-card-body"><h3>Theme Assets</h3><p class="hint">Back up and replace bundled theme resources without changing colors by default.</p><p class="affected-files"><i class="codicon codicon-files" aria-hidden="true"></i> Replaces theme.sty, theorems.tex, and commands.tex after backup.</p><div class="form-row"><label class="field compact-field"><span>Colors</span><select id="upgradeColorPolicy"><option value="preserve" selected>Preserve Colors</option><option value="default">Reset to Default</option></select></label></div><div class="action-card-footer"><button id="upgradeThemeAssetsBtn">Upgrade Theme Assets</button></div></div></article>
            <article class="danger-zone"><div><h3>Danger Zone</h3><p>Delete generated Toolkit overrides and configuration from this workspace.</p></div><button id="resetBtn" class="danger">Reset All Toolkit Overrides</button></article>
          </section>

          <section id="panelStructure" class="toolkit-panel" data-toolkit-panel="structure" hidden>
            <header class="section-heading"><div><p class="eyebrow">Structure</p><h2>Structure Tools</h2><p class="hint">Preview file changes with dry-run before modifying the project.</p></div></header>
            <div class="form-card"><label class="field"><span>Source target</span><select id="splitSourceSelect"></select></label><div class="form-row"><code id="splitModeTag" class="value-pill">subfiles</code><label class="inline"><input id="splitDryRun" type="checkbox"> dry run</label></div></div>
            <div class="segmented-control" role="group" aria-label="Structure operation"><button data-structure-task="split" aria-pressed="true">Split</button><button data-structure-task="renumber" aria-pressed="false">Renumber</button><button data-structure-task="unsplit" aria-pressed="false">Merge</button></div>
            <div class="structure-task" data-structure-panel="split"><h3>Split into subfiles</h3><p class="hint">Extract top-level units into the Sections directory and rewrite the root target.</p><button id="splitBtn">Split Current Target</button></div>
            <div class="structure-task" data-structure-panel="renumber" hidden><h3>Renumber units</h3><p class="hint">Add or remove numeric filename prefixes and update references.</p><div class="form-row"><select id="renumberModeSelect"><option value="add">Add prefixes</option><option value="remove">Remove prefixes</option></select><button id="renumberBtn">Renumber</button></div></div>
            <div class="structure-task" data-structure-panel="unsplit" hidden><h3>Merge back to root</h3><p class="hint">Inline the selected unit into the root target.</p><div class="form-row"><label class="inline"><input id="unsplitDeleteSource" type="checkbox" checked> delete source after merge</label><button id="unsplitBtn">Merge Selected</button></div></div>
          </section>

          <section id="panelSnippets" class="toolkit-panel" data-toolkit-panel="snippets" hidden>
            <header class="section-heading"><div><p class="eyebrow">Programmable Writing</p><h2>Snippet Workbench</h2><p class="hint">Manage base, profile, and workspace .hsnips files. Snippet source uses an explicit Save action.</p></div><div class="toolbar compact"><button id="snippetReloadBtn" class="ghost-button"><i class="codicon codicon-refresh" aria-hidden="true"></i><span>Reload All</span></button><button id="snippetBaseDirBtn" class="icon-button" aria-label="Open global snippets directory" title="Open global snippets directory"><i class="codicon codicon-folder-opened" aria-hidden="true"></i></button><button id="snippetProfileDirBtn" class="icon-button" aria-label="Open active profile directory" title="Open active profile directory"><i class="codicon codicon-account" aria-hidden="true"></i></button><button id="snippetWorkspaceDirBtn" class="icon-button" aria-label="Open workspace snippets directory" title="Open workspace snippets directory"><i class="codicon codicon-root-folder-opened" aria-hidden="true"></i></button></div></header>
            <div class="snippet-manager-layout">
              <aside class="snippet-browser" aria-label="Snippet files">
                <label class="field"><span>Active profile</span><select id="snippetProfileSelect"></select></label>
                <label class="snippet-search"><i class="codicon codicon-search" aria-hidden="true"></i><input id="snippetSearchInput" type="text" placeholder="Search triggers, descriptions, files"></label>
                <div class="snippet-filters"><select id="snippetScopeFilter" aria-label="Filter snippet scope"><option value="">All scopes</option><option value="base">Base</option><option value="profile">Profile</option><option value="workspace">Workspace</option></select><select id="snippetLanguageFilter" aria-label="Filter snippet language"><option value="">All languages</option></select><select id="snippetDiagnosticFilter" aria-label="Filter snippet diagnostics"><option value="">All health</option><option value="issues">Warnings &amp; errors</option><option value="errors">Errors only</option></select></div>
                <div class="snippet-browser-heading"><strong>Files</strong><span id="snippetFileCount" class="value-pill">0</span></div>
                <div id="snippetFileList" class="snippet-file-list"></div>
                <div class="snippet-create-row"><input id="snippetCreateLanguage" type="text" value="latex" aria-label="New snippet file language"><select id="snippetCreateScope" aria-label="New snippet file scope"><option value="base">Base</option><option value="profile">Profile</option><option value="workspace">Workspace</option></select><button id="snippetCreateFileBtn" class="icon-button" aria-label="Create or open snippet file" title="Create or open snippet file"><i class="codicon codicon-new-file" aria-hidden="true"></i></button></div>
              </aside>
              <div class="snippet-editor-card">
                <header class="snippet-editor-heading"><div><div class="snippet-editor-title"><h3 id="snippetEditorFileName">No file selected</h3><span id="snippetDirtyBadge" class="context-badge">Empty</span></div><p id="snippetEditorPath" class="path"></p></div><div class="toolbar compact"><button id="snippetNewBtn"><i class="codicon codicon-add" aria-hidden="true"></i><span>New Snippet</span></button><button id="snippetReloadFileBtn" class="ghost-button"><i class="codicon codicon-discard" aria-hidden="true"></i><span>Reload</span></button><button id="snippetOpenSourceBtn" class="ghost-button"><i class="codicon codicon-go-to-file" aria-hidden="true"></i><span>Open Source</span></button><button id="snippetSaveBtn" class="primary"><i class="codicon codicon-save" aria-hidden="true"></i><span>Save</span></button></div></header>
                <div id="snippetEditorFallbackNotice" class="inline-editor-notice" hidden><i class="codicon codicon-info" aria-hidden="true"></i><span>Monaco could not load; using the built-in text editor fallback.</span></div>
                <div id="snippetMonacoHost" class="snippet-monaco" hidden aria-label="hsnips source editor"></div>
                <textarea id="snippetFallbackEditor" class="snippet-fallback-editor" hidden spellcheck="false" aria-label="hsnips source editor"></textarea>
              </div>
            </div>
          </section>

          <section id="panelSync" class="toolkit-panel" data-toolkit-panel="sync" hidden>
            <header class="section-heading"><div><p class="eyebrow">Overleaf</p><h2>Realtime Sync</h2><p class="hint">Mirror local source and Toolkit configuration safely with explicit conflict handling.</p></div><div class="toolbar compact"><button id="overleafRefreshBtn" class="ghost-button"><i class="codicon codicon-refresh" aria-hidden="true"></i><span>Refresh</span></button></div></header>
            <div id="syncUnavailable" class="empty-state compact"><i class="codicon codicon-cloud" aria-hidden="true"></i><div><strong>No Overleaf mirror detected</strong><p>Open an Overleaf project locally to manage realtime sync here.</p></div></div>
            <div id="syncDetails" hidden>
              <div class="form-card"><dl class="summary-list"><div><dt>Server</dt><dd id="syncServer">\u2014</dd></div><div><dt>Project</dt><dd id="syncProject">\u2014</dd></div><div><dt>Mirror</dt><dd id="syncMirror">\u2014</dd></div><div><dt>Status</dt><dd id="syncStatus">\u2014</dd></div></dl><div class="toolbar"><button id="syncLoginBtn" class="secondary"><i class="codicon codicon-key" aria-hidden="true"></i><span>Login</span></button><button id="syncStartBtn" class="primary"><i class="codicon codicon-cloud-upload" aria-hidden="true"></i><span>Start Sync</span></button><button id="syncStopBtn" class="ghost-button"><i class="codicon codicon-debug-stop" aria-hidden="true"></i><span>Stop Sync</span></button><button id="syncCheckBtn" class="ghost-button"><i class="codicon codicon-shield" aria-hidden="true"></i><span>Check Status</span></button></div></div>
              <div class="settings-group"><div class="group-heading"><h3>Files needing attention</h3><span id="syncItemCount" class="value-pill">0</span></div><div id="syncItemList" class="sync-item-list"></div></div>
              <div class="settings-group"><div class="group-heading"><h3>Conflicts</h3><span id="syncConflictCount" class="value-pill">0</span></div><div id="syncConflictList" class="sync-item-list"></div></div>
            </div>
          </section>

          <section id="panelDiagnostics" class="toolkit-panel" data-toolkit-panel="diagnostics" hidden>
            <header class="section-heading"><div><p class="eyebrow">Diagnostics</p><h2>Warnings &amp; Log</h2><p class="hint">Configuration recovery details and the latest command output.</p></div></header>
            <details id="configWarnings" class="config-warnings" hidden open><summary id="configWarningSummary">Configuration warnings</summary><ul id="configWarningList"></ul></details>
            <div id="configHealthyState" class="empty-state compact"><i class="codicon codicon-pass-filled" aria-hidden="true"></i><div><strong>No configuration warnings</strong><p>Toolkit state loaded without field-level recovery warnings.</p></div></div>
            <pre id="logBox" class="log">Compile output and operation details will appear here.</pre>
          </section>
        </section>

        <aside class="context-pane surface" aria-label="Toolkit context">
          <section class="context-panel" data-context-panel="style">
            <header class="context-heading"><div><p class="eyebrow">Live Style Preview</p><h2>Visual Language</h2></div><span id="previewModeLabel" class="context-badge"></span></header>
            <p class="preview-disclaimer">Illustrative browser preview; final TeX spacing may differ.</p>
            <div id="docPreview" class="doc-preview"></div>
            <div id="preview" class="preview-grid"></div>
          </section>
          <section class="context-panel" data-context-panel="build" hidden>
            <header class="context-heading"><div><p class="eyebrow">Build Status</p><h2 id="buildContextTitle">Checking PDF status\u2026</h2></div><span id="buildStatusBadge" class="context-badge"></span></header>
            <p id="buildContextDescription" class="context-copy"></p>
            <dl class="summary-list"><div><dt>PDF</dt><dd id="buildContextPath"></dd></div><div><dt>Mode</dt><dd id="buildContextRecipe"></dd></div><div><dt>History</dt><dd id="buildContextLastCompile"></dd></div><div><dt>Duration</dt><dd id="buildContextDuration">Not measured</dd></div></dl>
            <div class="context-actions"><button id="compileBtn" class="primary"><i class="codicon codicon-play" aria-hidden="true"></i><span>Compile PDF</span></button><button id="openPdfBtn"><i class="codicon codicon-open-preview" aria-hidden="true"></i><span>Open PDF</span></button><button id="openDiagnosticsBtn" class="ghost-button" hidden><i class="codicon codicon-warning" aria-hidden="true"></i><span>Open Diagnostics</span></button><button id="buildShowLogBtn" class="ghost-button" hidden><i class="codicon codicon-output" aria-hidden="true"></i><span>Show Log</span></button></div>
          </section>
          <section class="context-panel" data-context-panel="setup" hidden><header class="context-heading"><div><p class="eyebrow">Selected Starter</p><h2 id="setupContextTitle">Starter template</h2></div></header><p id="setupContextDescription" class="context-copy"></p><dl class="summary-list"><div><dt>Output</dt><dd>Toolkit-managed workspace files</dd></div><div><dt>Upgrade</dt><dd id="setupContextPolicy">Preserve current colors</dd></div></dl><div class="safety-note"><i class="codicon codicon-shield" aria-hidden="true"></i><p>Theme upgrades create backups first. Reset and overwrite actions still require confirmation.</p></div></section>
          <section class="context-panel" data-context-panel="structure" hidden><header class="context-heading"><div><p class="eyebrow">Latest Result</p><h2 id="structureContextTitle">No structure operation yet</h2></div><span id="structureResultBadge" class="context-badge" hidden></span></header><p id="structureContextDescription" class="context-copy"></p><div id="structureEmptyState" class="empty-state compact"><i class="codicon codicon-list-tree" aria-hidden="true"></i><div><strong>No structure result</strong><p>Run a dry-run first to inspect planned file changes.</p></div></div><div id="structureResultState" hidden><div class="result-stats"><div><strong id="structureCreatedCount">0</strong><span>Created</span></div><div><strong id="structureUpdatedCount">0</strong><span>Updated</span></div><div><strong id="structureRenamedCount">0</strong><span>Renamed</span></div><div><strong id="structureDeletedCount">0</strong><span>Deleted</span></div><div><strong id="structureWarningCount">0</strong><span>Warnings</span></div></div><details class="result-details"><summary id="structureFilesSummary">Affected items</summary><ul id="splitResult" class="result-file-list"></ul></details></div></section>
          <section class="context-panel" data-context-panel="snippets" hidden>
            <header class="context-heading"><div><p class="eyebrow">Snippet Inspector</p><h2 id="snippetContextTitle">No snippet file selected</h2></div></header>
            <p id="snippetContextCounts" class="context-copy"></p>
            <dl class="summary-list snippet-file-summary"><div><dt>Scope</dt><dd id="snippetContextScope">\u2014</dd></div><div><dt>Language</dt><dd id="snippetContextLanguage">\u2014</dd></div><div><dt>Path</dt><dd id="snippetContextPath">\u2014</dd></div></dl>
            <div class="snippet-context-heading"><h3>Snippets</h3><button id="snippetDeleteBtn" class="icon-button danger" disabled aria-label="Delete selected simple snippet from buffer" title="Delete selected simple snippet from buffer"><i class="codicon codicon-trash" aria-hidden="true"></i></button></div>
            <div id="snippetNoBlocks" class="empty-state compact"><i class="codicon codicon-symbol-snippet" aria-hidden="true"></i><div><strong>No parsed snippets</strong><p>Add a snippet block in the source editor.</p></div></div>
            <div id="snippetBlockList" class="snippet-block-list"></div>
            <details class="snippet-detail-panel" open><summary>Selected snippet</summary><dl class="summary-list"><div><dt>Trigger</dt><dd id="snippetDetailTrigger">\u2014</dd></div><div><dt>Description</dt><dd id="snippetDetailDescription">\u2014</dd></div><div><dt>Flags</dt><dd id="snippetDetailFlags">\u2014</dd></div><div><dt>Priority</dt><dd id="snippetDetailPriority">\u2014</dd></div><div><dt>Kind</dt><dd id="snippetDetailKind">\u2014</dd></div></dl><pre id="snippetDetailBody" class="snippet-body-preview">No snippet selected.</pre></details>
            <h3 class="snippet-diagnostics-title">Diagnostics</h3>
            <div id="snippetNoDiagnostics" class="empty-state compact"><i class="codicon codicon-pass-filled" aria-hidden="true"></i><div><strong>No snippet diagnostics</strong><p>The current buffer parsed without known issues.</p></div></div>
            <ul id="snippetDiagnosticList" class="snippet-diagnostic-list"></ul>
          </section>
          <section class="context-panel" data-context-panel="sync" hidden><header class="context-heading"><div><p class="eyebrow">Sync Inspector</p><h2 id="syncContextTitle">No mirror selected</h2></div><span id="syncContextBadge" class="context-badge"></span></header><p id="syncContextDescription" class="context-copy"></p><div id="syncContextEmpty" class="empty-state compact"><i class="codicon codicon-cloud" aria-hidden="true"></i><div><strong>Sync is ready when a mirror is open</strong><p>Use the Setup or Activity Bar actions to connect an Overleaf project.</p></div></div><dl id="syncContextSummary" class="summary-list" hidden><div><dt>Server</dt><dd id="syncContextServer">\u2014</dd></div><div><dt>Last sync</dt><dd id="syncContextLastSync">\u2014</dd></div><div><dt>Files</dt><dd id="syncContextFiles">\u2014</dd></div></dl></section>
          <section class="context-panel" data-context-panel="diagnostics" hidden><header class="context-heading"><div><p class="eyebrow">Configuration Health</p><h2 id="diagnosticsContextTitle">Loading diagnostics\u2026</h2></div></header><p id="diagnosticsContextDescription" class="context-copy"></p><div class="safety-note"><i class="codicon codicon-output" aria-hidden="true"></i><p>Full extension logs are also available in the LaTeX Editing Toolkit Output channel.</p></div></section>
        </aside>
      </div>
    </main>`;
  }
  shell();
  wire();
  void loadState().catch(() => void 0);
})();
