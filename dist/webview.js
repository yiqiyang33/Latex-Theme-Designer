"use strict";
(() => {
  // src/webview/index.ts
  var vscode = acquireVsCodeApi();
  var pending = /* @__PURE__ */ new Map();
  var model = null;
  var latestSplit = null;
  var latestRenumber = null;
  var latestUnsplit = null;
  var latestOperation = "";
  var starterTemplateSelection = "";
  function request(command, payload = {}) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    vscode.postMessage({ id, command, payload });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  window.addEventListener("message", (event) => {
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
    const el = byId("status");
    el.textContent = message;
    el.dataset.kind = kind;
  }
  function color(token) {
    return model?.state?.colors?.[token] || "#808080";
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
    return model.state.class_config?.[id] || "auto";
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
    renderStarter();
    renderPresets();
    renderBodyFontSize();
    renderBoldPresets();
    renderToggles();
    renderColors();
    renderTargets();
    renderRecipes();
    renderClassConfig();
    renderSplitControls();
    renderPreview();
    renderSplitResult();
    refreshPdf().catch(() => void 0);
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
  }
  function renderPresets() {
    renderPresetSelect("blockPresetSelect", "blockPresetDesc", model.schema.block_presets || [], model.state.block_preset);
    renderPresetSelect("headingTocPresetSelect", "headingTocPresetDesc", model.schema.heading_toc_presets || [], model.state.heading_toc_preset);
  }
  function renderPresetSelect(selectId, descId, presets, selectedValue) {
    const select = byId(selectId);
    const selected = renderSelect(select, presets.map((item) => ({ value: item.id, label: item.label })), selectedValue);
    byId(descId).textContent = presets.find((item) => item.id === selected)?.description || "";
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
  function renderBoldPresets() {
    const box = byId("boldTextPresetBox");
    box.innerHTML = "";
    for (const preset of model.schema.bold_text_presets || []) {
      const button = document.createElement("button");
      button.className = "swatch-button";
      button.title = preset.label;
      button.style.background = preset.color;
      button.dataset.active = color("theme-bold").toUpperCase() === String(preset.color).toUpperCase() ? "true" : "false";
      button.addEventListener("click", () => {
        model.state.colors["theme-bold"] = preset.color;
        renderAll();
      });
      box.appendChild(button);
    }
  }
  function renderToggles() {
    const box = byId("toggleBox");
    box.innerHTML = "";
    for (const item of model.schema.toggles || []) {
      const label = document.createElement("label");
      label.className = "toggle-row";
      label.innerHTML = `<input type="checkbox" ${toggleOn(item.id) ? "checked" : ""}><span>${item.label}</span>`;
      label.title = item.help || "";
      label.querySelector("input")?.addEventListener("change", (ev) => {
        model.state.toggles[item.id] = ev.target.checked;
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
        const row = document.createElement("label");
        row.className = "color-row";
        const inactiveChapter = item.id === "theme-chapter" && !chapterStatus.active;
        row.innerHTML = `<span>${item.label}${inactiveChapter ? " (inactive)" : ""}</span><input type="color"><input type="text">`;
        const colorInput = row.children[1];
        const textInput = row.children[2];
        colorInput.value = color(item.id);
        textInput.value = color(item.id);
        colorInput.addEventListener("input", () => {
          model.state.colors[item.id] = colorInput.value.toUpperCase();
          textInput.value = model.state.colors[item.id];
          renderPreview();
        });
        textInput.addEventListener("input", () => {
          if (/^#?[0-9a-fA-F]{6}$/.test(textInput.value.trim())) {
            const value = `#${textInput.value.trim().replace(/^#/, "").toUpperCase()}`;
            model.state.colors[item.id] = value;
            colorInput.value = value;
            renderPreview();
          }
        });
        rows.appendChild(row);
      }
      details.appendChild(rows);
      box.appendChild(details);
    }
  }
  function renderTargets() {
    const target = byId("targetSelect");
    renderSelect(target, (model.state.compile_targets || []).map((value) => ({ value, label: value })), model.state.compile_target || "");
    const info = byId("targetInfo");
    const chapter = chapterStyleStatus();
    info.textContent = `target: ${model.state.compile_target || "(none)"} | mode: ${currentCompileLabel()} | class: ${model.state.detected_document_class || "(unknown)"} -> ${effectiveThemeClass()} | chapter-style: ${chapter.message}`;
    byId("outputInfo").textContent = `current pdf: ${currentPdfPath()} | expected: ${model.state.compile_output_pdf_expected || pdfForTarget(model.state.compile_target)} | last compile: ${model.state.compile_last_compile_at || "never"}`;
  }
  function currentCompileLabel() {
    return model.state.compile_use_internal_fallback ? "internal fallback" : recipeName(model.state.compile_recipe) || model.state.compile_recipe || "recipe";
  }
  function renderRecipes() {
    const select = byId("recipeSelect");
    const recipes = model.state.compile_recipes || [];
    renderSelect(select, recipes.map((item) => ({ value: item.id, label: item.name })), model.state.compile_recipe || "");
    byId("useInternalFallback").checked = !!model.state.compile_use_internal_fallback;
    byId("applyRecipeBtn").disabled = recipes.length === 0 && !model.state.compile_use_internal_fallback;
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
        renderAll();
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
  function renderPreview() {
    const preview = byId("preview");
    preview.innerHTML = "";
    preview.append(
      sampleCard("Definition", color("definition-title-bg"), color("definition-title-fg"), color("definition-body-bg"), color("definition-accent")),
      sampleCard("Theorem", color("theorem-title-bg"), color("theorem-title-fg"), color("theorem-body-bg"), color("theorem-accent")),
      sampleCard("Note", color("note-title-bg"), color("note-title-fg"), color("note-bg"), color("note-accent"))
    );
    byId("docPreview").innerHTML = `<h1 style="color:${color("theme-chapter")}">Chapter Heading</h1><h2 style="color:${color("theme-section")}">Section Heading</h2><p style="font-size:${bodyFontSize()}pt">A short note preview with <b style="color:${color("theme-bold")}">bold emphasis</b>, <code style="background:${color("inline-code-bg")};color:${color("inline-code-fg")}">inline code</code>, and current theme colors.</p>`;
  }
  function sampleCard(title, titleBg, titleFg, bodyBg, accent) {
    const card = document.createElement("div");
    card.className = "sample-card";
    card.style.background = bodyBg;
    card.style.borderColor = accent;
    card.style.boxShadow = toggleOn("enable_block_shadow") ? "3px 3px 0 rgba(0,0,0,.12)" : "none";
    card.innerHTML = `<div style="background:${titleBg};color:${titleFg};border-bottom-color:${accent}">${title}</div><p>Sample block body. Label prefixes and theorem commands remain compatible.</p>`;
    return card;
  }
  async function refreshPdf() {
    try {
      const result = await request("pdf-uri", { path: currentPdfPath() });
      const frame = byId("pdfFrame");
      frame.src = `${result.uri}`;
      byId("openPdfBtn").disabled = false;
    } catch {
      byId("pdfFrame").removeAttribute("src");
      byId("openPdfBtn").disabled = true;
    }
  }
  async function loadState() {
    model = await request("state");
    renderAll();
  }
  async function bootstrapStarter() {
    const output = byId("starterOutputTarget").value.trim();
    const overwrite = byId("starterOverwrite").checked;
    if (overwrite && !confirm(`Overwrite target file if it already exists?

${output}`)) return;
    const result = await request("template-bootstrap", {
      template_id: byId("starterTemplateSelect").value,
      output_target: output,
      overwrite
    });
    starterTemplateSelection = byId("starterTemplateSelect").value;
    model = result;
    setStatus(`Generated ${result.generated_target}.`, "ok");
    renderAll();
  }
  async function saveOverrides() {
    model = await request("save", model.state);
    setStatus("Saved theme overrides.", "ok");
    renderAll();
  }
  async function applyTarget() {
    model = await request("target", { compile_target: byId("targetSelect").value });
    setStatus("Compile target updated.", "ok");
    renderAll();
  }
  async function applyRecipe() {
    model = await request("compile-config", {
      compile_recipe: byId("recipeSelect").value,
      compile_use_internal_fallback: byId("useInternalFallback").checked
    });
    setStatus("Compile config updated.", "ok");
    renderAll();
  }
  async function compilePdf() {
    setStatus("Compiling...", "");
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
    setStatus(result.success ? "Compile succeeded." : "Compile failed.", result.success ? "ok" : "error");
    renderAll();
  }
  async function splitCurrent() {
    const result = await request("split", {
      compile_target: byId("splitSourceSelect").value,
      dry_run: byId("splitDryRun").checked,
      sections_dir: "Sections"
    });
    model = result;
    latestSplit = result.split;
    latestOperation = "split";
    setStatus("Split finished.", "ok");
    renderAll();
  }
  async function renumberCurrent() {
    const result = await request("renumber", {
      compile_target: byId("splitSourceSelect").value,
      mode: byId("renumberModeSelect").value,
      dry_run: byId("splitDryRun").checked
    });
    model = result;
    latestRenumber = result.renumber;
    latestOperation = "renumber";
    setStatus("Renumber finished.", "ok");
    renderAll();
  }
  async function unsplitCurrent() {
    const deleteSource = byId("unsplitDeleteSource").checked;
    if (deleteSource && !confirm("Merge selected unit back to root and delete the source file?")) return;
    const result = await request("unsplit", {
      compile_target: byId("splitSourceSelect").value,
      dry_run: byId("splitDryRun").checked,
      delete_source: deleteSource
    });
    model = result;
    latestUnsplit = result.unsplit;
    latestOperation = "unsplit";
    setStatus("Merge finished.", "ok");
    renderAll();
  }
  function wire() {
    byId("starterTemplateSelect").addEventListener("change", () => {
      starterTemplateSelection = byId("starterTemplateSelect").value;
      renderStarterDescription();
    });
    byId("generateTemplateBtn").addEventListener("click", () => run(bootstrapStarter));
    byId("generateVscodeSettingsBtn").addEventListener("click", () => run(async () => {
      const result = await request("vscode-settings-generate", {});
      model = result;
      setStatus(result.message || "Checked VS Code settings.", "ok");
      renderAll();
    }));
    byId("applyBlockPresetBtn").addEventListener("click", () => run(async () => {
      model = await request("block-preset", { block_preset: byId("blockPresetSelect").value });
      setStatus("Applied block preset.", "ok");
      renderAll();
    }));
    byId("applyHeadingTocPresetBtn").addEventListener("click", () => run(async () => {
      model = await request("heading-toc-preset", { heading_toc_preset: byId("headingTocPresetSelect").value });
      setStatus("Applied heading/TOC preset.", "ok");
      renderAll();
    }));
    byId("bodyFontSizeSlider").addEventListener("input", () => {
      const slider = byId("bodyFontSizeSlider");
      model.state.body_font_size_pt = Number(slider.value);
      byId("bodyFontSizeValue").textContent = `${Number(slider.value).toFixed(1)}pt`;
      renderPreview();
    });
    byId("saveBtn").addEventListener("click", () => run(saveOverrides));
    byId("applyTargetBtn").addEventListener("click", () => run(applyTarget));
    byId("applyRecipeBtn").addEventListener("click", () => run(applyRecipe));
    byId("compileBtn").addEventListener("click", () => run(compilePdf));
    byId("refreshPdfBtn").addEventListener("click", () => run(refreshPdf));
    byId("openPdfBtn").addEventListener("click", () => run(async () => request("open-pdf", { path: currentPdfPath() })));
    byId("splitBtn").addEventListener("click", () => run(splitCurrent));
    byId("renumberBtn").addEventListener("click", () => run(renumberCurrent));
    byId("unsplitBtn").addEventListener("click", () => run(unsplitCurrent));
    byId("resetBtn").addEventListener("click", () => run(async () => {
      if (!confirm("Delete theme.ui.json, theme.overrides.tex, and theme.colors.tex?")) return;
      model = await request("reset", {});
      setStatus("Deleted override files.", "ok");
      renderAll();
    }));
    byId("cleanBtn").addEventListener("click", () => run(async () => {
      if (!confirm("Clean LaTeX build artifacts in this workspace?")) return;
      const result = await request("clean", { dry_run: false });
      byId("logBox").textContent = [`Cleaned ${result.deleted_count || 0} file(s).`, ...result.deleted_files || [], ...(result.errors || []).map((x) => `error: ${x}`)].join("\n");
      setStatus("Cleanup finished.", result.success ? "ok" : "error");
    }));
  }
  async function run(fn) {
    try {
      await fn();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }
  function shell() {
    const initial = JSON.parse(document.getElementById("app")?.getAttribute("data-initial") || "{}");
    document.body.innerHTML = `
    <main class="layout">
      <aside class="panel left">
        <header>
          <p class="eyebrow">LaTeX Editing Toolkit</p>
          <h1>${initial.workspaceName || "Workspace"}</h1>
          <p class="path">${initial.workspacePath || ""}</p>
        </header>
        <section>
          <h2>Theme Toggles</h2>
          <div id="toggleBox" class="toggles"></div>
        </section>
        <section>
          <h2>Presets</h2>
          <div class="row"><select id="blockPresetSelect"></select><button id="applyBlockPresetBtn">Apply Block</button></div>
          <p id="blockPresetDesc" class="hint"></p>
          <div class="row"><select id="headingTocPresetSelect"></select><button id="applyHeadingTocPresetBtn">Apply Heading</button></div>
          <p id="headingTocPresetDesc" class="hint"></p>
        </section>
        <section>
          <h2>Body Text</h2>
          <div class="row"><input id="bodyFontSizeSlider" type="range"><code id="bodyFontSizeValue"></code></div>
          <p id="bodyFontSizeHelp" class="hint"></p>
          <div id="boldTextPresetBox" class="swatch-grid"></div>
        </section>
        <section>
          <h2>Colors</h2>
          <div id="groupBox"></div>
        </section>
      </aside>
      <section class="panel right">
        <section>
          <h2>Starter Template</h2>
          <div class="row"><select id="starterTemplateSelect"></select><input id="starterOutputTarget" placeholder="main.tex"><label class="inline"><input id="starterOverwrite" type="checkbox"> overwrite</label><button id="generateTemplateBtn">Generate</button></div>
          <p id="starterTemplateDesc" class="hint"></p>
        </section>
        <section>
          <h2>Split + Subfiles Standalone</h2>
          <div class="row"><select id="splitSourceSelect"></select><code id="splitModeTag">subfiles</code><label class="inline"><input id="splitDryRun" type="checkbox"> dry run</label></div>
          <div class="row"><button id="splitBtn">Split Current Target</button><select id="renumberModeSelect"><option value="add">add</option><option value="remove">remove</option></select><button id="renumberBtn">Renumber</button><label class="inline"><input id="unsplitDeleteSource" type="checkbox" checked> delete source</label><button id="unsplitBtn">Merge Selected</button></div>
          <pre id="splitResult" class="result"></pre>
        </section>
        <section>
          <h2>Compile</h2>
          <div class="row"><select id="targetSelect"></select><button id="applyTargetBtn">Apply Target</button></div>
          <div class="row"><select id="recipeSelect"></select><button id="applyRecipeBtn">Apply Recipe</button><label class="inline"><input id="useInternalFallback" type="checkbox"> internal fallback</label></div>
          <div id="classConfigBox" class="class-config"></div>
          <p id="compileHelp" class="hint"></p>
          <code id="targetInfo" class="meta"></code>
          <code id="outputInfo" class="meta"></code>
          <div class="toolbar"><button id="generateVscodeSettingsBtn">Generate VS Code Settings</button><button id="saveBtn" class="primary">Save Overrides</button><button id="compileBtn">Compile PDF</button><button id="refreshPdfBtn">Refresh PDF</button><button id="openPdfBtn">Open PDF</button><button id="cleanBtn">Clean</button><button id="resetBtn" class="danger">Reset</button></div>
          <div id="status" class="status"></div>
        </section>
        <section class="preview-area">
          <div>
            <h2>Live Style Preview</h2>
            <div id="docPreview" class="doc-preview"></div>
            <div id="preview" class="preview-grid"></div>
          </div>
          <div>
            <h2>PDF</h2>
            <iframe id="pdfFrame"></iframe>
          </div>
        </section>
        <section>
          <h2>Log</h2>
          <pre id="logBox" class="log">(click Compile PDF to run)</pre>
        </section>
      </section>
    </main>`;
  }
  shell();
  wire();
  run(loadState);
})();
