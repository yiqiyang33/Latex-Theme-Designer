"""Embedded HTML page for Theme Designer UI."""

HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Theme Designer</title>
  <style>
    :root {
      --bg: #f5f7fb;
      --panel: #ffffff;
      --line: #d8dee9;
      --text: #1f2937;
      --muted: #6b7280;
      --accent: #0b5bd3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      color: var(--text);
      background: linear-gradient(150deg, #eef3ff 0%, #f7fafc 40%, #f3f6fb 100%);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(360px, 430px) 1fr;
      gap: 14px;
      padding: 14px;
      min-height: 100vh;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 10px 28px rgba(17, 24, 39, 0.05);
    }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 14px 0 8px; font-size: 18px; }
    p.hint { margin: 0 0 10px; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .toggles { display: grid; gap: 8px; margin-bottom: 12px; }
    .toggle {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 8px;
      align-items: start;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: #fafcff;
    }
    .toggle label { font-weight: 600; display: block; font-size: 14px; }
    .toggle span { font-size: 12px; color: var(--muted); }
    details.group {
      border: 1px solid var(--line);
      border-radius: 10px;
      margin-bottom: 8px;
      overflow: hidden;
      background: #fcfdff;
    }
    details.group > summary {
      cursor: pointer;
      list-style: none;
      padding: 9px 11px;
      font-weight: 700;
      font-size: 14px;
      border-bottom: 1px solid #edf1f8;
    }
    details.group[open] > summary { background: #f5f8ff; }
    .rows { display: grid; gap: 8px; padding: 10px; }
    .row {
      display: grid;
      grid-template-columns: minmax(110px, 1fr) auto auto;
      gap: 8px;
      align-items: center;
    }
    .row label { font-size: 13px; color: #263041; }
    .row input[type="color"] {
      width: 36px;
      height: 28px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 1px;
      background: #fff;
    }
    .row input.hex {
      width: 104px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 5px 7px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .row input.hex.invalid {
      border-color: #dc2626;
      background: #fff1f2;
    }
    .preset-controls {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      margin: 0 0 8px;
    }
    .preset-controls select {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 13px;
      background: #fff;
      color: #1f2937;
    }
    .font-size-control {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      margin: 0 0 8px;
    }
    .font-size-control input[type="range"] {
      width: 100%;
    }
    .font-size-control code {
      min-width: 64px;
      text-align: right;
      color: #334155;
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .bootstrap-row {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .bootstrap-row label {
      font-size: 13px;
      font-weight: 700;
      color: #334155;
    }
    .bootstrap-row select,
    .bootstrap-row input[type="text"] {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 13px;
      background: #fff;
      color: #1f2937;
      width: 100%;
    }
    .bootstrap-overwrite {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px 80px;
      font-size: 13px;
      color: #334155;
    }
    .bootstrap-overwrite input[type="checkbox"] {
      width: 15px;
      height: 15px;
      margin: 0;
    }
    .compile-target {
      display: grid;
      grid-template-columns: 72px 1fr auto;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .compile-target label {
      font-size: 13px;
      font-weight: 700;
      color: #334155;
    }
    .compile-target select {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 6px 9px;
      font-size: 13px;
      background: #fff;
      color: #1f2937;
    }
    .compile-target code {
      font-size: 12px;
      color: #475569;
    }
    .compile-options {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px 80px;
      font-size: 13px;
      color: #334155;
      flex-wrap: wrap;
    }
    .compile-options input[type="checkbox"] {
      width: 15px;
      height: 15px;
      margin: 0;
    }
    .compile-help {
      margin: 0 0 8px;
      color: #64748b;
      font-size: 12px;
    }
    .compile-meta {
      margin: 4px 0 0;
      font-size: 12px;
      color: #475569;
    }
    .class-config {
      display: grid;
      gap: 8px;
      margin: 0 0 10px 80px;
    }
    .class-config-row {
      display: grid;
      grid-template-columns: minmax(140px, 1fr) minmax(180px, 240px);
      gap: 8px;
      align-items: center;
    }
    .class-config-row label {
      font-size: 12px;
      color: #334155;
      font-weight: 600;
    }
    .class-config-row select {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 5px 8px;
      font-size: 12px;
      color: #1f2937;
      background: #fff;
    }
    button {
      border: 1px solid #bfd3ff;
      background: #eef4ff;
      color: #0b3f96;
      padding: 7px 11px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
    }
    button.primary {
      border-color: #0b5bd3;
      background: #0b5bd3;
      color: white;
    }
    button.warn {
      border-color: #f3c4c4;
      background: #fff2f2;
      color: #9f1239;
    }
    .status {
      min-height: 24px;
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .status.ok { color: #047857; }
    .status.err { color: #b91c1c; }
    .preview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
    }
    .sample {
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #e5eaf4;
      background: white;
    }
    .sample .title {
      font-weight: 700;
      padding: 7px 10px;
      font-size: 13px;
    }
    .sample .body {
      padding: 10px;
      font-size: 13px;
      line-height: 1.45;
      border-left-width: 5px;
      border-left-style: solid;
    }
    .doc-preview {
      margin: 10px 0 14px;
      padding: 10px;
      border: 1px dashed #d6dce8;
      border-radius: 10px;
      background: #fbfdff;
    }
    .doc-preview .chapter { font-weight: 800; font-size: 19px; }
    .doc-preview .section { font-weight: 700; font-size: 16px; margin-top: 5px; }
    .doc-preview .subsection { font-weight: 700; font-size: 14px; margin-top: 3px; }
    .pdf-wrap {
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 8px;
      background: #fff;
    }
    iframe#pdfFrame { width: 100%; height: 430px; border: 0; }
    pre.log {
      margin: 8px 0 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      max-height: 260px;
      overflow: auto;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 12px;
      line-height: 1.35;
    }
    @media (max-width: 1080px) {
      .layout { grid-template-columns: 1fr; }
      iframe#pdfFrame { height: 360px; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section class="panel">
      <h1>Theme Designer</h1>
      <p class="hint">Adjust colors, feature switches, and class-aware options. Save writes <code>theme.colors.tex</code> and <code>theme.overrides.tex</code>.</p>
      <h2>Feature Toggles</h2>
      <div id="toggleBox" class="toggles"></div>
      <h2>Block Presets</h2>
      <div class="preset-controls">
        <select id="blockPresetSelect"></select>
        <button id="applyBlockPresetBtn">Apply Preset</button>
      </div>
      <p id="blockPresetDesc" class="hint"></p>
      <h2>Heading/TOC Presets</h2>
      <div class="preset-controls">
        <select id="headingTocPresetSelect"></select>
        <button id="applyHeadingTocPresetBtn">Apply Preset</button>
      </div>
      <p id="headingTocPresetDesc" class="hint"></p>
      <h2>Body Font Size</h2>
      <div class="font-size-control">
        <input id="bodyFontSizeSlider" type="range">
        <code id="bodyFontSizeValue"></code>
      </div>
      <p id="bodyFontSizeHelp" class="hint"></p>
      <h2>Colors</h2>
      <div id="groupBox"></div>
    </section>
    <section class="panel">
      <h2>Starter Template</h2>
      <div class="bootstrap-row">
        <label for="starterTemplateSelect">Template</label>
        <select id="starterTemplateSelect"></select>
      </div>
      <div class="bootstrap-row">
        <label for="starterOutputTarget">Output</label>
        <input id="starterOutputTarget" type="text" placeholder="main.tex">
      </div>
      <div class="bootstrap-overwrite">
        <input id="starterOverwrite" type="checkbox">
        <label for="starterOverwrite">Allow overwrite if target exists</label>
      </div>
      <p id="starterTemplateDesc" class="hint"></p>
      <div class="actions">
        <button id="generateTemplateBtn">Generate Starter File</button>
      </div>

      <div class="compile-target">
        <label for="targetSelect">Compile</label>
        <select id="targetSelect"></select>
        <button id="applyTargetBtn">Apply Target</button>
      </div>
      <div class="compile-target">
        <label for="recipeSelect">Recipe</label>
        <select id="recipeSelect"></select>
        <button id="applyRecipeBtn">Apply Recipe</button>
      </div>
      <div class="compile-options">
        <input id="useInternalFallback" type="checkbox">
        <label for="useInternalFallback">Use internal fallback pipeline</label>
      </div>
      <div id="classConfigBox" class="class-config"></div>
      <div id="compileHelp" class="compile-help">When fallback is enabled, recipe selection is ignored.</div>
      <code id="targetInfo"></code>
      <div class="compile-meta"><code id="outputInfo"></code></div>
      <div class="actions">
        <button id="saveBtn" class="primary">Save Overrides</button>
        <button id="compileBtn">Compile PDF</button>
        <button id="refreshPdfBtn">Refresh PDF Preview</button>
        <button id="resetBtn" class="warn">Reset (Delete Overrides)</button>
      </div>
      <div id="status" class="status"></div>

      <h2>Live Preview</h2>
      <div id="docPreview" class="doc-preview"></div>
      <div id="preview" class="preview-grid"></div>

      <h2>PDF Preview</h2>
      <div class="pdf-wrap">
        <iframe id="pdfFrame" src="/api/pdf"></iframe>
      </div>

      <h2>Compiler Log</h2>
      <pre id="logBox" class="log">(click "Compile PDF" to run latexmk)</pre>
    </section>
  </div>
  <script>
    let model = null;
    let sessionId = null;
    let heartbeatTimer = null;
    const HEARTBEAT_INTERVAL_MS = 15000;

    // ---------- Model Helpers ----------
    function setStatus(text, kind = "") {
      const el = document.getElementById("status");
      el.textContent = text;
      el.className = "status " + kind;
    }

    function color(token) {
      return model.state.colors[token] || "#808080";
    }

    function toggleOn(id) {
      return !!model.state.toggles[id];
    }

    function pdfPathForTarget(target) {
      if (!target || !target.endsWith(".tex")) return "main.pdf";
      return target.slice(0, -4) + ".pdf";
    }

    function recipeNameById(id) {
      const recipes = model.state.compile_recipes || [];
      for (const recipe of recipes) {
        if (recipe.id === id) return recipe.name || id;
      }
      return "";
    }

    function classConfigValue(id) {
      const config = model.state.class_config || {};
      return config[id] || "auto";
    }

    function blockPresetOptions() {
      return model.schema.block_presets || [];
    }

    function blockPresetInfoById(id) {
      for (const item of blockPresetOptions()) {
        if (item.id === id) return item;
      }
      return null;
    }

    function blockPresetValue() {
      const options = blockPresetOptions();
      if (model.state.block_preset) return model.state.block_preset;
      return options.length > 0 ? options[0].id : "default";
    }

    function headingTocPresetOptions() {
      return model.schema.heading_toc_presets || [];
    }

    function headingTocPresetInfoById(id) {
      for (const item of headingTocPresetOptions()) {
        if (item.id === id) return item;
      }
      return null;
    }

    function headingTocPresetValue() {
      const options = headingTocPresetOptions();
      if (model.state.heading_toc_preset) return model.state.heading_toc_preset;
      return options.length > 0 ? options[0].id : "default";
    }

    function starterTemplateOptions() {
      return model.schema.starter_templates || [];
    }

    function starterTemplateInfoById(id) {
      for (const item of starterTemplateOptions()) {
        if (item.id === id) return item;
      }
      return null;
    }

    function starterTemplateValue() {
      const options = starterTemplateOptions();
      const preferred = model.schema.starter_default_template || "book-minimal";
      for (const item of options) {
        if (item.id === preferred) return preferred;
      }
      return options.length > 0 ? options[0].id : "";
    }

    function starterOutputDefault() {
      return model.schema.starter_default_output_target || "main.tex";
    }

    function bodyFontSizeSchema() {
      return model.schema.body_font_size || {
        id: "body_font_size_pt",
        min: 9.0,
        max: 14.0,
        step: 0.5,
        default: 10.0
      };
    }

    function bodyFontSizeValue() {
      const schema = bodyFontSizeSchema();
      const fallback = Number(schema.default || 10.0);
      const parsed = Number(model.state[schema.id]);
      if (Number.isFinite(parsed)) return parsed;
      return fallback;
    }

    function effectiveThemeClass() {
      const mode = classConfigValue("theme_class_mode");
      if (mode === "book" || mode === "article") return mode;
      return model.state.detected_document_class_has_chapter ? "book" : "article";
    }

    function currentPdfPath() {
      return model.state.compile_output_pdf
        || model.state.compile_output_pdf_expected
        || pdfPathForTarget(model.state.compile_target);
    }

    function currentExpectedPdfPath() {
      return model.state.compile_output_pdf_expected || pdfPathForTarget(model.state.compile_target);
    }

    function formatCompileTimestamp(raw) {
      if (!raw) return "never";
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return raw;
      return parsed.toLocaleString();
    }

    function currentCompileLabel() {
      if (model.state.compile_use_internal_fallback) return "internal fallback";
      const recipeName = recipeNameById(model.state.compile_recipe);
      return recipeName ? `recipe: ${recipeName}` : "recipe: (none)";
    }

    function renderTargetInfo() {
      const info = document.getElementById("targetInfo");
      const outputInfo = document.getElementById("outputInfo");
      info.textContent = `target: ${model.state.compile_target || "(none)"} | mode: ${currentCompileLabel()} | class: ${model.state.detected_document_class || "(unknown)"} -> ${effectiveThemeClass()}`;
      outputInfo.textContent = `current pdf: ${currentPdfPath()} | expected: ${currentExpectedPdfPath()} | last compile: ${formatCompileTimestamp(model.state.compile_last_compile_at)}`;
    }

    // ---------- Renderers ----------
    function renderStarterTemplateControls() {
      const select = document.getElementById("starterTemplateSelect");
      const desc = document.getElementById("starterTemplateDesc");
      const output = document.getElementById("starterOutputTarget");
      const options = starterTemplateOptions();
      const selected = starterTemplateValue();

      select.innerHTML = "";
      for (const item of options) {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.label || item.id;
        select.appendChild(opt);
      }

      if (selected) {
        select.value = selected;
      }
      const info = starterTemplateInfoById(select.value || selected);
      desc.textContent = info && info.description
        ? info.description
        : "Generate a starter .tex file from templates/.";

      if (!output.value) {
        output.value = starterOutputDefault();
      }
      select.onchange = () => {
        const selectedInfo = starterTemplateInfoById(select.value);
        desc.textContent = selectedInfo && selectedInfo.description
          ? selectedInfo.description
          : "Generate a starter .tex file from templates/.";
      };
    }

    function renderCompileTargetSelector() {
      const select = document.getElementById("targetSelect");
      select.innerHTML = "";
      const targets = model.state.compile_targets || [];
      for (const target of targets) {
        const opt = document.createElement("option");
        opt.value = target;
        opt.textContent = target;
        select.appendChild(opt);
      }
      if (model.state.compile_target) {
        select.value = model.state.compile_target;
      }
      select.onchange = () => {
        model.state.compile_target = select.value;
        renderTargetInfo();
      };
      renderTargetInfo();
    }

    function renderCompileRecipeSelector() {
      const select = document.getElementById("recipeSelect");
      const fallback = document.getElementById("useInternalFallback");
      const applyBtn = document.getElementById("applyRecipeBtn");
      const help = document.getElementById("compileHelp");
      select.innerHTML = "";
      const recipes = model.state.compile_recipes || [];
      const errors = model.state.compile_recipe_errors || [];

      for (const recipe of recipes) {
        const opt = document.createElement("option");
        opt.value = recipe.id;
        opt.textContent = recipe.name;
        select.appendChild(opt);
      }

      if (model.state.compile_recipe) {
        select.value = model.state.compile_recipe;
      } else if (recipes.length > 0) {
        model.state.compile_recipe = recipes[0].id;
        select.value = model.state.compile_recipe;
      }

      fallback.checked = !!model.state.compile_use_internal_fallback;
      select.disabled = fallback.checked || recipes.length === 0;
      applyBtn.disabled = recipes.length === 0 && !fallback.checked;
      fallback.onchange = () => {
        model.state.compile_use_internal_fallback = fallback.checked;
        select.disabled = fallback.checked || recipes.length === 0;
        applyBtn.disabled = recipes.length === 0 && !fallback.checked;
        renderTargetInfo();
      };
      select.onchange = () => {
        model.state.compile_recipe = select.value;
        renderTargetInfo();
      };
      if (errors.length > 0) {
        help.textContent = `Recipe parse warning: ${errors[0]}`;
      } else if (recipes.length === 0) {
        help.textContent = "No VSCode recipes found. Enable internal fallback pipeline.";
      } else {
        help.textContent = "When fallback is enabled, recipe selection is ignored.";
      }
      renderTargetInfo();
    }

    function renderClassConfig() {
      const box = document.getElementById("classConfigBox");
      box.innerHTML = "";
      const fields = model.schema.class_config || [];
      for (const field of fields) {
        const row = document.createElement("div");
        row.className = "class-config-row";
        const label = document.createElement("label");
        label.textContent = field.label;
        label.title = field.help || "";
        const select = document.createElement("select");
        for (const opt of (field.options || [])) {
          const node = document.createElement("option");
          node.value = opt.value;
          node.textContent = opt.label || opt.value;
          select.appendChild(node);
        }
        select.value = classConfigValue(field.id);
        select.onchange = () => {
          if (!model.state.class_config) model.state.class_config = {};
          model.state.class_config[field.id] = select.value;
          renderTargetInfo();
          renderPreview();
        };
        row.appendChild(label);
        row.appendChild(select);
        box.appendChild(row);
      }
    }

    function renderBlockPresetSelector() {
      const select = document.getElementById("blockPresetSelect");
      const desc = document.getElementById("blockPresetDesc");
      const options = blockPresetOptions();
      select.innerHTML = "";

      for (const item of options) {
        const node = document.createElement("option");
        node.value = item.id;
        node.textContent = item.label || item.id;
        select.appendChild(node);
      }

      const selected = blockPresetValue();
      if (options.length > 0) {
        select.value = selected;
      }
      model.state.block_preset = selected;
      const info = blockPresetInfoById(selected);
      desc.textContent = info && info.description ? info.description : "No preset description.";

      select.onchange = () => {
        model.state.block_preset = select.value;
        const selectedInfo = blockPresetInfoById(select.value);
        desc.textContent = selectedInfo && selectedInfo.description
          ? selectedInfo.description
          : "No preset description.";
      };
    }

    function renderHeadingTocPresetSelector() {
      const select = document.getElementById("headingTocPresetSelect");
      const desc = document.getElementById("headingTocPresetDesc");
      const options = headingTocPresetOptions();
      select.innerHTML = "";

      for (const item of options) {
        const node = document.createElement("option");
        node.value = item.id;
        node.textContent = item.label || item.id;
        select.appendChild(node);
      }

      const selected = headingTocPresetValue();
      if (options.length > 0) {
        select.value = selected;
      }
      model.state.heading_toc_preset = selected;
      const info = headingTocPresetInfoById(selected);
      desc.textContent = info && info.description ? info.description : "No preset description.";

      select.onchange = () => {
        model.state.heading_toc_preset = select.value;
        const selectedInfo = headingTocPresetInfoById(select.value);
        desc.textContent = selectedInfo && selectedInfo.description
          ? selectedInfo.description
          : "No preset description.";
      };
    }

    function renderBodyFontSizeControl() {
      const schema = bodyFontSizeSchema();
      const slider = document.getElementById("bodyFontSizeSlider");
      const valueTag = document.getElementById("bodyFontSizeValue");
      const help = document.getElementById("bodyFontSizeHelp");
      const value = bodyFontSizeValue();

      slider.min = String(schema.min ?? 9.0);
      slider.max = String(schema.max ?? 14.0);
      slider.step = String(schema.step ?? 0.5);
      slider.value = String(value);
      valueTag.textContent = `${value.toFixed(1)}pt`;
      help.textContent = `${schema.help || "Body text size"} Range: ${Number(slider.min).toFixed(1)}-${Number(slider.max).toFixed(1)}pt, step ${Number(slider.step).toFixed(1)}pt.`;

      slider.oninput = () => {
        const parsed = Number(slider.value);
        model.state[schema.id] = parsed;
        valueTag.textContent = `${parsed.toFixed(1)}pt`;
        renderPreview();
      };
    }

    function renderToggles() {
      const box = document.getElementById("toggleBox");
      box.innerHTML = "";
      for (const item of model.schema.toggles) {
        const row = document.createElement("div");
        row.className = "toggle";
        row.innerHTML = `
          <input type="checkbox" id="toggle-${item.id}" ${toggleOn(item.id) ? "checked" : ""}>
          <div>
            <label for="toggle-${item.id}">${item.label}</label>
            <span>${item.help}</span>
          </div>
        `;
        row.querySelector("input").addEventListener("change", (ev) => {
          model.state.toggles[item.id] = ev.target.checked;
          renderPreview();
        });
        box.appendChild(row);
      }
    }

    function bindColorInputHandlers(inputColor, inputHex, token) {
      inputColor.addEventListener("input", () => {
        inputHex.value = inputColor.value.toUpperCase();
        inputHex.classList.remove("invalid");
        model.state.colors[token] = inputColor.value.toUpperCase();
        renderPreview();
      });
      inputHex.addEventListener("input", () => {
        const val = inputHex.value.trim();
        if (/^#?[0-9a-fA-F]{6}$/.test(val)) {
          const fixed = ("#" + val.replace("#", "")).toUpperCase();
          inputHex.classList.remove("invalid");
          inputColor.value = fixed;
          model.state.colors[token] = fixed;
          renderPreview();
        } else {
          inputHex.classList.add("invalid");
        }
      });
    }

    function renderColorGroups() {
      const box = document.getElementById("groupBox");
      box.innerHTML = "";
      for (const group of model.schema.groups) {
        const details = document.createElement("details");
        details.className = "group";
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = group.title;
        details.appendChild(summary);

        const rows = document.createElement("div");
        rows.className = "rows";
        for (const item of group.items) {
          const row = document.createElement("div");
          row.className = "row";
          row.innerHTML = `
            <label>${item.label}</label>
            <input type="color" value="${color(item.id)}">
            <input class="hex" value="${color(item.id)}">
          `;
          const inputColor = row.children[1];
          const inputHex = row.children[2];
          bindColorInputHandlers(inputColor, inputHex, item.id);
          rows.appendChild(row);
        }
        details.appendChild(rows);
        box.appendChild(details);
      }
    }

    function sampleCard(title, titleBg, titleFg, bodyBg, accent) {
      const shadow = toggleOn("enable_block_shadow") ? "box-shadow: 0 3px 0 rgba(17,24,39,0.11);" : "";
      return `
        <article class="sample" style="${shadow}">
          <div class="title" style="background:${titleBg};color:${titleFg};">${title}</div>
          <div class="body" style="background:${bodyBg};border-left-color:${accent};">
            Short content preview for <strong>${title.toLowerCase()}</strong>.
          </div>
        </article>
      `;
    }

    function renderPreview() {
      const docPreview = document.getElementById("docPreview");
      const bodyFontPt = bodyFontSizeValue();
      docPreview.style.fontSize = `${bodyFontPt}pt`;
      if (effectiveThemeClass() === "book") {
        docPreview.innerHTML = `
          <div class="chapter" style="color:${color("theme-chapter")}">Chapter 1. Variational Inference</div>
          <div class="section" style="color:${color("theme-section")}">1.1 Intro</div>
          <div class="subsection" style="color:${color("theme-subsection")}">1.1.1 The objective</div>
        `;
      } else {
        docPreview.innerHTML = `
          <div class="section" style="color:${color("theme-section")}">1 Intro</div>
          <div class="subsection" style="color:${color("theme-subsection")}">1.1 The objective</div>
        `;
      }

      const noteShadow = toggleOn("enable_block_shadow") ? "box-shadow: 0 3px 0 rgba(17,24,39,0.11);" : "";
      const noteCard = `
        <article class="sample" style="${noteShadow}">
          <div class="title" style="background:${color("note-title-bg")};color:${color("note-title-fg")}">Note</div>
          <div class="body" style="background:${color("note-bg")};border-left-color:${color("note-accent")}">
            A titled note preview block.
          </div>
        </article>
      `;

      document.getElementById("preview").innerHTML = [
        sampleCard("Definition", color("definition-title-bg"), color("definition-title-fg"), color("definition-body-bg"), color("definition-accent")),
        sampleCard("Theorem", color("theorem-title-bg"), color("theorem-title-fg"), color("theorem-body-bg"), color("theorem-accent")),
        sampleCard("Lemma", color("lemma-title-bg"), color("lemma-title-fg"), color("lemma-body-bg"), color("lemma-accent")),
        sampleCard("Corollary", color("corollary-title-bg"), color("corollary-title-fg"), color("corollary-body-bg"), color("corollary-accent")),
        noteCard,
        sampleCard("Example", color("example-bg"), color("example-label-fg"), color("example-bg"), color("example-accent")),
        sampleCard("Remark", color("remark-bg"), color("remark-label-fg"), color("remark-bg"), color("remark-accent"))
      ].join("");
      document.getElementById("preview").style.fontSize = `${bodyFontPt}pt`;
    }

    // ---------- API Helpers ----------
    async function getState() {
      const resp = await fetch("/api/state");
      if (!resp.ok) throw new Error("Failed to load state.");
      return resp.json();
    }

    async function postJson(url, payload) {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Request failed.");
      return data;
    }

    function createSessionId() {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
      return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    async function sendHeartbeat() {
      if (!sessionId) sessionId = createSessionId();
      try {
        const result = await postJson("/api/session-heartbeat", { session_id: sessionId });
        if (result && typeof result.session_id === "string" && result.session_id.length > 0) {
          sessionId = result.session_id;
        }
      } catch (_) {
        // Heartbeat failures should not block local editing workflow.
      }
    }

    function startHeartbeat() {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      void sendHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        void sendHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
      window.addEventListener("beforeunload", () => {
        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }, { once: true });
    }

    function refreshPdf() {
      const path = currentPdfPath();
      document.getElementById("pdfFrame").src = `/api/pdf?path=${encodeURIComponent(path)}&ts=${Date.now()}`;
      renderTargetInfo();
    }

    // ---------- UI Actions ----------
    async function generateStarterTemplate() {
      const templateId = document.getElementById("starterTemplateSelect").value;
      const outputTarget = document.getElementById("starterOutputTarget").value.trim();
      const overwrite = document.getElementById("starterOverwrite").checked;
      if (!templateId) {
        setStatus("No starter template available.", "err");
        return;
      }
      if (!outputTarget) {
        setStatus("Output filename cannot be empty.", "err");
        return;
      }
      if (overwrite) {
        const ok = confirm(`Overwrite target file if it already exists?\n\n${outputTarget}`);
        if (!ok) return;
      }
      setStatus(`Generating ${outputTarget} from ${templateId}...`);
      try {
        model = await postJson("/api/template-bootstrap", {
          template_id: templateId,
          output_target: outputTarget,
          overwrite: overwrite
        });
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileTargetSelector();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderToggles();
        renderColorGroups();
        renderPreview();
        document.getElementById("starterOutputTarget").value = model.generated_target || outputTarget;
        document.getElementById("starterOverwrite").checked = false;
        refreshPdf();
        if (model.overwrote_existing) {
          setStatus(`Template generated and overwritten: ${model.generated_target}`, "ok");
        } else {
          setStatus(`Template generated: ${model.generated_target}`, "ok");
        }
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function saveOverrides() {
      setStatus("Saving overrides...");
      try {
        const result = await postJson("/api/save", model.state);
        model = result;
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileTargetSelector();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderColorGroups();
        renderPreview();
        setStatus("Saved to theme.colors.tex and theme.overrides.tex", "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function applyBlockPreset() {
      const select = document.getElementById("blockPresetSelect");
      const selected = select.value || model.state.block_preset;
      setStatus(`Applying block preset: ${selected}...`);
      try {
        model = await postJson("/api/block-preset", { block_preset: selected });
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileTargetSelector();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderToggles();
        renderColorGroups();
        renderPreview();
        setStatus(`Applied block preset: ${model.state.block_preset}`, "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function applyHeadingTocPreset() {
      const select = document.getElementById("headingTocPresetSelect");
      const selected = select.value || model.state.heading_toc_preset;
      setStatus(`Applying heading/TOC preset: ${selected}...`);
      try {
        model = await postJson("/api/heading-toc-preset", { heading_toc_preset: selected });
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileTargetSelector();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderToggles();
        renderColorGroups();
        renderPreview();
        setStatus(`Applied heading/TOC preset: ${model.state.heading_toc_preset}`, "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function applyCompileTarget() {
      const select = document.getElementById("targetSelect");
      const selected = select.value;
      setStatus(`Applying compile target: ${selected}`);
      try {
        model = await postJson("/api/target", { compile_target: selected });
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileTargetSelector();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderPreview();
        refreshPdf();
        setStatus(`Compile target set to ${model.state.compile_target}`, "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function applyCompileRecipe() {
      const selectedRecipe = document.getElementById("recipeSelect").value;
      const useInternal = document.getElementById("useInternalFallback").checked;
      setStatus("Applying compile mode...");
      try {
        model = await postJson("/api/compile-config", {
          compile_recipe: selectedRecipe,
          compile_use_internal_fallback: useInternal
        });
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderPreview();
        refreshPdf();
        setStatus("Compile mode updated.", "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function resetOverrides() {
      if (!confirm("Delete override files and reset to defaults?")) return;
      setStatus("Resetting...");
      try {
        model = await postJson("/api/reset", {});
        renderStarterTemplateControls();
        renderBlockPresetSelector();
        renderHeadingTocPresetSelector();
        renderBodyFontSizeControl();
        renderCompileTargetSelector();
        renderCompileRecipeSelector();
        renderClassConfig();
        renderToggles();
        renderColorGroups();
        renderPreview();
        refreshPdf();
        setStatus("Reset complete. Override files deleted.", "ok");
      } catch (err) {
        setStatus(err.message, "err");
      }
    }

    async function compilePdf() {
      const selected = document.getElementById("targetSelect").value || model.state.compile_target;
      model.state.compile_target = selected;
      model.state.compile_recipe = document.getElementById("recipeSelect").value || model.state.compile_recipe;
      model.state.compile_use_internal_fallback = document.getElementById("useInternalFallback").checked;
      setStatus(`Compiling ${selected}...`);
      const btn = document.getElementById("compileBtn");
      btn.disabled = true;
      try {
        const result = await postJson("/api/compile", {
          compile_target: selected,
          compile_recipe: model.state.compile_recipe,
          compile_use_internal_fallback: model.state.compile_use_internal_fallback
        });
        document.getElementById("logBox").textContent = result.output;
        if (result.compile_target) {
          model.state.compile_target = result.compile_target;
        }
        if (result.compile_recipe !== undefined) {
          model.state.compile_recipe = result.compile_recipe;
        }
        if (result.compile_use_internal_fallback !== undefined) {
          model.state.compile_use_internal_fallback = !!result.compile_use_internal_fallback;
        }
        if (result.pdf_path) {
          model.state.compile_output_pdf = result.pdf_path;
        }
        if (result.compile_output_pdf_expected) {
          model.state.compile_output_pdf_expected = result.compile_output_pdf_expected;
        }
        if (result.compile_last_compile_at !== undefined) {
          model.state.compile_last_compile_at = result.compile_last_compile_at;
        }
        if (result.compile_last_success !== undefined) {
          model.state.compile_last_success = !!result.compile_last_success;
        }
        if (result.class_config && typeof result.class_config === "object") {
          model.state.class_config = result.class_config;
        }
        if (result.detected_document_class !== undefined) {
          model.state.detected_document_class = result.detected_document_class;
        }
        if (result.detected_document_class_has_chapter !== undefined) {
          model.state.detected_document_class_has_chapter = !!result.detected_document_class_has_chapter;
        }
        if (result.effective_theme_class !== undefined) {
          model.state.effective_theme_class = result.effective_theme_class;
        }
        renderCompileRecipeSelector();
        renderClassConfig();
        renderTargetInfo();
        renderPreview();
        if (result.success) {
          setStatus("Compile succeeded.", "ok");
          refreshPdf();
        } else {
          setStatus("Compile failed. Check log below.", "err");
        }
      } catch (err) {
        setStatus(err.message, "err");
      } finally {
        btn.disabled = false;
      }
    }

    async function init() {
      setStatus("Loading...");
      model = await getState();
      renderStarterTemplateControls();
      renderBlockPresetSelector();
      renderHeadingTocPresetSelector();
      renderBodyFontSizeControl();
      renderCompileTargetSelector();
      renderCompileRecipeSelector();
      renderClassConfig();
      renderToggles();
      renderColorGroups();
      renderPreview();
      setStatus("Ready");
      refreshPdf();
      startHeartbeat();

      document.getElementById("generateTemplateBtn").addEventListener("click", generateStarterTemplate);
      document.getElementById("applyTargetBtn").addEventListener("click", applyCompileTarget);
      document.getElementById("applyRecipeBtn").addEventListener("click", applyCompileRecipe);
      document.getElementById("applyBlockPresetBtn").addEventListener("click", applyBlockPreset);
      document.getElementById("applyHeadingTocPresetBtn").addEventListener("click", applyHeadingTocPreset);
      document.getElementById("saveBtn").addEventListener("click", saveOverrides);
      document.getElementById("resetBtn").addEventListener("click", resetOverrides);
      document.getElementById("compileBtn").addEventListener("click", compilePdf);
      document.getElementById("refreshPdfBtn").addEventListener("click", refreshPdf);
    }

    init().catch((err) => {
      setStatus(err.message, "err");
    });
  </script>
</body>
</html>
"""
