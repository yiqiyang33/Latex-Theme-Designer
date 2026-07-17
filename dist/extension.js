"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/stylePresets.ts
var STYLE_PRESET_DEFINITIONS;
var init_stylePresets = __esm({
  "src/stylePresets.ts"() {
    "use strict";
    STYLE_PRESET_DEFINITIONS = [
      {
        id: "default",
        label: "Default",
        description: "Balanced slate document colors with the built-in theorem and inline styles.",
        block_source: "default",
        heading_source: "default",
        colors: {
          "theme-chapter": "#1F2937",
          "theme-section": "#334155",
          "theme-subsection": "#486581",
          "theme-toc-title": "#1F2937",
          "theme-toc-chapter": "#334155",
          "theme-toc-section": "#486581",
          "theme-header-rule": "#94A3B8",
          "theme-bold": "#334155",
          "inline-key-fg": "#2F6F73",
          "inline-term-bg": "#EBF5F4",
          "inline-term-fg": "#245E62",
          "inline-warn-fg": "#8A5A24",
          "inline-todo-bg": "#FFF4CF",
          "inline-todo-fg": "#6F5517",
          "inline-code-bg": "#F1F4F6",
          "inline-code-fg": "#2D3742",
          "sidenote-fg": "#5A6570",
          "sidenote-accent": "#8AA0B2",
          "chapter-overview-bg": "#F5F7FA",
          "chapter-overview-title-bg": "#E3EAF2",
          "chapter-overview-title-fg": "#2F4050",
          "chapter-overview-accent": "#6F879C",
          "definition-body-bg": "#F4F8F7",
          "definition-title-bg": "#E1EEEC",
          "definition-title-fg": "#234A48",
          "definition-accent": "#5D8D87",
          "theorem-body-bg": "#F3F7FB",
          "theorem-title-bg": "#DFEAF5",
          "theorem-title-fg": "#244761",
          "theorem-accent": "#5B7FA2",
          "lemma-body-bg": "#F7F5FB",
          "lemma-title-bg": "#E8E2F1",
          "lemma-title-fg": "#463B5E",
          "lemma-accent": "#7A6B9A",
          "corollary-body-bg": "#FBF7F1",
          "corollary-title-bg": "#F0E4D2",
          "corollary-title-fg": "#5B4730",
          "corollary-accent": "#9B7A4A",
          "proposition-body-bg": "#F8F8F1",
          "proposition-title-bg": "#E9EAD8",
          "proposition-title-fg": "#4E5433",
          "proposition-accent": "#87905E",
          "claim-body-bg": "#FBF4F4",
          "claim-title-bg": "#F0DEDE",
          "claim-title-fg": "#633F3F",
          "claim-accent": "#9C6A6A",
          "fact-body-bg": "#F5F6FA",
          "fact-title-bg": "#E2E6F0",
          "fact-title-fg": "#34405C",
          "fact-accent": "#6B7898",
          "assumption-body-bg": "#FBF8EF",
          "assumption-title-bg": "#EEE5CD",
          "assumption-title-fg": "#5F5133",
          "assumption-accent": "#9A8555",
          "note-bg": "#F5F7FA",
          "note-title-bg": "#E4EBF2",
          "note-title-fg": "#2F4050",
          "note-accent": "#6F879C",
          "note-frame": "#D9E1EA",
          "example-bg": "#F4F8F7",
          "example-label-fg": "#2C5A57",
          "example-accent": "#5D8D87",
          "remark-bg": "#F5F7FA",
          "remark-label-fg": "#40576A",
          "remark-inline-fg": "#3F6F9F",
          "remark-accent": "#6F879C",
          "assump-bg": "#FBF8EF",
          "assump-label-fg": "#5F5133",
          "assump-accent": "#9A8555",
          "insight-bg": "#F1F8F6",
          "insight-label-fg": "#2E625B",
          "insight-accent": "#3F7D73",
          "pitfall-bg": "#FBF4F4",
          "pitfall-label-fg": "#633F3F",
          "pitfall-accent": "#9C6A6A",
          "intuition-bg": "#F7F5FB",
          "intuition-label-fg": "#463B5E",
          "intuition-accent": "#7A6B9A",
          "summary-bg": "#F5F7FA",
          "summary-label-fg": "#40576A",
          "summary-accent": "#6F879C",
          "question-bg": "#FBF8EF",
          "question-label-fg": "#5F5133",
          "question-accent": "#9A8555"
        }
      },
      {
        id: "midnight",
        label: "Midnight",
        description: "Cool high-contrast blues for focused technical notes.",
        block_source: "midnight",
        heading_source: "inkstone",
        colors: {
          "theme-chapter": "#1F2A44",
          "theme-section": "#273B66",
          "theme-subsection": "#35589A",
          "theme-toc-title": "#1E2D53",
          "theme-toc-chapter": "#243A6A",
          "theme-toc-section": "#4465A8",
          "theme-header-rule": "#1B2948",
          "theme-bold": "#273B66",
          "inline-key-fg": "#2952A3",
          "inline-term-bg": "#EAF2FF",
          "inline-term-fg": "#0F2A5F",
          "inline-warn-fg": "#9A4155",
          "inline-todo-bg": "#FFF8E8",
          "inline-todo-fg": "#5E4A14",
          "inline-code-bg": "#F1F0F8",
          "inline-code-fg": "#2D234A",
          "sidenote-fg": "#1B2562",
          "sidenote-accent": "#3342A8",
          "chapter-overview-bg": "#EEF2FF",
          "chapter-overview-title-bg": "#CFD7FF",
          "chapter-overview-title-fg": "#1B2562",
          "chapter-overview-accent": "#3342A8",
          "definition-body-bg": "#EAF2FF",
          "definition-title-bg": "#C8DAFF",
          "definition-title-fg": "#0F2A5F",
          "definition-accent": "#2952A3",
          "theorem-body-bg": "#E6F9FF",
          "theorem-title-bg": "#B8EBF7",
          "theorem-title-fg": "#0D4A5A",
          "theorem-accent": "#1B7286",
          "lemma-body-bg": "#F5ECFF",
          "lemma-title-bg": "#DEC8F8",
          "lemma-title-fg": "#45226E",
          "lemma-accent": "#6A3CA0",
          "corollary-body-bg": "#FFF4E5",
          "corollary-title-bg": "#F9D7A8",
          "corollary-title-fg": "#6B3D00",
          "corollary-accent": "#A65A00",
          "proposition-body-bg": "#F7F8E8",
          "proposition-title-bg": "#E6E9B5",
          "proposition-title-fg": "#5C5E1A",
          "proposition-accent": "#8A8D2B",
          "claim-body-bg": "#FFF1F3",
          "claim-title-bg": "#F8CDD5",
          "claim-title-fg": "#612532",
          "claim-accent": "#9A4155",
          "fact-body-bg": "#F1F0F8",
          "fact-title-bg": "#D5D1EB",
          "fact-title-fg": "#2D234A",
          "fact-accent": "#5A4E88",
          "assumption-body-bg": "#FFF8E8",
          "assumption-title-bg": "#F2E2B5",
          "assumption-title-fg": "#5E4A14",
          "assumption-accent": "#927320",
          "note-bg": "#EEF2FF",
          "note-title-bg": "#CFD7FF",
          "note-title-fg": "#1B2562",
          "note-accent": "#3342A8",
          "note-frame": "#B8C3FF",
          "example-bg": "#E8FAFA",
          "example-label-fg": "#0F6E70",
          "example-accent": "#19989B",
          "remark-bg": "#F0F4FF",
          "remark-label-fg": "#233B88",
          "remark-inline-fg": "#2B4AB0",
          "remark-accent": "#3D56C2",
          "assump-bg": "#FFF9E9",
          "assump-label-fg": "#6B5B1F",
          "assump-accent": "#A0801A",
          "insight-bg": "#E8FAFA",
          "insight-label-fg": "#0F6E70",
          "insight-accent": "#19989B",
          "pitfall-bg": "#FFF1F3",
          "pitfall-label-fg": "#612532",
          "pitfall-accent": "#9A4155",
          "intuition-bg": "#F5ECFF",
          "intuition-label-fg": "#45226E",
          "intuition-accent": "#6A3CA0",
          "summary-bg": "#F1F0F8",
          "summary-label-fg": "#2D234A",
          "summary-accent": "#5A4E88",
          "question-bg": "#FFF8E8",
          "question-label-fg": "#5E4A14",
          "question-accent": "#927320"
        }
      },
      {
        id: "meadow",
        label: "Meadow",
        description: "Soft green-blue blocks with calm earth-tone accents.",
        block_source: "meadow",
        heading_source: "aurora",
        colors: {
          "theme-chapter": "#0E5A61",
          "theme-section": "#12727E",
          "theme-subsection": "#2F94A3",
          "theme-toc-title": "#0F6169",
          "theme-toc-chapter": "#107681",
          "theme-toc-section": "#2C8D99",
          "theme-header-rule": "#0D4A50",
          "theme-bold": "#12727E",
          "inline-key-fg": "#2F7A55",
          "inline-term-bg": "#ECF8F1",
          "inline-term-fg": "#1E4A34",
          "inline-warn-fg": "#A14C43",
          "inline-todo-bg": "#FFF9EA",
          "inline-todo-fg": "#64531B",
          "inline-code-bg": "#F3F2FA",
          "inline-code-fg": "#342A59",
          "sidenote-fg": "#1F4A3D",
          "sidenote-accent": "#2F7C64",
          "chapter-overview-bg": "#EEF8F5",
          "chapter-overview-title-bg": "#D4ECE4",
          "chapter-overview-title-fg": "#1F4A3D",
          "chapter-overview-accent": "#2F7C64",
          "definition-body-bg": "#ECF8F1",
          "definition-title-bg": "#CDECDC",
          "definition-title-fg": "#1E4A34",
          "definition-accent": "#2F7A55",
          "theorem-body-bg": "#ECF7F9",
          "theorem-title-bg": "#CBE9F0",
          "theorem-title-fg": "#174452",
          "theorem-accent": "#2B7084",
          "lemma-body-bg": "#F2F0FA",
          "lemma-title-bg": "#DCCFF3",
          "lemma-title-fg": "#3F2D66",
          "lemma-accent": "#6945A6",
          "corollary-body-bg": "#FFF6E9",
          "corollary-title-bg": "#F8DBB3",
          "corollary-title-fg": "#6A4210",
          "corollary-accent": "#A0631C",
          "proposition-body-bg": "#F6F7E9",
          "proposition-title-bg": "#E2E7BD",
          "proposition-title-fg": "#4B5421",
          "proposition-accent": "#748233",
          "claim-body-bg": "#FFF1F0",
          "claim-title-bg": "#F9D3CF",
          "claim-title-fg": "#6A2F2A",
          "claim-accent": "#A14C43",
          "fact-body-bg": "#F3F2FA",
          "fact-title-bg": "#DCD6F0",
          "fact-title-fg": "#342A59",
          "fact-accent": "#5B4B8C",
          "assumption-body-bg": "#FFF9EA",
          "assumption-title-bg": "#F4E5BF",
          "assumption-title-fg": "#64531B",
          "assumption-accent": "#9A7A29",
          "note-bg": "#EEF8F5",
          "note-title-bg": "#D4ECE4",
          "note-title-fg": "#1F4A3D",
          "note-accent": "#2F7C64",
          "note-frame": "#B8DDD1",
          "example-bg": "#EBFAF6",
          "example-label-fg": "#1F6D5F",
          "example-accent": "#2D9E8A",
          "remark-bg": "#EEF4FB",
          "remark-label-fg": "#294A78",
          "remark-inline-fg": "#2F5A90",
          "remark-accent": "#3E6FB0",
          "assump-bg": "#F9FCEB",
          "assump-label-fg": "#5E6827",
          "assump-accent": "#8B9A33",
          "insight-bg": "#EBFAF6",
          "insight-label-fg": "#1F6D5F",
          "insight-accent": "#2D9E8A",
          "pitfall-bg": "#FFF1F0",
          "pitfall-label-fg": "#6A2F2A",
          "pitfall-accent": "#A14C43",
          "intuition-bg": "#F2F0FA",
          "intuition-label-fg": "#3F2D66",
          "intuition-accent": "#6945A6",
          "summary-bg": "#F3F2FA",
          "summary-label-fg": "#342A59",
          "summary-accent": "#5B4B8C",
          "question-bg": "#FFF9EA",
          "question-label-fg": "#64531B",
          "question-accent": "#9A7A29"
        }
      },
      {
        id: "ember",
        label: "Ember",
        description: "Warm rust, amber, rose, and plum contrast.",
        block_source: "ember",
        heading_source: "sunset",
        colors: {
          "theme-chapter": "#8A2E3B",
          "theme-section": "#A3422E",
          "theme-subsection": "#C26C2A",
          "theme-toc-title": "#7A2A36",
          "theme-toc-chapter": "#954137",
          "theme-toc-section": "#B66232",
          "theme-header-rule": "#6F2D33",
          "theme-bold": "#A3422E",
          "inline-key-fg": "#9A4B33",
          "inline-term-bg": "#FFF3EE",
          "inline-term-fg": "#5F2D1F",
          "inline-warn-fg": "#A44C33",
          "inline-todo-bg": "#FFF8EF",
          "inline-todo-fg": "#6A4C20",
          "inline-code-bg": "#F2F3FD",
          "inline-code-fg": "#2C356D",
          "sidenote-fg": "#3F2A66",
          "sidenote-accent": "#6243A3",
          "chapter-overview-bg": "#F8F2FF",
          "chapter-overview-title-bg": "#E4D7F9",
          "chapter-overview-title-fg": "#3F2A66",
          "chapter-overview-accent": "#6243A3",
          "definition-body-bg": "#FFF3EE",
          "definition-title-bg": "#F7D4C7",
          "definition-title-fg": "#5F2D1F",
          "definition-accent": "#9A4B33",
          "theorem-body-bg": "#FFF7EC",
          "theorem-title-bg": "#F8DEB9",
          "theorem-title-fg": "#664110",
          "theorem-accent": "#A56A1E",
          "lemma-body-bg": "#F9F0FF",
          "lemma-title-bg": "#E7D2F6",
          "lemma-title-fg": "#4F2D67",
          "lemma-accent": "#7B49A2",
          "corollary-body-bg": "#FFF1F4",
          "corollary-title-bg": "#F8CFD8",
          "corollary-title-fg": "#652536",
          "corollary-accent": "#A0455C",
          "proposition-body-bg": "#FDF5E9",
          "proposition-title-bg": "#F0DDBD",
          "proposition-title-fg": "#5F481F",
          "proposition-accent": "#967034",
          "claim-body-bg": "#FFF0EB",
          "claim-title-bg": "#F8CEC0",
          "claim-title-fg": "#6A2C1D",
          "claim-accent": "#A44C33",
          "fact-body-bg": "#F2F3FD",
          "fact-title-bg": "#D8DCF7",
          "fact-title-fg": "#2C356D",
          "fact-accent": "#4657B5",
          "assumption-body-bg": "#FFF8EF",
          "assumption-title-bg": "#F5E3C6",
          "assumption-title-fg": "#6A4C20",
          "assumption-accent": "#A7782D",
          "note-bg": "#F8F2FF",
          "note-title-bg": "#E4D7F9",
          "note-title-fg": "#3F2A66",
          "note-accent": "#6243A3",
          "note-frame": "#CDBBEA",
          "example-bg": "#FFF9EF",
          "example-label-fg": "#7A4B13",
          "example-accent": "#B4711A",
          "remark-bg": "#FFF2F1",
          "remark-label-fg": "#7A3030",
          "remark-inline-fg": "#A04242",
          "remark-accent": "#C55A50",
          "assump-bg": "#FFF8E9",
          "assump-label-fg": "#6C5A20",
          "assump-accent": "#A58625",
          "insight-bg": "#FFF9EF",
          "insight-label-fg": "#7A4B13",
          "insight-accent": "#B4711A",
          "pitfall-bg": "#FFF0EB",
          "pitfall-label-fg": "#6A2C1D",
          "pitfall-accent": "#A44C33",
          "intuition-bg": "#F9F0FF",
          "intuition-label-fg": "#4F2D67",
          "intuition-accent": "#7B49A2",
          "summary-bg": "#F2F3FD",
          "summary-label-fg": "#2C356D",
          "summary-accent": "#4657B5",
          "question-bg": "#FFF8EF",
          "question-label-fg": "#6A4C20",
          "question-accent": "#A7782D"
        }
      },
      {
        id: "uchicago",
        label: "UChicago",
        description: "Maroon-forward colors with greystone contrast.",
        block_source: "uchicago",
        heading_source: "uchicago",
        colors: {
          "theme-chapter": "#800000",
          "theme-section": "#800000",
          "theme-subsection": "#737373",
          "theme-toc-title": "#800000",
          "theme-toc-chapter": "#800000",
          "theme-toc-section": "#737373",
          "theme-header-rule": "#A6A6A6",
          "theme-bold": "#800000",
          "inline-key-fg": "#800000",
          "inline-term-bg": "#F6F4F2",
          "inline-term-fg": "#800000",
          "inline-warn-fg": "#800000",
          "inline-todo-bg": "#F8F1F0",
          "inline-todo-fg": "#800000",
          "inline-code-bg": "#F2F2F2",
          "inline-code-fg": "#4A4A4A",
          "sidenote-fg": "#737373",
          "sidenote-accent": "#800000",
          "chapter-overview-bg": "#F7F6F5",
          "chapter-overview-title-bg": "#D9D9D9",
          "chapter-overview-title-fg": "#800000",
          "chapter-overview-accent": "#800000",
          "definition-body-bg": "#F7F6F5",
          "definition-title-bg": "#E5DEDA",
          "definition-title-fg": "#800000",
          "definition-accent": "#800000",
          "theorem-body-bg": "#F6F4F2",
          "theorem-title-bg": "#E6DAD7",
          "theorem-title-fg": "#800000",
          "theorem-accent": "#800000",
          "lemma-body-bg": "#F7F7F7",
          "lemma-title-bg": "#D9D9D9",
          "lemma-title-fg": "#4A4A4A",
          "lemma-accent": "#737373",
          "corollary-body-bg": "#FAF7F5",
          "corollary-title-bg": "#E8DDD8",
          "corollary-title-fg": "#6A1B1B",
          "corollary-accent": "#800000",
          "proposition-body-bg": "#F7F7F7",
          "proposition-title-bg": "#E0E0E0",
          "proposition-title-fg": "#4D4D4D",
          "proposition-accent": "#737373",
          "claim-body-bg": "#FBF5F5",
          "claim-title-bg": "#E8D6D6",
          "claim-title-fg": "#800000",
          "claim-accent": "#800000",
          "fact-body-bg": "#F6F6F6",
          "fact-title-bg": "#D9D9D9",
          "fact-title-fg": "#4B4B4B",
          "fact-accent": "#A6A6A6",
          "assumption-body-bg": "#FAF8F4",
          "assumption-title-bg": "#E3DDD4",
          "assumption-title-fg": "#5A4738",
          "assumption-accent": "#737373",
          "note-bg": "#F6F6F6",
          "note-title-bg": "#D9D9D9",
          "note-title-fg": "#4A4A4A",
          "note-accent": "#800000",
          "note-frame": "#A6A6A6",
          "example-bg": "#F7F6F5",
          "example-label-fg": "#800000",
          "example-accent": "#800000",
          "remark-bg": "#F7F7F7",
          "remark-label-fg": "#4A4A4A",
          "remark-inline-fg": "#800000",
          "remark-accent": "#737373",
          "assump-bg": "#FAF8F4",
          "assump-label-fg": "#5A4738",
          "assump-accent": "#737373",
          "insight-bg": "#F7F6F5",
          "insight-label-fg": "#800000",
          "insight-accent": "#800000",
          "pitfall-bg": "#FBF5F5",
          "pitfall-label-fg": "#800000",
          "pitfall-accent": "#800000",
          "intuition-bg": "#F7F7F7",
          "intuition-label-fg": "#4A4A4A",
          "intuition-accent": "#737373",
          "summary-bg": "#F6F6F6",
          "summary-label-fg": "#4A4A4A",
          "summary-accent": "#A6A6A6",
          "question-bg": "#FAF8F4",
          "question-label-fg": "#5A4738",
          "question-accent": "#737373"
        }
      }
    ];
  }
});

// src/schema.ts
var TOGGLE_SCHEMA, CLASS_CONFIG_SCHEMA, COLOR_GROUPS, COLOR_ORDER, COLOR_SET, TOGGLE_IDS, CLASS_CONFIG_IDS, CLASS_CONFIG_COMMANDS, CLASS_CONFIG_DEFAULTS, CLASS_CONFIG_VALID_OPTIONS, BODY_FONT_SIZE_CONFIG, STARTER_TEMPLATE_DEFINITIONS, CHAPTER_CLASS_NAMES;
var init_schema = __esm({
  "src/schema.ts"() {
    "use strict";
    init_stylePresets();
    TOGGLE_SCHEMA = [
      { id: "enable_heading_theme", command: "EnableHeadingTheme", label: "Heading Theme", help: "Style chapter/section/subsection headings." },
      { id: "enable_toc_theme", command: "EnableTOCTheme", label: "TOC Theme", help: "Style table of contents typography and spacing." },
      { id: "enable_page_theme", command: "EnablePageTheme", label: "Page Header Theme", help: "Enable custom header/footer with chapter marker." },
      { id: "enable_enhanced_env_style", command: "EnableEnhancedEnvStyle", label: "Enhanced Block Style", help: "Use richer theorem/callout box styling." },
      { id: "enable_plain_amsthm_theorem", command: "EnablePlainAmsthmTheorem", label: "Plain amsthm Theorem", help: "Switch theorem family to native amsthm environments.", default: false },
      { id: "enable_block_shadow", command: "EnableBlockShadow", label: "Block Shadow", help: "Add subtle right/bottom shadow lines on blocks." }
    ];
    CLASS_CONFIG_SCHEMA = [
      {
        id: "theme_class_mode",
        command: "ThemeClassMode",
        label: "Class Mode",
        help: "Auto follows target document class; force book/article when needed.",
        options: [
          { value: "auto", label: "Auto (detect target class)" },
          { value: "book", label: "Force book" },
          { value: "article", label: "Force article" }
        ]
      },
      {
        id: "theme_heading_chapter_mode",
        command: "ThemeHeadingChapterMode",
        label: "Chapter Heading Rule",
        help: "Control chapter heading styling when chapter is available.",
        options: [
          { value: "auto", label: "Auto (book-only)" },
          { value: "on", label: "On if chapter exists" },
          { value: "off", label: "Always off" }
        ]
      },
      {
        id: "theme_page_header_mode",
        command: "ThemePageHeaderMode",
        label: "Page Header Rule",
        help: "Choose chapter-mark or section-mark page headers.",
        options: [
          { value: "auto", label: "Auto by class" },
          { value: "chapter", label: "Prefer chapter mark" },
          { value: "section", label: "Prefer section mark" }
        ]
      },
      {
        id: "theme_theorem_numbering_policy",
        command: "ThemeTheoremNumberingPolicy",
        label: "Theorem Numbering",
        help: "Select whether theorem counters are global or reset within section/chapter.",
        options: [
          { value: "none", label: "No hierarchy" },
          { value: "section", label: "Within section" },
          { value: "chapter", label: "Within chapter (fallback section)" },
          { value: "auto", label: "Auto (book=chapter, article=section)" }
        ]
      }
    ];
    COLOR_GROUPS = [
      {
        title: "Document",
        items: [
          ["theme-chapter", "Chapter title"],
          ["theme-section", "Section title"],
          ["theme-subsection", "Subsection title"],
          ["theme-toc-title", "TOC title"],
          ["theme-toc-chapter", "TOC chapter"],
          ["theme-toc-section", "TOC section"],
          ["theme-header-rule", "Header rule"],
          ["theme-bold", "Bold text"]
        ].map(([id, label]) => ({ id, label }))
      },
      {
        title: "Inline Text",
        items: [
          ["inline-key-fg", "Key"],
          ["inline-term-bg", "Term bg"],
          ["inline-term-fg", "Term text"],
          ["inline-warn-fg", "Warn"],
          ["inline-todo-bg", "TODO bg"],
          ["inline-todo-fg", "TODO text"],
          ["inline-code-bg", "Code bg"],
          ["inline-code-fg", "Code text"],
          ["sidenote-fg", "Side note text"],
          ["sidenote-accent", "Side note accent"],
          ["chapter-overview-bg", "Overview bg"],
          ["chapter-overview-title-bg", "Overview title bg"],
          ["chapter-overview-title-fg", "Overview title"],
          ["chapter-overview-accent", "Overview accent"]
        ].map(([id, label]) => ({ id, label }))
      },
      ...[
        ["Definition", "definition"],
        ["Theorem", "theorem"],
        ["Lemma", "lemma"],
        ["Corollary", "corollary"],
        ["Proposition", "proposition"],
        ["Claim", "claim"],
        ["Fact", "fact"],
        ["Assumption", "assumption"]
      ].map(([title, prefix]) => ({
        title,
        items: [
          [`${prefix}-body-bg`, "Body bg"],
          [`${prefix}-title-bg`, "Title bg"],
          [`${prefix}-title-fg`, "Title fg"],
          [`${prefix}-accent`, "Accent"]
        ].map(([id, label]) => ({ id, label }))
      })),
      {
        title: "Note",
        items: [
          ["note-bg", "Body bg"],
          ["note-title-bg", "Title bg"],
          ["note-title-fg", "Title fg"],
          ["note-accent", "Accent"],
          ["note-frame", "Frame"]
        ].map(([id, label]) => ({ id, label }))
      },
      {
        title: "Example / Remark / Assump",
        items: [
          ["example-bg", "Example bg"],
          ["example-label-fg", "Example label"],
          ["example-accent", "Example accent"],
          ["remark-bg", "Remark bg"],
          ["remark-label-fg", "Remark label"],
          ["remark-inline-fg", "Remark inline"],
          ["remark-accent", "Remark accent"],
          ["assump-bg", "Assump bg"],
          ["assump-label-fg", "Assump label"],
          ["assump-accent", "Assump accent"]
        ].map(([id, label]) => ({ id, label }))
      },
      {
        title: "Study Callouts",
        items: [
          ["insight-bg", "Insight bg"],
          ["insight-label-fg", "Insight label"],
          ["insight-accent", "Insight accent"],
          ["pitfall-bg", "Pitfall bg"],
          ["pitfall-label-fg", "Pitfall label"],
          ["pitfall-accent", "Pitfall accent"],
          ["intuition-bg", "Intuition bg"],
          ["intuition-label-fg", "Intuition label"],
          ["intuition-accent", "Intuition accent"],
          ["summary-bg", "Summary bg"],
          ["summary-label-fg", "Summary label"],
          ["summary-accent", "Summary accent"],
          ["question-bg", "Question bg"],
          ["question-label-fg", "Question label"],
          ["question-accent", "Question accent"]
        ].map(([id, label]) => ({ id, label }))
      }
    ];
    COLOR_ORDER = COLOR_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    COLOR_SET = new Set(COLOR_ORDER);
    TOGGLE_IDS = TOGGLE_SCHEMA.map((item) => item.id);
    CLASS_CONFIG_IDS = CLASS_CONFIG_SCHEMA.map((item) => item.id);
    CLASS_CONFIG_COMMANDS = Object.fromEntries(CLASS_CONFIG_SCHEMA.map((item) => [item.id, item.command]));
    CLASS_CONFIG_DEFAULTS = Object.fromEntries(CLASS_CONFIG_SCHEMA.map((item) => [item.id, item.options[0]?.value ?? "auto"]));
    CLASS_CONFIG_VALID_OPTIONS = Object.fromEntries(CLASS_CONFIG_SCHEMA.map((item) => [item.id, new Set(item.options.map((opt) => opt.value))]));
    BODY_FONT_SIZE_CONFIG = {
      id: "body_font_size_pt",
      label: "Body Font Size",
      help: "Base body text font size applied at begin document.",
      min: 9,
      max: 14,
      step: 0.5,
      default: 10
    };
    STARTER_TEMPLATE_DEFINITIONS = [
      { id: "book-minimal", label: "Book Minimal", description: "Minimal book starter wired to theme.sty and theorem blocks.", filename: "book-minimal.tex" },
      { id: "article-minimal", label: "Article Minimal", description: "Minimal article starter wired to theme.sty and theorem blocks.", filename: "article-minimal.tex" },
      { id: "homework-assignment", label: "Homework Assignment", description: "Formal homework starter with problem, part, and solution environments.", filename: "homework-assignment.tex" }
    ];
    CHAPTER_CLASS_NAMES = /* @__PURE__ */ new Set(["book", "report", "memoir", "scrbook", "scrreprt", "ctexbook", "ctexrep", "bxjsbook"]);
  }
});

// src/utils.ts
var utils_exports = {};
__export(utils_exports, {
  IGNORE_DIR_NAMES: () => IGNORE_DIR_NAMES,
  IGNORE_TEX_FILENAMES: () => IGNORE_TEX_FILENAMES,
  assertValidBodyFontSize: () => assertValidBodyFontSize,
  boolFromTex: () => boolFromTex,
  compileOutputPdfRelpath: () => compileOutputPdfRelpath,
  defaultCompileTarget: () => defaultCompileTarget,
  escapeRegExp: () => escapeRegExp,
  exists: () => exists,
  extractDocumentclassDeclaration: () => extractDocumentclassDeclaration,
  extractDocumentclassName: () => extractDocumentclassName,
  fileUrl: () => fileUrl,
  formatBodyFontSize: () => formatBodyFontSize,
  globToRegExp: () => globToRegExp,
  hexFromRgb: () => hexFromRgb,
  isChapterCapableClass: () => isChapterCapableClass,
  isSubpath: () => isSubpath,
  listFilesRecursive: () => listFilesRecursive,
  listTexCandidates: () => listTexCandidates,
  matchesGlob: () => matchesGlob,
  normalizeBodyFontSize: () => normalizeBodyFontSize,
  normalizeCompileTarget: () => normalizeCompileTarget,
  parseHexColor: () => parseHexColor,
  parseThemeColorDefaults: () => parseThemeColorDefaults,
  resolveWorkspacePath: () => resolveWorkspacePath,
  safeWorkspaceRel: () => safeWorkspaceRel,
  slugify: () => slugify,
  statOrNull: () => statOrNull,
  stripTexComments: () => stripTexComments,
  toPosixPath: () => toPosixPath,
  workspaceRel: () => workspaceRel
});
async function exists(filePath) {
  try {
    await import_node_fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function statOrNull(filePath) {
  try {
    return await import_node_fs.promises.stat(filePath);
  } catch {
    return null;
  }
}
function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}
function isSubpath(child, parent) {
  const childResolved = path.resolve(child);
  const parentResolved = path.resolve(parent);
  const relative4 = path.relative(parentResolved, childResolved);
  return relative4 === "" || !!relative4 && !relative4.startsWith("..") && !path.isAbsolute(relative4);
}
function workspaceRel(rootDir, absolutePath) {
  if (!isSubpath(absolutePath, rootDir)) {
    throw new Error(`Path is outside workspace: ${absolutePath}`);
  }
  return toPosixPath(path.relative(rootDir, absolutePath));
}
function resolveWorkspacePath(rootDir, relPath, mustStayInside = true) {
  if (path.isAbsolute(relPath)) {
    if (mustStayInside && !isSubpath(relPath, rootDir)) {
      throw new Error(`Path is outside workspace: ${relPath}`);
    }
    return path.resolve(relPath);
  }
  const resolved = path.resolve(rootDir, relPath);
  if (mustStayInside && !isSubpath(resolved, rootDir)) {
    throw new Error(`Path is outside workspace: ${relPath}`);
  }
  return resolved;
}
function safeWorkspaceRel(rootDir, maybePath) {
  if (typeof maybePath !== "string" || !maybePath.trim()) return "";
  try {
    const resolved = resolveWorkspacePath(rootDir, maybePath.trim(), true);
    return workspaceRel(rootDir, resolved);
  } catch {
    return "";
  }
}
function parseHexColor(raw) {
  const cleaned = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}
function hexFromRgb(rgb) {
  return `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
function blend(left, right, leftWeight) {
  const lw = Math.max(0, Math.min(1, leftWeight));
  const rw = 1 - lw;
  return [
    left[0] * lw + right[0] * rw,
    left[1] * lw + right[1] * rw,
    left[2] * lw + right[2] * rw
  ];
}
function boolFromTex(raw) {
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off", ""].includes(value)) return false;
  return null;
}
function formatBodyFontSize(value) {
  return value.toFixed(1);
}
function normalizeBodyFontSize(raw, defaultValue = 10) {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  const clamped = Math.min(14, Math.max(9, parsed));
  return Number((9 + Math.round((clamped - 9) / 0.5) * 0.5).toFixed(1));
}
function assertValidBodyFontSize(raw) {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 9 || parsed > 14) {
    throw new Error(`Invalid value for body_font_size_pt: ${raw}. Expected 9.0 to 14.0.`);
  }
  const normalized = normalizeBodyFontSize(parsed);
  if (Math.abs(normalized - parsed) > 1e-9) {
    throw new Error(`Invalid value for body_font_size_pt: ${raw}. Expected increments of 0.5.`);
  }
  return normalized;
}
function slugify(raw) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}
function escapeRegExp(raw) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripTexComments(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/(?<!\\)%.*/, "")).join("\n");
}
function extractDocumentclassDeclaration(text) {
  const match = /\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/i.exec(text);
  if (!match) return null;
  const rawClass = (match[2] ?? "").split(",", 1)[0].trim().toLowerCase();
  return { className: rawClass, options: (match[1] ?? "").trim() };
}
async function extractDocumentclassName(texPath, rootDir, visited = /* @__PURE__ */ new Set()) {
  const resolved = path.resolve(texPath);
  if (visited.has(resolved)) return "";
  visited.add(resolved);
  const text = await import_node_fs.promises.readFile(resolved, "utf8");
  const declaration = extractDocumentclassDeclaration(text);
  if (!declaration) return "";
  if (declaration.className !== "subfiles") return declaration.className;
  const parentRef = declaration.options.split(",")[0]?.trim();
  if (!parentRef) return declaration.className;
  const parent = path.resolve(path.dirname(resolved), parentRef);
  if (!isSubpath(parent, rootDir) || !await exists(parent)) return declaration.className;
  return extractDocumentclassName(parent, rootDir, visited);
}
function isChapterCapableClass(className) {
  const name = className.trim().toLowerCase();
  return CHAPTER_CLASS_NAMES.has(name) || name.endsWith("book") || name.endsWith("report");
}
function globToRegExp(pattern) {
  const normalized = toPosixPath(pattern);
  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  source += "$";
  return new RegExp(source);
}
function matchesGlob(relPath, basename12, pattern) {
  const normalized = toPosixPath(relPath);
  if (!pattern.includes("/")) {
    return globToRegExp(pattern).test(basename12);
  }
  return globToRegExp(pattern).test(normalized);
}
async function listFilesRecursive(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await import_node_fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORE_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await walk(rootDir);
  return out.sort();
}
async function listTexCandidates(rootDir) {
  const candidates = [];
  const all = await listFilesRecursive(rootDir);
  for (const abs of all) {
    if (!abs.endsWith(".tex")) continue;
    if (IGNORE_TEX_FILENAMES.has(path.basename(abs))) continue;
    try {
      const text = await import_node_fs.promises.readFile(abs, "utf8");
      if (extractDocumentclassDeclaration(text)) {
        candidates.push(workspaceRel(rootDir, abs));
      }
    } catch {
    }
  }
  candidates.sort((a, b) => {
    if (a === "main.tex") return -1;
    if (b === "main.tex") return 1;
    return a.localeCompare(b);
  });
  return candidates;
}
function defaultCompileTarget(candidates) {
  return candidates.includes("main.tex") ? "main.tex" : candidates[0] ?? "";
}
function normalizeCompileTarget(rootDir, rawTarget, candidates) {
  if (candidates.length === 0) return "";
  const raw = String(rawTarget ?? "").trim();
  if (!raw) return defaultCompileTarget(candidates);
  const normalized = toPosixPath(raw);
  if (candidates.includes(normalized)) return normalized;
  const resolved = resolveWorkspacePath(rootDir, normalized, true);
  const rel = workspaceRel(rootDir, resolved);
  if (candidates.includes(rel)) return rel;
  throw new Error(`Unknown compile target: ${raw}`);
}
function compileOutputPdfRelpath(compileTarget) {
  if (!compileTarget) return "main.pdf";
  return toPosixPath(compileTarget).replace(/\.tex$/i, ".pdf");
}
async function parseThemeColorDefaults(themePath, colorOrder) {
  const text = await import_node_fs.promises.readFile(themePath, "utf8");
  const defines = {};
  for (const match of text.matchAll(/\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
    defines[match[1]] = `#${match[2].toUpperCase()}`;
  }
  const colorlets = [];
  for (const match of text.matchAll(/\\colorlet\{([^}]+)\}\{([^}]+)\}/g)) {
    colorlets.push({ token: match[1], expr: match[2] });
  }
  const resolved = {};
  const resolveExpr = (expr, depth = 0) => {
    if (depth > 20) return [128, 128, 128];
    const hex = parseHexColor(expr);
    if (hex) {
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    }
    const lowered = expr.trim().toLowerCase();
    if (BASE_COLORS[lowered]) return BASE_COLORS[lowered];
    if (defines[expr]) return resolveExpr(defines[expr], depth + 1);
    if (resolved[expr]) return resolveExpr(resolved[expr], depth + 1);
    if (expr.includes("!")) {
      const parts = expr.split("!");
      let current = resolveExpr(parts[0], depth + 1);
      for (let i = 1; i < parts.length; i += 2) {
        const pct = Number(parts[i]);
        const right = resolveExpr(parts[i + 1] || "white", depth + 1);
        current = blend(current, right, Number.isFinite(pct) ? pct / 100 : 0.5);
      }
      return current;
    }
    return [128, 128, 128];
  };
  for (const { token, expr } of colorlets) {
    if (colorOrder.includes(token)) {
      resolved[token] = hexFromRgb(resolveExpr(expr));
    }
  }
  const out = {};
  for (const token of colorOrder) out[token] = resolved[token] ?? "#808080";
  return out;
}
function fileUrl(filePath) {
  return (0, import_node_url.pathToFileURL)(filePath).toString();
}
var import_node_fs, path, import_node_url, IGNORE_TEX_FILENAMES, IGNORE_DIR_NAMES, BASE_COLORS;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    import_node_fs = require("node:fs");
    path = __toESM(require("node:path"));
    import_node_url = require("node:url");
    init_schema();
    IGNORE_TEX_FILENAMES = /* @__PURE__ */ new Set(["theme.colors.tex", "theme.overrides.tex"]);
    IGNORE_DIR_NAMES = /* @__PURE__ */ new Set([".git", ".vscode", "__pycache__", "build", "dist", "out", ".venv", "venv", "node_modules"]);
    BASE_COLORS = {
      white: [255, 255, 255],
      black: [0, 0, 0],
      red: [255, 0, 0],
      green: [0, 255, 0],
      blue: [0, 0, 255],
      cyan: [0, 255, 255],
      magenta: [255, 0, 255],
      yellow: [255, 255, 0],
      orange: [255, 165, 0],
      violet: [238, 130, 238],
      pink: [255, 192, 203],
      purple: [128, 0, 128],
      midnightblue: [25, 25, 112],
      navyblue: [0, 0, 128],
      royalblue: [65, 105, 225]
    };
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var fs14 = __toESM(require("node:fs"));
var path16 = __toESM(require("node:path"));
var vscode7 = __toESM(require("vscode"));

// src/changeHistory.ts
var import_node_crypto = require("node:crypto");
var import_node_fs2 = require("node:fs");
var path2 = __toESM(require("node:path"));
init_utils();
var HistoryConflictError = class extends Error {
  constructor(conflicts) {
    super(`Files or settings changed after the recorded operation: ${conflicts.join(", ")}`);
    this.conflicts = conflicts;
    this.name = "HistoryConflictError";
  }
  conflicts;
};
var ChangeHistoryService = class {
  constructor(rootDir, storageDir, stateService) {
    this.rootDir = rootDir;
    this.storageDir = storageDir;
    this.stateService = stateService;
  }
  rootDir;
  storageDir;
  stateService;
  queue = Promise.resolve();
  async historyState() {
    const record = await this.readRecord();
    return {
      canUndo: record?.state === "applied",
      canRedo: record?.state === "undone",
      label: record?.label ?? "",
      createdAt: record?.createdAt ?? ""
    };
  }
  runStateChange(command, label, task, enabled = true) {
    if (!this.storageDir || !enabled) return task();
    return this.runSerialized(async () => {
      const before = this.editableState(await this.stateService.loadState());
      const configTargets = this.normalizePaths(["theme.ui.json", "theme.overrides.tex", "theme.colors.tex"]);
      const beforeFiles = await this.captureValues(configTargets);
      try {
        const result = await task();
        const after = this.editableState(await this.stateService.loadState());
        await this.commit({ command, label, beforeEditableState: before, afterEditableState: after, files: [] });
        return result;
      } catch (err) {
        await this.restoreValues(configTargets.map((target, index) => ({ target, value: beforeFiles[index] }))).catch(() => void 0);
        throw err;
      }
    });
  }
  runFileChange(command, label, paths, task, enabled = true) {
    if (!this.storageDir || !enabled) return task();
    return this.runSerialized(async () => {
      const targets = this.normalizePaths(paths);
      const before = await this.captureValues(targets);
      try {
        const result = await task();
        const after = await this.captureValues(targets);
        const files = targets.map((target, index) => ({
          path: workspaceRel(this.rootDir, target),
          before: before[index],
          after: after[index]
        }));
        await this.commit({ command, label, files });
        return result;
      } catch (err) {
        await this.restoreValues(targets.map((target, index) => ({ target, value: before[index] }))).catch(() => void 0);
        throw err;
      }
    });
  }
  undo(force = false) {
    return this.runSerialized(async () => this.restoreDirection("undo", force));
  }
  redo(force = false) {
    return this.runSerialized(async () => this.restoreDirection("redo", force));
  }
  async restoreDirection(direction, force) {
    const record = await this.readRecord();
    if (!record) throw new Error("No Toolkit change is available to restore.");
    if (direction === "undo" && record.state !== "applied") throw new Error("The last Toolkit change is already undone.");
    if (direction === "redo" && record.state !== "undone") throw new Error("No Toolkit change is available to redo.");
    const expectedState = direction === "undo" ? record.afterEditableState : record.beforeEditableState;
    const restoreState = direction === "undo" ? record.beforeEditableState : record.afterEditableState;
    const conflicts = [];
    if (expectedState) {
      const current = this.editableState(await this.stateService.loadState());
      if (JSON.stringify(current) !== JSON.stringify(expectedState)) conflicts.push("Toolkit settings");
    }
    for (const file of record.files) {
      const target = path2.resolve(this.rootDir, file.path);
      const current = await this.captureValue(target);
      const expected = direction === "undo" ? file.after : file.before;
      if (current.fingerprint !== expected.fingerprint) conflicts.push(file.path);
    }
    if (conflicts.length > 0 && !force) throw new HistoryConflictError(conflicts);
    if (restoreState) {
      await this.restoreEditableState(restoreState);
      const actual = this.editableState(await this.stateService.loadState());
      if (direction === "undo") record.beforeEditableState = actual;
      else record.afterEditableState = actual;
    }
    if (record.files.length > 0) {
      await this.restoreValues(record.files.map((file) => ({
        target: path2.resolve(this.rootDir, file.path),
        value: direction === "undo" ? file.before : file.after
      })));
    }
    record.state = direction === "undo" ? "undone" : "applied";
    await this.writeRecord(record);
    return this.historyState();
  }
  editableState(state) {
    return {
      toggles: { ...state.toggles },
      colors: { ...state.colors },
      style_preset: state.style_preset,
      style_base_preset: state.style_base_preset,
      body_font_size_pt: state.body_font_size_pt,
      class_config: { ...state.class_config },
      compile_target: state.compile_target,
      compile_recipe: state.compile_recipe,
      compile_use_internal_fallback: state.compile_use_internal_fallback
    };
  }
  async restoreEditableState(snapshot) {
    const current = await this.stateService.loadState();
    current.toggles = { ...snapshot.toggles };
    current.colors = { ...snapshot.colors };
    current.style_preset = current.style_presets.some((preset) => preset.id === snapshot.style_preset) ? snapshot.style_preset : snapshot.style_base_preset;
    current.style_base_preset = snapshot.style_base_preset;
    current.body_font_size_pt = snapshot.body_font_size_pt;
    current.class_config = { ...snapshot.class_config };
    current.compile_target = snapshot.compile_target;
    current.compile_recipe = snapshot.compile_recipe;
    current.compile_use_internal_fallback = snapshot.compile_use_internal_fallback;
    await this.stateService.writeOverrideFiles(current);
  }
  async captureValues(targets) {
    return Promise.all(targets.map((target) => this.captureValue(target)));
  }
  async captureValue(target) {
    try {
      const stat = await import_node_fs2.promises.lstat(target);
      if (stat.isSymbolicLink()) {
        const link = await import_node_fs2.promises.readlink(target);
        return { kind: "symlink", link_target: link, mode: stat.mode, fingerprint: hash(`symlink:${link}`) };
      }
      if (stat.isDirectory()) {
        const entries = (await import_node_fs2.promises.readdir(target)).sort();
        return { kind: "directory", mode: stat.mode, fingerprint: hash(`directory:${entries.join("\0")}`) };
      }
      if (stat.isFile()) {
        const content = await import_node_fs2.promises.readFile(target);
        return { kind: "file", content_base64: content.toString("base64"), mode: stat.mode, fingerprint: hashBuffer(content) };
      }
      return { kind: "missing", fingerprint: hash("missing") };
    } catch (err) {
      if (err.code === "ENOENT") return { kind: "missing", fingerprint: hash("missing") };
      throw err;
    }
  }
  async restoreValues(entries) {
    for (const { target, value } of entries.filter((entry) => entry.value.kind === "directory")) {
      await import_node_fs2.promises.mkdir(target, { recursive: true });
      if (value.mode !== void 0) await import_node_fs2.promises.chmod(target, value.mode).catch(() => void 0);
    }
    for (const { target, value } of entries.filter((entry) => entry.value.kind === "file" || entry.value.kind === "symlink")) {
      await import_node_fs2.promises.mkdir(path2.dirname(target), { recursive: true });
      await import_node_fs2.promises.rm(target, { recursive: true, force: true });
      if (value.kind === "file") {
        const temp = `${target}.restore-${(0, import_node_crypto.randomUUID)()}`;
        await import_node_fs2.promises.writeFile(temp, Buffer.from(value.content_base64 ?? "", "base64"));
        await import_node_fs2.promises.rename(temp, target);
        if (value.mode !== void 0) await import_node_fs2.promises.chmod(target, value.mode).catch(() => void 0);
      } else {
        await import_node_fs2.promises.symlink(value.link_target ?? "", target);
      }
    }
    const missing = entries.filter((entry) => entry.value.kind === "missing");
    for (const { target } of missing) {
      try {
        const stat = await import_node_fs2.promises.lstat(target);
        if (!stat.isDirectory()) await import_node_fs2.promises.unlink(target);
      } catch (err) {
        const code = err.code;
        if (code !== "ENOENT") throw err;
      }
    }
    for (const { target } of [...missing].reverse()) {
      try {
        if ((await import_node_fs2.promises.lstat(target)).isDirectory()) await import_node_fs2.promises.rmdir(target);
      } catch (err) {
        const code = err.code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY") throw err;
      }
    }
  }
  normalizePaths(rawPaths) {
    const unique2 = /* @__PURE__ */ new Set();
    for (const raw of rawPaths) {
      const target = path2.isAbsolute(raw) ? path2.resolve(raw) : path2.resolve(this.rootDir, raw);
      if (!isSubpath(target, this.rootDir)) throw new Error(`History target is outside workspace: ${raw}`);
      unique2.add(target);
    }
    return [...unique2];
  }
  async commit(input) {
    await this.writeRecord({
      version: 1,
      id: (0, import_node_crypto.randomUUID)(),
      rootPath: this.rootDir,
      command: input.command,
      label: input.label,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      state: "applied",
      beforeEditableState: input.beforeEditableState,
      afterEditableState: input.afterEditableState,
      files: input.files
    });
  }
  manifestPath() {
    return this.storageDir ? path2.join(this.storageDir, "last-change.json") : void 0;
  }
  async readRecord() {
    const manifest = this.manifestPath();
    if (!manifest) return void 0;
    try {
      const parsed = JSON.parse(await import_node_fs2.promises.readFile(manifest, "utf8"));
      return parsed?.version === 1 && parsed.rootPath === this.rootDir ? parsed : void 0;
    } catch {
      return void 0;
    }
  }
  async writeRecord(record) {
    const manifest = this.manifestPath();
    if (!manifest) return;
    await import_node_fs2.promises.mkdir(path2.dirname(manifest), { recursive: true });
    const temp = `${manifest}.tmp-${(0, import_node_crypto.randomUUID)()}`;
    await import_node_fs2.promises.writeFile(temp, `${JSON.stringify(record)}
`, "utf8");
    await import_node_fs2.promises.rename(temp, manifest);
  }
  runSerialized(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => void 0);
    return next;
  }
};
function workspaceHistoryStorageRoot(globalStoragePath, rootPath) {
  const resolved = path2.resolve(rootPath);
  const canonical = process.platform === "win32" || process.platform === "darwin" ? resolved.toLocaleLowerCase() : resolved;
  return path2.join(globalStoragePath, "history", (0, import_node_crypto.createHash)("sha256").update(canonical).digest("hex"));
}
function hash(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
}
function hashBuffer(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
}

// src/confirmations.ts
var CONFIRM_ACTIONS = [
  "starter-overwrite",
  "upgrade-theme-assets",
  "reset-overrides",
  "clean-artifacts",
  "unsplit-delete-source"
];
function isConfirmAction(value) {
  return typeof value === "string" && CONFIRM_ACTIONS.includes(value);
}
function confirmationSpec(action, detail = "") {
  switch (action) {
    case "starter-overwrite":
      return {
        message: "Overwrite the existing starter target?",
        detail: detail ? `The existing file will be replaced:
${detail}` : "The existing starter target will be replaced.",
        confirmLabel: "Overwrite"
      };
    case "upgrade-theme-assets": {
      const resetColors = detail === "default";
      return {
        message: "Upgrade Toolkit theme assets?",
        detail: resetColors ? "The current assets will be backed up and replaced. The complete Default color package will replace current colors; compile and document settings are preserved." : "The current assets will be backed up and replaced. Existing colors and Toolkit settings will be preserved.",
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

// src/personalStyles.ts
var import_node_crypto2 = require("node:crypto");
init_schema();
init_utils();
var PERSONAL_STYLES_STATE_KEY = "latexEditingToolkit.personalStyles.v1";
var PersonalStyleRegistry = class {
  constructor(store) {
    this.store = store;
  }
  store;
  queue = Promise.resolve();
  list() {
    const raw = this.store.get(PERSONAL_STYLES_STATE_KEY);
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of raw) {
      const parsed = this.parseRecord(item);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(parsed);
    }
    return out.sort((left, right) => left.label.localeCompare(right.label));
  }
  definitions() {
    return this.list().map((record) => {
      const base = STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === record.basePresetId) ?? STYLE_PRESET_DEFINITIONS[0];
      return {
        id: record.id,
        label: record.label,
        description: record.description,
        block_source: base.block_source,
        heading_source: base.heading_source,
        source: "personal",
        base_preset_id: base.id,
        editable: true,
        colors: { ...record.colors }
      };
    });
  }
  add(label, basePresetId, colors) {
    return this.runSerialized(async () => {
      const normalizedLabel = label.trim();
      this.assertLabelAvailable(normalizedLabel, this.list());
      const base = this.validateBasePreset(basePresetId);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const record = {
        version: 1,
        id: `personal:${(0, import_node_crypto2.randomUUID)()}`,
        label: normalizedLabel,
        description: `Personal style based on ${base.label}`,
        basePresetId: base.id,
        colors: this.validateColors(colors),
        createdAt: now,
        updatedAt: now
      };
      await this.write([...this.list(), record]);
      return record;
    });
  }
  update(id, colors) {
    return this.runSerialized(async () => {
      const records = this.list();
      const current = records.find((record) => record.id === id);
      if (!current) throw new Error("Personal style not found.");
      const updated = { ...current, colors: this.validateColors(colors), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await this.write(records.map((record) => record.id === id ? updated : record));
      return updated;
    });
  }
  rename(id, label) {
    return this.runSerialized(async () => {
      const records = this.list();
      const current = records.find((record) => record.id === id);
      if (!current) throw new Error("Personal style not found.");
      const updated = {
        ...current,
        label: label.trim(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.assertLabelAvailable(updated.label, records.filter((record) => record.id !== id));
      await this.write(records.map((record) => record.id === id ? updated : record));
      return updated;
    });
  }
  remove(id) {
    return this.runSerialized(async () => {
      const records = this.list();
      const removed = records.find((record) => record.id === id);
      if (!removed) return void 0;
      await this.write(records.filter((record) => record.id !== id));
      return removed;
    });
  }
  importLibrary(raw) {
    return this.runSerialized(async () => {
      const envelope = isRecord(raw) && raw.version === 1 && Array.isArray(raw.styles) ? raw.styles : [];
      const records = this.list();
      let imported = 0;
      let skipped = 0;
      for (const item of envelope) {
        const parsed = this.parseRecord(item);
        if (!parsed) {
          skipped += 1;
          continue;
        }
        const index = records.findIndex((record) => record.id === parsed.id);
        if (index >= 0) records[index] = { ...parsed, label: this.uniqueLabel(parsed.label, records.filter((_, itemIndex) => itemIndex !== index)) };
        else records.push({ ...parsed, label: this.uniqueLabel(parsed.label, records) });
        imported += 1;
      }
      await this.write(records);
      return { imported, skipped };
    });
  }
  exportLibrary() {
    return { version: 1, styles: this.list() };
  }
  parseRecord(raw) {
    if (!isRecord(raw) || raw.version !== 1 || typeof raw.id !== "string" || !raw.id.startsWith("personal:")) return void 0;
    if (typeof raw.label !== "string" || !raw.label.trim() || typeof raw.basePresetId !== "string") return void 0;
    let colors;
    try {
      colors = this.validateColors(isRecord(raw.colors) ? Object.fromEntries(Object.entries(raw.colors).map(([key, value]) => [key, String(value)])) : {});
      this.validateBasePreset(raw.basePresetId);
    } catch {
      return void 0;
    }
    const createdAt = validDate(raw.createdAt) ?? (/* @__PURE__ */ new Date(0)).toISOString();
    const updatedAt = validDate(raw.updatedAt) ?? createdAt;
    return {
      version: 1,
      id: raw.id,
      label: raw.label.trim(),
      description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : `Personal style based on ${raw.basePresetId}`,
      basePresetId: raw.basePresetId,
      colors,
      createdAt,
      updatedAt
    };
  }
  validateColors(raw) {
    if (Object.keys(raw).length !== COLOR_ORDER.length || COLOR_ORDER.some((token) => !(token in raw))) {
      throw new Error("Personal style must contain every Toolkit color token.");
    }
    const colors = {};
    for (const token of COLOR_ORDER) {
      const parsed = parseHexColor(raw[token]);
      if (!parsed) throw new Error(`Invalid color for ${token}.`);
      colors[token] = parsed;
    }
    return colors;
  }
  validateBasePreset(id) {
    const base = STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === id);
    if (!base) throw new Error(`Unknown built-in base style: ${id}.`);
    return base;
  }
  uniqueLabel(raw, records) {
    const base = raw.trim();
    if (!base) throw new Error("Personal style name is required.");
    const used = new Set(records.map((record) => record.label.toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    let index = 2;
    while (used.has(`${base} (Imported ${index})`.toLocaleLowerCase())) index += 1;
    return `${base} (Imported ${index})`;
  }
  assertLabelAvailable(label, records) {
    if (!label) throw new Error("Personal style name is required.");
    if (records.some((record) => record.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      throw new Error(`A personal style named '${label}' already exists.`);
    }
  }
  async write(records) {
    await this.store.update(PERSONAL_STYLES_STATE_KEY, records);
  }
  runSerialized(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => void 0);
    return next;
  }
};
function validDate(raw) {
  if (typeof raw !== "string") return void 0;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? void 0 : new Date(timestamp).toISOString();
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/projectRegistry.ts
var import_node_crypto3 = require("node:crypto");
var import_node_fs3 = require("node:fs");
var path3 = __toESM(require("node:path"));
var LOCAL_PROJECTS_STATE_KEY = "latexEditingToolkit.localProjects";
var LocalProjectRegistry = class {
  constructor(store, stateKey = LOCAL_PROJECTS_STATE_KEY) {
    this.store = store;
    this.stateKey = stateKey;
  }
  store;
  stateKey;
  queue = Promise.resolve();
  list() {
    return this.runSerialized(async () => {
      const entries = await this.readCleanEntries();
      const statuses = await Promise.all(entries.map(async (entry) => ({
        ...entry,
        missing: !await this.isDirectory(entry.rootPath)
      })));
      return statuses.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  }
  add(rootPath, templateId) {
    return this.runSerialized(async () => {
      const normalizedPath = normalizeProjectPath(rootPath);
      const targetKey = await this.canonicalPathKey(normalizedPath);
      const entries = await this.readCleanEntries();
      const existing = await this.findByCanonicalKey(entries, targetKey);
      const entry = existing ? {
        ...existing,
        // Preserve the original id, timestamp, and user-facing path. A symlink or
        // differently-cased path must not make an existing note appear recreated.
        templateId: String(templateId || existing.templateId || "unknown")
      } : {
        id: (0, import_node_crypto3.randomUUID)(),
        rootPath: normalizedPath,
        label: path3.basename(normalizedPath),
        templateId: String(templateId || "unknown"),
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const next = existing ? entries.map((item) => item.id === existing.id ? entry : item) : [...entries, entry];
      await this.writeEntries(next);
      return entry;
    });
  }
  find(rootPath) {
    return this.runSerialized(async () => {
      const normalizedPath = normalizeProjectPath(rootPath);
      const targetKey = await this.canonicalPathKey(normalizedPath);
      const entries = await this.readCleanEntries();
      const entry = await this.findByCanonicalKey(entries, targetKey);
      return entry ? { ...entry, missing: !await this.isDirectory(entry.rootPath) } : void 0;
    });
  }
  remove(rootPath) {
    return this.runSerialized(async () => {
      const normalizedPath = normalizeProjectPath(rootPath);
      const targetKey = await this.canonicalPathKey(normalizedPath);
      const entries = await this.readCleanEntries();
      const current = await this.findByCanonicalKey(entries, targetKey);
      if (!current) return false;
      await this.writeEntries(entries.filter((entry) => entry.id !== current.id));
      return true;
    });
  }
  relocate(oldRootPath, newRootPath) {
    return this.runSerialized(async () => {
      const oldPath = normalizeProjectPath(oldRootPath);
      const newPath = normalizeProjectPath(newRootPath);
      if (!await this.isDirectory(newPath)) throw new Error("The selected location is not a local directory.");
      if (!await this.isRegularFile(path3.join(newPath, "main.tex"))) {
        throw new Error("The selected directory does not contain main.tex.");
      }
      const oldKey = await this.canonicalPathKey(oldPath);
      const newKey = await this.canonicalPathKey(newPath);
      const entries = await this.readCleanEntries();
      const current = await this.findByCanonicalKey(entries, oldKey);
      if (!current) throw new Error("The local note project is no longer registered.");
      const duplicate = await this.findByCanonicalKey(entries.filter((entry) => entry.id !== current.id), newKey);
      if (duplicate) throw new Error(`The selected directory is already registered as '${duplicate.label}'.`);
      const updated = {
        ...current,
        rootPath: newPath,
        label: path3.basename(newPath)
      };
      await this.writeEntries(entries.map((entry) => entry.id === current.id ? updated : entry));
      return updated;
    });
  }
  async readCleanEntries() {
    const raw = this.store.get(this.stateKey);
    if (!Array.isArray(raw)) {
      if (raw !== void 0) await this.writeEntries([]);
      return [];
    }
    const parsed = [];
    for (const item of raw) {
      if (!isRecord2(item)) continue;
      const rawRootPath = typeof item.rootPath === "string" ? item.rootPath : item.root_path;
      const rootPath = typeof rawRootPath === "string" ? safeNormalizeProjectPath(rawRootPath) : void 0;
      if (!rootPath) continue;
      parsed.push({
        id: typeof item.id === "string" && item.id ? item.id : legacyProjectId(rootPath),
        rootPath,
        label: typeof item.label === "string" && item.label ? item.label : path3.basename(rootPath),
        templateId: typeof item.templateId === "string" && item.templateId ? item.templateId : typeof item.template_id === "string" && item.template_id ? item.template_id : "unknown",
        createdAt: validTimestamp(item.createdAt) ?? validTimestamp(item.created_at) ?? (/* @__PURE__ */ new Date(0)).toISOString()
      });
    }
    const byCanonicalPath = /* @__PURE__ */ new Map();
    for (const entry of parsed) {
      const key = await this.canonicalPathKey(entry.rootPath);
      const previous = byCanonicalPath.get(key);
      if (!previous || entry.createdAt >= previous.createdAt) byCanonicalPath.set(key, entry);
    }
    const cleaned = [...byCanonicalPath.values()];
    if (JSON.stringify(cleaned) !== JSON.stringify(raw)) await this.writeEntries(cleaned);
    return cleaned;
  }
  async findByCanonicalKey(entries, targetKey) {
    for (const entry of entries) {
      if (await this.canonicalPathKey(entry.rootPath) === targetKey) return entry;
    }
    return void 0;
  }
  async canonicalPathKey(value) {
    let canonical = path3.normalize(value);
    try {
      canonical = path3.normalize(await import_node_fs3.promises.realpath(canonical));
    } catch {
    }
    return caseFoldPath(canonical);
  }
  async writeEntries(entries) {
    await this.store.update(this.stateKey, entries);
  }
  async isDirectory(target) {
    try {
      return (await import_node_fs3.promises.stat(target)).isDirectory();
    } catch {
      return false;
    }
  }
  async isRegularFile(target) {
    try {
      return (await import_node_fs3.promises.stat(target)).isFile();
    } catch {
      return false;
    }
  }
  runSerialized(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => void 0);
    return next;
  }
};
function normalizeProjectPath(rawPath) {
  const normalized = safeNormalizeProjectPath(rawPath);
  if (!normalized) throw new Error("Local note project path must be an absolute local path.");
  return normalized;
}
function safeNormalizeProjectPath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value || !path3.isAbsolute(value)) return void 0;
  return path3.normalize(value);
}
function caseFoldPath(value) {
  const normalized = path3.normalize(value);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}
function legacyProjectId(rootPath) {
  return `legacy-${(0, import_node_crypto3.createHash)("sha1").update(caseFoldPath(rootPath)).digest("hex").slice(0, 16)}`;
}
function validTimestamp(value) {
  if (typeof value !== "string") return void 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? void 0 : new Date(parsed).toISOString();
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/projectWorkflow.ts
var import_node_fs4 = require("node:fs");
var path4 = __toESM(require("node:path"));
init_schema();
init_utils();
async function runCreateProjectWorkflow(service, registry, rootPath, templateId) {
  await import_node_fs4.promises.mkdir(rootPath, { recursive: true });
  await service.handle("initialize-workspace", {});
  await service.handle("template-bootstrap", {
    template_id: templateId,
    output_target: "main.tex",
    overwrite: false
  });
  await registry.add(rootPath, templateId);
}
var WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
async function preflightCreateProject(draft, extensionDir) {
  const errors = [];
  const warnings = [];
  const parentPath = path4.resolve(String(draft.parentPath || ""));
  const projectName = String(draft.projectName || "").trim();
  const template = STARTER_TEMPLATE_DEFINITIONS.find((item) => item.id === draft.templateId);
  if (!path4.isAbsolute(String(draft.parentPath || ""))) errors.push("Parent location must be an absolute local path.");
  if (!projectName) errors.push("Project name is required.");
  if (projectName === "." || projectName === "..") errors.push("Project name cannot be '.' or '..'.");
  if (/[\\/\0]/.test(projectName)) errors.push("Project name cannot contain path separators or NUL characters.");
  if (WINDOWS_RESERVED_NAME.test(projectName)) errors.push("Project name is reserved by Windows.");
  const rootPath = path4.resolve(parentPath, projectName || "New Notes");
  if (path4.dirname(rootPath) !== path4.normalize(parentPath)) errors.push("Project path must remain directly inside the selected parent folder.");
  try {
    const stat = await import_node_fs4.promises.stat(parentPath);
    if (!stat.isDirectory()) errors.push("Selected parent location is not a directory.");
    else await import_node_fs4.promises.access(parentPath, import_node_fs4.constants.W_OK);
  } catch (err) {
    errors.push(`Parent location is not writable: ${err.message}`);
  }
  let targetExists = false;
  let targetEmpty = false;
  try {
    const stat = await import_node_fs4.promises.lstat(rootPath);
    targetExists = true;
    if (!stat.isDirectory()) errors.push("A non-directory item already exists at the project path.");
    else {
      const entries = await import_node_fs4.promises.readdir(rootPath);
      targetEmpty = entries.length === 0;
      if (targetEmpty) warnings.push("The project folder already exists and is empty.");
      else errors.push(`Project folder is not empty: ${entries.slice(0, 5).join(", ")}${entries.length > 5 ? ` and ${entries.length - 5} more` : ""}.`);
    }
  } catch (err) {
    if (err.code !== "ENOENT") errors.push(`Could not inspect project path: ${err.message}`);
  }
  if (!template) errors.push(`Unknown starter template: ${draft.templateId}.`);
  else {
    try {
      const source = path4.join(extensionDir, "assets", "template", "templates", template.filename);
      const text = await import_node_fs4.promises.readFile(source, "utf8");
      if (!extractDocumentclassDeclaration(text)) errors.push(`Starter template '${template.filename}' has no valid \\documentclass declaration.`);
    } catch (err) {
      errors.push(`Starter template is unavailable: ${err.message}`);
    }
  }
  return {
    ok: errors.length === 0,
    rootPath,
    targetExists,
    targetEmpty,
    errors,
    warnings,
    plannedFiles: [
      "main.tex",
      "theme.sty",
      "theorems.tex",
      "commands.tex",
      "references.bib",
      ".vscode/settings.json",
      "Fig/",
      "templates/"
    ]
  };
}

// src/extension.ts
init_schema();

// src/snippets/engine/host.ts
var vscode5 = __toESM(require("vscode"));
var import_fs2 = require("fs");
var path6 = __toESM(require("path"));

// src/snippets/engine/openFileExplorer.ts
var os = __toESM(require("os"));
var import_child_process = require("child_process");
function openExplorer(path17, callback = (err) => {
  console.log(err);
}) {
  let platform3 = os.platform();
  let defaultPath = {
    "win32": ".",
    "darwin": ".",
    "linux": "."
  };
  let commands4 = {
    "win32": "explorer",
    "darwin": "open",
    "linux": "xdg-open"
  };
  if (!(platform3 == "win32" || platform3 == "darwin" || platform3 == "linux")) {
    return callback(new Error("Platform not supported"));
  }
  path17 = path17 || defaultPath[platform3];
  let p = (0, import_child_process.spawn)(commands4[platform3], [path17]);
  p.on("error", (err) => {
    p.kill();
    return callback(err);
  });
}

// src/snippets/engine/hsnippetInstance.ts
var vscode3 = __toESM(require("vscode"));

// src/snippets/engine/dynamicRange.ts
var vscode = __toESM(require("vscode"));
function getRangeDelta(range, change, growth) {
  let deltaStart = { characterDelta: 0, lineDelta: 0 };
  let deltaEnd = { characterDelta: 0, lineDelta: 0 };
  let textLines = change.text.split("\n");
  let lineDelta = change.text.split("\n").length - (change.range.end.line - change.range.start.line + 1);
  let charDelta = textLines[textLines.length - 1].length - change.range.end.character;
  if (lineDelta == 0) charDelta += change.range.start.character;
  if (range.start.isAfterOrEqual(change.range.end)) {
    deltaStart.lineDelta = lineDelta;
  }
  if (range.end.isAfterOrEqual(change.range.end)) {
    deltaEnd.lineDelta = lineDelta;
  }
  if (change.range.end.line == range.start.line) {
    if (growth == 2 /* FixRight */ && range.start.isEqual(change.range.end) || range.start.isAfter(change.range.end)) {
      deltaStart.characterDelta = charDelta;
    }
  }
  if (change.range.end.line == range.end.line) {
    if (growth != 1 /* FixLeft */ && range.end.isEqual(change.range.end) || range.end.isAfter(change.range.end)) {
      deltaEnd.characterDelta = charDelta;
    }
  }
  return [deltaStart, deltaEnd];
}
var DynamicRange = class _DynamicRange {
  range;
  constructor(start, end) {
    this.range = new vscode.Range(start, end);
  }
  static fromRange(range) {
    return new _DynamicRange(range.start, range.end);
  }
  update(changes) {
    let deltaStart = { characterDelta: 0, lineDelta: 0 };
    let deltaEnd = { characterDelta: 0, lineDelta: 0 };
    for (let { change, growth } of changes) {
      let deltaChange = getRangeDelta(this.range, change, growth);
      deltaStart.characterDelta += deltaChange[0].characterDelta;
      deltaStart.lineDelta += deltaChange[0].lineDelta;
      deltaEnd.characterDelta += deltaChange[1].characterDelta;
      deltaEnd.lineDelta += deltaChange[1].lineDelta;
    }
    let [newStart, newEnd] = [this.range.start, this.range.end];
    newStart = newStart.translate(deltaStart);
    newEnd = newEnd.translate(deltaEnd);
    this.range = this.range.with(newStart, newEnd);
  }
  contains(range) {
    return this.range.contains(range);
  }
};

// src/snippets/engine/utils.ts
var vscode2 = __toESM(require("vscode"));
var os2 = __toESM(require("os"));
function lineRange(character, position) {
  return new vscode2.Range(position.line, character, position.line, position.character);
}
function RegReplace(text, reg, replaceFn) {
  let result = "";
  let last = 0;
  while (true) {
    let match = reg.exec(text);
    if (!match) break;
    result += text.slice(last, match.index) + replaceFn(match);
    last = match.index + match[0].length;
  }
  result += text.slice(last);
  return result;
}
function getSnippetDir() {
  let platform3 = os2.platform();
  function parse_path(path17) {
    if (platform3 == "win32") {
      path17 = RegReplace(path17, /\%(\w+)\%/g, (match) => process.env[match[1]] || "");
    } else {
      path17 = RegReplace(path17, /\$(\w+)/g, (match) => process.env[match[1]] || "");
    }
    if (platform3 == "win32") {
      path17 = path17.replace(/\//g, "\\");
    }
    return path17;
  }
  if (platform3 == "win32") {
    let path17 = vscode2.workspace.getConfiguration("hsnips").get("windows");
    return parse_path(path17 ? parse_path(path17) : parse_path("%APPDATA%/Code/User/hsnips"));
  } else if (platform3 == "darwin") {
    let path17 = vscode2.workspace.getConfiguration("hsnips").get("mac");
    return parse_path(path17 ? parse_path(path17) : parse_path("$HOME/Library/Application Support/Code/User/hsnips"));
  } else {
    let path17 = vscode2.workspace.getConfiguration("hsnips").get("linux");
    return parse_path(path17 ? parse_path(path17) : parse_path("$HOME/.config/Code/User/hsnips"));
  }
}
function applyOffset(position, text, indent) {
  text = text.replace("\\$", "$");
  let lines = text.split("\n");
  let newLine = position.line + lines.length - 1;
  let charOffset = lines[lines.length - 1].length;
  let newChar = position.character + charOffset;
  if (lines.length > 1) newChar = indent + charOffset;
  return position.with(newLine, newChar);
}
function getWorkspaceUri() {
  return vscode2.workspace.workspaceFolders?.[0]?.uri?.toString() ?? "";
}

// src/snippets/engine/hsnippetInstance.ts
var selectedText = "";
var lastTimeOfselectedTextChanged = (/* @__PURE__ */ new Date()).getTime();
vscode3.window.onDidChangeTextEditorSelection((e) => {
  const newSelectedText = e.textEditor.document.getText(e.selections[0]);
  if (newSelectedText) {
    selectedText = newSelectedText;
    selectedText = selectedText.replace(/\\\\/g, "\\\\\\ ").replace(/\}/g, "\\}");
    lastTimeOfselectedTextChanged = (/* @__PURE__ */ new Date()).getTime();
  }
});
var HSnippetPart = class {
  type;
  range;
  content;
  id;
  updates;
  constructor(type, range, content, id) {
    this.type = type;
    this.range = range;
    this.content = content;
    this.id = id;
    this.updates = [];
  }
  updateRange() {
    if (this.updates.length == 0) return;
    this.range.update(this.updates);
    this.updates = [];
  }
};
var HSnippetInstance = class {
  type;
  matchGroups;
  editor;
  range;
  placeholderIds;
  selectedPlaceholder;
  parts;
  blockParts;
  blockChanged;
  snippetString;
  constructor(type, editor, position, matchGroups) {
    this.type = type;
    this.editor = editor;
    this.matchGroups = matchGroups;
    this.selectedPlaceholder = 0;
    this.placeholderIds = [];
    this.blockChanged = false;
    let generatorResult = [[], []];
    try {
      generatorResult = type.generator(
        new Array(this.type.placeholders).fill(""),
        this.matchGroups,
        getWorkspaceUri(),
        editor.document.uri.toString()
      );
    } catch (e) {
      let message = e instanceof Error ? e.message : String(e);
      vscode3.window.showWarningMessage(
        `Snippet ${this.type.description} failed to expand with error: ${message}`
      );
    }
    let [sections, blocks] = generatorResult;
    blocks = blocks.map(String);
    this.parts = [];
    this.blockParts = [];
    let start = position;
    let snippetString = "";
    const indentLevel = editor.document.lineAt(position.line).firstNonWhitespaceCharacterIndex;
    for (let section of sections) {
      if (typeof section == "string") {
        if ((/* @__PURE__ */ new Date()).getTime() - lastTimeOfselectedTextChanged < 5e3) {
          section = section.replace(/\${VISUAL}/g, selectedText);
        } else {
          section = section.replace(/\${VISUAL}/g, "");
        }
      }
      let rawSection = section;
      if (typeof rawSection != "string") {
        let block = blocks[rawSection.block];
        let endPosition = applyOffset(position, block, indentLevel);
        let range = new DynamicRange(position, endPosition);
        let part = new HSnippetPart(1 /* Block */, range, block);
        this.parts.push(part);
        this.blockParts.push(part);
        snippetString += block;
        position = endPosition;
        continue;
      }
      snippetString += rawSection;
      let PLACEHOLDER_REGEX = /\$(\d+)|\$\{(\d+)\}/;
      let match;
      while (match = PLACEHOLDER_REGEX.exec(rawSection)) {
        let text = rawSection.substring(0, match.index);
        position = applyOffset(position, text, indentLevel);
        let range = new DynamicRange(position, position);
        let placeholderId = Number(match[1] || match[2]);
        if (!this.placeholderIds.includes(placeholderId)) this.placeholderIds.push(placeholderId);
        this.parts.push(new HSnippetPart(0 /* Placeholder */, range, "", placeholderId));
        rawSection = rawSection.substring(match.index + match[0].length);
      }
      position = applyOffset(position, rawSection, indentLevel);
    }
    this.snippetString = new vscode3.SnippetString(snippetString);
    this.range = new DynamicRange(start, position);
    this.placeholderIds.sort();
    if (this.placeholderIds[0] == 0) this.placeholderIds.shift();
    this.placeholderIds.push(0);
    this.selectedPlaceholder = this.placeholderIds[0];
  }
  nextPlaceholder() {
    let currentIndex = this.placeholderIds.indexOf(this.selectedPlaceholder);
    this.selectedPlaceholder = this.placeholderIds[currentIndex + 1];
    return this.selectedPlaceholder != void 0 && this.selectedPlaceholder != 0;
  }
  prevPlaceholder() {
    let currentIndex = this.placeholderIds.indexOf(this.selectedPlaceholder);
    this.selectedPlaceholder = this.placeholderIds[currentIndex - 1];
    return this.selectedPlaceholder != void 0 && this.selectedPlaceholder != 0;
  }
  debugLog() {
    let parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      let range = parts[i].range.range;
      let start = range.start;
      let end = range.end;
      console.log(
        `Tabstop ${i}: "${parts[i].content}" (${start.line}, ${start.character})..(${end.line}, ${end.character})`
      );
    }
  }
  // Updates the location of all the placeholder blocks and code blocks, and if any change happened
  // to the placeholder blocks then run the generator function again with the updated values so the
  // code blocks are updated.
  update(changes) {
    let ordChanges = [...changes];
    ordChanges.sort((a, b) => {
      if (a.range.end.isBefore(b.range.end)) return -1;
      else if (a.range.end.isEqual(b.range.end)) return 0;
      else return 1;
    });
    let changedPlaceholders = [];
    let currentPart = 0;
    for (let change of ordChanges) {
      if (!change) continue;
      let part = this.parts[currentPart];
      while (currentPart < this.parts.length) {
        if (part.range.range.end.isAfterOrEqual(change.range.end)) {
          break;
        }
        currentPart++;
        part = this.parts[currentPart];
      }
      if (currentPart >= this.parts.length) break;
      while (part.range.contains(change.range)) {
        if (part.type == 0 /* Placeholder */ && part.id == this.selectedPlaceholder && !this.blockChanged || part.type == 1 /* Block */ && this.blockChanged && part.content == change.text) {
          if (part.type == 0 /* Placeholder */) changedPlaceholders.push(part);
          part.updates.push({ change, growth: 0 /* Grow */ });
          currentPart++;
          part = this.parts[currentPart];
          break;
        }
        currentPart++;
        part = this.parts[currentPart];
      }
      for (let i = currentPart; i < this.parts.length; i++) {
        this.parts[i].updates.push({ change, growth: 2 /* FixRight */ });
      }
    }
    this.range.update(ordChanges.map((c) => ({ change: c, growth: 0 /* Grow */ })));
    this.parts.forEach((p) => p.updateRange());
    if (this.blockChanged) this.blockChanged = false;
    if (!changedPlaceholders.length) return;
    changedPlaceholders.forEach((p) => p.content = this.editor.document.getText(p.range.range));
    let placeholderContents = this.parts.filter((p) => p.type == 0 /* Placeholder */).map((p) => p.content);
    let blocks = this.type.generator(
      placeholderContents,
      this.matchGroups,
      getWorkspaceUri(),
      this.editor.document.uri.toString()
    )[1].map(String);
    this.editor.edit((edit) => {
      for (let i = 0; i < blocks.length; i++) {
        let range = this.blockParts[i].range;
        let oldContent = this.blockParts[i].content;
        let content = blocks[i];
        if (content != oldContent) {
          edit.replace(range.range, content);
          this.blockChanged = true;
        }
      }
    });
    this.blockParts.forEach((b, i) => b.content = blocks[i]);
  }
};

// src/snippets/engine/hsnippet.ts
var HSnippet = class {
  trigger;
  description;
  generator;
  regexp;
  placeholders;
  priority;
  // UltiSnips-like options.
  automatic = false;
  multiline = false;
  inword = false;
  wordboundary = false;
  beginningofline = false;
  math = false;
  text = false;
  constructor(header, generator, placeholders) {
    this.description = header.description;
    this.generator = generator;
    this.placeholders = placeholders;
    this.priority = header.priority || 0;
    if (header.trigger instanceof RegExp) {
      this.regexp = header.trigger;
      this.trigger = "";
    } else {
      this.trigger = header.trigger;
    }
    if (header.flags.includes("A")) this.automatic = true;
    if (header.flags.includes("M")) this.multiline = true;
    if (header.flags.includes("i")) this.inword = true;
    if (header.flags.includes("w")) this.wordboundary = true;
    if (header.flags.includes("b")) this.beginningofline = true;
    if (header.flags.includes("m")) this.math = true;
    if (header.flags.includes("t")) this.text = true;
  }
};

// src/snippets/engine/parser.ts
var CODE_DELIMITER = "``";
var HEADER_REGEXP = /^snippet ?(?:`([^`]+)`|(\S+))?(?: "([^"]+)")?(?: ([AMiwbmt]*))?/;
function parseSnippetHeader(header) {
  let match = HEADER_REGEXP.exec(header);
  if (!match) throw new Error("Invalid snippet header");
  let trigger = match[2];
  if (match[1]) {
    if (!match[1].endsWith("$")) match[1] += "$";
    trigger = new RegExp(match[1], "m");
  }
  return {
    trigger,
    description: match[3] || "",
    flags: match[4] || ""
  };
}
function escapeString(string) {
  return string.replace(/"/g, '\\"').replace(/\\/g, "\\\\");
}
function countPlaceholders(string) {
  return string.split(/\$\d+|\$\{\d+\}/g).length - 1;
}
function parseSnippet(headerLine, lines) {
  let header = parseSnippetHeader(headerLine);
  let script = [`(require, t, m, w, path) => {`];
  script.push(`let rv = "";`);
  script.push(`let result = [];`);
  script.push(`let blockResults = [];`);
  let isCode = false;
  let placeholders = 0;
  while (lines.length > 0) {
    let line = lines.shift();
    if (isCode) {
      if (!line.includes(CODE_DELIMITER)) {
        script.push(line.trim());
      } else {
        let [code, ...rest] = line.split(CODE_DELIMITER);
        script.push(code.trim());
        lines.unshift(rest.join(CODE_DELIMITER));
        script.push(`result.push({block: blockResults.length});`);
        script.push(`blockResults.push(rv);`);
        isCode = false;
      }
    } else {
      if (line.startsWith("endsnippet")) {
        break;
      } else if (!line.includes(CODE_DELIMITER)) {
        script.push(`result.push("${escapeString(line)}");`);
        script.push(`result.push("\\n");`);
        placeholders += countPlaceholders(line);
      } else if (isCode == false) {
        let [text, ...rest] = line.split(CODE_DELIMITER);
        script.push(`result.push("${escapeString(text)}");`);
        script.push(`rv = "";`);
        placeholders += countPlaceholders(text);
        lines.unshift(rest.join(CODE_DELIMITER));
        isCode = true;
      }
    }
  }
  script.pop();
  script.push(`return [result, blockResults];`);
  script.push(`}`);
  return { body: script.join("\n"), header, placeholders };
}
function parse(content) {
  let lines = content.split(/\r?\n/);
  let snippetInfos = [];
  let script = [];
  let isCode = false;
  let priority = 0;
  while (lines.length > 0) {
    let line = lines.shift();
    if (isCode) {
      if (line.startsWith("endglobal")) {
        isCode = false;
      } else {
        script.push(line);
      }
    } else if (line.startsWith("global")) {
      isCode = true;
    } else if (line.startsWith("priority ")) {
      priority = Number(line.substring("priority ".length).trim()) || 0;
    } else if (line.match(HEADER_REGEXP)) {
      let info = parseSnippet(line, lines);
      info.header.priority = priority;
      snippetInfos.push(info);
      priority = 0;
    }
  }
  script.push(`return [`);
  for (let snippet of snippetInfos) {
    script.push(snippet.body);
    script.push(",");
  }
  script.push(`]`);
  let generators = new Function(script.join("\n"))().map((generator) => {
    return generator.bind(null, require);
  });
  return snippetInfos.map((s, i) => new HSnippet(s.header, generators[i], s.placeholders));
}

// src/snippets/engine/completion.ts
var vscode4 = __toESM(require("vscode"));
var CompletionInfo = class {
  range;
  completionRange;
  snippet;
  label;
  groups;
  constructor(snippet, label, range, groups) {
    this.snippet = snippet;
    this.label = label;
    this.range = range;
    this.completionRange = new vscode4.Range(range.start, range.start.translate(0, label.length));
    this.groups = groups;
  }
  toCompletionItem() {
    let completionItem = new vscode4.CompletionItem(this.label);
    completionItem.range = this.range;
    completionItem.detail = this.snippet.description;
    completionItem.insertText = this.label;
    completionItem.command = {
      command: "hsnips.expand",
      title: "expand",
      arguments: [this]
    };
    return completionItem;
  }
};
function matchSuffixPrefix(context, trigger) {
  while (trigger.length) {
    if (context.endsWith(trigger)) return trigger;
    trigger = trigger.substring(0, trigger.length - 1);
  }
  return null;
}
function createCompletionMatchContext(document, position) {
  let line = document.getText(lineRange(0, position));
  let match = line.match(/\S*$/);
  let contextRange = lineRange(match.index || 0, position);
  let context = document.getText(contextRange);
  let precedingContextRange = new vscode4.Range(
    position.line,
    0,
    position.line,
    match.index || 0
  );
  let precedingContext = document.getText(precedingContextRange);
  let isPrecedingContextWhitespace = precedingContext.match(/^\s*$/) != null;
  let wordRange = document.getWordRangeAtPosition(position) || contextRange;
  if (wordRange.end != position) {
    wordRange = new vscode4.Range(wordRange.start, position);
  }
  let wordContext = document.getText(wordRange);
  return {
    line,
    contextRange,
    context,
    isPrecedingContextWhitespace,
    wordContext
  };
}
function getLongContext(document, position, context) {
  if (context.longContext === void 0) {
    let numberPrevLines = vscode4.workspace.getConfiguration("hsnips").get("multiLineContext");
    context.longContext = document.getText(
      new vscode4.Range(
        new vscode4.Position(Math.max(position.line - numberPrevLines, 0), 0),
        position
      )
    ).replace(/\r/g, "");
  }
  return context.longContext;
}
function matchSnippet(document, position, snippet, context) {
  let snippetMatches = false;
  let snippetRange = context.contextRange;
  let prefixMatches = false;
  let matchGroups = [];
  let label = snippet.trigger;
  if (snippet.trigger) {
    let matchingPrefix = null;
    if (snippet.inword) {
      snippetMatches = context.context.endsWith(snippet.trigger);
      matchingPrefix = snippetMatches ? snippet.trigger : matchSuffixPrefix(context.context, snippet.trigger);
    } else if (snippet.wordboundary) {
      snippetMatches = context.wordContext == snippet.trigger;
      matchingPrefix = snippet.trigger.startsWith(context.wordContext) ? context.wordContext : null;
    } else if (snippet.beginningofline) {
      snippetMatches = context.context.endsWith(snippet.trigger) && context.isPrecedingContextWhitespace;
      matchingPrefix = snippet.trigger.startsWith(context.context) && context.isPrecedingContextWhitespace ? context.context : null;
    } else {
      snippetMatches = context.context == snippet.trigger;
      matchingPrefix = snippet.trigger.startsWith(context.context) ? context.context : null;
    }
    if (matchingPrefix) {
      snippetRange = new vscode4.Range(position.translate(0, -matchingPrefix.length), position);
      prefixMatches = true;
    }
  } else if (snippet.regexp) {
    let regexContext = context.line;
    if (snippet.multiline) {
      regexContext = getLongContext(document, position, context);
    }
    let match = snippet.regexp.exec(regexContext);
    if (match) {
      let charOffset = match.index - regexContext.lastIndexOf("\n", match.index) - 1;
      let lineOffset = match[0].split("\n").length - 1;
      snippetRange = new vscode4.Range(
        new vscode4.Position(position.line - lineOffset, charOffset),
        position
      );
      snippetMatches = true;
      matchGroups = match;
      label = match[0];
    }
  }
  return {
    snippetMatches,
    prefixMatches,
    range: snippetRange,
    label,
    groups: matchGroups
  };
}
function getAutomaticCompletion(document, position, snippets) {
  let context = createCompletionMatchContext(document, position);
  for (let snippet of snippets) {
    if (!snippet.automatic) continue;
    let match = matchSnippet(document, position, snippet, context);
    if (match.snippetMatches) {
      return new CompletionInfo(snippet, match.label, match.range, match.groups);
    }
  }
}
function getCompletions(document, position, snippets) {
  let context = createCompletionMatchContext(document, position);
  let completions = [];
  for (let snippet of snippets) {
    let match = matchSnippet(document, position, snippet, context);
    if (snippet.automatic && match.snippetMatches) {
      return new CompletionInfo(snippet, match.label, match.range, match.groups);
    }
    if (match.prefixMatches) {
      completions.push(new CompletionInfo(snippet, match.label, match.range, match.groups));
    }
  }
  return completions;
}

// src/snippets/engine/latexContext.ts
var ROW_BREAK_ENVIRONMENTS = [
  "align",
  "align*",
  "aligned",
  "alignedat",
  "alignedat*",
  "gather",
  "gather*",
  "gathered",
  "split",
  "multline",
  "multline*",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "cases",
  "array",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable"
];
var ALIGNMENT_SEPARATOR_ENVIRONMENTS = [
  "align",
  "align*",
  "aligned",
  "alignedat",
  "alignedat*",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "cases",
  "array",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable"
];
var MATH_ENVIRONMENTS = [
  "math",
  "displaymath",
  "equation",
  "equation*",
  ...ROW_BREAK_ENVIRONMENTS
];
var TEXT_LIKE_COMMANDS = [
  "text",
  "textrm",
  "textnormal",
  "mbox",
  "operatorname",
  "mathrm",
  "label",
  "tag"
];
var VERBATIM_LIKE_ENVIRONMENTS = [
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "comment"
];
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function resolveLatexContextOptions(options = {}) {
  let rowBreakEnvironments = unique([
    ...ROW_BREAK_ENVIRONMENTS,
    ...options.extraRowBreakEnvironments || []
  ]);
  let alignmentEnvironments = unique([
    ...ALIGNMENT_SEPARATOR_ENVIRONMENTS,
    ...options.extraAlignmentEnvironments || []
  ]);
  return {
    rowBreakEnvironments,
    alignmentEnvironments,
    mathEnvironments: unique([
      ...MATH_ENVIRONMENTS,
      ...rowBreakEnvironments,
      ...alignmentEnvironments,
      ...options.extraMathEnvironments || []
    ]),
    textLikeCommands: unique([
      ...TEXT_LIKE_COMMANDS,
      ...options.extraTextLikeCommands || []
    ]),
    verbatimLikeEnvironments: VERBATIM_LIKE_ENVIRONMENTS
  };
}
function isEscaped(text, index) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] == "\\"; i--) {
    slashCount++;
  }
  return slashCount % 2 == 1;
}
function findLatexCommentStart(line) {
  for (let index = 0; index < line.length; index++) {
    if (line[index] == "%" && !isEscaped(line, index)) {
      return index;
    }
  }
  return -1;
}
function maskRange(chars, start, end) {
  for (let index = Math.max(start, 0); index < Math.min(end, chars.length); index++) {
    if (chars[index] != "\n" && chars[index] != "\r") {
      chars[index] = " ";
    }
  }
}
function getMarkdownFenceRanges(text) {
  let ranges = [];
  let open;
  let lineStart = 0;
  while (lineStart <= text.length) {
    let newline = text.indexOf("\n", lineStart);
    let lineEnd = newline == -1 ? text.length : newline;
    let nextLineStart = newline == -1 ? text.length + 1 : newline + 1;
    let line = text.substring(lineStart, lineEnd);
    let match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      let marker = match[1][0];
      let length = match[1].length;
      if (!open) {
        open = { start: lineStart, marker, length };
      } else if (marker == open.marker && length >= open.length) {
        ranges.push({ start: open.start, end: nextLineStart - 1 });
        open = void 0;
      }
    }
    lineStart = nextLineStart;
  }
  if (open) {
    ranges.push({ start: open.start, end: text.length });
  }
  return ranges;
}
function maskRegexRanges(chars, text, regexp) {
  let match;
  while ((match = regexp.exec(text)) !== null) {
    maskRange(chars, match.index, match.index + match[0].length);
  }
}
function sanitizeLatexForParsing(text, markdownFenceRanges = getMarkdownFenceRanges(text)) {
  let chars = text.split("");
  for (let range of markdownFenceRanges) {
    maskRange(chars, range.start, range.end);
  }
  maskRegexRanges(chars, text, /<!--[\s\S]*?-->/g);
  maskRegexRanges(chars, text, /`[^`\n]*`/g);
  let lineStart = 0;
  while (lineStart <= chars.length) {
    let newline = chars.indexOf("\n", lineStart);
    let lineEnd = newline == -1 ? chars.length : newline;
    let line = chars.slice(lineStart, lineEnd).join("");
    let commentStart = findLatexCommentStart(line);
    if (commentStart != -1) {
      maskRange(chars, lineStart + commentStart, lineEnd);
    }
    if (newline == -1) break;
    lineStart = newline + 1;
  }
  return chars.join("");
}
function createLatexParsingPrefix(text, offset) {
  let original = text.substring(0, offset);
  let markdownFenceRanges = getMarkdownFenceRanges(original);
  return {
    original,
    markdownFenceRanges,
    sanitized: sanitizeLatexForParsing(original, markdownFenceRanges)
  };
}
function getOpenLatexEnvironmentFramesFromSanitized(beforeCursor, resolved) {
  let verbatimEnvironments = new Set(resolved.verbatimLikeEnvironments);
  const stack = [];
  const environmentReg = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match;
  while ((match = environmentReg.exec(beforeCursor)) !== null) {
    let kind = match[1];
    let rawEnvironment = match[2];
    let environment = rawEnvironment.trim();
    let rawNameStart = match.index + match[0].indexOf("{") + 1;
    let leadingWhitespace = rawEnvironment.search(/\S/);
    let nameStart = rawNameStart + (leadingWhitespace == -1 ? 0 : leadingWhitespace);
    let nameEnd = nameStart + environment.length;
    let currentVerbatimIndex = -1;
    for (let index = stack.length - 1; index >= 0; index--) {
      if (verbatimEnvironments.has(stack[index].name)) {
        currentVerbatimIndex = index;
        break;
      }
    }
    if (currentVerbatimIndex != -1) {
      if (kind == "end" && environment == stack[currentVerbatimIndex].name) {
        stack.splice(currentVerbatimIndex, 1);
      }
      continue;
    }
    if (kind == "begin") {
      stack.push({
        name: environment,
        beginStart: match.index,
        beginEnd: environmentReg.lastIndex,
        nameStart,
        nameEnd
      });
      continue;
    }
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index].name == environment) {
        stack.splice(index, 1);
        break;
      }
    }
  }
  return stack;
}
function isInAnyEnvironment(stack, environments) {
  return stack.some((environment) => environments.has(environment));
}
function isInsideLatexLineComment(text, offset) {
  let lineStart = text.lastIndexOf("\n", Math.max(offset - 1, 0)) + 1;
  let lineBeforeCursor = text.substring(lineStart, offset);
  return findLatexCommentStart(lineBeforeCursor) != -1;
}
function isInsideMarkdownCodeInPrefix(beforeCursor, markdownFenceRanges) {
  if (markdownFenceRanges.some((range) => range.end == beforeCursor.length)) {
    return true;
  }
  let lineStart = beforeCursor.lastIndexOf("\n") + 1;
  let lineBeforeCursor = beforeCursor.substring(lineStart);
  let inlineBackticks = lineBeforeCursor.match(/`/g);
  return inlineBackticks ? inlineBackticks.length % 2 == 1 : false;
}
function findMatchingBrace(text, openBrace, limit) {
  let depth = 0;
  for (let index = openBrace; index < limit; index++) {
    if (isEscaped(text, index)) {
      continue;
    }
    if (text[index] == "{") {
      depth++;
      continue;
    }
    if (text[index] == "}") {
      depth--;
      if (depth == 0) {
        return index;
      }
    }
  }
  return -1;
}
function escapeRegExp2(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isInsideTextLikeCommandInSanitized(sanitized, resolved) {
  if (resolved.textLikeCommands.length == 0) {
    return false;
  }
  const commandReg = new RegExp(
    "\\\\(" + resolved.textLikeCommands.map(escapeRegExp2).join("|") + ")\\s*\\{",
    "g"
  );
  let match;
  while ((match = commandReg.exec(sanitized)) !== null) {
    let openBrace = commandReg.lastIndex - 1;
    let closeBrace = findMatchingBrace(sanitized, openBrace, sanitized.length);
    if (closeBrace == -1 || closeBrace >= sanitized.length) {
      return true;
    }
  }
  return false;
}
function getMathDelimiterStackFromSanitized(beforeCursor) {
  let stack = [];
  for (let index = 0; index < beforeCursor.length; index++) {
    let char = beforeCursor[index];
    if (char == "\\") {
      let next = beforeCursor[index + 1];
      if (next == "(" || next == "[") {
        stack.push({ kind: next == "(" ? "paren" : "bracket", start: index });
        index++;
        continue;
      }
      if (next == ")" && stack[stack.length - 1]?.kind == "paren") {
        stack.pop();
        index++;
        continue;
      }
      if (next == "]" && stack[stack.length - 1]?.kind == "bracket") {
        stack.pop();
        index++;
        continue;
      }
      index++;
      continue;
    }
    if (char == "$" && !isEscaped(beforeCursor, index)) {
      let delimiter2 = beforeCursor[index + 1] == "$" ? "$$" : "$";
      let kind = delimiter2 == "$$" ? "displayDollar" : "inlineDollar";
      if (stack[stack.length - 1]?.kind == kind) {
        stack.pop();
      } else {
        stack.push({ kind, start: index });
      }
      if (delimiter2 == "$$") {
        index++;
      }
    }
  }
  return stack;
}
function getLatexContext(text, offset, options = {}) {
  let resolved = resolveLatexContextOptions(options);
  let parsedPrefix = createLatexParsingPrefix(text, offset);
  let environmentFrames = getOpenLatexEnvironmentFramesFromSanitized(
    parsedPrefix.sanitized,
    resolved
  );
  let environmentStack = environmentFrames.map((frame) => frame.name);
  let currentEnvironmentFrame = environmentFrames[environmentFrames.length - 1];
  let currentEnvironment = currentEnvironmentFrame?.name;
  let inComment = isInsideLatexLineComment(text, offset);
  let inMarkdownCode = isInsideMarkdownCodeInPrefix(
    parsedPrefix.original,
    parsedPrefix.markdownFenceRanges
  );
  let inTextLikeCommand = isInsideTextLikeCommandInSanitized(parsedPrefix.sanitized, resolved);
  let verbatimEnvironments = new Set(resolved.verbatimLikeEnvironments);
  let rowBreakEnvironments = new Set(resolved.rowBreakEnvironments);
  let alignmentEnvironments = new Set(resolved.alignmentEnvironments);
  let mathEnvironments = new Set(resolved.mathEnvironments);
  let inVerbatimLikeEnvironment = isInAnyEnvironment(environmentStack, verbatimEnvironments);
  let delimiterStack = getMathDelimiterStackFromSanitized(parsedPrefix.sanitized);
  let delimiterMathKind = delimiterStack[delimiterStack.length - 1]?.kind;
  let inRowBreakEnvironment = isInAnyEnvironment(environmentStack, rowBreakEnvironments);
  let inAlignmentEnvironment = isInAnyEnvironment(environmentStack, alignmentEnvironments);
  let inMathEnvironment = isInAnyEnvironment(environmentStack, mathEnvironments);
  let blocked = inComment || inMarkdownCode || inTextLikeCommand || inVerbatimLikeEnvironment;
  let inMath = (Boolean(delimiterMathKind) || inMathEnvironment) && !blocked;
  let mathKind = "none";
  if (inMath) {
    mathKind = delimiterMathKind || "environment";
  }
  return {
    environmentStack,
    environmentFrames,
    currentEnvironment,
    currentEnvironmentFrame,
    inComment,
    inMarkdownCode,
    inTextLikeCommand,
    inVerbatimLikeEnvironment,
    inMath,
    mathKind,
    canSmartEnter: inRowBreakEnvironment && !blocked,
    canSmartTab: inAlignmentEnvironment && !blocked,
    canInsertAlignmentSeparator: inAlignmentEnvironment && !blocked,
    canExpandMathSnippet: inMath && !blocked
  };
}

// src/snippets/engine/latexEdit.ts
function getLineBounds(text, offset) {
  let start = text.lastIndexOf("\n", Math.max(offset - 1, 0)) + 1;
  let nextNewline = text.indexOf("\n", offset);
  let end = nextNewline == -1 ? text.length : nextNewline;
  return { start, end };
}
function getLineIndent(line) {
  let match = line.match(/^\s*/);
  return match ? match[0] : "";
}
function applyTextEditsToString(text, edits) {
  return edits.slice().sort((a, b) => b.start - a.start).reduce((result, edit) => {
    return result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }, text);
}
function getTextReplacement(fromText, toText) {
  if (fromText == toText) {
    return void 0;
  }
  let start = 0;
  while (start < fromText.length && start < toText.length && fromText[start] == toText[start]) {
    start++;
  }
  let fromEnd = fromText.length;
  let toEnd = toText.length;
  while (fromEnd > start && toEnd > start && fromText[fromEnd - 1] == toText[toEnd - 1]) {
    fromEnd--;
    toEnd--;
  }
  return {
    start,
    end: fromEnd,
    text: toText.slice(start, toEnd)
  };
}
function shouldAppendMathLineBreak(line) {
  let commentStart = findLatexCommentStart(line);
  let formulaPart = commentStart == -1 ? line : line.substring(0, commentStart);
  let trimmed = formulaPart.trim();
  if (!trimmed) return false;
  if (/^\\(?:begin|end)\s*\{[^}]+\}$/.test(trimmed)) return false;
  if (/\\\\(?:\[[^\]]+\])?$/.test(trimmed)) return false;
  return true;
}
function getSmartEnterPlan(text, offset, options = {}) {
  let context = getLatexContext(text, offset, options);
  if (!context.canSmartEnter) {
    return { handled: false, edits: [] };
  }
  let lineBounds = getLineBounds(text, offset);
  let line = text.substring(lineBounds.start, lineBounds.end);
  let column = offset - lineBounds.start;
  let commentStart = findLatexCommentStart(line);
  let formulaLimit = commentStart == -1 ? line.length : commentStart;
  if (column > formulaLimit) {
    return { handled: false, edits: [] };
  }
  if (line.substring(column, formulaLimit).trim().length > 0) {
    return { handled: false, edits: [] };
  }
  if (!shouldAppendMathLineBreak(line)) {
    return { handled: false, edits: [] };
  }
  let indent = getLineIndent(line);
  let formulaEnd = line.substring(0, formulaLimit).replace(/\s+$/, "").length;
  if (commentStart == -1) {
    let replaceStart2 = lineBounds.start + formulaEnd;
    let insertText2 = " \\\\\n" + indent;
    return {
      handled: true,
      edits: [{ start: replaceStart2, end: lineBounds.end, text: insertText2 }],
      cursorOffset: replaceStart2 + insertText2.length
    };
  }
  let replaceStart = lineBounds.start + formulaEnd;
  let replaceEnd = lineBounds.start + commentStart;
  let insertText = " \\\\ ";
  let lineBreakText = "\n" + indent;
  return {
    handled: true,
    edits: [
      { start: replaceStart, end: replaceEnd, text: insertText },
      { start: lineBounds.end, end: lineBounds.end, text: lineBreakText }
    ],
    cursorOffset: lineBounds.end + insertText.length - (replaceEnd - replaceStart) + lineBreakText.length
  };
}
function getSmartEnterRecoveryPlan(beforeEnterText, offsetBeforeEnter, currentText, options = {}) {
  let desiredPlan = getSmartEnterPlan(beforeEnterText, offsetBeforeEnter, options);
  if (!desiredPlan.handled || typeof desiredPlan.cursorOffset != "number") {
    return { handled: false, edits: [] };
  }
  let desiredText = applyTextEditsToString(beforeEnterText, desiredPlan.edits);
  let replacement = getTextReplacement(currentText, desiredText);
  if (!replacement) {
    return { handled: false, edits: [] };
  }
  return {
    handled: true,
    edits: [replacement],
    cursorOffset: desiredPlan.cursorOffset
  };
}
function shouldInsertAlignmentSeparator(text, offset, options = {}) {
  let context = getLatexContext(text, offset, options);
  if (!context.canSmartTab) {
    return false;
  }
  let lineBounds = getLineBounds(text, offset);
  let line = text.substring(lineBounds.start, lineBounds.end);
  let column = offset - lineBounds.start;
  let commentStart = findLatexCommentStart(line);
  let formulaLimit = commentStart == -1 ? line.length : commentStart;
  let formulaPart = line.substring(0, formulaLimit).trim();
  if (column > formulaLimit) return false;
  if (!formulaPart && line.trim().startsWith("%")) return false;
  if (/^\\(?:begin|end)\s*\{[^}]+\}$/.test(formulaPart)) return false;
  if (/\\\\(?:\[[^\]]+\])?$/.test(formulaPart)) return false;
  return true;
}

// src/snippets/engine/environmentConvert.ts
var CONVERTIBLE_ENVIRONMENTS = [
  "align",
  "align*",
  "aligned",
  "equation",
  "equation*",
  "split",
  "gather",
  "gather*",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "cases",
  "array",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable"
];
var WRAPPABLE_MATH_ENVIRONMENTS = [
  "aligned",
  "cases",
  "split",
  "matrix",
  "pmatrix",
  "bmatrix",
  "equation",
  "equation*",
  "align",
  "align*"
];
var TABLE_LIKE_ENVIRONMENTS = [
  "array",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable"
];
var TWO_ARGUMENT_TABLE_ENVIRONMENTS = ["tabular*", "tabularx"];
function findMatchingBrace2(text, openBrace) {
  let depth = 0;
  for (let index = openBrace; index < text.length; index++) {
    if (isEscaped(text, index)) {
      continue;
    }
    if (text[index] == "{") {
      depth++;
      continue;
    }
    if (text[index] == "}") {
      depth--;
      if (depth == 0) {
        return index;
      }
    }
  }
  return -1;
}
function parseBracedArguments(text, start) {
  let args = [];
  let index = start;
  while (index < text.length) {
    while (/\s/.test(text[index] || "")) index++;
    if (text[index] != "{") break;
    let end = findMatchingBrace2(text, index);
    if (end == -1) break;
    args.push({
      start: index,
      end: end + 1,
      text: text.slice(index, end + 1)
    });
    index = end + 1;
  }
  return args;
}
function getEnvironmentNameRange(match) {
  let rawName = match[2];
  let name = rawName.trim();
  let rawNameStart = match.index + match[0].indexOf("{") + 1;
  let leadingWhitespace = rawName.search(/\S/);
  let nameStart = rawNameStart + (leadingWhitespace == -1 ? 0 : leadingWhitespace);
  return {
    name,
    nameStart,
    nameEnd: nameStart + name.length
  };
}
function findLatexEnvironmentPairAt(text, offset, _options = {}) {
  let sanitized = sanitizeLatexForParsing(text);
  let verbatimEnvironments = new Set(VERBATIM_LIKE_ENVIRONMENTS);
  let stack = [];
  let pairs = [];
  const environmentReg = /\\(begin|end)\s*\{([^}]+)\}/g;
  let match;
  while ((match = environmentReg.exec(sanitized)) !== null) {
    let kind = match[1];
    let { name, nameStart, nameEnd } = getEnvironmentNameRange(match);
    let currentVerbatim;
    for (let index = stack.length - 1; index >= 0; index--) {
      if (verbatimEnvironments.has(stack[index].name)) {
        currentVerbatim = stack[index];
        break;
      }
    }
    if (currentVerbatim) {
      if (kind == "end" && name == currentVerbatim.name) {
        let matchingBegin2 = stack.lastIndexOf(currentVerbatim);
        if (matchingBegin2 != -1) {
          stack.splice(matchingBegin2, 1);
        }
      }
      continue;
    }
    if (kind == "begin") {
      stack.push({
        name,
        beginStart: match.index,
        beginEnd: environmentReg.lastIndex,
        beginNameStart: nameStart,
        beginNameEnd: nameEnd
      });
      continue;
    }
    let matchingBegin = stack.map((token) => token.name).lastIndexOf(name);
    if (matchingBegin == -1) {
      continue;
    }
    let begin = stack[matchingBegin];
    stack.splice(matchingBegin, 1);
    pairs.push({
      name,
      beginStart: begin.beginStart,
      beginEnd: begin.beginEnd,
      beginNameStart: begin.beginNameStart,
      beginNameEnd: begin.beginNameEnd,
      endStart: match.index,
      endEnd: environmentReg.lastIndex,
      endNameStart: nameStart,
      endNameEnd: nameEnd,
      beginArguments: parseBracedArguments(text, begin.beginEnd)
    });
  }
  return pairs.filter((pair) => pair.beginStart <= offset && offset <= pair.endEnd).sort((a, b) => a.endEnd - a.beginStart - (b.endEnd - b.beginStart))[0];
}
function findDisplayMathDelimiterAt(text, offset) {
  let sanitized = sanitizeLatexForParsing(text);
  let stack = [];
  let pairs = [];
  for (let index = 0; index < sanitized.length; index++) {
    let char = sanitized[index];
    if (char == "\\") {
      let next = sanitized[index + 1];
      if (next == "(" || next == "[") {
        stack.push({
          kind: next == "(" ? "paren" : "bracket",
          openStart: index,
          openEnd: index + 2
        });
        index++;
        continue;
      }
      if (next == ")" || next == "]") {
        let kind = next == ")" ? "paren" : "bracket";
        if (stack[stack.length - 1]?.kind == kind) {
          let open = stack.pop();
          if (kind == "bracket") {
            pairs.push({
              kind: "bracket",
              openStart: open.openStart,
              openEnd: open.openEnd,
              closeStart: index,
              closeEnd: index + 2
            });
          }
        }
        index++;
        continue;
      }
      index++;
      continue;
    }
    if (char == "$" && !isEscaped(sanitized, index)) {
      let isDisplay = sanitized[index + 1] == "$";
      let kind = isDisplay ? "displayDollar" : "inlineDollar";
      let width = isDisplay ? 2 : 1;
      if (stack[stack.length - 1]?.kind == kind) {
        let open = stack.pop();
        if (kind == "displayDollar") {
          pairs.push({
            kind: "displayDollar",
            openStart: open.openStart,
            openEnd: open.openEnd,
            closeStart: index,
            closeEnd: index + width
          });
        }
      } else {
        stack.push({ kind, openStart: index, openEnd: index + width });
      }
      index += width - 1;
    }
  }
  return pairs.filter((pair) => pair.openStart <= offset && offset <= pair.closeEnd).sort((a, b) => a.closeEnd - a.openStart - (b.closeEnd - b.openStart))[0];
}
function isTableLikeEnvironment(name) {
  return TABLE_LIKE_ENVIRONMENTS.indexOf(name) != -1;
}
function needsTwoTableArguments(name) {
  return TWO_ARGUMENT_TABLE_ENVIRONMENTS.indexOf(name) != -1;
}
function formatTableArguments(targetName, columnSpecOrArguments = "c") {
  let value = columnSpecOrArguments.trim() || "c";
  if (value.startsWith("{")) {
    return value;
  }
  if (needsTwoTableArguments(targetName)) {
    return `{\\linewidth}{${value}}`;
  }
  return `{${value}}`;
}
function normalizeArgumentsForTarget(currentArguments, targetName, fallbackArguments) {
  if (!isTableLikeEnvironment(targetName)) {
    return "";
  }
  if (currentArguments.length > 0) {
    if (needsTwoTableArguments(targetName)) {
      if (currentArguments.length >= 2) {
        return currentArguments[0].text + currentArguments[1].text;
      }
      return `{\\linewidth}` + currentArguments[0].text;
    }
    return currentArguments[currentArguments.length - 1].text;
  }
  return fallbackArguments || formatTableArguments(targetName);
}
function conversionNeedsTableArguments(text, offset, targetName) {
  if (!isTableLikeEnvironment(targetName)) {
    return false;
  }
  let pair = findLatexEnvironmentPairAt(text, offset);
  return !pair || pair.beginArguments.length == 0;
}
function getBeginArgumentsRange(pair) {
  if (pair.beginArguments.length == 0) {
    return { start: pair.beginEnd, end: pair.beginEnd };
  }
  return {
    start: pair.beginArguments[0].start,
    end: pair.beginArguments[pair.beginArguments.length - 1].end
  };
}
function getEnvironmentBodyRange(pair) {
  let bodyStart = pair.beginArguments.length > 0 ? pair.beginArguments[pair.beginArguments.length - 1].end : pair.beginEnd;
  return {
    start: bodyStart,
    end: pair.endStart
  };
}
function createEnvironmentNameOnlyRenamePlan(pair, targetName) {
  let name = targetName.trim();
  if (!isValidEnvironmentName(name) || pair.name == name) {
    return { handled: false, edits: [] };
  }
  return {
    handled: true,
    edits: [
      { start: pair.beginNameStart, end: pair.beginNameEnd, text: name },
      { start: pair.endNameStart, end: pair.endNameEnd, text: name }
    ],
    cursorOffset: pair.beginStart
  };
}
function createEnvironmentRenamePlan(text, pair, targetName, targetArguments) {
  let argsRange = getBeginArgumentsRange(pair);
  let nextArguments = normalizeArgumentsForTarget(pair.beginArguments, targetName, targetArguments);
  let currentArgumentsText = text.slice(argsRange.start, argsRange.end);
  let edits = [
    { start: pair.beginNameStart, end: pair.beginNameEnd, text: targetName },
    { start: pair.endNameStart, end: pair.endNameEnd, text: targetName }
  ];
  if (currentArgumentsText != nextArguments) {
    edits.push({ start: argsRange.start, end: argsRange.end, text: nextArguments });
  }
  if (pair.name == targetName && currentArgumentsText == nextArguments) {
    return { handled: false, edits: [] };
  }
  return {
    handled: true,
    edits,
    cursorOffset: pair.beginStart
  };
}
function trimOneOuterNewline(text) {
  if (text.startsWith("\n")) {
    text = text.slice(1);
  }
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  return text;
}
function createDelimiterConversionPlan(text, pair, targetName, targetArguments = "") {
  let body = trimOneOuterNewline(text.slice(pair.openEnd, pair.closeStart));
  let begin = `\\begin{${targetName}}${targetArguments}`;
  let replacement = `${begin}
${body}
\\end{${targetName}}`;
  return {
    handled: true,
    edits: [{ start: pair.openStart, end: pair.closeEnd, text: replacement }],
    cursorOffset: pair.openStart + begin.length + 1
  };
}
function createWrapEnvironmentPlan(text, start, end, targetName, targetArguments = "") {
  let body = text.slice(start, end);
  let begin = `\\begin{${targetName}}${targetArguments}`;
  let replacement = `${begin}
${body}
\\end{${targetName}}`;
  return {
    handled: true,
    edits: [{ start, end, text: replacement }],
    cursorOffset: start + begin.length + 1
  };
}
function createWrapBodyPlan(text, start, end, targetName, targetArguments = "") {
  let body = trimOneOuterNewline(text.slice(start, end));
  let prefix = text[start] == "\n" ? "\n" : "";
  let suffix = text[end - 1] == "\n" ? "\n" : "";
  let begin = `\\begin{${targetName}}${targetArguments}`;
  let replacement = `${prefix}${begin}
${body}
\\end{${targetName}}${suffix}`;
  return {
    handled: true,
    edits: [{ start, end, text: replacement }],
    cursorOffset: start + prefix.length + begin.length + 1
  };
}
function createWrapCurrentMathStructurePlan(text, offset, targetName, targetArguments = "", options = {}) {
  let environmentPair = findLatexEnvironmentPairAt(text, offset, options);
  if (environmentPair) {
    let bodyRange = getEnvironmentBodyRange(environmentPair);
    return createWrapBodyPlan(text, bodyRange.start, bodyRange.end, targetName, targetArguments);
  }
  let delimiterPair = findDisplayMathDelimiterAt(text, offset);
  if (delimiterPair) {
    return createWrapBodyPlan(text, delimiterPair.openEnd, delimiterPair.closeStart, targetName, targetArguments);
  }
  return { handled: false, edits: [] };
}
function trimOneOuterNewlinePair(text) {
  if (text.startsWith("\n")) {
    text = text.slice(1);
  }
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  return text;
}
function createUnwrapEnvironmentPlan(text, pair) {
  let bodyRange = getEnvironmentBodyRange(pair);
  let body = trimOneOuterNewlinePair(text.slice(bodyRange.start, bodyRange.end));
  return {
    handled: true,
    edits: [{ start: pair.beginStart, end: pair.endEnd, text: body }],
    cursorOffset: pair.beginStart
  };
}
function createUnwrapDelimiterPlan(text, pair) {
  let body = trimOneOuterNewlinePair(text.slice(pair.openEnd, pair.closeStart));
  return {
    handled: true,
    edits: [{ start: pair.openStart, end: pair.closeEnd, text: body }],
    cursorOffset: pair.openStart
  };
}
function createUnwrapMathStructurePlan(text, offset, options = {}) {
  let environmentPair = findLatexEnvironmentPairAt(text, offset, options);
  if (environmentPair && WRAPPABLE_MATH_ENVIRONMENTS.indexOf(environmentPair.name) != -1) {
    return createUnwrapEnvironmentPlan(text, environmentPair);
  }
  let delimiterPair = findDisplayMathDelimiterAt(text, offset);
  if (delimiterPair) {
    return createUnwrapDelimiterPlan(text, delimiterPair);
  }
  return { handled: false, edits: [] };
}
function createEnvironmentConversionPlan(text, offset, targetName, targetArguments = "", options = {}) {
  let environmentPair = findLatexEnvironmentPairAt(text, offset, options);
  if (environmentPair) {
    return createEnvironmentRenamePlan(text, environmentPair, targetName, targetArguments);
  }
  let delimiterPair = findDisplayMathDelimiterAt(text, offset);
  if (delimiterPair) {
    return createDelimiterConversionPlan(text, delimiterPair, targetName, targetArguments);
  }
  return { handled: false, edits: [] };
}
function isChangeInRange(change, start, end) {
  let changeStart = change.rangeOffset;
  let changeEnd = change.rangeOffset + change.rangeLength;
  if (change.rangeLength == 0) {
    return start <= changeStart && changeStart <= end;
  }
  return changeStart < end && changeEnd > start;
}
function mapOffsetAfterChange(offset, change) {
  let changeStart = change.rangeOffset;
  let changeEnd = change.rangeOffset + change.rangeLength;
  let delta = change.text.length - change.rangeLength;
  if (offset <= changeStart) {
    return offset;
  }
  if (offset >= changeEnd) {
    return offset + delta;
  }
  return changeStart + change.text.length;
}
function mapRangeAfterChange(start, end, change) {
  if (change.rangeLength == 0) {
    let delta = change.text.length;
    if (change.rangeOffset < start) {
      return { start: start + delta, end: end + delta };
    }
    if (change.rangeOffset <= end) {
      return { start, end: end + delta };
    }
    return { start, end };
  }
  return {
    start: mapOffsetAfterChange(start, change),
    end: mapOffsetAfterChange(end, change)
  };
}
function isValidEnvironmentName(name) {
  return /^[^{}\s]+$/.test(name);
}
function createEnvironmentNameSyncPlan(beforeText, afterText, change, options = {}) {
  let pairsToCheck = [
    findLatexEnvironmentPairAt(beforeText, change.rangeOffset, options),
    findLatexEnvironmentPairAt(beforeText, change.rangeOffset + change.rangeLength, options)
  ].filter((pair) => Boolean(pair));
  for (let pair of pairsToCheck) {
    let editedBegin = isChangeInRange(change, pair.beginNameStart, pair.beginNameEnd);
    let editedEnd = isChangeInRange(change, pair.endNameStart, pair.endNameEnd);
    if (editedBegin == editedEnd) {
      continue;
    }
    let editedStart = editedBegin ? pair.beginNameStart : pair.endNameStart;
    let editedEndOffset = editedBegin ? pair.beginNameEnd : pair.endNameEnd;
    let targetStart = editedBegin ? pair.endNameStart : pair.beginNameStart;
    let targetEnd = editedBegin ? pair.endNameEnd : pair.beginNameEnd;
    let mappedEdited = mapRangeAfterChange(editedStart, editedEndOffset, change);
    let mappedTarget = mapRangeAfterChange(targetStart, targetEnd, change);
    let nextName = afterText.slice(mappedEdited.start, mappedEdited.end);
    let currentTargetName = afterText.slice(mappedTarget.start, mappedTarget.end);
    if (!isValidEnvironmentName(nextName) || nextName == currentTargetName) {
      return { handled: false, edits: [] };
    }
    return {
      handled: true,
      edits: [{ start: mappedTarget.start, end: mappedTarget.end, text: nextName }],
      cursorOffset: mappedTarget.start
    };
  }
  return { handled: false, edits: [] };
}

// src/snippets/engine/snippetProfiles.ts
var import_fs = require("fs");
var path5 = __toESM(require("path"));
var PROFILE_ROOT_DIR = "profiles";
var WORKSPACE_SNIPPET_DIR = path5.join(".vscode", "hsnips");
function normalizeProfileName(profile) {
  let normalized = (profile || "").trim();
  if (!normalized || normalized == "." || normalized == ".." || normalized.includes("\0") || normalized.includes("/") || normalized.includes("\\")) {
    return "";
  }
  return normalized;
}
function getProfilesDir(snippetDir) {
  return path5.join(snippetDir, PROFILE_ROOT_DIR);
}
function getProfileDir(snippetDir, profile) {
  return path5.join(getProfilesDir(snippetDir), profile);
}
function getWorkspaceSnippetDir(workspaceFolder) {
  return path5.join(workspaceFolder, WORKSPACE_SNIPPET_DIR);
}
function isHsnipsFile(filePath) {
  return path5.extname(filePath).toLowerCase() == ".hsnips";
}
function readSnippetFileEntries(directory, scope, profile = "", workspaceFolder) {
  if (!(0, import_fs.existsSync)(directory)) {
    return [];
  }
  let canonicalDirectory = canonicalPath(directory);
  return (0, import_fs.readdirSync)(directory).filter((file) => isHsnipsFile(file)).filter((file) => isInside(canonicalPath(path5.join(directory, file)), canonicalDirectory)).sort((a, b) => a.localeCompare(b)).map((file) => {
    let filePath = path5.join(directory, file);
    return {
      filePath,
      language: path5.basename(file, ".hsnips").toLowerCase(),
      profile,
      scope,
      workspaceFolder
    };
  });
}
function discoverSnippetProfiles(snippetDir) {
  let profilesDir = getProfilesDir(snippetDir);
  if (!(0, import_fs.existsSync)(profilesDir)) {
    return [];
  }
  let canonicalProfilesDir = canonicalPath(profilesDir);
  return (0, import_fs.readdirSync)(profilesDir).filter((name) => {
    let filePath = path5.join(profilesDir, name);
    return normalizeProfileName(name) == name && (0, import_fs.statSync)(filePath).isDirectory() && isInside(canonicalPath(filePath), canonicalProfilesDir);
  }).sort((a, b) => a.localeCompare(b));
}
function getSnippetFilesForProfile(snippetDir, activeProfile = "") {
  let profile = normalizeProfileName(activeProfile);
  let files = readSnippetFileEntries(snippetDir, "base");
  if (profile) {
    files.push(...readSnippetFileEntries(getProfileDir(snippetDir, profile), "profile", profile));
  }
  return files;
}
function getSnippetFiles(snippetDir, activeProfile = "", workspaceSnippetDir, workspaceFolder) {
  let files = getSnippetFilesForProfile(snippetDir, activeProfile);
  if (workspaceSnippetDir) {
    files.push(...readSnippetFileEntries(workspaceSnippetDir, "workspace", "", workspaceFolder));
  }
  return files;
}
function getWorkspaceSnippetFiles(workspaceFolder) {
  return readSnippetFileEntries(
    getWorkspaceSnippetDir(workspaceFolder),
    "workspace",
    "",
    workspaceFolder
  );
}
function ensureProfileDir(snippetDir, profile) {
  let normalized = normalizeProfileName(profile);
  if (!normalized) throw new Error("Snippet profile name is invalid.");
  let profileDir = getProfileDir(snippetDir, normalized);
  (0, import_fs.mkdirSync)(profileDir, { recursive: true });
  return profileDir;
}
function canonicalPath(candidate) {
  try {
    return import_fs.realpathSync.native(candidate);
  } catch {
    return path5.resolve(candidate);
  }
}
function isInside(candidate, root) {
  let caseInsensitive = process.platform == "win32" || process.platform == "darwin";
  let normalizedCandidate = caseInsensitive ? candidate.toLocaleLowerCase() : candidate;
  let normalizedRoot = caseInsensitive ? root.toLocaleLowerCase() : root;
  return normalizedCandidate == normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path5.sep}`);
}

// src/snippets/engine/host.ts
var GLOBAL_SNIPPETS_BY_LANGUAGE = /* @__PURE__ */ new Map();
var WORKSPACE_SNIPPETS_BY_FOLDER = /* @__PURE__ */ new Map();
var SNIPPET_STACK = [];
var insertingSnippet = false;
var applyingLatexEdit = false;
var latexContextCache;
var latexContextOptionsCache;
var DOCUMENT_TEXT_CACHE = /* @__PURE__ */ new WeakMap();
var snippetOutput;
function isLatexLikeDocument(document) {
  return ["latex", "tex", "markdown"].includes(document.languageId.toLowerCase());
}
function getStringArrayConfiguration(path17) {
  let value = vscode5.workspace.getConfiguration("hsnips").get(path17);
  return Array.isArray(value) ? value.filter((item) => typeof item == "string") : [];
}
function getActiveSnippetProfile() {
  return normalizeProfileName(
    vscode5.workspace.getConfiguration("hsnips").get("profiles.activeProfile")
  );
}
function readLatexContextOptions() {
  return {
    extraMathEnvironments: getStringArrayConfiguration("context.extraMathEnvironments"),
    extraRowBreakEnvironments: getStringArrayConfiguration("context.extraRowBreakEnvironments"),
    extraAlignmentEnvironments: getStringArrayConfiguration("context.extraAlignmentEnvironments"),
    extraTextLikeCommands: getStringArrayConfiguration("context.extraTextLikeCommands")
  };
}
function getLatexContextOptionsState() {
  if (!latexContextOptionsCache) {
    let options = readLatexContextOptions();
    latexContextOptionsCache = {
      options,
      key: JSON.stringify(options)
    };
  }
  return latexContextOptionsCache;
}
function getLatexContextOptions() {
  return getLatexContextOptionsState().options;
}
function getCachedLatexContext(document, position) {
  if (!isLatexLikeDocument(document)) {
    return void 0;
  }
  let { options, key: optionsKey } = getLatexContextOptionsState();
  let offset = document.offsetAt(position);
  if (latexContextCache && latexContextCache.document == document && latexContextCache.version == document.version && latexContextCache.offset == offset && latexContextCache.optionsKey == optionsKey) {
    return latexContextCache.context;
  }
  let context = getLatexContext(document.getText(), offset, options);
  latexContextCache = {
    document,
    version: document.version,
    offset,
    optionsKey,
    context
  };
  return context;
}
function updateMathContext(editor) {
  let inLatexMath = false;
  let canSmartEnter = false;
  let canSmartTab = false;
  if (editor) {
    let context = getCachedLatexContext(editor.document, editor.selection.active);
    if (context) {
      inLatexMath = context.inMath;
      canSmartEnter = context.canSmartEnter;
      canSmartTab = context.canSmartTab;
    }
  }
  vscode5.commands.executeCommand("setContext", "hsnips.inLatexMath", inLatexMath);
  vscode5.commands.executeCommand("setContext", "hsnips.canSmartEnter", canSmartEnter);
  vscode5.commands.executeCommand("setContext", "hsnips.canSmartTab", canSmartTab);
  vscode5.commands.executeCommand("setContext", "hsnips.canInsertAlignmentSeparator", canSmartTab);
}
async function typeText(text) {
  await vscode5.commands.executeCommand("type", { text });
}
async function applyEdits(editor, edits) {
  applyingLatexEdit = true;
  try {
    return await editor.edit((editBuilder) => {
      for (let edit of edits) {
        editBuilder.replace(
          new vscode5.Range(
            editor.document.positionAt(edit.start),
            editor.document.positionAt(edit.end)
          ),
          edit.text
        );
      }
    });
  } finally {
    applyingLatexEdit = false;
  }
}
async function smartEnter(editor) {
  if (editor.selections.length != 1 || !editor.selection.isEmpty) {
    await typeText("\n");
    return;
  }
  let text = editor.document.getText();
  let offset = editor.document.offsetAt(editor.selection.active);
  let plan = getSmartEnterPlan(text, offset, getLatexContextOptions());
  if (!plan.handled) {
    await typeText("\n");
    return;
  }
  let inserted = await applyEdits(editor, plan.edits);
  if (inserted) {
    let newPosition = editor.document.positionAt(plan.cursorOffset);
    editor.selection = new vscode5.Selection(newPosition, newPosition);
    editor.revealRange(new vscode5.Range(newPosition, newPosition));
  }
}
function isPlainEnterChange(change) {
  return change.rangeLength == 0 && /^\r?\n[ \t]*$/.test(change.text);
}
async function recoverSmartEnterAfterPlainEnter(editor, change) {
  if (applyingLatexEdit || !isPlainEnterChange(change)) {
    return false;
  }
  let currentText = editor.document.getText();
  let beforeEnterText = currentText.slice(0, change.rangeOffset) + currentText.slice(change.rangeOffset + change.text.length);
  let plan = getSmartEnterRecoveryPlan(
    beforeEnterText,
    change.rangeOffset,
    currentText,
    getLatexContextOptions()
  );
  if (!plan.handled) {
    return false;
  }
  let inserted = await applyEdits(editor, plan.edits);
  if (inserted && typeof plan.cursorOffset == "number") {
    let newPosition = editor.document.positionAt(plan.cursorOffset);
    editor.selection = new vscode5.Selection(newPosition, newPosition);
    editor.revealRange(new vscode5.Range(newPosition, newPosition));
  }
  return inserted;
}
function getTextBeforeChange(currentText, change) {
  return currentText.slice(0, change.rangeOffset) + currentText.slice(change.rangeOffset + change.text.length);
}
async function recoverEnvironmentNameSyncAfterChange(editor, change, beforeText, currentText) {
  if (applyingLatexEdit || !isLatexLikeDocument(editor.document)) {
    return false;
  }
  let plan = createEnvironmentNameSyncPlan(
    beforeText,
    currentText,
    {
      rangeOffset: change.rangeOffset,
      rangeLength: change.rangeLength,
      text: change.text
    },
    getLatexContextOptions()
  );
  if (!plan.handled) {
    return false;
  }
  applyingLatexEdit = true;
  try {
    return await editor.edit(
      (editBuilder) => {
        for (let edit of plan.edits) {
          editBuilder.replace(
            new vscode5.Range(
              editor.document.positionAt(edit.start),
              editor.document.positionAt(edit.end)
            ),
            edit.text
          );
        }
      },
      { undoStopBefore: false, undoStopAfter: false }
    );
  } finally {
    applyingLatexEdit = false;
  }
}
async function nextSnippetPlaceholder() {
  if (SNIPPET_STACK[0] && !SNIPPET_STACK[0].nextPlaceholder()) {
    SNIPPET_STACK.shift();
  }
  await vscode5.commands.executeCommand("jumpToNextSnippetPlaceholder");
}
async function fallbackTab() {
  if (SNIPPET_STACK.length) {
    await nextSnippetPlaceholder();
    return;
  }
  try {
    await vscode5.commands.executeCommand("editor.action.insertTab");
  } catch {
    await typeText("	");
  }
}
async function smartTab(editor) {
  let text = editor.document.getText();
  let options = getLatexContextOptions();
  let shouldInsertSeparator = editor.selections.every((selection) => {
    return shouldInsertAlignmentSeparator(text, editor.document.offsetAt(selection.active), options);
  });
  if (!shouldInsertSeparator) {
    await fallbackTab();
    return;
  }
  await editor.edit((editBuilder) => {
    for (let selection of editor.selections) {
      editBuilder.replace(selection, " & ");
    }
  });
}
async function convertEnvironment(editor) {
  let text = editor.document.getText();
  let options = getLatexContextOptions();
  let selection = editor.selection;
  let offset = editor.document.offsetAt(selection.active);
  let selectionStart = editor.document.offsetAt(selection.start);
  let selectionEnd = editor.document.offsetAt(selection.end);
  let environmentPair = findLatexEnvironmentPairAt(text, offset, options);
  let delimiterPair = findDisplayMathDelimiterAt(text, offset);
  let currentName = environmentPair?.name;
  let target = await vscode5.window.showQuickPick(
    CONVERTIBLE_ENVIRONMENTS.filter((environment) => environment != currentName).map((environment) => ({
      label: environment,
      description: isTableLikeEnvironment(environment) ? "table-like environment" : "math environment"
    })),
    {
      placeHolder: currentName ? `Convert ${currentName} to...` : selection.isEmpty ? "Convert display math to..." : "Wrap selection with..."
    }
  );
  if (!target) {
    return;
  }
  let targetArguments = "";
  if (isTableLikeEnvironment(target.label)) {
    let needsArguments = !environmentPair || conversionNeedsTableArguments(text, offset, target.label);
    if (needsArguments) {
      let columnSpec = await vscode5.window.showInputBox({
        prompt: `Column specification for ${target.label}`,
        value: "c",
        ignoreFocusOut: true
      });
      if (columnSpec === void 0) {
        return;
      }
      targetArguments = formatTableArguments(target.label, columnSpec);
    }
  }
  let plan = !selection.isEmpty && !environmentPair && !delimiterPair ? createWrapEnvironmentPlan(text, selectionStart, selectionEnd, target.label, targetArguments) : createEnvironmentConversionPlan(text, offset, target.label, targetArguments, options);
  if (!plan.handled) {
    vscode5.window.showInformationMessage("No LaTeX environment or display math delimiter found at the cursor.");
    return;
  }
  let inserted = await applyEdits(editor, plan.edits);
  if (inserted && typeof plan.cursorOffset == "number") {
    let newPosition = editor.document.positionAt(plan.cursorOffset);
    editor.selection = new vscode5.Selection(newPosition, newPosition);
    editor.revealRange(new vscode5.Range(newPosition, newPosition));
  }
}
async function renameMatchingEnvironment(editor) {
  let text = editor.document.getText();
  let offset = editor.document.offsetAt(editor.selection.active);
  let pair = findLatexEnvironmentPairAt(text, offset, getLatexContextOptions());
  if (!pair) {
    vscode5.window.showInformationMessage("No LaTeX environment found at the cursor.");
    return;
  }
  let targetName = await vscode5.window.showInputBox({
    prompt: `Rename matching \\begin/\\end for ${pair.name}`,
    value: pair.name,
    ignoreFocusOut: true,
    validateInput(value) {
      return isValidEnvironmentName(value.trim()) ? void 0 : "Environment name cannot be empty or contain braces/whitespace.";
    }
  });
  if (targetName === void 0) {
    return;
  }
  let plan = createEnvironmentNameOnlyRenamePlan(pair, targetName);
  if (!plan.handled) {
    return;
  }
  let inserted = await applyEdits(editor, plan.edits);
  if (inserted && typeof plan.cursorOffset == "number") {
    let newPosition = editor.document.positionAt(plan.cursorOffset);
    editor.selection = new vscode5.Selection(newPosition, newPosition);
    editor.revealRange(new vscode5.Range(newPosition, newPosition));
  }
}
async function pickMathStructureTarget() {
  let target = await vscode5.window.showQuickPick(
    WRAPPABLE_MATH_ENVIRONMENTS.map((environment) => ({
      label: environment,
      description: isTableLikeEnvironment(environment) ? "matrix/table-like environment" : "math environment"
    })),
    { placeHolder: "Wrap with..." }
  );
  return target?.label;
}
async function getTargetArgumentsIfNeeded(targetName) {
  if (!isTableLikeEnvironment(targetName)) {
    return "";
  }
  let columnSpec = await vscode5.window.showInputBox({
    prompt: `Column specification for ${targetName}`,
    value: "c",
    ignoreFocusOut: true
  });
  if (columnSpec === void 0) {
    return void 0;
  }
  return formatTableArguments(targetName, columnSpec);
}
async function wrapMathStructure(editor) {
  let targetName = await pickMathStructureTarget();
  if (!targetName) {
    return;
  }
  let targetArguments = await getTargetArgumentsIfNeeded(targetName);
  if (targetArguments === void 0) {
    return;
  }
  let text = editor.document.getText();
  let selection = editor.selection;
  let selectionStart = editor.document.offsetAt(selection.start);
  let selectionEnd = editor.document.offsetAt(selection.end);
  let plan = !selection.isEmpty ? createWrapEnvironmentPlan(text, selectionStart, selectionEnd, targetName, targetArguments) : createWrapCurrentMathStructurePlan(
    text,
    editor.document.offsetAt(selection.active),
    targetName,
    targetArguments,
    getLatexContextOptions()
  );
  if (!plan.handled) {
    vscode5.window.showInformationMessage("Select text or place the cursor inside a math structure to wrap.");
    return;
  }
  let inserted = await applyEdits(editor, plan.edits);
  if (inserted && typeof plan.cursorOffset == "number") {
    let newPosition = editor.document.positionAt(plan.cursorOffset);
    editor.selection = new vscode5.Selection(newPosition, newPosition);
    editor.revealRange(new vscode5.Range(newPosition, newPosition));
  }
}
async function unwrapMathStructure(editor) {
  let text = editor.document.getText();
  let plan = createUnwrapMathStructurePlan(
    text,
    editor.document.offsetAt(editor.selection.active),
    getLatexContextOptions()
  );
  if (!plan.handled) {
    vscode5.window.showInformationMessage("No supported math structure found at the cursor.");
    return;
  }
  let inserted = await applyEdits(editor, plan.edits);
  if (inserted && typeof plan.cursorOffset == "number") {
    let newPosition = editor.document.positionAt(plan.cursorOffset);
    editor.selection = new vscode5.Selection(newPosition, newPosition);
    editor.revealRange(new vscode5.Range(newPosition, newPosition));
  }
}
function reportSnippetLoadErrors(errors) {
  if (!errors.length) {
    return;
  }
  for (let error of errors) snippetOutput?.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] SNIPPET PARSE ${error}`);
  snippetOutput?.appendLine(`Skipped ${errors.length} snippet file${errors.length == 1 ? "" : "s"}; the Snippets inspector remains available.`);
  snippetOutput?.appendLine("");
}
function readSnippetMap(entries) {
  let snippetsByLanguage = /* @__PURE__ */ new Map();
  let errors = [];
  for (let entry of entries) {
    try {
      let fileData = (0, import_fs2.readFileSync)(entry.filePath, "utf8");
      let snippetList = snippetsByLanguage.get(entry.language);
      if (!snippetList) {
        snippetList = [];
        snippetsByLanguage.set(entry.language, snippetList);
      }
      snippetList.push(...parse(fileData));
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      errors.push(`${entry.filePath}: ${message}`);
    }
  }
  return { snippetsByLanguage, errors };
}
async function loadSnippets() {
  GLOBAL_SNIPPETS_BY_LANGUAGE.clear();
  WORKSPACE_SNIPPETS_BY_FOLDER.clear();
  let snippetDir = getSnippetDir();
  if (!(0, import_fs2.existsSync)(snippetDir)) {
    (0, import_fs2.mkdirSync)(snippetDir, { recursive: true });
  }
  let { snippetsByLanguage, errors } = readSnippetMap(
    getSnippetFilesForProfile(snippetDir, getActiveSnippetProfile())
  );
  for (let [language, snippets] of snippetsByLanguage.entries()) {
    GLOBAL_SNIPPETS_BY_LANGUAGE.set(language, snippets);
  }
  reportSnippetLoadErrors(errors);
}
function getWorkspaceFolderForDocument(document) {
  if (document.uri.scheme != "file") {
    return void 0;
  }
  return vscode5.workspace.getWorkspaceFolder(document.uri);
}
function loadWorkspaceSnippets(workspaceFolder) {
  let key = workspaceFolder.uri.fsPath;
  let cached = WORKSPACE_SNIPPETS_BY_FOLDER.get(key);
  if (cached) {
    return cached;
  }
  let { snippetsByLanguage, errors } = readSnippetMap(getWorkspaceSnippetFiles(key));
  WORKSPACE_SNIPPETS_BY_FOLDER.set(key, snippetsByLanguage);
  reportSnippetLoadErrors(errors);
  return snippetsByLanguage;
}
function appendSnippetsForLanguage(target, snippetsByLanguage, language) {
  let languageSnippets = snippetsByLanguage.get(language);
  if (languageSnippets) {
    target.push(...languageSnippets);
  }
  if (language != "all") {
    let globalSnippets = snippetsByLanguage.get("all");
    if (globalSnippets) {
      target.push(...globalSnippets);
    }
  }
}
function getSnippetsForDocument(document) {
  let language = document.languageId.toLowerCase();
  let snippets = [];
  appendSnippetsForLanguage(snippets, GLOBAL_SNIPPETS_BY_LANGUAGE, language);
  let workspaceFolder = getWorkspaceFolderForDocument(document);
  if (workspaceFolder) {
    appendSnippetsForLanguage(snippets, loadWorkspaceSnippets(workspaceFolder), language);
  }
  snippets.sort((a, b) => b.priority - a.priority);
  return snippets.length ? snippets : void 0;
}
function getActiveWorkspaceFolder() {
  let editor = vscode5.window.activeTextEditor;
  if (editor) {
    let workspaceFolder = getWorkspaceFolderForDocument(editor.document);
    if (workspaceFolder) {
      return workspaceFolder;
    }
  }
  return vscode5.workspace.workspaceFolders?.[0];
}
function getActiveWorkspaceSnippetDir() {
  let workspaceFolder = getActiveWorkspaceFolder();
  return workspaceFolder ? getWorkspaceSnippetDir(workspaceFolder.uri.fsPath) : void 0;
}
function getWorkspaceSnippetLanguageChoices(workspaceFolder) {
  let activeLanguage = vscode5.window.activeTextEditor?.document.languageId.toLowerCase();
  let languages2 = /* @__PURE__ */ new Set(["latex", "tex", "all"]);
  for (let entry of getWorkspaceSnippetFiles(workspaceFolder.uri.fsPath)) {
    languages2.add(entry.language);
  }
  if (activeLanguage && activeLanguage != "hsnips" && activeLanguage != "plaintext") {
    languages2.add(activeLanguage);
  }
  return [...languages2];
}
async function openWorkspaceSnippetFile() {
  let workspaceFolder = getActiveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode5.window.showInformationMessage("Open a workspace folder to create workspace snippets.");
    return;
  }
  let workspaceSnippetDir = getWorkspaceSnippetDir(workspaceFolder.uri.fsPath);
  (0, import_fs2.mkdirSync)(workspaceSnippetDir, { recursive: true });
  let picked = await vscode5.window.showQuickPick(
    getWorkspaceSnippetLanguageChoices(workspaceFolder).map((language) => {
      let filePath = path6.join(workspaceSnippetDir, `${language}.hsnips`);
      return {
        label: `${language}.hsnips`,
        description: (0, import_fs2.existsSync)(filePath) ? "workspace" : "create",
        detail: filePath,
        filePath
      };
    }),
    { placeHolder: "Create or open workspace snippet file" }
  );
  if (!picked) {
    return;
  }
  if (!(0, import_fs2.existsSync)(picked.filePath)) {
    (0, import_fs2.writeFileSync)(picked.filePath, "", "utf8");
    WORKSPACE_SNIPPETS_BY_FOLDER.delete(workspaceFolder.uri.fsPath);
  }
  let document = await vscode5.workspace.openTextDocument(picked.filePath);
  await vscode5.window.showTextDocument(document);
}
async function selectSnippetProfile() {
  let snippetDir = getSnippetDir();
  if (!(0, import_fs2.existsSync)(snippetDir)) {
    (0, import_fs2.mkdirSync)(snippetDir, { recursive: true });
  }
  let activeProfile = getActiveSnippetProfile();
  let profiles = discoverSnippetProfiles(snippetDir);
  let picked = await vscode5.window.showQuickPick(
    [
      {
        label: "Base only",
        description: activeProfile ? void 0 : "current",
        profile: ""
      },
      ...profiles.map((profile) => ({
        label: profile,
        description: profile == activeProfile ? "current" : void 0,
        profile
      }))
    ],
    { placeHolder: "Select active snippet profile" }
  );
  if (!picked) {
    return;
  }
  await vscode5.workspace.getConfiguration("hsnips").update("profiles.activeProfile", picked.profile, vscode5.ConfigurationTarget.Global);
  await loadSnippets();
  vscode5.window.showInformationMessage(
    picked.profile ? `LaTeX Toolkit snippet profile: ${picked.profile}` : "LaTeX Toolkit snippet profile: base only"
  );
}
async function openActiveSnippetProfile() {
  let snippetDir = getSnippetDir();
  let activeProfile = getActiveSnippetProfile();
  if (!activeProfile) {
    vscode5.window.showInformationMessage("No active snippet profile selected. Opening the base snippets directory.");
    openExplorer(snippetDir);
    return;
  }
  openExplorer(ensureProfileDir(snippetDir, activeProfile));
}
async function expandSnippet(completion, editor, snippetExpansion = false) {
  let snippetInstance = new HSnippetInstance(
    completion.snippet,
    editor,
    completion.range.start,
    completion.groups
  );
  let insertionRange = completion.range.start;
  insertingSnippet = true;
  await editor.edit(
    (eb) => {
      eb.delete(snippetExpansion ? completion.completionRange : completion.range);
    },
    { undoStopAfter: false, undoStopBefore: !snippetExpansion }
  );
  await editor.insertSnippet(snippetInstance.snippetString, insertionRange, {
    undoStopAfter: false,
    undoStopBefore: false
  });
  if (snippetInstance.selectedPlaceholder != 0) SNIPPET_STACK.unshift(snippetInstance);
  insertingSnippet = false;
}
function snippetCommandError(output, commandId, error) {
  let normalized = error instanceof Error ? error : new Error(String(error));
  output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] ERROR ${commandId}`);
  output.appendLine(`Workspace: ${vscode5.window.activeTextEditor?.document.uri.fsPath || vscode5.workspace.workspaceFolders?.[0]?.uri.fsPath || "(no local workspace)"}`);
  output.appendLine(normalized.stack || normalized.message);
  output.appendLine("");
}
function snippetCommandCancelled(error) {
  return error instanceof vscode5.CancellationError || error instanceof Error && /cancelled|canceled/i.test(error.message);
}
function registerSnippetHost(context, output) {
  snippetOutput = output;
  const guarded = (commandId, handler) => async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (snippetCommandCancelled(error)) return void 0;
      snippetCommandError(output, commandId, error);
      let action = await vscode5.window.showErrorMessage(`LaTeX Editing Toolkit: ${error instanceof Error ? error.message : String(error)}`, "Show Log");
      if (action == "Show Log") output.show(true);
      return void 0;
    }
  };
  loadSnippets();
  if (vscode5.window.activeTextEditor) {
    DOCUMENT_TEXT_CACHE.set(
      vscode5.window.activeTextEditor.document,
      vscode5.window.activeTextEditor.document.getText()
    );
  }
  updateMathContext(vscode5.window.activeTextEditor);
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.openSnippetsDir", guarded("hsnips.openSnippetsDir", () => openExplorer(getSnippetDir())))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.openSnippetFile", guarded("hsnips.openSnippetFile", async () => {
      let snippetDir = getSnippetDir();
      if (!(0, import_fs2.existsSync)(snippetDir)) {
        (0, import_fs2.mkdirSync)(snippetDir, { recursive: true });
      }
      let files = getSnippetFiles(
        snippetDir,
        getActiveSnippetProfile(),
        getActiveWorkspaceSnippetDir(),
        getActiveWorkspaceFolder()?.uri.fsPath
      );
      let selectedFile = await vscode5.window.showQuickPick(
        files.map((entry) => ({
          label: path6.basename(entry.filePath),
          description: entry.scope == "profile" ? `profile:${entry.profile}` : entry.scope,
          detail: entry.filePath,
          filePath: entry.filePath
        })),
        { placeHolder: "Open snippet file" }
      );
      if (selectedFile) {
        let document = await vscode5.workspace.openTextDocument(selectedFile.filePath);
        vscode5.window.showTextDocument(document);
      }
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.openWorkspaceSnippetsDir", guarded("hsnips.openWorkspaceSnippetsDir", () => {
      let workspaceSnippetDir = getActiveWorkspaceSnippetDir();
      if (!workspaceSnippetDir) {
        vscode5.window.showInformationMessage("Open a workspace folder to use workspace snippets.");
        return;
      }
      (0, import_fs2.mkdirSync)(workspaceSnippetDir, { recursive: true });
      openExplorer(workspaceSnippetDir);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.openWorkspaceSnippetFile", guarded("hsnips.openWorkspaceSnippetFile", () => openWorkspaceSnippetFile()))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.reloadSnippets", guarded("hsnips.reloadSnippets", () => loadSnippets()))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.selectProfile", guarded("hsnips.selectProfile", () => selectSnippetProfile()))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.openActiveProfile", guarded("hsnips.openActiveProfile", () => openActiveSnippetProfile()))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.leaveSnippet", guarded("hsnips.leaveSnippet", () => {
      while (SNIPPET_STACK.length) SNIPPET_STACK.pop();
      vscode5.commands.executeCommand("leaveSnippet");
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.nextPlaceholder", guarded("hsnips.nextPlaceholder", () => {
      return nextSnippetPlaceholder();
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerCommand("hsnips.prevPlaceholder", guarded("hsnips.prevPlaceholder", () => {
      if (SNIPPET_STACK[0] && !SNIPPET_STACK[0].prevPlaceholder()) {
        SNIPPET_STACK.shift();
      }
      vscode5.commands.executeCommand("jumpToPrevSnippetPlaceholder");
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.smartEnter", guarded("hsnips.smartEnter", (editor) => {
      return smartEnter(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.matrixTab", guarded("hsnips.matrixTab", (editor) => {
      return smartTab(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.smartTab", guarded("hsnips.smartTab", (editor) => {
      return smartTab(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.convertEnvironment", guarded("hsnips.convertEnvironment", (editor) => {
      return convertEnvironment(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.renameMatchingEnvironment", guarded("hsnips.renameMatchingEnvironment", (editor) => {
      return renameMatchingEnvironment(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.wrapMathStructure", guarded("hsnips.wrapMathStructure", (editor) => {
      return wrapMathStructure(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand("hsnips.unwrapMathStructure", guarded("hsnips.unwrapMathStructure", (editor) => {
      return unwrapMathStructure(editor);
    }))
  );
  context.subscriptions.push(
    vscode5.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId == "hsnips") {
        loadSnippets();
      }
    })
  );
  context.subscriptions.push(
    vscode5.workspace.onDidChangeWorkspaceFolders(() => {
      WORKSPACE_SNIPPETS_BY_FOLDER.clear();
    })
  );
  context.subscriptions.push(
    vscode5.commands.registerTextEditorCommand(
      "hsnips.expand",
      guarded("hsnips.expand", (editor, _, completion) => {
        expandSnippet(completion, editor, true);
      })
    )
  );
  function getDocumentLatexContext(document, offset) {
    return getCachedLatexContext(document, document.positionAt(offset));
  }
  function getEditorLatexContext(editor, position = editor.selection.start) {
    return getDocumentLatexContext(editor.document, editor.document.offsetAt(position));
  }
  function canExpandSnippetInContext(snippet, latexContext) {
    if (snippet.math) {
      return Boolean(latexContext?.canExpandMathSnippet);
    }
    if (snippet.text && latexContext?.inMath) {
      return false;
    }
    return true;
  }
  context.subscriptions.push(
    vscode5.workspace.onDidChangeTextDocument(async (e) => {
      let previousText = DOCUMENT_TEXT_CACHE.get(e.document);
      let currentText = e.document.getText();
      let activeEditor = vscode5.window.activeTextEditor;
      try {
        if (activeEditor && e.document == activeEditor.document) {
          updateMathContext(activeEditor);
        }
        if (SNIPPET_STACK.length && SNIPPET_STACK[0].editor.document == e.document) {
          SNIPPET_STACK[0].update(e.contentChanges);
        }
        if (insertingSnippet) return;
        let mainChange = e.contentChanges[0];
        if (!mainChange) return;
        if (activeEditor && e.document == activeEditor.document && e.contentChanges.length == 1 && await recoverEnvironmentNameSyncAfterChange(
          activeEditor,
          mainChange,
          previousText || getTextBeforeChange(currentText, mainChange),
          currentText
        )) {
          return;
        }
        if (activeEditor && e.document == activeEditor.document && isPlainEnterChange(mainChange)) {
          void recoverSmartEnterAfterPlainEnter(activeEditor, mainChange).then(void 0, console.error);
          return;
        }
        if (mainChange.text.length != 1) return;
        let snippets = getSnippetsForDocument(e.document);
        if (!snippets) return;
        let editor = vscode5.window.activeTextEditor;
        if (!editor || e.document != editor.document) return;
        let latexContext = getEditorLatexContext(editor);
        snippets = snippets.filter((snippet) => canExpandSnippetInContext(snippet, latexContext));
        let mainChangePosition = mainChange.range.start.translate(0, mainChange.text.length);
        let completion = getAutomaticCompletion(e.document, mainChangePosition, snippets);
        if (completion) {
          expandSnippet(completion, editor);
          return;
        }
      } finally {
        DOCUMENT_TEXT_CACHE.set(e.document, e.document.getText());
      }
    })
  );
  context.subscriptions.push(
    vscode5.window.onDidChangeVisibleTextEditors(() => {
      while (SNIPPET_STACK.length) SNIPPET_STACK.pop();
      updateMathContext(vscode5.window.activeTextEditor);
    })
  );
  context.subscriptions.push(
    vscode5.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        DOCUMENT_TEXT_CACHE.set(editor.document, editor.document.getText());
      }
      updateMathContext(editor);
    })
  );
  context.subscriptions.push(
    vscode5.window.onDidChangeTextEditorSelection((e) => {
      while (SNIPPET_STACK.length) {
        if (e.selections.some((s) => SNIPPET_STACK[0].range.contains(s))) {
          break;
        }
        SNIPPET_STACK.shift();
      }
      updateMathContext(e.textEditor);
    })
  );
  context.subscriptions.push(
    vscode5.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("hsnips.context")) {
        latexContextCache = void 0;
        latexContextOptionsCache = void 0;
        updateMathContext(vscode5.window.activeTextEditor);
      }
      if (event.affectsConfiguration("hsnips.profiles.activeProfile")) {
        loadSnippets();
      }
    })
  );
  context.subscriptions.push(
    vscode5.languages.registerCompletionItemProvider([{ scheme: "untitled" }, { scheme: "file" }], {
      provideCompletionItems(document, position) {
        let snippets = getSnippetsForDocument(document);
        if (!snippets) return;
        let editor = vscode5.window.activeTextEditor;
        if (!editor || document != editor.document) return;
        let latexContext = getDocumentLatexContext(document, document.offsetAt(position));
        snippets = snippets.filter((snippet) => canExpandSnippetInContext(snippet, latexContext));
        let completions = getCompletions(document, position, snippets);
        if (completions && Array.isArray(completions)) {
          return completions.map((c) => c.toCompletionItem());
        }
      }
    })
  );
}

// src/snippets/snippetService.ts
var import_node_fs7 = require("node:fs");
var path8 = __toESM(require("node:path"));
var vscode6 = __toESM(require("vscode"));

// src/snippets/snippetManagerModel.ts
var import_node_fs5 = require("node:fs");

// src/snippets/engine/snippetDocument.ts
var import_crypto = require("crypto");
var HEADER_REGEXP2 = /^snippet(?:\s+(?:`([^`]*)`|(\S+)))?(?:\s+"([^"]*)")?(?:\s+(\S+))?\s*$/;
var VALID_FLAGS = /^[AMiwbmt]*$/;
function getSourceLines(content) {
  let lines = [];
  let start = 0;
  if (content.length == 0) {
    return [{ text: "", start: 0, end: 0, endIncludingNewline: 0 }];
  }
  while (start < content.length) {
    let newline = content.indexOf("\n", start);
    if (newline == -1) {
      lines.push({
        text: content.slice(start),
        start,
        end: content.length,
        endIncludingNewline: content.length
      });
      break;
    }
    let lineEnd = newline > start && content[newline - 1] == "\r" ? newline - 1 : newline;
    lines.push({
      text: content.slice(start, lineEnd),
      start,
      end: lineEnd,
      endIncludingNewline: newline + 1
    });
    start = newline + 1;
  }
  return lines;
}
function hashText(text) {
  return (0, import_crypto.createHash)("sha256").update(text).digest("hex");
}
function assertExpectedSnippetDocumentHash(content, expectedHash) {
  if (expectedHash && hashText(content) != expectedHash) {
    throw new Error("The snippet file changed on disk. Reload the manager before saving.");
  }
}
function parseHeader(line) {
  let match = HEADER_REGEXP2.exec(line);
  if (!match) {
    return void 0;
  }
  return {
    isRegex: match[1] !== void 0,
    trigger: match[1] ?? match[2] ?? "",
    description: match[3] ?? "",
    flags: match[4] ?? ""
  };
}
function createDiagnostic(severity, message, line, snippetId) {
  return { severity, message, line, snippetId };
}
function collectBlockDiagnostics(block) {
  let diagnostics = [];
  if (!block.trigger) {
    diagnostics.push(createDiagnostic("error", "Snippet trigger is empty.", block.startLine, block.id));
  }
  if (!VALID_FLAGS.test(block.flags)) {
    diagnostics.push(createDiagnostic("error", `Invalid flags: ${block.flags}`, block.startLine, block.id));
  }
  if (!block.isSimple) {
    diagnostics.push(
      createDiagnostic(
        "info",
        "Complex snippets are read-only in the manager; open the source file to edit them.",
        block.startLine,
        block.id
      )
    );
  }
  return diagnostics;
}
function addDuplicateDiagnostics(document) {
  let byTrigger = /* @__PURE__ */ new Map();
  let automaticByTrigger = /* @__PURE__ */ new Map();
  for (let snippet of document.snippets) {
    if (snippet.isRegex || !snippet.trigger) continue;
    let key = snippet.trigger;
    byTrigger.set(key, [...byTrigger.get(key) || [], snippet]);
    if (snippet.flags.includes("A")) {
      automaticByTrigger.set(key, [...automaticByTrigger.get(key) || [], snippet]);
    }
  }
  for (let snippets of byTrigger.values()) {
    if (snippets.length < 2) continue;
    for (let snippet of snippets) {
      snippet.diagnostics.push(
        createDiagnostic("warning", `Duplicate trigger "${snippet.trigger}".`, snippet.startLine, snippet.id)
      );
    }
  }
  for (let snippets of automaticByTrigger.values()) {
    if (snippets.length < 2) continue;
    for (let snippet of snippets) {
      snippet.diagnostics.push(
        createDiagnostic(
          "warning",
          `Multiple automatic snippets use trigger "${snippet.trigger}".`,
          snippet.startLine,
          snippet.id
        )
      );
    }
  }
}
function parseSnippetDocument(content, filePath = "", language = "") {
  let lines = getSourceLines(content);
  let snippets = [];
  let diagnostics = [];
  let priority = 0;
  let priorityStart;
  let priorityLineIndex;
  let inGlobal = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex];
    let trimmed = line.text.trim();
    if (inGlobal) {
      if (trimmed == "endglobal") {
        inGlobal = false;
      }
      continue;
    }
    if (trimmed == "global") {
      inGlobal = true;
      continue;
    }
    if (trimmed.startsWith("priority ")) {
      priority = Number(trimmed.substring("priority ".length).trim()) || 0;
      priorityStart = line.start;
      priorityLineIndex = lineIndex;
      continue;
    }
    if (!trimmed.startsWith("snippet")) {
      continue;
    }
    let header = parseHeader(trimmed);
    if (!header) {
      diagnostics.push(createDiagnostic("error", "Invalid snippet header.", lineIndex));
      priority = 0;
      priorityStart = void 0;
      priorityLineIndex = void 0;
      continue;
    }
    let endLineIndex = lineIndex + 1;
    while (endLineIndex < lines.length && lines[endLineIndex].text.trim() != "endsnippet") {
      endLineIndex++;
    }
    let bodyStart = line.endIncludingNewline;
    let bodyEnd = endLineIndex < lines.length ? lines[endLineIndex].start : content.length;
    let body = content.slice(bodyStart, bodyEnd).replace(/\r?\n$/, "");
    let endOffset = endLineIndex < lines.length ? lines[endLineIndex].endIncludingNewline : content.length;
    let id = `${filePath}:${line.start}`;
    let isDynamic = body.includes("``");
    let canReplacePriority = priorityLineIndex !== void 0 && lines.slice(priorityLineIndex + 1, lineIndex).every((sourceLine) => sourceLine.text.trim() == "");
    let isSimple = !header.isRegex && !isDynamic && Boolean(header.trigger) && !/\s/.test(header.trigger) && VALID_FLAGS.test(header.flags);
    let block = {
      id,
      trigger: header.trigger,
      description: header.description,
      flags: header.flags,
      priority,
      body,
      language,
      filePath,
      startLine: lineIndex,
      endLine: endLineIndex < lines.length ? endLineIndex : lines.length - 1,
      headerStart: line.start,
      endOffset,
      priorityStart: canReplacePriority ? priorityStart : void 0,
      isRegex: header.isRegex,
      isDynamic,
      isSimple,
      diagnostics: []
    };
    if (endLineIndex >= lines.length) {
      block.diagnostics.push(createDiagnostic("error", "Snippet is missing endsnippet.", lineIndex, id));
    }
    block.diagnostics.push(...collectBlockDiagnostics(block));
    snippets.push(block);
    lineIndex = endLineIndex;
    priority = 0;
    priorityStart = void 0;
    priorityLineIndex = void 0;
  }
  let document = {
    filePath,
    language,
    content,
    hash: hashText(content),
    snippets,
    diagnostics
  };
  addDuplicateDiagnostics(document);
  document.diagnostics.push(...document.snippets.flatMap((snippet) => snippet.diagnostics));
  return document;
}

// src/snippets/snippetManagerModel.ts
function crossDocumentDiagnostic(message, snippet) {
  return {
    severity: "warning",
    message,
    line: snippet.startLine,
    snippetId: snippet.id
  };
}
function addCrossDocumentDuplicateDiagnostics(documents) {
  const byTrigger = /* @__PURE__ */ new Map();
  const automaticByTrigger = /* @__PURE__ */ new Map();
  for (const document of documents) {
    for (const snippet of document.snippets) {
      if (snippet.isRegex || !snippet.trigger) continue;
      byTrigger.set(snippet.trigger, [...byTrigger.get(snippet.trigger) || [], snippet]);
      if (snippet.flags.includes("A")) {
        automaticByTrigger.set(snippet.trigger, [...automaticByTrigger.get(snippet.trigger) || [], snippet]);
      }
    }
  }
  for (const snippets of byTrigger.values()) {
    if (new Set(snippets.map((snippet) => snippet.filePath)).size < 2) continue;
    for (const snippet of snippets) {
      const diagnostic = crossDocumentDiagnostic(`Duplicate trigger "${snippet.trigger}" across loaded snippet files.`, snippet);
      snippet.diagnostics.push(diagnostic);
      documents.find((document) => document.filePath === snippet.filePath)?.diagnostics.push(diagnostic);
    }
  }
  for (const snippets of automaticByTrigger.values()) {
    if (new Set(snippets.map((snippet) => snippet.filePath)).size < 2) continue;
    for (const snippet of snippets) {
      const diagnostic = crossDocumentDiagnostic(`Multiple automatic snippets use trigger "${snippet.trigger}" across loaded snippet files.`, snippet);
      snippet.diagnostics.push(diagnostic);
      documents.find((document) => document.filePath === snippet.filePath)?.diagnostics.push(diagnostic);
    }
  }
}
function readSnippetDocuments(snippetDir, activeProfile = "", workspaceSnippetDir, workspaceFolder) {
  if (!(0, import_node_fs5.existsSync)(snippetDir)) (0, import_node_fs5.mkdirSync)(snippetDir, { recursive: true });
  const documents = [];
  for (const entry of getSnippetFiles(snippetDir, activeProfile, workspaceSnippetDir, workspaceFolder)) {
    try {
      const content = (0, import_node_fs5.readFileSync)(entry.filePath, "utf8");
      const document = parseSnippetDocument(content, entry.filePath, entry.language);
      document.mtimeMs = (0, import_node_fs5.statSync)(entry.filePath).mtimeMs;
      document.sourceScope = entry.scope;
      document.profile = entry.profile;
      document.workspaceFolder = entry.workspaceFolder;
      documents.push(document);
    } catch {
    }
  }
  addCrossDocumentDuplicateDiagnostics(documents);
  return documents;
}

// src/snippets/pathPolicy.ts
var import_node_fs6 = require("node:fs");
var path7 = __toESM(require("node:path"));
async function canonicalSnippetPath(candidate, mustExist) {
  const resolved = path7.resolve(candidate);
  try {
    return await import_node_fs6.promises.realpath(resolved);
  } catch (error) {
    if (mustExist) throw error;
    try {
      return path7.join(await import_node_fs6.promises.realpath(path7.dirname(resolved)), path7.basename(resolved));
    } catch {
      return resolved;
    }
  }
}
async function assertSnippetPathAllowed(filePath, allowedRoots, mustExist) {
  const resolved = path7.resolve(filePath);
  if (path7.extname(resolved).toLowerCase() !== ".hsnips") throw new Error("Only .hsnips files can be managed.");
  const candidate = await canonicalSnippetPath(resolved, mustExist);
  const roots = await Promise.all(allowedRoots.map((root) => canonicalSnippetPath(root, false)));
  if (!roots.some((root) => candidate === root || candidate.startsWith(`${root}${path7.sep}`))) {
    throw new Error("Snippet path is outside the configured snippet directories.");
  }
}

// src/snippets/snippetService.ts
var SnippetService = class {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
  }
  workspaceRoot;
  async state() {
    const snippetDir = getSnippetDir();
    await import_node_fs7.promises.mkdir(snippetDir, { recursive: true });
    const activeProfile = normalizeProfileName(vscode6.workspace.getConfiguration("hsnips").get("profiles.activeProfile"));
    const workspaceSnippetDir = this.workspaceRoot ? getWorkspaceSnippetDir(this.workspaceRoot) : void 0;
    const documents = readSnippetDocuments(snippetDir, activeProfile, workspaceSnippetDir, this.workspaceRoot).map((document) => ({
      filePath: document.filePath,
      fileName: path8.basename(document.filePath),
      sourceScope: document.sourceScope || "base",
      profile: document.profile || "",
      workspaceFolder: document.workspaceFolder || "",
      language: document.language,
      content: document.content,
      hash: document.hash,
      mtimeMs: document.mtimeMs,
      diagnostics: document.diagnostics || [],
      snippets: document.snippets || []
    }));
    return {
      activeProfile,
      profiles: discoverSnippetProfiles(snippetDir),
      snippetDir,
      workspaceSnippetDir,
      documents
    };
  }
  async analyze(filePath, content) {
    await this.assertAllowed(filePath, true);
    const document = parseSnippetDocument(content, filePath, path8.basename(filePath, ".hsnips"));
    return {
      filePath,
      fileName: path8.basename(filePath),
      sourceScope: this.scopeFor(filePath),
      profile: this.profileFor(filePath),
      workspaceFolder: this.workspaceRoot || "",
      language: document.language,
      content: document.content,
      hash: document.hash,
      diagnostics: document.diagnostics,
      snippets: document.snippets
    };
  }
  async save(filePath, content, expectedHash, expectedMtimeMs) {
    await this.assertAllowed(filePath, true);
    const openDocument = vscode6.workspace.textDocuments.find((document) => document.uri.scheme === "file" && path8.resolve(document.uri.fsPath) === path8.resolve(filePath));
    if (openDocument?.isDirty) {
      throw new Error("The snippet file has unsaved changes in the editor. Save or discard them before using the manager.");
    }
    const currentStat = await import_node_fs7.promises.stat(filePath);
    if (expectedMtimeMs !== void 0 && Math.abs(currentStat.mtimeMs - expectedMtimeMs) > 1) {
      throw new Error("The snippet file timestamp changed on disk. Reload the manager before saving.");
    }
    const current = await import_node_fs7.promises.readFile(filePath, "utf8");
    assertExpectedSnippetDocumentHash(current, expectedHash);
    await this.atomicWrite(filePath, content);
    await vscode6.commands.executeCommand("hsnips.reloadSnippets");
    return this.state();
  }
  async create(language, scope) {
    if (!/^[a-z0-9_-]+$/i.test(language)) throw new Error("Snippet language must contain only letters, digits, underscores, or hyphens.");
    const snippetDir = getSnippetDir();
    const activeProfile = normalizeProfileName(vscode6.workspace.getConfiguration("hsnips").get("profiles.activeProfile"));
    let directory = snippetDir;
    if (scope === "profile") {
      if (!activeProfile) throw new Error("Select an active snippet profile before creating a profile file.");
      directory = path8.join(getProfilesDir(snippetDir), activeProfile);
    } else if (scope === "workspace") {
      if (!this.workspaceRoot) throw new Error("Open a local workspace before creating workspace snippets.");
      directory = getWorkspaceSnippetDir(this.workspaceRoot);
    }
    await import_node_fs7.promises.mkdir(directory, { recursive: true });
    const filePath = path8.join(directory, `${language.toLowerCase()}.hsnips`);
    await this.assertAllowed(filePath, false);
    try {
      await import_node_fs7.promises.writeFile(filePath, "", { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    await vscode6.commands.executeCommand("hsnips.reloadSnippets");
    return this.state();
  }
  async openSource(filePath, line = 1) {
    await this.assertAllowed(filePath, true);
    const document = await vscode6.workspace.openTextDocument(filePath);
    const editor = await vscode6.window.showTextDocument(document);
    const position = new vscode6.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode6.Selection(position, position);
    editor.revealRange(new vscode6.Range(position, position));
  }
  allowedRoots() {
    const snippetDir = path8.resolve(getSnippetDir());
    return this.workspaceRoot ? [snippetDir, path8.resolve(getWorkspaceSnippetDir(this.workspaceRoot))] : [snippetDir];
  }
  async assertAllowed(filePath, mustExist) {
    await assertSnippetPathAllowed(filePath, this.allowedRoots(), mustExist);
  }
  scopeFor(filePath) {
    if (this.workspaceRoot && path8.resolve(filePath).startsWith(`${path8.resolve(getWorkspaceSnippetDir(this.workspaceRoot))}${path8.sep}`)) return "workspace";
    if (path8.resolve(filePath).startsWith(`${path8.resolve(getProfilesDir(getSnippetDir()))}${path8.sep}`)) return "profile";
    return "base";
  }
  profileFor(filePath) {
    if (this.scopeFor(filePath) !== "profile") return "";
    return path8.relative(getProfilesDir(getSnippetDir()), filePath).split(path8.sep)[0] || "";
  }
  async atomicWrite(filePath, content) {
    const temp = `${filePath}.toolkit-${process.pid}-${Date.now()}.tmp`;
    await import_node_fs7.promises.writeFile(temp, content, "utf8");
    await import_node_fs7.promises.rename(temp, filePath);
  }
};

// src/toolkitService.ts
var import_node_fs14 = require("node:fs");
var path15 = __toESM(require("node:path"));

// src/cleanup.ts
var import_node_fs9 = require("node:fs");
var path10 = __toESM(require("node:path"));

// src/vscodeSettings.ts
var import_node_fs8 = require("node:fs");
var path9 = __toESM(require("node:path"));
init_utils();
function toolkitVscodeSettingsTemplate() {
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
      "*.aux",
      "*.bbl",
      "*.blg",
      "*.idx",
      "*.ind",
      "*.lof",
      "*.lot",
      "*.out",
      "*.toc",
      "*.acn",
      "*.acr",
      "*.alg",
      "*.glg",
      "*.glo",
      "*.gls",
      "*.ist",
      "*.fls",
      "*.log",
      "*.fdb_latexmk"
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
async function loadVscodeSettings(rootDir) {
  const settingsPath = path9.join(rootDir, ".vscode", "settings.json");
  try {
    const text = await import_node_fs8.promises.readFile(settingsPath, "utf8");
    if (!text.trim()) return {};
    const parsed = parseJsonc(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSONC content must be a top-level object.");
    }
    return parsed;
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") return {};
    throw err;
  }
}
function parseJsonc(raw) {
  return JSON.parse(stripJsonTrailingCommas(stripJsoncComments(raw)));
}
function stripJsoncComments(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
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
function stripJsonTrailingCommas(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
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
async function loadRecipeCatalog(rootDir) {
  const catalog = { tools: {}, recipes: [], errors: [] };
  let settings;
  try {
    settings = await loadVscodeSettings(rootDir);
  } catch (err) {
    catalog.errors.push(`Failed to parse .vscode/settings.json: ${err.message}`);
    return catalog;
  }
  const rawTools = settings["latex-workshop.latex.tools"];
  if (Array.isArray(rawTools)) {
    rawTools.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        catalog.errors.push(`Tool entry at index ${index} is not an object.`);
        return;
      }
      const item = entry;
      const name = String(item.name ?? "").trim();
      const command = String(item.command ?? "").trim();
      const args = Array.isArray(item.args) ? item.args.map(String) : [];
      if (!name) catalog.errors.push(`Tool entry at index ${index} is missing 'name'.`);
      if (!command) catalog.errors.push(`Tool '${name || index}' is missing 'command'.`);
      if (name && command) catalog.tools[name] = { name, command, args };
    });
  } else if (rawTools !== void 0) {
    catalog.errors.push("latex-workshop.latex.tools must be a list.");
  }
  const rawRecipes = settings["latex-workshop.latex.recipes"];
  if (Array.isArray(rawRecipes)) {
    rawRecipes.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        catalog.errors.push(`Recipe entry at index ${index} is not an object.`);
        return;
      }
      const item = entry;
      const name = String(item.name ?? "").trim();
      const tools = Array.isArray(item.tools) ? item.tools.map(String).filter((value) => value.trim()) : [];
      if (!name) catalog.errors.push(`Recipe entry at index ${index} is missing 'name'.`);
      if (tools.length === 0) catalog.errors.push(`Recipe '${name || index}' has no tools.`);
      if (name && tools.length > 0) {
        catalog.recipes.push({ id: `vscode-${index + 1}-${slugify(name)}`, name, tools });
      }
    });
  } else if (rawRecipes !== void 0) {
    catalog.errors.push("latex-workshop.latex.recipes must be a list.");
  }
  return catalog;
}
async function generateVscodeSettingsIfMissing(rootDir) {
  const settingsPath = path9.join(rootDir, ".vscode", "settings.json");
  try {
    const stat = await import_node_fs8.promises.stat(settingsPath);
    if (stat.isDirectory()) throw new Error(".vscode/settings.json is a directory.");
    return { generated: false, generated_path: ".vscode/settings.json", message: ".vscode/settings.json already exists; left unchanged." };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await import_node_fs8.promises.mkdir(path9.dirname(settingsPath), { recursive: true });
  await import_node_fs8.promises.writeFile(settingsPath, `${JSON.stringify(toolkitVscodeSettingsTemplate(), null, 2)}
`, "utf8");
  return { generated: true, generated_path: ".vscode/settings.json", message: "Generated .vscode/settings.json." };
}
async function cleanPatternsFromVscodeSettings(rootDir, fallback) {
  try {
    const settings = await loadVscodeSettings(rootDir);
    const raw = settings["latex-workshop.latex.clean.fileTypes"];
    if (Array.isArray(raw)) {
      const patterns = raw.map(String).map((value) => value.trim()).filter(Boolean);
      if (patterns.length > 0) return Array.from(new Set(patterns));
    }
  } catch {
  }
  return fallback;
}

// src/cleanup.ts
init_utils();
var ROOT_SCOPE_DIRS = ["."];
var ROOT_PROTECTED_PATTERNS = ["*.pdf", "*.synctex.gz"];
var SUBFILE_DELETE_PATTERNS = ["*"];
var SUBFILE_KEEP_PATTERNS = ["*.tex", "*.pdf"];
var FALLBACK_FILE_TYPES = [
  "*.aux",
  "*.bbl",
  "*.bcf",
  "*.blg",
  "*.fdb_latexmk",
  "*.fls",
  "*.lof",
  "*.log",
  "*.lot",
  "*.out",
  "*.run.xml",
  "*.toc",
  "*.xdv",
  "*.nav",
  "*.snm",
  "*.vrb",
  "*.acn",
  "*.acr",
  "*.alg",
  "*.glg",
  "*.glo",
  "*.gls",
  "*.ist",
  "*.idx",
  "*.ilg",
  "*.ind",
  "*.loa",
  "*.lol",
  "*.maf",
  "*.mtc*",
  "*.pyg",
  "*.thm"
];
var CleanupService = class {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }
  rootDir;
  async clean(dryRun = false) {
    const rootPatterns = await cleanPatternsFromVscodeSettings(this.rootDir, FALLBACK_FILE_TYPES);
    const { scopeDirs: subfileScope, errors: discoverErrors } = await this.discoverSubfileScopeDirs();
    const rootResult = await this.cleanBuildArtifacts(ROOT_SCOPE_DIRS, rootPatterns, ROOT_PROTECTED_PATTERNS, dryRun, false);
    const subfileResult = subfileScope.length > 0 ? await this.cleanBuildArtifacts(subfileScope, SUBFILE_DELETE_PATTERNS, SUBFILE_KEEP_PATTERNS, dryRun, true) : { scope: [], deleted: [], skipped: [], errors: [] };
    const emptyDirs = subfileScope.length > 0 ? await this.pruneEmptyDirectories(subfileScope, dryRun) : { removed: [], errors: [] };
    const deleted = Array.from(/* @__PURE__ */ new Set([...rootResult.deleted, ...subfileResult.deleted])).sort();
    const skipped = Array.from(/* @__PURE__ */ new Set([...rootResult.skipped, ...subfileResult.skipped])).sort();
    const errors = Array.from(/* @__PURE__ */ new Set([...discoverErrors, ...rootResult.errors, ...subfileResult.errors, ...emptyDirs.errors])).sort();
    return {
      success: errors.length === 0,
      dry_run: dryRun,
      scope: Array.from(/* @__PURE__ */ new Set([...rootResult.scope, ...subfileResult.scope])).sort(),
      patterns: rootPatterns,
      protected_patterns: ROOT_PROTECTED_PATTERNS,
      deleted_files: deleted,
      deleted_count: deleted.length,
      skipped_protected_files: skipped,
      skipped_protected_count: skipped.length,
      errors,
      root_scope: rootResult.scope,
      subfile_scope: subfileResult.scope,
      root_patterns: rootPatterns,
      root_protected_patterns: ROOT_PROTECTED_PATTERNS,
      subfile_keep_patterns: SUBFILE_KEEP_PATTERNS,
      removed_empty_dirs: emptyDirs.removed,
      removed_empty_dir_count: emptyDirs.removed.length
    };
  }
  async discoverSubfileScopeDirs() {
    const scope = /* @__PURE__ */ new Set();
    const errors = [];
    const walk = async (dir) => {
      const entries = await import_node_fs9.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "__pycache__"].includes(entry.name)) continue;
        const abs = path10.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile() && entry.name.endsWith(".tex")) {
          try {
            const text = await import_node_fs9.promises.readFile(abs, "utf8");
            const declaration = extractDocumentclassDeclaration(text);
            if (declaration?.className === "subfiles" && path10.dirname(abs) !== this.rootDir) {
              scope.add(workspaceRel(this.rootDir, path10.dirname(abs)));
            }
          } catch (err) {
            errors.push(`Failed to inspect documentclass for ${safeWorkspaceRel(this.rootDir, abs)}: ${err.message}`);
          }
        }
      }
    };
    await walk(this.rootDir);
    return { scopeDirs: Array.from(scope).sort(), errors };
  }
  async cleanBuildArtifacts(scopeDirs, patterns, protectedPatterns, dryRun, recursiveAll) {
    const deleted = [];
    const skipped = [];
    const errors = [];
    const normalizedScope = scopeDirs.map((scope) => scope || ".").filter(Boolean);
    for (const scope of normalizedScope) {
      const scopeAbs = path10.resolve(this.rootDir, scope);
      if (!isSubpath(scopeAbs, this.rootDir) || !await exists(scopeAbs)) continue;
      const files = await this.listScopeFiles(scopeAbs, recursiveAll);
      for (const abs of files) {
        const relToScope = safeWorkspaceRel(scopeAbs, abs) || path10.basename(abs);
        const workspaceRelative = workspaceRel(this.rootDir, abs);
        const basename12 = path10.basename(abs);
        if (!patterns.some((pattern) => matchesGlob(relToScope, basename12, pattern))) continue;
        if (protectedPatterns.some((pattern) => matchesGlob(relToScope, basename12, pattern))) {
          skipped.push(workspaceRelative);
          continue;
        }
        try {
          if (!dryRun) await import_node_fs9.promises.unlink(abs);
          deleted.push(workspaceRelative);
        } catch (err) {
          errors.push(`Failed to delete ${workspaceRelative}: ${err.message}`);
        }
      }
    }
    return { scope: normalizedScope, deleted, skipped, errors };
  }
  async listScopeFiles(scopeAbs, recursive) {
    const out = [];
    const walk = async (dir) => {
      for (const entry of await import_node_fs9.promises.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || ["node_modules", ".git"].includes(entry.name)) continue;
        const abs = path10.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (recursive) await walk(abs);
        } else if (entry.isFile()) {
          out.push(abs);
        }
      }
    };
    await walk(scopeAbs);
    return out;
  }
  async pruneEmptyDirectories(scopeDirs, dryRun) {
    const removed = [];
    const errors = [];
    for (const scope of scopeDirs) {
      const scopeAbs = path10.resolve(this.rootDir, scope);
      const dirs = [];
      const collect = async (dir) => {
        for (const entry of await import_node_fs9.promises.readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const abs = path10.join(dir, entry.name);
            dirs.push(abs);
            await collect(abs);
          }
        }
      };
      if (await exists(scopeAbs)) await collect(scopeAbs);
      dirs.sort((a, b) => b.length - a.length);
      for (const dir of dirs) {
        try {
          const entries = await import_node_fs9.promises.readdir(dir);
          if (entries.length === 0) {
            if (!dryRun) await import_node_fs9.promises.rmdir(dir);
            removed.push(workspaceRel(this.rootDir, dir));
          }
        } catch (err) {
          errors.push(`Failed to prune ${safeWorkspaceRel(this.rootDir, dir)}: ${err.message}`);
        }
      }
    }
    return { removed, errors };
  }
};

// src/compile.ts
var import_node_child_process = require("node:child_process");
var import_node_fs10 = require("node:fs");
var path11 = __toESM(require("node:path"));
init_utils();
var COMMAND_TIMEOUT_MS = 12e4;
var SUBFILE_PATTERN = /\\subfile(?:\[[^\]]*\])?\{([^}]+)\}/g;
var CompileService = class {
  constructor(rootDir, stateService) {
    this.rootDir = rootDir;
    this.stateService = stateService;
  }
  rootDir;
  stateService;
  resolveContext(compileTarget) {
    if (!compileTarget) throw new Error("No compile target selected.");
    const targetAbs = path11.resolve(this.rootDir, compileTarget);
    if (!isSubpath(targetAbs, this.rootDir)) throw new Error(`Compile target is outside workspace: ${compileTarget}`);
    const compileCwd = path11.dirname(targetAbs);
    const docfile = path11.basename(targetAbs);
    const docstem = path11.basename(targetAbs, path11.extname(targetAbs));
    const defaultPdfAbs = path11.join(compileCwd, `${docstem}.pdf`);
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
  async compileFromPayload(payload) {
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
  async compileTexTarget(compileTarget, recipeId, useInternalFallback) {
    const ctx = this.resolveContext(compileTarget);
    const targetStat = await import_node_fs10.promises.stat(ctx.targetAbs).catch(() => null);
    if (!targetStat?.isFile()) throw new Error(`Compile target does not exist: ${compileTarget}`);
    const preflight = await this.preflight(ctx);
    if (preflight) return preflight;
    if (useInternalFallback) return this.compileInternal(ctx);
    return this.compileRecipe(ctx, recipeId);
  }
  async expectedOutputPdfForSelection(state) {
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
  async compileInternal(ctx) {
    const logs = [];
    const pipeline = [
      ["xelatex", ["-synctex=1", "-interaction=nonstopmode", "-file-line-error", ctx.docfile]],
      ["biber", [ctx.docstem]],
      ["xelatex", ["-synctex=1", "-interaction=nonstopmode", "-file-line-error", ctx.docfile]],
      ["xelatex", ["-synctex=1", "-interaction=nonstopmode", "-file-line-error", ctx.docfile]]
    ];
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
    return this.finalizeCompileOutput(ctx, logs, ctx.defaultPdfRel);
  }
  async compileRecipe(ctx, recipeId) {
    const catalog = await loadRecipeCatalog(this.rootDir);
    const recipe = catalog.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) throw new Error(`Unknown compile recipe: ${recipeId}`);
    const logs = [];
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
  async preflight(ctx) {
    const issues = [];
    const visited = /* @__PURE__ */ new Set();
    const visiting = /* @__PURE__ */ new Set();
    const walk = async (filePath, chain) => {
      const resolved = path11.resolve(filePath);
      if (visiting.has(resolved)) {
        issues.push(`Recursive subfile cycle detected: ${[...chain, resolved].map((item) => safeWorkspaceRel(this.rootDir, item) || item).join(" -> ")}`);
        return;
      }
      if (visited.has(resolved)) return;
      visited.add(resolved);
      visiting.add(resolved);
      let text = "";
      try {
        text = stripTexComments(await import_node_fs10.promises.readFile(resolved, "utf8"));
      } catch (err) {
        issues.push(`Failed to read source file: ${safeWorkspaceRel(this.rootDir, resolved)} (${err.message})`);
        visiting.delete(resolved);
        return;
      }
      for (const match of text.matchAll(SUBFILE_PATTERN)) {
        const raw = match[1].trim();
        const withExt = raw.endsWith(".tex") ? raw : `${raw}.tex`;
        const target = path11.isAbsolute(withExt) ? withExt : path11.resolve(path11.dirname(resolved), withExt);
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
        if (!await exists(target)) {
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
  replaceRecipeTokens(value, ctx, outdir) {
    return value.replace(/%DOCFILE%/g, ctx.docfile).replace(/%DOC%/g, ctx.targetAbs).replace(/%DOC_EXT%/g, ctx.docfile).replace(/%DOCFILE_EXT%/g, ctx.docfile).replace(/%DOCFILE_NOEXT%/g, ctx.docstem).replace(/%DOC_NOEXT%/g, path11.join(ctx.compileCwd, ctx.docstem)).replace(/%OUTDIR%/g, outdir || ".");
  }
  extractOutdir(args) {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith("-outdir=")) return arg.slice("-outdir=".length);
      if (arg === "-outdir" && args[i + 1]) return args[i + 1];
      if (arg.startsWith("--output-directory=")) return arg.slice("--output-directory=".length);
      if (arg === "--output-directory" && args[i + 1]) return args[i + 1];
    }
    return null;
  }
  resolvePdfPathForOutdir(ctx, outdir) {
    const replaced = this.replaceRecipeTokens(outdir, ctx, ".");
    const outAbs = path11.isAbsolute(replaced) ? path11.resolve(replaced) : path11.resolve(ctx.compileCwd, replaced);
    if (!isSubpath(outAbs, this.rootDir)) return ctx.defaultPdfRel;
    return workspaceRel(this.rootDir, path11.join(outAbs, `${ctx.docstem}.pdf`));
  }
  async finalizeCompileOutput(ctx, logs, expectedPdfRel) {
    let pdfRel = expectedPdfRel;
    const expectedAbs = path11.resolve(this.rootDir, expectedPdfRel);
    if (!await exists(expectedAbs) && await exists(ctx.defaultPdfAbs)) {
      pdfRel = ctx.defaultPdfRel;
    }
    const pdfAbs = path11.resolve(this.rootDir, pdfRel);
    if (!await exists(pdfAbs)) {
      logs.push("");
      logs.push(`[output] Expected PDF not found: ${pdfRel}`);
      return { success: false, output: logs.join("\n"), pdfPath: pdfRel };
    }
    logs.push("");
    logs.push(`[output] PDF: ${pdfRel}`);
    return { success: true, output: logs.join("\n"), pdfPath: pdfRel };
  }
  appendStepLog(logs, label, cwd, command, output, code) {
    logs.push(`$ ${command.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ")}`);
    logs.push(`[${label}] cwd: ${workspaceRel(this.rootDir, cwd) || "."}`);
    logs.push(`[${label}] exit code: ${code}`);
    if (output.trim()) logs.push(output.trim());
    logs.push("");
  }
  async runCommand(command, args, cwd) {
    return new Promise((resolve14) => {
      const child = (0, import_node_child_process.spawn)(command, [...args], {
        cwd,
        env: { ...process.env, TEXINPUTS: `.:${this.rootDir}//:${process.env.TEXINPUTS ?? ""}`, BIBINPUTS: `.:${this.rootDir}//:${process.env.BIBINPUTS ?? ""}` }
      });
      let output = "";
      const timer = setTimeout(() => {
        output += `
[timeout] Command exceeded ${COMMAND_TIMEOUT_MS / 1e3}s and was terminated.`;
        child.kill("SIGTERM");
      }, COMMAND_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve14({ code: 127, output: `${output}
${err.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve14({ code: code ?? 1, output });
      });
    });
  }
  async resolveBinary(command) {
    if (path11.isAbsolute(command) || command.includes(path11.sep)) return await exists(command) ? command : null;
    const paths = (process.env.PATH ?? "").split(path11.delimiter);
    const candidates = process.platform === "win32" ? [`${command}.exe`, `${command}.cmd`, command] : [command];
    for (const dir of paths) {
      for (const candidate of candidates) {
        const abs = path11.join(dir, candidate);
        if (await exists(abs)) return abs;
      }
    }
    return null;
  }
};

// src/splitter.ts
var import_node_fs11 = require("node:fs");
var path12 = __toESM(require("node:path"));
init_utils();
var BEGIN_DOCUMENT_PATTERN = /\\begin\s*\{document\}/;
var END_DOCUMENT_PATTERN = /\\end\s*\{document\}/;
var TOP_LEVEL_REFERENCE_PATTERN = /\\(subfile|input|include)(?:\[[^\]]*\])?\{([^}]+)\}/g;
var APPENDIX_PATTERN = /\\appendix\b/g;
var NUMERIC_PREFIX_PATTERN = /^(\d+)-(.+)$/;
var SplitterService = class {
  constructor(rootDir, stateService) {
    this.rootDir = rootDir;
    this.stateService = stateService;
  }
  rootDir;
  stateService;
  async splitCompileTarget(compileTarget, dryRun = false, sectionsDir = "Sections") {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.splitTexFile(path12.resolve(this.rootDir, target), sectionsDir, dryRun);
    return { response: await this.stateService.buildResponseState(), split: result };
  }
  async renumberCompileTarget(compileTarget, mode, dryRun = false) {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.renumberReferences(path12.resolve(this.rootDir, target), mode, dryRun);
    return { response: await this.stateService.buildResponseState(), renumber: result };
  }
  async unsplitCompileTarget(compileTarget, dryRun = false, deleteSource = true) {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.unsplitOneUnit(path12.resolve(this.rootDir, target), dryRun, deleteSource);
    return { response: await this.stateService.buildResponseState(), unsplit: result };
  }
  async splitTexFile(rootTexPath, sectionsDirRaw = "Sections", dryRun = false) {
    const rootAbs = path12.resolve(rootTexPath);
    if (!isSubpath(rootAbs, this.rootDir)) throw new Error("Split target is outside workspace.");
    const originalText = await import_node_fs11.promises.readFile(rootAbs, "utf8");
    const declaration = extractDocumentclassDeclaration(originalText);
    if (!declaration) throw new Error("Split source must contain a \\documentclass declaration.");
    if (declaration.className === "subfiles") throw new Error("Split source must be a root target, not a subfiles unit.");
    const splitCommand = isChapterCapableClass(declaration.className) ? "chapter" : "section";
    const bounds = this.findBodyBounds(originalText);
    const body = originalText.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path12.dirname(rootAbs), body);
    const anchors = this.findTopLevelAnchors(body, splitCommand);
    const chunks = this.computeChunks(body, anchors, refs);
    const appendixStart = this.firstAppendixStart(body);
    const existingPrefixMax = this.highestExistingPrefix(refs);
    const mutableChunks = chunks.filter((chunk) => appendixStart === -1 || chunk.anchor.start < appendixStart).map((chunk) => ({
      ...chunk,
      end: appendixStart !== -1 && chunk.end > appendixStart ? appendixStart : chunk.end
    }));
    const newChunks = mutableChunks.filter((chunk) => !this.chunkOverlapsRefs(chunk, refs));
    const warnings = [];
    if (newChunks.length === 0) {
      return {
        success: true,
        dry_run: dryRun,
        already_split: refs.length > 0,
        document_class: declaration.className,
        split_command: splitCommand,
        standalone_mode: "subfiles",
        include_macro: "\\subfile",
        subfiles_package_injected: false,
        backup_path: "",
        generated_subfile_targets: [],
        updated_files: [],
        units: [],
        warnings: refs.length > 0 ? ["No new top-level anchors found outside existing references."] : ["No split anchors found."]
      };
    }
    const sectionsRel = this.normalizeSectionsDir(sectionsDirRaw);
    const sectionsAbs = path12.resolve(path12.dirname(rootAbs), sectionsRel);
    if (!isSubpath(sectionsAbs, this.rootDir)) throw new Error("Sections directory is outside workspace.");
    const seenSlugs = /* @__PURE__ */ new Map();
    const units = [];
    const replacements = [];
    let index = existingPrefixMax + 1;
    for (const chunk of newChunks) {
      const slug = this.stableSlug(chunk.anchor.title, seenSlugs);
      let unitPath;
      do {
        unitPath = path12.join(sectionsAbs, `${String(index).padStart(2, "0")}-${slug}.tex`);
        index += 1;
      } while (await exists(unitPath));
      const ref = this.relativeTexReference(path12.dirname(rootAbs), unitPath);
      units.push({ path: workspaceRel(this.rootDir, unitPath), title: chunk.anchor.title, reference: ref });
      replacements.push({ start: chunk.anchor.start, end: chunk.end, text: `\\subfile{${ref.replace(/\.tex$/i, "")}}
` });
    }
    const preamblePlusBegin = originalText.slice(0, bounds.bodyStart);
    const injectResult = this.injectSubfilesPackage(preamblePlusBegin);
    const newBody = this.applyReplacements(body, replacements);
    const rewritten = `${injectResult.text}${newBody}${originalText.slice(bounds.bodyEnd)}`;
    const backupPath = await this.nextBackupPath(rootAbs);
    const updatedFiles = [workspaceRel(this.rootDir, rootAbs), ...units.map((unit) => unit.path)];
    if (!dryRun) {
      await import_node_fs11.promises.mkdir(sectionsAbs, { recursive: true });
      await import_node_fs11.promises.copyFile(rootAbs, backupPath);
      await import_node_fs11.promises.writeFile(rootAbs, rewritten, "utf8");
      for (const unit of units) {
        const unitAbs = path12.resolve(this.rootDir, unit.path);
        const chunk = newChunks[units.indexOf(unit)];
        await import_node_fs11.promises.writeFile(unitAbs, this.buildSubfileUnitText(rootAbs, unitAbs, body.slice(chunk.anchor.start, chunk.end)), "utf8");
      }
    }
    return {
      success: true,
      dry_run: dryRun,
      already_split: false,
      document_class: declaration.className,
      split_command: splitCommand,
      standalone_mode: "subfiles",
      include_macro: "\\subfile",
      subfiles_package_injected: injectResult.injected,
      backup_path: dryRun ? "" : workspaceRel(this.rootDir, backupPath),
      generated_subfile_targets: units.map((unit) => unit.path),
      updated_files: dryRun ? [] : updatedFiles,
      units,
      warnings
    };
  }
  async renumberReferences(rootTexPath, modeRaw, dryRun = false) {
    const mode = modeRaw === "remove" ? "remove" : "add";
    const rootAbs = path12.resolve(rootTexPath);
    const text = await import_node_fs11.promises.readFile(rootAbs, "utf8");
    const bounds = this.findBodyBounds(text);
    const body = text.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path12.dirname(rootAbs), body);
    const renameMap = /* @__PURE__ */ new Map();
    const replacements = [];
    const warnings = [];
    let counter = 1;
    for (const ref of refs) {
      const ext = path12.extname(ref.path);
      const dir = path12.dirname(ref.path);
      const stem = path12.basename(ref.path, ext);
      const match = NUMERIC_PREFIX_PATTERN.exec(stem);
      let newStem;
      if (mode === "add") {
        newStem = match ? stem : `${String(counter).padStart(2, "0")}-${stem}`;
        counter += 1;
      } else {
        newStem = match ? match[2] : stem;
      }
      const newPath = path12.join(dir, `${newStem}${ext || ".tex"}`);
      if (newPath !== ref.path) {
        if (await exists(newPath)) {
          warnings.push(`Skipped rename because target exists: ${workspaceRel(this.rootDir, newPath)}`);
          continue;
        }
        renameMap.set(ref.path, newPath);
        const newRef = this.relativeTexReference(path12.dirname(rootAbs), newPath).replace(/\.tex$/i, "");
        replacements.push({ start: ref.start, end: ref.end, text: `\\${ref.macro}{${newRef}}` });
      }
    }
    const rewritten = `${text.slice(0, bounds.bodyStart)}${this.applyReplacements(body, replacements)}${text.slice(bounds.bodyEnd)}`;
    if (!dryRun) {
      for (const [from, to] of renameMap) await import_node_fs11.promises.rename(from, to);
      if (replacements.length > 0) await import_node_fs11.promises.writeFile(rootAbs, rewritten, "utf8");
    }
    return {
      success: true,
      dry_run: dryRun,
      mode,
      root_target: workspaceRel(this.rootDir, rootAbs),
      renamed: Object.fromEntries(Array.from(renameMap.entries()).map(([from, to]) => [workspaceRel(this.rootDir, from), workspaceRel(this.rootDir, to)])),
      updated_files: dryRun || replacements.length === 0 ? [] : [workspaceRel(this.rootDir, rootAbs)],
      warnings
    };
  }
  async unsplitOneUnit(unitPath, dryRun = false, deleteSource = true) {
    const unitAbs = path12.resolve(unitPath);
    const unitText = await import_node_fs11.promises.readFile(unitAbs, "utf8");
    const declaration = extractDocumentclassDeclaration(unitText);
    if (!declaration || declaration.className !== "subfiles") throw new Error("Selected target is not a subfiles unit.");
    const parentRef = declaration.options.split(",")[0]?.trim();
    if (!parentRef) throw new Error("Subfiles unit is missing parent root reference.");
    const rootAbs = path12.resolve(path12.dirname(unitAbs), parentRef);
    if (!isSubpath(rootAbs, this.rootDir)) throw new Error("Parent root is outside workspace.");
    const rootText = await import_node_fs11.promises.readFile(rootAbs, "utf8");
    const bounds = this.findBodyBounds(rootText);
    const body = rootText.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path12.dirname(rootAbs), body);
    const matching = refs.find((ref) => path12.resolve(ref.path) === unitAbs);
    if (!matching) throw new Error("Could not find matching \\subfile reference in parent root.");
    const unitBody = this.extractUnitBody(unitText);
    const replacement = unitBody.endsWith("\n") ? unitBody : `${unitBody}
`;
    const newBody = `${body.slice(0, matching.start)}${replacement}${body.slice(matching.end)}`;
    const updated = [workspaceRel(this.rootDir, rootAbs)];
    if (!dryRun) {
      await import_node_fs11.promises.writeFile(rootAbs, `${rootText.slice(0, bounds.bodyStart)}${newBody}${rootText.slice(bounds.bodyEnd)}`, "utf8");
      if (deleteSource) {
        await import_node_fs11.promises.unlink(unitAbs);
        updated.push(workspaceRel(this.rootDir, unitAbs));
      }
    }
    return {
      success: true,
      dry_run: dryRun,
      root_target: workspaceRel(this.rootDir, rootAbs),
      source_target: workspaceRel(this.rootDir, unitAbs),
      delete_source: deleteSource,
      updated_files: dryRun ? [] : updated,
      warnings: []
    };
  }
  findBodyBounds(texText) {
    const begin = BEGIN_DOCUMENT_PATTERN.exec(texText);
    const end = END_DOCUMENT_PATTERN.exec(texText);
    if (!begin || !end || begin.index > end.index) throw new Error("Could not find a valid document body.");
    return { bodyStart: begin.index + begin[0].length, bodyEnd: end.index, beginEnd: begin.index + begin[0].length };
  }
  findTopLevelAnchors(body, command) {
    const anchors = [];
    const pattern = new RegExp(`\\\\${escapeRegExp(command)}(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const groupStart = pattern.lastIndex - 1;
      const parsed = this.parseBalancedGroup(body, groupStart);
      if (!parsed) continue;
      anchors.push({ start: match.index, end: parsed.end, title: parsed.content.trim(), raw: body.slice(match.index, parsed.end) });
      pattern.lastIndex = parsed.end;
    }
    return anchors;
  }
  computeChunks(body, anchors, refs) {
    return anchors.map((anchor, index) => {
      let end = index + 1 < anchors.length ? anchors[index + 1].start : body.length;
      const nextRef = refs.filter((ref) => ref.start > anchor.start).sort((a, b) => a.start - b.start)[0];
      if (nextRef && nextRef.start < end) end = nextRef.start;
      return { anchor, end };
    });
  }
  firstAppendixStart(body) {
    const match = APPENDIX_PATTERN.exec(body);
    APPENDIX_PATTERN.lastIndex = 0;
    return match?.index ?? -1;
  }
  extractTopLevelReferences(baseDir, body) {
    const refs = [];
    for (const match of body.matchAll(TOP_LEVEL_REFERENCE_PATTERN)) {
      const macro = match[1];
      const ref = match[2].trim();
      let target = ref.endsWith(".tex") ? ref : `${ref}.tex`;
      target = path12.isAbsolute(target) ? target : path12.resolve(baseDir, target);
      refs.push({ macro, ref, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, path: target });
    }
    return refs;
  }
  chunkOverlapsRefs(chunk, refs) {
    return refs.some((ref) => ref.start >= chunk.anchor.start && ref.start < chunk.end);
  }
  highestExistingPrefix(refs) {
    let highest = 0;
    for (const ref of refs) {
      const stem = path12.basename(ref.path, path12.extname(ref.path));
      const match = NUMERIC_PREFIX_PATTERN.exec(stem);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    return highest;
  }
  parseBalancedGroup(text, openIndex) {
    if (text[openIndex] !== "{") return null;
    let depth = 0;
    let escaped = false;
    for (let i = openIndex; i < text.length; i += 1) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return { content: text.slice(openIndex + 1, i), end: i + 1 };
      }
    }
    return null;
  }
  stableSlug(title, seen) {
    const base = slugify(title.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "").replace(/[{}]/g, " ")) || "section";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }
  async nextBackupPath(rootAbs) {
    let candidate = `${rootAbs}.bak`;
    let index = 1;
    while (await exists(candidate)) {
      candidate = `${rootAbs}.bak.${index}`;
      index += 1;
    }
    return candidate;
  }
  normalizeSectionsDir(raw) {
    const value = toPosixPath(String(raw || "Sections")).replace(/^\/+/, "").replace(/\/+$/, "") || "Sections";
    if (value.split("/").some((part) => part === ".." || part === "")) throw new Error("Invalid sections directory.");
    return value;
  }
  relativeTexReference(rootDir, targetTexPath) {
    return toPosixPath(path12.relative(rootDir, targetTexPath)).replace(/\.tex$/i, "");
  }
  injectSubfilesPackage(preamblePlusBegin) {
    if (/\\usepackage(?:\[[^\]]*\])?\{subfiles\}/.test(preamblePlusBegin)) {
      return { text: preamblePlusBegin, injected: false };
    }
    const begin = BEGIN_DOCUMENT_PATTERN.exec(preamblePlusBegin);
    if (!begin) return { text: preamblePlusBegin, injected: false };
    const insertAt = begin.index;
    const injected = `${preamblePlusBegin.slice(0, insertAt)}\\usepackage{subfiles}
${preamblePlusBegin.slice(insertAt)}`;
    return { text: injected, injected: true };
  }
  applyReplacements(text, replacements) {
    let result = text;
    for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
      result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`;
    }
    return result;
  }
  buildSubfileUnitText(rootAbs, unitAbs, content) {
    const rootRel = toPosixPath(path12.relative(path12.dirname(unitAbs), rootAbs));
    const body = content.trimStart();
    return `\\documentclass[${rootRel}]{subfiles}
\\begin{document}
${body.trimEnd()}
\\end{document}
`;
  }
  extractUnitBody(unitText) {
    const bounds = this.findBodyBounds(unitText);
    return unitText.slice(bounds.bodyStart, bounds.bodyEnd).trim();
  }
};

// src/state.ts
var import_node_crypto4 = require("node:crypto");
var import_node_fs12 = require("node:fs");
var path13 = __toESM(require("node:path"));
init_schema();
init_utils();
var StateService = class {
  constructor(rootDir, additionalStylePresets = []) {
    this.rootDir = rootDir;
    this.additionalStylePresets = additionalStylePresets.map((preset) => ({ ...preset, colors: { ...preset.colors } }));
  }
  rootDir;
  additionalStylePresets;
  setAdditionalStylePresets(presets) {
    this.additionalStylePresets = presets.map((preset) => ({ ...preset, colors: { ...preset.colors } }));
  }
  configPath() {
    return path13.join(this.rootDir, "theme.ui.json");
  }
  toggleOverridePath() {
    return path13.join(this.rootDir, "theme.overrides.tex");
  }
  colorOverridePath() {
    return path13.join(this.rootDir, "theme.colors.tex");
  }
  themePath() {
    return path13.join(this.rootDir, "theme.sty");
  }
  mainTexPath() {
    return path13.join(this.rootDir, "main.tex");
  }
  async buildResponseState() {
    const state = await this.loadState();
    const starterTemplates = await this.starterTemplateMeta();
    return {
      state,
      schema: {
        toggles: TOGGLE_SCHEMA,
        groups: COLOR_GROUPS,
        class_config: CLASS_CONFIG_SCHEMA,
        style_presets: this.stylePresetSchema(),
        body_font_size: BODY_FONT_SIZE_CONFIG,
        starter_templates: starterTemplates,
        starter_default_template: starterTemplates.some((item) => item.id === "book-minimal") ? "book-minimal" : starterTemplates[0]?.id ?? "",
        starter_default_output_target: "main.tex"
      }
    };
  }
  async parseThemeDefaults(warnings = []) {
    if (!await exists(this.themePath())) {
      const fallback = {};
      for (const token of COLOR_ORDER) fallback[token] = "#808080";
      warnings.push("theme.sty is missing; placeholder colors are being used.");
      return fallback;
    }
    try {
      return await parseThemeColorDefaults(this.themePath(), COLOR_ORDER);
    } catch (err) {
      const fallback = {};
      for (const token of COLOR_ORDER) fallback[token] = "#808080";
      warnings.push(`Could not read theme.sty colors: ${err.message}`);
      return fallback;
    }
  }
  async loadState() {
    const configWarnings = [];
    const themeDefaults = await this.parseThemeDefaults(configWarnings);
    const styleCatalog = this.buildStylePresetCatalog();
    const compileTargets = await this.listCandidateTexFiles();
    const recipeCatalog = await loadRecipeCatalog(this.rootDir);
    const compileRecipes = recipeCatalog.recipes;
    const state = {
      toggles: await this.parseMainToggleDefaults(),
      colors: { ...themeDefaults },
      style_preset: this.defaultPresetId(styleCatalog),
      style_base_preset: this.defaultPresetId(styleCatalog),
      style_presets: this.presetMeta(styleCatalog),
      config_warnings: configWarnings,
      body_font_size_pt: BODY_FONT_SIZE_CONFIG.default,
      class_config: { ...CLASS_CONFIG_DEFAULTS },
      compile_target: defaultCompileTarget(compileTargets),
      compile_targets: compileTargets,
      compile_recipe: compileRecipes[0]?.id ?? "",
      compile_recipe_name: "",
      compile_recipes: compileRecipes,
      compile_recipe_errors: recipeCatalog.errors,
      compile_use_internal_fallback: true,
      compile_output_pdf: "",
      compile_output_pdf_expected: "",
      compile_last_compile_at: "",
      compile_last_success: null,
      detected_document_class: "(unknown)",
      detected_document_class_has_chapter: false,
      effective_theme_class: "article"
    };
    await this.mergePersistedState(state);
    await this.mergeOverrideFiles(state);
    this.finishNormalization(state);
    await this.refreshDerivedState(state);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, state.compile_output_pdf) || state.compile_output_pdf_expected || compileOutputPdfRelpath(state.compile_target);
    return state;
  }
  async listCandidateTexFiles() {
    const { listTexCandidates: listTexCandidates2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
    return listTexCandidates2(this.rootDir);
  }
  async normalizePayload(payload, baseState) {
    const base = baseState ?? await this.loadState();
    const normalized = structuredClone(base);
    const rawToggles = payload.toggles;
    if (rawToggles && typeof rawToggles === "object" && !Array.isArray(rawToggles)) {
      for (const key of TOGGLE_IDS) {
        if (key in rawToggles) {
          const value = rawToggles[key];
          if (typeof value === "boolean") normalized.toggles[key] = value;
          else if (typeof value === "string") {
            const parsed = boolFromTex(value);
            if (parsed === null) throw new Error(`Invalid boolean value for ${key}: ${value}`);
            normalized.toggles[key] = parsed;
          } else {
            throw new Error(`Invalid boolean type for ${key}`);
          }
        }
      }
    }
    const rawColors = payload.colors;
    if (rawColors && typeof rawColors === "object" && !Array.isArray(rawColors)) {
      for (const key of COLOR_ORDER) {
        if (key in rawColors) {
          const parsed = parseHexColor(String(rawColors[key]));
          if (!parsed) throw new Error(`Invalid hex color for ${key}: ${rawColors[key]}`);
          normalized.colors[key] = parsed;
        }
      }
    }
    if ("style_preset" in payload) {
      normalized.style_preset = this.normalizePreset(String(payload.style_preset ?? ""), normalized.style_presets);
      normalized.style_base_preset = this.styleDefinition(normalized.style_preset).base_preset_id ?? normalized.style_preset;
    } else if ("block_preset" in payload) {
      normalized.style_preset = this.styleIdFromBlockPreset(String(payload.block_preset ?? ""));
      normalized.style_base_preset = normalized.style_preset;
    } else if ("heading_toc_preset" in payload) {
      normalized.style_preset = this.styleIdFromHeadingPreset(String(payload.heading_toc_preset ?? ""));
      normalized.style_base_preset = normalized.style_preset;
    }
    if ("body_font_size_pt" in payload) normalized.body_font_size_pt = assertValidBodyFontSize(payload.body_font_size_pt);
    const rawClassConfig = payload.class_config;
    if (rawClassConfig && typeof rawClassConfig === "object" && !Array.isArray(rawClassConfig)) {
      for (const field of CLASS_CONFIG_IDS) {
        if (field in rawClassConfig) {
          normalized.class_config[field] = this.validateClassConfigValue(field, rawClassConfig[field]);
        }
      }
    }
    if ("compile_target" in payload) {
      normalized.compile_target = normalizeCompileTarget(this.rootDir, payload.compile_target, normalized.compile_targets);
    }
    if ("compile_recipe" in payload) {
      normalized.compile_recipe = this.normalizeCompileRecipe(payload.compile_recipe, normalized.compile_recipes);
    }
    if ("compile_use_internal_fallback" in payload) {
      const raw = payload.compile_use_internal_fallback;
      if (typeof raw === "boolean") normalized.compile_use_internal_fallback = raw;
      else if (typeof raw === "string") {
        const parsed = boolFromTex(raw);
        if (parsed === null) throw new Error(`Invalid boolean value for compile_use_internal_fallback: ${raw}`);
        normalized.compile_use_internal_fallback = parsed;
      } else {
        throw new Error("Invalid boolean type for compile_use_internal_fallback");
      }
    }
    await this.refreshDerivedState(normalized);
    return normalized;
  }
  async applyCompilePreferences(state, prefs) {
    const previousTarget = state.compile_target;
    if (prefs.compile_target !== void 0) state.compile_target = prefs.compile_target;
    if (prefs.compile_recipe !== void 0) state.compile_recipe = prefs.compile_recipe;
    if (prefs.compile_use_internal_fallback !== void 0) state.compile_use_internal_fallback = prefs.compile_use_internal_fallback;
    if (prefs.compile_target !== void 0 && prefs.compile_target !== previousTarget) {
      await this.coerceClassModeOnTargetSwitch(state);
    }
    await this.refreshDerivedState(state);
    state.compile_output_pdf = state.compile_output_pdf_expected || "main.pdf";
  }
  async applyCompileResult(state, success, pdfPath) {
    await this.refreshDerivedState(state);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, pdfPath) || state.compile_output_pdf_expected || "main.pdf";
    state.compile_last_compile_at = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
    state.compile_last_success = success;
  }
  async persistUiState(state) {
    const uiState = {
      toggles: state.toggles,
      colors: state.colors,
      style_preset: state.style_preset,
      style_base_preset: state.style_base_preset,
      // Keep legacy fields for older Toolkit versions reading this workspace cache.
      block_preset: this.styleDefinition(state.style_preset).block_source,
      heading_toc_preset: this.styleDefinition(state.style_preset).heading_source,
      body_font_size_pt: normalizeBodyFontSize(state.body_font_size_pt),
      class_config: this.normalizeClassConfigMap(state.class_config),
      compile_target: state.compile_target,
      compile_recipe: state.compile_recipe,
      compile_use_internal_fallback: state.compile_use_internal_fallback,
      compile_output_pdf: state.compile_output_pdf,
      compile_output_pdf_expected: state.compile_output_pdf_expected,
      compile_last_compile_at: state.compile_last_compile_at,
      compile_last_success: state.compile_last_success
    };
    await this.writeFileAtomic(this.configPath(), `${JSON.stringify(uiState, null, 2)}
`);
  }
  async writeOverrideFiles(state) {
    await this.prepareStateForWrite(state);
    await this.persistUiState(state);
    await this.writeToggleOverrideFile(state);
    await this.writeColorOverrideFile(state);
  }
  async writeColorState(state) {
    state.style_preset = this.normalizePreset(state.style_preset, state.style_presets);
    for (const token of COLOR_ORDER) {
      const parsed = parseHexColor(state.colors[token] ?? "");
      if (!parsed) throw new Error(`Invalid hex color for ${token}: ${String(state.colors[token])}`);
      state.colors[token] = parsed;
    }
    let uiState = {};
    try {
      const parsed = JSON.parse(await import_node_fs12.promises.readFile(this.configPath(), "utf8"));
      if (this.isRecord(parsed)) uiState = parsed;
    } catch (err) {
      if (err.code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
    }
    uiState.colors = { ...state.colors };
    uiState.style_preset = state.style_preset;
    uiState.style_base_preset = state.style_base_preset;
    uiState.block_preset = this.styleDefinition(state.style_preset).block_source;
    uiState.heading_toc_preset = this.styleDefinition(state.style_preset).heading_source;
    await this.writeFileAtomic(this.configPath(), `${JSON.stringify(uiState, null, 2)}
`);
    await this.writeColorOverrideFile(state);
    state.config_warnings = [];
  }
  async writeToggleOverrideFile(state) {
    const toggleLines = [
      "% Auto-generated by LaTeX Editing Toolkit VS Code extension",
      "% Delete this file to return to defaults in main.tex."
    ];
    for (const entry of TOGGLE_SCHEMA) {
      toggleLines.push(`\\${entry.command}${state.toggles[entry.id] ? "true" : "false"}`);
    }
    toggleLines.push("", "% Class-aware options for theme.sty and theorems.tex.");
    for (const field of CLASS_CONFIG_IDS) {
      toggleLines.push(`\\def\\${CLASS_CONFIG_COMMANDS[field]}{${state.class_config[field]}}`);
    }
    toggleLines.push("", "% Base body font size in pt.");
    toggleLines.push(`\\def\\ThemeBodyFontSizePt{${formatBodyFontSize(state.body_font_size_pt)}}`);
    await this.writeFileAtomic(this.toggleOverridePath(), `${toggleLines.join("\n")}
`);
  }
  async writeColorOverrideFile(state) {
    const colorLines = [
      "% Auto-generated by LaTeX Editing Toolkit VS Code extension",
      "% Delete this file to return to defaults in theme.sty."
    ];
    for (const token of COLOR_ORDER) {
      const alias = `themeui${token.replace(/[^A-Za-z0-9]+/g, "")}`;
      const hex = (state.colors[token] ?? "#808080").replace(/^#/, "").toUpperCase();
      colorLines.push(`\\definecolor{${alias}}{HTML}{${hex}}`);
      colorLines.push(`\\colorlet{${token}}{${alias}}`);
    }
    await this.writeFileAtomic(this.colorOverridePath(), `${colorLines.join("\n")}
`);
  }
  async prepareStateForWrite(state) {
    state.style_preset = this.normalizePreset(state.style_preset, state.style_presets);
    state.body_font_size_pt = normalizeBodyFontSize(state.body_font_size_pt);
    state.class_config = this.normalizeClassConfigMap(state.class_config);
    state.config_warnings = [];
    await this.refreshDerivedState(state);
  }
  async deleteOverrideFiles() {
    for (const file of [this.configPath(), this.toggleOverridePath(), this.colorOverridePath()]) {
      try {
        await import_node_fs12.promises.unlink(file);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
  }
  applyStylePreset(state, presetId) {
    const catalog = this.buildStylePresetCatalog();
    const selected = this.normalizePreset(presetId, this.presetMeta(catalog));
    const preset = catalog.find((item) => item.id === selected);
    if (!preset) throw new Error(`Unknown style preset: ${presetId}`);
    for (const token of COLOR_ORDER) {
      state.colors[token] = preset.colors[token] ?? "#808080";
    }
    state.style_preset = selected;
    state.style_base_preset = preset.base_preset_id ?? preset.id;
    state.style_presets = this.presetMeta(catalog);
  }
  // Compatibility helpers for callers using the pre-unified API.
  applyBlockPreset(state, presetId) {
    this.applyStylePreset(state, this.styleIdFromBlockPreset(presetId));
  }
  applyHeadingTocPreset(state, presetId) {
    this.applyStylePreset(state, this.styleIdFromHeadingPreset(presetId));
  }
  async starterTemplateMeta() {
    const templateDir = path13.join(this.rootDir, "templates");
    const assetTemplateDir = path13.resolve(__dirname, "..", "assets", "template", "templates");
    const out = [];
    for (const entry of STARTER_TEMPLATE_DEFINITIONS) {
      if (await exists(path13.join(templateDir, entry.filename)) || await exists(path13.join(assetTemplateDir, entry.filename))) {
        out.push({ id: entry.id, label: entry.label, description: entry.description });
      }
    }
    return out;
  }
  async templateSourcePath(filename) {
    const workspaceTemplate = path13.join(this.rootDir, "templates", filename);
    if (await exists(workspaceTemplate)) return workspaceTemplate;
    return path13.resolve(__dirname, "..", "assets", "template", "templates", filename);
  }
  async refreshDerivedState(state) {
    state.compile_recipe_name = state.compile_recipes.find((item) => item.id === state.compile_recipe)?.name ?? "";
    state.compile_output_pdf_expected = await this.expectedOutputPdfForSelection(state);
    const detected = await this.detectTargetDocumentClass(state.compile_target);
    const hasChapter = isChapterCapableClass(detected);
    const mode = this.normalizeClassConfigValue("theme_class_mode", state.class_config.theme_class_mode);
    state.detected_document_class = detected || "(unknown)";
    state.detected_document_class_has_chapter = hasChapter;
    state.effective_theme_class = mode === "book" || mode === "article" ? mode : hasChapter ? "book" : "article";
  }
  async expectedOutputPdfForSelection(state) {
    if (!state.compile_target) return "main.pdf";
    if (state.compile_use_internal_fallback || !state.compile_recipe) {
      return compileOutputPdfRelpath(state.compile_target);
    }
    try {
      const catalog = await loadRecipeCatalog(this.rootDir);
      const recipe = catalog.recipes.find((item) => item.id === state.compile_recipe);
      if (!recipe) return compileOutputPdfRelpath(state.compile_target);
      const targetAbs = path13.resolve(this.rootDir, state.compile_target);
      const targetDir = path13.dirname(targetAbs);
      const stem = path13.basename(targetAbs, ".tex");
      for (const toolName of recipe.tools) {
        const tool = catalog.tools[toolName];
        if (!tool) continue;
        const outdir = this.extractRecipeOutdir(tool.args);
        if (!outdir) continue;
        const normalizedOutdir = outdir === "%OUTDIR%" ? "." : outdir.replace(/%DOCFILE_NOEXT%/g, stem).replace(/%DOCFILE%/g, path13.basename(targetAbs)).replace(/%DOC%/g, targetAbs);
        const outAbs = path13.isAbsolute(normalizedOutdir) ? path13.resolve(normalizedOutdir) : path13.resolve(targetDir, normalizedOutdir);
        if (!isSubpath(outAbs, this.rootDir)) return compileOutputPdfRelpath(state.compile_target);
        return workspaceRel(this.rootDir, path13.join(outAbs, `${stem}.pdf`));
      }
    } catch {
      return compileOutputPdfRelpath(state.compile_target);
    }
    return compileOutputPdfRelpath(state.compile_target);
  }
  extractRecipeOutdir(args) {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg.startsWith("-outdir=")) return arg.slice("-outdir=".length);
      if (arg === "-outdir" && args[i + 1]) return args[i + 1];
      if (arg.startsWith("--output-directory=")) return arg.slice("--output-directory=".length);
      if (arg === "--output-directory" && args[i + 1]) return args[i + 1];
    }
    return null;
  }
  async detectTargetDocumentClass(targetRel) {
    if (!targetRel) return "";
    try {
      const abs = path13.resolve(this.rootDir, targetRel);
      return await extractDocumentclassName(abs, this.rootDir);
    } catch {
      return "";
    }
  }
  async parseMainToggleDefaults() {
    const defaults = {};
    let text = "";
    try {
      text = await import_node_fs12.promises.readFile(this.mainTexPath(), "utf8");
    } catch {
    }
    for (const entry of TOGGLE_SCHEMA) {
      const regex = new RegExp(`\\\\${entry.command}(true|false)`, "g");
      const matches = Array.from(text.matchAll(regex));
      if (matches.length > 0) {
        defaults[entry.id] = boolFromTex(matches.at(-1)?.[1] ?? "true") ?? true;
      } else {
        defaults[entry.id] = entry.default ?? true;
      }
    }
    return defaults;
  }
  async mergePersistedState(state) {
    let raw;
    try {
      const parsed = JSON.parse(await import_node_fs12.promises.readFile(this.configPath(), "utf8"));
      if (!this.isRecord(parsed)) {
        this.addWarning(state, "theme.ui.json must contain a JSON object; defaults were used.");
        return;
      }
      raw = parsed;
    } catch (err) {
      if (err.code !== "ENOENT") {
        this.addWarning(state, `Could not read theme.ui.json: ${err.message}`);
      }
      return;
    }
    if (this.isRecord(raw.toggles)) {
      for (const [key, value] of Object.entries(raw.toggles)) {
        if (!(key in state.toggles)) continue;
        if (typeof value === "boolean") state.toggles[key] = value;
        else if (typeof value === "string") {
          const parsed = boolFromTex(value);
          if (parsed === null) this.addWarning(state, `Ignored invalid toggle '${key}' in theme.ui.json.`);
          else state.toggles[key] = parsed;
        } else {
          this.addWarning(state, `Ignored invalid toggle '${key}' in theme.ui.json.`);
        }
      }
    } else if (raw.toggles !== void 0) {
      this.addWarning(state, "Ignored invalid toggles in theme.ui.json.");
    }
    if (this.isRecord(raw.colors)) {
      for (const [key, value] of Object.entries(raw.colors)) {
        if (!(key in state.colors)) continue;
        const parsed = parseHexColor(String(value));
        if (parsed) state.colors[key] = parsed;
        else this.addWarning(state, `Ignored invalid color '${key}' in theme.ui.json.`);
      }
    } else if (raw.colors !== void 0) {
      this.addWarning(state, "Ignored invalid colors in theme.ui.json.");
    }
    if (typeof raw.style_preset === "string") {
      try {
        state.style_preset = this.normalizePreset(raw.style_preset, state.style_presets);
        state.style_base_preset = this.styleDefinition(state.style_preset).base_preset_id ?? state.style_preset;
      } catch {
        const fallback = typeof raw.style_base_preset === "string" && this.isKnownBuiltInPreset(raw.style_base_preset) ? raw.style_base_preset : "default";
        state.style_preset = fallback;
        state.style_base_preset = fallback;
        this.addWarning(state, `Personal style '${raw.style_preset}' is unavailable; saved colors were preserved using '${fallback}' as the base.`);
      }
    } else if (raw.style_preset !== void 0) {
      this.addWarning(state, "Ignored invalid style_preset in theme.ui.json.");
    } else if (typeof raw.block_preset === "string") {
      if (this.isKnownBlockPreset(raw.block_preset)) {
        state.style_preset = this.styleIdFromBlockPreset(raw.block_preset);
        state.style_base_preset = state.style_preset;
      } else {
        this.addWarning(state, `Ignored unknown legacy block preset '${raw.block_preset}'.`);
      }
    }
    if ("body_font_size_pt" in raw) {
      try {
        state.body_font_size_pt = assertValidBodyFontSize(raw.body_font_size_pt);
      } catch {
        this.addWarning(state, "Ignored invalid body_font_size_pt in theme.ui.json.");
      }
    }
    if (this.isRecord(raw.class_config)) {
      for (const field of CLASS_CONFIG_IDS) {
        if (!(field in raw.class_config)) continue;
        try {
          state.class_config[field] = this.validateClassConfigValue(field, raw.class_config[field]);
        } catch {
          this.addWarning(state, `Ignored invalid class config '${field}'.`);
        }
      }
    } else if (raw.class_config !== void 0) {
      this.addWarning(state, "Ignored invalid class_config in theme.ui.json.");
    }
    if ("compile_target" in raw) {
      try {
        state.compile_target = normalizeCompileTarget(this.rootDir, raw.compile_target, state.compile_targets);
      } catch {
        this.addWarning(state, `Ignored unavailable compile target '${String(raw.compile_target)}'.`);
      }
    }
    if ("compile_recipe" in raw) {
      try {
        if (state.compile_recipes.length === 0 && String(raw.compile_recipe ?? "").trim()) {
          throw new Error("No compile recipes are available.");
        }
        state.compile_recipe = this.normalizeCompileRecipe(raw.compile_recipe, state.compile_recipes);
      } catch {
        this.addWarning(state, `Ignored unavailable compile recipe '${String(raw.compile_recipe)}'.`);
      }
    }
    if ("compile_use_internal_fallback" in raw) {
      const value = raw.compile_use_internal_fallback;
      const parsed = typeof value === "boolean" ? value : typeof value === "string" ? boolFromTex(value) : null;
      if (parsed === null) this.addWarning(state, "Ignored invalid compile_use_internal_fallback in theme.ui.json.");
      else state.compile_use_internal_fallback = parsed;
    }
    if (typeof raw.compile_output_pdf === "string") state.compile_output_pdf = raw.compile_output_pdf;
    else if (raw.compile_output_pdf !== void 0) this.addWarning(state, "Ignored invalid compile_output_pdf in theme.ui.json.");
    if (typeof raw.compile_output_pdf_expected === "string") state.compile_output_pdf_expected = raw.compile_output_pdf_expected;
    else if (raw.compile_output_pdf_expected !== void 0) this.addWarning(state, "Ignored invalid compile_output_pdf_expected in theme.ui.json.");
    if (typeof raw.compile_last_compile_at === "string") state.compile_last_compile_at = raw.compile_last_compile_at;
    else if (raw.compile_last_compile_at !== void 0) this.addWarning(state, "Ignored invalid compile_last_compile_at in theme.ui.json.");
    if (typeof raw.compile_last_success === "boolean" || raw.compile_last_success === null) state.compile_last_success = raw.compile_last_success;
    else if (raw.compile_last_success !== void 0) this.addWarning(state, "Ignored invalid compile_last_success in theme.ui.json.");
  }
  async mergeOverrideFiles(state) {
    try {
      const text = await import_node_fs12.promises.readFile(this.toggleOverridePath(), "utf8");
      for (const entry of TOGGLE_SCHEMA) {
        const matches = Array.from(text.matchAll(new RegExp(`\\\\${entry.command}(true|false)`, "g")));
        if (matches.length > 0) state.toggles[entry.id] = boolFromTex(matches.at(-1)?.[1] ?? "") ?? state.toggles[entry.id];
      }
      for (const field of CLASS_CONFIG_IDS) {
        const command = CLASS_CONFIG_COMMANDS[field];
        const matches = Array.from(text.matchAll(new RegExp(`\\\\def\\\\${command}\\{([^}]+)\\}`, "g")));
        if (matches.length > 0) {
          try {
            state.class_config[field] = this.validateClassConfigValue(field, matches.at(-1)?.[1]);
          } catch {
            this.addWarning(state, `Ignored invalid class config '${field}' in theme.overrides.tex.`);
          }
        }
      }
      const fontMatch = Array.from(text.matchAll(/\\def\\ThemeBodyFontSizePt\{([^}]+)\}/g));
      if (fontMatch.length > 0) {
        try {
          state.body_font_size_pt = assertValidBodyFontSize(fontMatch.at(-1)?.[1]);
        } catch {
          this.addWarning(state, "Ignored invalid body font size in theme.overrides.tex.");
        }
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        this.addWarning(state, `Could not read theme.overrides.tex: ${err.message}`);
      }
    }
    try {
      const text = await import_node_fs12.promises.readFile(this.colorOverridePath(), "utf8");
      const defines = /* @__PURE__ */ new Map();
      for (const match of text.matchAll(/\\definecolor\{([^}]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
        defines.set(match[1], `#${match[2].toUpperCase()}`);
      }
      for (const match of text.matchAll(/\\colorlet\{([^}]+)\}\{([^}]+)\}/g)) {
        const token = match[1];
        const mapped = match[2];
        if (!COLOR_SET.has(token)) continue;
        const defined = defines.get(mapped);
        const parsed = defined ?? parseHexColor(mapped);
        if (parsed) state.colors[token] = parsed;
        else this.addWarning(state, `Ignored invalid color mapping for '${token}' in theme.colors.tex.`);
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        this.addWarning(state, `Could not read theme.colors.tex: ${err.message}`);
      }
    }
  }
  finishNormalization(state) {
    for (const key of TOGGLE_IDS) state.toggles[key] = Boolean(state.toggles[key]);
    for (const key of COLOR_ORDER) state.colors[key] = parseHexColor(state.colors[key] ?? "") ?? "#808080";
    state.class_config = this.normalizeClassConfigMap(state.class_config);
    state.body_font_size_pt = normalizeBodyFontSize(state.body_font_size_pt);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, state.compile_output_pdf) || state.compile_output_pdf_expected || compileOutputPdfRelpath(state.compile_target);
  }
  buildStylePresetCatalog() {
    return this.allStylePresetDefinitions().map((definition) => ({
      ...definition,
      colors: { ...definition.colors }
    }));
  }
  stylePresetSchema() {
    return this.allStylePresetDefinitions().map(({ id, label, description, colors, source, base_preset_id, editable }) => ({
      id,
      label,
      description,
      colors: { ...colors },
      source: source ?? "builtin",
      base_preset_id: base_preset_id ?? id,
      editable: editable ?? false
    }));
  }
  addWarning(state, message) {
    if (!state.config_warnings.includes(message)) state.config_warnings.push(message);
  }
  isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  isKnownBlockPreset(raw) {
    const value = raw.trim();
    return STYLE_PRESET_DEFINITIONS.some((preset) => preset.id === value || preset.block_source === value);
  }
  isKnownBuiltInPreset(raw) {
    return STYLE_PRESET_DEFINITIONS.some((preset) => preset.id === raw.trim());
  }
  allStylePresetDefinitions() {
    return [
      ...STYLE_PRESET_DEFINITIONS.map((preset) => ({ ...preset, source: "builtin", base_preset_id: preset.id, editable: false })),
      ...this.additionalStylePresets
    ];
  }
  async writeFileAtomic(targetPath, text) {
    const tempPath = `${targetPath}.tmp-${process.pid}-${(0, import_node_crypto4.randomUUID)()}`;
    await import_node_fs12.promises.mkdir(path13.dirname(targetPath), { recursive: true });
    try {
      await import_node_fs12.promises.writeFile(tempPath, text, "utf8");
      await import_node_fs12.promises.rename(tempPath, targetPath);
    } catch (err) {
      await import_node_fs12.promises.unlink(tempPath).catch(() => void 0);
      throw err;
    }
  }
  styleDefinition(styleId) {
    return this.allStylePresetDefinitions().find((item) => item.id === styleId) ?? STYLE_PRESET_DEFINITIONS[0];
  }
  styleIdFromBlockPreset(presetId) {
    const normalized = presetId.trim();
    return STYLE_PRESET_DEFINITIONS.find((item) => item.id === normalized || item.block_source === normalized)?.id ?? "default";
  }
  styleIdFromHeadingPreset(presetId) {
    const normalized = presetId.trim();
    return STYLE_PRESET_DEFINITIONS.find((item) => item.id === normalized || item.heading_source === normalized)?.id ?? "default";
  }
  presetMeta(catalog) {
    return catalog.map(({ id, label, description }) => ({ id, label, description }));
  }
  defaultPresetId(catalog) {
    return catalog.some((item) => item.id === "default") ? "default" : catalog[0]?.id ?? "";
  }
  normalizePreset(raw, presets) {
    const value = raw.trim();
    const ids = new Set(presets.map((item) => item.id));
    if (!value) return ids.has("default") ? "default" : presets[0]?.id ?? "";
    if (ids.has(value)) return value;
    throw new Error(`Unknown preset: ${value}`);
  }
  normalizeClassConfigValue(field, raw) {
    const parsed = String(raw ?? "").trim().toLowerCase();
    const valid = CLASS_CONFIG_VALID_OPTIONS[field];
    if (valid?.has(parsed)) return parsed;
    return CLASS_CONFIG_DEFAULTS[field] ?? "auto";
  }
  validateClassConfigValue(field, raw) {
    const parsed = String(raw ?? "").trim().toLowerCase();
    const valid = CLASS_CONFIG_VALID_OPTIONS[field];
    if (valid?.has(parsed)) return parsed;
    throw new Error(`Invalid value for ${field}: ${String(raw)}.`);
  }
  normalizeClassConfigMap(raw) {
    const config = { ...CLASS_CONFIG_DEFAULTS };
    for (const field of CLASS_CONFIG_IDS) {
      if (field in raw) config[field] = this.normalizeClassConfigValue(field, raw[field]);
    }
    return config;
  }
  normalizeCompileRecipe(raw, recipes) {
    if (recipes.length === 0) return "";
    const value = String(raw ?? "").trim();
    if (!value) return recipes[0]?.id ?? "";
    if (recipes.some((item) => item.id === value)) return value;
    throw new Error(`Unknown compile recipe: ${value}`);
  }
  async coerceClassModeOnTargetSwitch(state) {
    const mode = this.normalizeClassConfigValue("theme_class_mode", state.class_config.theme_class_mode);
    if (mode !== "book" && mode !== "article") return;
    const detected = await this.detectTargetDocumentClass(state.compile_target);
    if (!detected) return;
    const hasChapter = isChapterCapableClass(detected);
    if (mode === "book" && !hasChapter || mode === "article" && hasChapter) {
      state.class_config.theme_class_mode = "auto";
    }
  }
};
async function copyDirectory(src, dest) {
  await import_node_fs12.promises.mkdir(dest, { recursive: true });
  for (const entry of await import_node_fs12.promises.readdir(src, { withFileTypes: true })) {
    const srcPath = path13.join(src, entry.name);
    const destPath = path13.join(dest, entry.name);
    if (entry.isDirectory()) await copyDirectory(srcPath, destPath);
    else if (entry.isFile()) await import_node_fs12.promises.copyFile(srcPath, destPath);
  }
}
async function copyMissingDirectory(src, dest, relLabel, copied) {
  if (!await exists(dest)) {
    await copyDirectory(src, dest);
    copied.push(`${relLabel}/`);
    return;
  }
  for (const entry of await import_node_fs12.promises.readdir(src, { withFileTypes: true })) {
    const source = path13.join(src, entry.name);
    const target = path13.join(dest, entry.name);
    if (await exists(target)) continue;
    if (entry.isDirectory()) {
      await copyDirectory(source, target);
      copied.push(`${relLabel}/${entry.name}/`);
    } else if (entry.isFile()) {
      await import_node_fs12.promises.copyFile(source, target);
      copied.push(`${relLabel}/${entry.name}`);
    }
  }
}
async function ensureWorkspaceTemplateAssets(rootDir, extensionDir) {
  const assetRoot = path13.join(extensionDir, "assets", "template");
  const copied = [];
  const files = ["theme.sty", "theorems.tex", "commands.tex", "references.bib"];
  for (const file of files) {
    const target = path13.join(rootDir, file);
    if (!await exists(target)) {
      await import_node_fs12.promises.copyFile(path13.join(assetRoot, file), target);
      copied.push(file);
    }
  }
  await copyMissingDirectory(path13.join(assetRoot, "Fig"), path13.join(rootDir, "Fig"), "Fig", copied);
  await copyMissingDirectory(path13.join(assetRoot, "templates"), path13.join(rootDir, "templates"), "templates", copied);
  return copied.map((item) => item.endsWith("/") ? item : workspaceRel(rootDir, path13.join(rootDir, item)));
}

// src/template.ts
var import_node_crypto5 = require("node:crypto");
var import_node_fs13 = require("node:fs");
var path14 = __toESM(require("node:path"));
init_schema();
init_utils();
var UPGRADE_THEME_ASSET_FILES = ["theme.sty", "theorems.tex", "commands.tex"];
var COLOR_OVERRIDE_FILES = ["theme.colors.tex", "theme.ui.json"];
var TemplateService = class {
  constructor(rootDir, extensionDir, stateService) {
    this.rootDir = rootDir;
    this.extensionDir = extensionDir;
    this.stateService = stateService;
  }
  rootDir;
  extensionDir;
  stateService;
  async initializeWorkspace() {
    const copied = await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir);
    const vscodeSettings = await generateVscodeSettingsIfMissing(this.rootDir);
    return { copied, vscode_settings: vscodeSettings };
  }
  async upgradeThemeAssets(options = { colorPolicy: "preserve" }) {
    const colorPolicy = options.colorPolicy ?? "preserve";
    if (colorPolicy !== "preserve" && colorPolicy !== "default") {
      throw new Error(`Unknown upgrade color policy: ${String(colorPolicy)}`);
    }
    const assetRoot = path14.join(this.extensionDir, "assets", "template");
    const backupDir = path14.join(this.rootDir, ".latex-editing-toolkit", "backups", this.timestamp());
    const upgradedFiles = [];
    const updatedOverrideFiles = [];
    const skippedMissingFiles = [];
    const assetReplacements = [];
    for (const file of UPGRADE_THEME_ASSET_FILES) {
      const source = path14.join(assetRoot, file);
      const target = path14.join(this.rootDir, file);
      this.assertInsideWorkspace(target);
      if (!await exists(source)) {
        skippedMissingFiles.push(file);
        continue;
      }
      assetReplacements.push({ file, source, target });
    }
    const state = colorPolicy === "default" ? await this.stateService.loadState() : void 0;
    const targets = assetReplacements.map((item) => item.target);
    if (colorPolicy === "default") {
      targets.push(...COLOR_OVERRIDE_FILES.map((file) => path14.join(this.rootDir, file)));
    }
    const existedBefore = /* @__PURE__ */ new Map();
    await import_node_fs13.promises.mkdir(backupDir, { recursive: true });
    for (const target of targets) {
      this.assertInsideWorkspace(target);
      const existed = await exists(target);
      existedBefore.set(target, existed);
      if (existed) await this.backupFile(target, backupDir);
    }
    try {
      for (const { file, source, target } of assetReplacements) {
        await this.replaceFileAtomic(source, target);
        upgradedFiles.push(file);
      }
      if (colorPolicy === "default" && state) {
        this.stateService.applyStylePreset(state, "default");
        await this.stateService.writeColorState(state);
        updatedOverrideFiles.push(...COLOR_OVERRIDE_FILES);
      }
    } catch (err) {
      const rollbackErrors = await this.rollbackTargets(targets, existedBefore, backupDir);
      const suffix = rollbackErrors.length > 0 ? ` Rollback errors: ${rollbackErrors.join("; ")}` : "";
      throw new Error(`Theme asset upgrade failed: ${err.message}.${suffix}`, { cause: err });
    }
    return {
      success: true,
      backup_dir: workspaceRel(this.rootDir, backupDir),
      upgraded_files: upgradedFiles,
      color_policy: colorPolicy,
      updated_override_files: updatedOverrideFiles,
      reset_files: [...updatedOverrideFiles],
      skipped_missing_files: skippedMissingFiles
    };
  }
  async createStarter(templateId, outputTarget, overwrite) {
    await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir);
    const normalizedTarget = this.normalizeOutputTarget(outputTarget);
    const template = STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === String(templateId || "").trim()) ?? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === "book-minimal") ?? STARTER_TEMPLATE_DEFINITIONS[0];
    if (!template) throw new Error("No starter templates available.");
    const targetAbs = path14.resolve(this.rootDir, normalizedTarget);
    const existed = await exists(targetAbs);
    if (existed) {
      const stat = await import_node_fs13.promises.stat(targetAbs);
      if (stat.isDirectory()) throw new Error(`Output target is a directory: ${normalizedTarget}`);
      if (!overwrite) throw new Error(`Output target already exists: ${normalizedTarget}. Set overwrite=true to replace it.`);
    }
    const source = await this.stateService.templateSourcePath(template.filename);
    const text = await import_node_fs13.promises.readFile(source, "utf8");
    if (!extractDocumentclassDeclaration(text)) throw new Error(`Starter template is missing a valid \\documentclass declaration: ${template.filename}`);
    await import_node_fs13.promises.mkdir(path14.dirname(targetAbs), { recursive: true });
    await import_node_fs13.promises.writeFile(targetAbs, text, "utf8");
    const state = await this.stateService.loadState();
    state.compile_targets = await this.stateService.listCandidateTexFiles();
    state.compile_target = normalizeCompileTarget(this.rootDir, normalizedTarget, state.compile_targets);
    await this.stateService.applyCompilePreferences(state, { compile_target: state.compile_target });
    await this.stateService.persistUiState(state);
    return {
      response: await this.stateService.buildResponseState(),
      generated_target: workspaceRel(this.rootDir, targetAbs),
      overwrote_existing: existed
    };
  }
  normalizeOutputTarget(raw) {
    let target = String(raw ?? "").trim() || "main.tex";
    target = toPosixPath(target);
    if (path14.isAbsolute(target)) throw new Error("Output target must be workspace-relative.");
    if (!path14.extname(target)) target += ".tex";
    if (path14.extname(target).toLowerCase() !== ".tex") throw new Error("Output target must end with .tex.");
    const resolved = path14.resolve(this.rootDir, target);
    if (!isSubpath(resolved, this.rootDir)) throw new Error("Output target is outside workspace.");
    return workspaceRel(this.rootDir, resolved);
  }
  async backupFile(source, backupDir) {
    this.assertInsideWorkspace(source);
    const rel = workspaceRel(this.rootDir, source);
    const backupPath = path14.join(backupDir, rel);
    this.assertInsideWorkspace(backupPath);
    await import_node_fs13.promises.mkdir(path14.dirname(backupPath), { recursive: true });
    await import_node_fs13.promises.copyFile(source, backupPath);
  }
  async replaceFileAtomic(source, target) {
    const tempPath = `${target}.tmp-${process.pid}-${(0, import_node_crypto5.randomUUID)()}`;
    this.assertInsideWorkspace(target);
    this.assertInsideWorkspace(tempPath);
    await import_node_fs13.promises.mkdir(path14.dirname(target), { recursive: true });
    try {
      await import_node_fs13.promises.copyFile(source, tempPath);
      await import_node_fs13.promises.rename(tempPath, target);
    } catch (err) {
      await import_node_fs13.promises.unlink(tempPath).catch(() => void 0);
      throw err;
    }
  }
  async rollbackTargets(targets, existedBefore, backupDir) {
    const errors = [];
    for (const target of [...targets].reverse()) {
      try {
        if (existedBefore.get(target)) {
          const backupPath = path14.join(backupDir, workspaceRel(this.rootDir, target));
          await this.replaceFileAtomic(backupPath, target);
        } else {
          await import_node_fs13.promises.unlink(target).catch((err) => {
            if (err.code !== "ENOENT") throw err;
          });
        }
      } catch (err) {
        errors.push(`${workspaceRel(this.rootDir, target)}: ${err.message}`);
      }
    }
    return errors;
  }
  assertInsideWorkspace(absPath) {
    if (!isSubpath(path14.resolve(absPath), this.rootDir)) throw new Error("Theme asset path is outside workspace.");
  }
  timestamp() {
    return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(".", "-");
  }
};

// src/toolkitService.ts
init_utils();
var ToolkitService = class {
  constructor(rootDir, extensionDir, options = {}) {
    this.rootDir = rootDir;
    this.extensionDir = extensionDir;
    this.state = new StateService(rootDir, options.additionalStylePresets ?? []);
    this.compile = new CompileService(rootDir, this.state);
    this.cleanup = new CleanupService(rootDir);
    this.splitter = new SplitterService(rootDir, this.state);
    this.template = new TemplateService(rootDir, extensionDir, this.state);
    this.history = new ChangeHistoryService(rootDir, options.historyStorageDir, this.state);
  }
  rootDir;
  extensionDir;
  state;
  compile;
  cleanup;
  splitter;
  template;
  history;
  queue = Promise.resolve();
  setAdditionalStylePresets(presets) {
    this.state.setAdditionalStylePresets(presets);
  }
  async handle(command, payload = {}) {
    switch (command) {
      case "state":
        return this.responseWithHistory(await this.state.buildResponseState());
      case "history-state":
        return this.history.historyState();
      case "undo-last-change":
        return this.runSerialized(async () => {
          await this.history.undo(Boolean(payload.force));
          return this.responseWithHistory(await this.state.buildResponseState());
        });
      case "redo-last-change":
        return this.runSerialized(async () => {
          await this.history.redo(Boolean(payload.force));
          return this.responseWithHistory(await this.state.buildResponseState());
        });
      case "autosave":
      case "save":
        return this.runSerialized(async () => {
          const rawState = command === "autosave" && isRecord3(payload.state) ? payload.state : payload;
          const result = await this.history.runStateChange(command, "Edit Toolkit settings", async () => {
            const current = await this.state.loadState();
            const normalized = await this.state.normalizePayload(rawState, current);
            if (normalized.compile_target !== current.compile_target) await this.state.coerceClassModeOnTargetSwitch(normalized);
            await this.state.writeOverrideFiles(normalized);
            return this.state.buildResponseState();
          }, payload.record_history !== false);
          return { ...await this.responseWithHistory(result), revision: Number(payload.revision ?? 0) };
        });
      case "target":
        return this.runStateMutation(command, "Change compile target", payload, async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, { compile_target: normalized.compile_target });
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "compile-config":
        return this.runStateMutation(command, "Change compile recipe", payload, async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, {
            compile_recipe: normalized.compile_recipe,
            compile_use_internal_fallback: normalized.compile_use_internal_fallback
          });
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "template-bootstrap":
        return this.runSerialized(async () => {
          const output = this.template.normalizeOutputTarget(payload.output_target);
          const paths = [...this.workspaceAssetPaths(), output, "theme.ui.json", ".vscode/settings.json"];
          const result = await this.history.runFileChange(command, "Generate starter", paths, async () => {
            const created = await this.template.createStarter(payload.template_id, payload.output_target, Boolean(payload.overwrite));
            return { ...created.response, generated_target: created.generated_target, overwrote_existing: created.overwrote_existing };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "vscode-settings-generate":
        return this.runFileMutation(command, "Generate VS Code settings", [".vscode", ".vscode/settings.json"], payload, async () => {
          const generated = await generateVscodeSettingsIfMissing(this.rootDir);
          return { ...await this.state.buildResponseState(), ...generated };
        });
      case "split-preview": {
        return this.runSerialized(async () => {
          const result = await this.splitter.splitCompileTarget(String(payload.compile_target ?? ""), true, String(payload.sections_dir ?? "Sections"));
          return { ...result.response, split: result.split };
        });
      }
      case "split":
        return this.runSerialized(async () => {
          if (Boolean(payload.dry_run)) {
            const result2 = await this.splitter.splitCompileTarget(String(payload.compile_target ?? ""), true, String(payload.sections_dir ?? "Sections"));
            return { ...result2.response, split: result2.split };
          }
          const target = String(payload.compile_target ?? "");
          const preview = await this.splitter.splitCompileTarget(target, true, String(payload.sections_dir ?? "Sections"));
          const backup = await this.nextSplitBackupPath(path15.resolve(this.rootDir, target));
          const generated = preview.split.generated_subfile_targets;
          const paths = [target, backup, ...generated, ...new Set(generated.map((item) => path15.dirname(item)))];
          const result = await this.history.runFileChange(command, "Split LaTeX target", paths, async () => {
            const changed = await this.splitter.splitCompileTarget(target, false, String(payload.sections_dir ?? "Sections"));
            return { ...changed.response, split: changed.split };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "renumber":
        return this.runSerialized(async () => {
          if (Boolean(payload.dry_run)) {
            const result2 = await this.splitter.renumberCompileTarget(String(payload.compile_target ?? ""), String(payload.mode ?? "add"), true);
            return { ...result2.response, renumber: result2.renumber };
          }
          const target = String(payload.compile_target ?? "");
          const mode = String(payload.mode ?? "add");
          const preview = await this.splitter.renumberCompileTarget(target, mode, true);
          const paths = [target, ...Object.keys(preview.renumber.renamed), ...Object.values(preview.renumber.renamed)];
          const result = await this.history.runFileChange(command, "Renumber LaTeX units", paths, async () => {
            const changed = await this.splitter.renumberCompileTarget(target, mode, false);
            return { ...changed.response, renumber: changed.renumber };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "unsplit":
        return this.runSerialized(async () => {
          if (Boolean(payload.dry_run)) {
            const result2 = await this.splitter.unsplitCompileTarget(String(payload.compile_target ?? ""), true, payload.delete_source !== false);
            return { ...result2.response, unsplit: result2.unsplit };
          }
          const target = String(payload.compile_target ?? "");
          const preview = await this.splitter.unsplitCompileTarget(target, true, payload.delete_source !== false);
          const paths = [preview.unsplit.root_target, preview.unsplit.source_target];
          const result = await this.history.runFileChange(command, "Merge LaTeX unit", paths, async () => {
            const changed = await this.splitter.unsplitCompileTarget(target, false, payload.delete_source !== false);
            return { ...changed.response, unsplit: changed.unsplit };
          }, payload.record_history !== false);
          return this.responseWithHistory(result);
        });
      case "style-preset":
        return this.runPresetMutation(command, "Change style", String(payload.style_preset ?? ""), payload, (state, preset) => this.state.applyStylePreset(state, preset));
      case "block-preset":
        return this.runPresetMutation(command, "Change style", String(payload.block_preset ?? ""), payload, (state, preset) => this.state.applyBlockPreset(state, preset));
      case "heading-toc-preset":
        return this.runPresetMutation(command, "Change style", String(payload.heading_toc_preset ?? ""), payload, (state, preset) => this.state.applyHeadingTocPreset(state, preset));
      case "reset":
        return this.runFileMutation(command, "Reset Toolkit overrides", ["theme.ui.json", "theme.overrides.tex", "theme.colors.tex"], payload, async () => {
          await this.state.deleteOverrideFiles();
          return this.state.buildResponseState();
        });
      case "clean":
        return this.runSerialized(async () => this.cleanup.clean(Boolean(payload.dry_run)));
      case "compile":
        return this.runSerialized(async () => this.compile.compileFromPayload(payload));
      case "initialize-workspace":
        return this.runFileMutation(command, "Initialize Toolkit workspace", [...this.workspaceAssetPaths(), ".vscode", ".vscode/settings.json"], payload, () => this.template.initializeWorkspace());
      case "upgrade-theme-assets":
        return this.runFileMutation(command, "Upgrade theme assets", ["theme.sty", "theorems.tex", "commands.tex", "theme.colors.tex", "theme.ui.json"], payload, async () => {
          const explicitPolicy = payload.color_policy;
          const colorPolicy = explicitPolicy === "default" || explicitPolicy === "preserve" ? explicitPolicy : payload.reset_color_overrides === true ? "default" : "preserve";
          return this.template.upgradeThemeAssets({ colorPolicy });
        });
      default:
        throw new Error(`Unknown toolkit command: ${command}`);
    }
  }
  resolvePdfPath(rawPath) {
    const rel = rawPath.trim() || "main.pdf";
    const resolved = path15.resolve(this.rootDir, rel);
    if (!resolved.endsWith(".pdf")) throw new Error("PDF path must end with .pdf.");
    if (!resolved.startsWith(path15.resolve(this.rootDir) + path15.sep) && resolved !== path15.resolve(this.rootDir)) throw new Error("PDF path is outside workspace.");
    return resolved;
  }
  async readPdfIfExists(rawPath) {
    const pdf = this.resolvePdfPath(rawPath);
    await import_node_fs14.promises.access(pdf);
    return pdf;
  }
  async runStateMutation(command, label, payload, task) {
    return this.runSerialized(async () => this.responseWithHistory(await this.history.runStateChange(command, label, task, payload.record_history !== false)));
  }
  async runFileMutation(command, label, paths, payload, task) {
    return this.runSerialized(async () => this.responseWithHistory(await this.history.runFileChange(command, label, paths, task, payload.record_history !== false)));
  }
  async runPresetMutation(command, label, preset, payload, apply) {
    return this.runStateMutation(command, label, payload, async () => {
      const current = await this.state.loadState();
      apply(current, preset || current.style_preset);
      await this.state.writeOverrideFiles(current);
      return this.state.buildResponseState();
    });
  }
  async responseWithHistory(value) {
    const history = await this.history.historyState();
    if (isRecord3(value)) return { ...value, history };
    return { value, history };
  }
  workspaceAssetPaths() {
    return [
      "theme.sty",
      "theorems.tex",
      "commands.tex",
      "references.bib",
      "Fig",
      "Fig/cover.png",
      "templates",
      "templates/book-minimal.tex",
      "templates/article-minimal.tex",
      "templates/homework-assignment.tex"
    ];
  }
  async nextSplitBackupPath(rootAbs) {
    let candidate = `${rootAbs}.bak`;
    let index = 1;
    while (await exists(candidate)) {
      candidate = `${rootAbs}.bak.${index}`;
      index += 1;
    }
    return candidate;
  }
  runSerialized(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => void 0);
    return next;
  }
};
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/extension.ts
var activePanel;
var toolkitServices = /* @__PURE__ */ new Map();
var personalStyles;
function activate(context) {
  const output = vscode7.window.createOutputChannel("LaTeX Editing Toolkit");
  const projectRegistry = new LocalProjectRegistry(context.globalState);
  personalStyles = new PersonalStyleRegistry(context.globalState);
  const treeProvider = new ToolkitTreeProvider(context, projectRegistry);
  const command = (id, handler) => registerToolkitCommand(output, id, handler);
  registerSnippetHost(context, output);
  void warnAboutLegacySnips(context, output);
  context.subscriptions.push(
    output,
    treeProvider,
    vscode7.window.registerTreeDataProvider("latexEditingToolkit.actions", treeProvider),
    vscode7.workspace.onDidChangeWorkspaceFolders(() => treeProvider.refresh()),
    vscode7.window.onDidChangeWindowState((state) => {
      if (state.focused) treeProvider.refresh();
    }),
    command("latexEditingToolkit.openToolkit", async (folderUri) => {
      const folder = await selectWorkspaceFolder(folderUri);
      if (!folder) return;
      activePanel = ToolkitPanel.createOrShow(context, folder, output, personalStyles, () => treeProvider.refresh());
    }),
    command("hsnips.openSnippetManager", async (folderUri) => {
      const folder = folderUri instanceof vscode7.Uri ? vscode7.workspace.getWorkspaceFolder(folderUri) : vscode7.window.activeTextEditor ? vscode7.workspace.getWorkspaceFolder(vscode7.window.activeTextEditor.document.uri) : vscode7.workspace.workspaceFolders?.[0];
      activePanel = ToolkitPanel.createOrShow(context, folder, output, personalStyles, () => treeProvider.refresh());
      await activePanel.openSection("snippets");
    }),
    command("latexEditingToolkit.createProject", async () => {
      await createProjectWizard(context, projectRegistry, treeProvider, output);
    }),
    command("latexEditingToolkit.openLocalProject", async (projectPath) => {
      await openLocalProject(projectPath);
    }),
    command("latexEditingToolkit.relocateLocalProject", async (projectPath) => {
      await relocateLocalProject(projectRegistry, treeProvider, projectPath);
    }),
    command("latexEditingToolkit.removeLocalProject", async (projectPath) => {
      await removeLocalProject(projectRegistry, treeProvider, projectPath);
    }),
    command("latexEditingToolkit.refreshTree", () => {
      treeProvider.refresh();
    }),
    command("latexEditingToolkit.undoLastChange", async (folderUri) => {
      await restoreLastToolkitChange(context, treeProvider, output, "undo", folderUri);
    }),
    command("latexEditingToolkit.redoLastChange", async (folderUri) => {
      await restoreLastToolkitChange(context, treeProvider, output, "redo", folderUri);
    }),
    command("latexEditingToolkit.createStarterInWorkspace", async (folderUri) => {
      await createStarterInWorkspace(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickCompileTarget", async (folderUri) => {
      await pickCompileTarget(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickCompileRecipe", async (folderUri) => {
      await pickCompileRecipe(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.toggleInternalFallback", async (folderUri) => {
      await toggleInternalFallback(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.openCurrentPdf", async (folderUri) => {
      await openCurrentPdf(context, folderUri);
    }),
    command("latexEditingToolkit.toggleThemeOption", async (folderUri, toggleId) => {
      await toggleThemeOption(context, treeProvider, folderUri, toggleId);
    }),
    command("latexEditingToolkit.pickClassConfig", async (folderUri, fieldId) => {
      await pickClassConfig(context, treeProvider, folderUri, fieldId);
    }),
    command("latexEditingToolkit.pickStylePreset", async (folderUri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    // Legacy command aliases now use the unified style preset.
    command("latexEditingToolkit.pickBlockPreset", async (folderUri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickHeadingTocPreset", async (folderUri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.pickBodyFontSize", async (folderUri) => {
      await pickBodyFontSize(context, treeProvider, folderUri);
    }),
    command("latexEditingToolkit.initializeWorkspace", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("initialize-workspace", {});
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage(`Initialized LaTeX Toolkit workspace: ${JSON.stringify(result)}`, 3e3);
    }),
    command("latexEditingToolkit.upgradeWorkspaceThemeAssets", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const choice = await vscode7.window.showWarningMessage(
        "Upgrade bundled theme assets? Existing files are backed up first. Preserve Colors keeps all current settings; Reset to Default only replaces the complete color/style package.",
        { modal: true },
        "Preserve Colors",
        "Reset to Default"
      );
      if (!choice) return;
      const result = await vscode7.window.withProgress(
        { location: vscode7.ProgressLocation.Notification, title: "Upgrading LaTeX Toolkit theme assets" },
        () => service.handle("upgrade-theme-assets", { color_policy: choice === "Reset to Default" ? "default" : "preserve" })
      );
      const resetSuffix = result.updated_override_files?.length ? ` Updated ${result.updated_override_files.length} color state file(s).` : " Colors preserved.";
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage(`Upgraded ${result.upgraded_files?.length ?? 0} theme asset(s).${resetSuffix}`, 3e3);
    }),
    command("latexEditingToolkit.generateVscodeSettings", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("vscode-settings-generate", {});
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage(result.message ?? "VS Code settings checked.", 2500);
    }),
    command("latexEditingToolkit.saveOverrides", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      await service.handle("save", response.state);
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage("Saved LaTeX Toolkit overrides.", 2e3);
    }),
    command("latexEditingToolkit.resetOverrides", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode7.window.showWarningMessage(
        "Reset all Toolkit overrides? This deletes theme.ui.json, theme.overrides.tex, and theme.colors.tex, including theme, compile, class, toggle, and status settings.",
        { modal: true },
        "Reset All"
      );
      if (ok !== "Reset All") return;
      await service.handle("reset", {});
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage("Reset all LaTeX Toolkit override files.", 2500);
    }),
    command("latexEditingToolkit.compilePdf", async (folderUri) => {
      const scoped = await folderAndServiceForCommand(context, folderUri);
      if (!scoped) return;
      const response = await scoped.service.handle("state", {});
      const result = await vscode7.window.withProgress({ location: vscode7.ProgressLocation.Notification, title: "Compiling LaTeX PDF" }, () => scoped.service.handle("compile", response.state));
      logCompileResult(output, scoped.folder.uri.fsPath, result);
      const success = Boolean(result.success);
      treeProvider.refresh();
      if (success) vscode7.window.setStatusBarMessage("LaTeX compile succeeded.", 2500);
      else {
        const action = await vscode7.window.showErrorMessage("LaTeX compile failed. The complete log is available in LaTeX Editing Toolkit output.", "Show Log");
        if (action === "Show Log") output.show(true);
      }
    }),
    command("latexEditingToolkit.cleanArtifacts", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode7.window.showWarningMessage("Clean LaTeX build artifacts in the workspace?", { modal: true }, "Clean");
      if (ok !== "Clean") return;
      const result = await service.handle("clean", {});
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage(`Cleaned ${result.deleted_count ?? 0} file(s).${result.errors?.length ? " Some errors occurred." : ""}`, 2500);
    }),
    command("latexEditingToolkit.splitCurrentTarget", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      await service.handle("split", { compile_target: response.state.compile_target ?? "main.tex", dry_run: false });
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage("Split current LaTeX target.", 2500);
    }),
    command("latexEditingToolkit.renumberUnits", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      await service.handle("renumber", { compile_target: response.state.compile_target ?? "main.tex", mode: "add", dry_run: false });
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage("Renumbered referenced units.", 2500);
    }),
    command("latexEditingToolkit.unsplitUnit", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      const ok = await vscode7.window.showWarningMessage("Merge selected subfiles unit back to its root and delete the source unit?", { modal: true }, "Merge");
      if (ok !== "Merge") return;
      await service.handle("unsplit", { compile_target: response.state.compile_target ?? "", dry_run: false, delete_source: true });
      treeProvider.refresh();
      vscode7.window.setStatusBarMessage("Merged selected unit back to root.", 2500);
    })
  );
}
function deactivate() {
  activePanel?.dispose();
  activePanel = void 0;
  toolkitServices.clear();
  personalStyles = void 0;
}
var LEGACY_SNIPS_NOTICE_KEY = "latexEditingToolkit.legacySnipsNotice.v1";
async function warnAboutLegacySnips(context, output) {
  const legacyId = "yiqiyang33.yiqis-latexsnips";
  const legacy = vscode7.extensions.getExtension(legacyId);
  if (!legacy || context.globalState.get(LEGACY_SNIPS_NOTICE_KEY)) return;
  await context.globalState.update(LEGACY_SNIPS_NOTICE_KEY, true);
  output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] Legacy extension detected: ${legacyId}`);
  const action = await vscode7.window.showWarningMessage(
    "Yiqi's LatexSnips is also installed. LaTeX Editing Toolkit 1.0 now includes the same snippet engine; disable the old extension to avoid duplicate completions and Enter/Tab behavior.",
    "Open Extension",
    "Continue"
  );
  if (action === "Open Extension") {
    await vscode7.commands.executeCommand("workbench.extensions.action.showExtensionsWithIds", [legacyId]);
  }
}
var RECENT_PROJECT_PARENTS_KEY = "latexEditingToolkit.recentProjectParents.v1";
async function createProjectWizard(context, registry, treeProvider, output) {
  const recent = context.globalState.get(RECENT_PROJECT_PARENTS_KEY) ?? [];
  const suggested = /* @__PURE__ */ new Set();
  for (const folder of vscode7.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme === "file") {
      suggested.add(folder.uri.fsPath);
      suggested.add(path16.dirname(folder.uri.fsPath));
    }
  }
  for (const item of recent) suggested.add(item);
  const location = await vscode7.window.showQuickPick(
    [
      ...[...suggested].map((folderPath) => ({ label: path16.basename(folderPath) || folderPath, description: folderPath, folderPath })),
      { label: "$(folder-opened) Browse\u2026", description: "Choose another parent folder", folderPath: "" }
    ],
    { title: "Create Project (1/3): Location", placeHolder: "Choose the parent folder for the new project" }
  );
  if (!location) return;
  let parentPath = location.folderPath;
  if (!parentPath) {
    const selected = await vscode7.window.showOpenDialog({
      title: "Create Project (1/3): Choose Parent Folder",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as Parent Folder"
    });
    if (!selected?.[0]) return;
    if (selected[0].scheme !== "file") throw new Error("Create Project only supports local parent folders.");
    parentPath = selected[0].fsPath;
  }
  const projectName = await vscode7.window.showInputBox({
    title: "Create Project (2/3): Project Name",
    prompt: `A new folder will be created inside ${parentPath}`,
    value: "New Notes",
    valueSelection: [0, "New Notes".length],
    validateInput: (value) => {
      const name = value.trim();
      if (!name) return "Project name is required.";
      if (name === "." || name === ".." || /[\\/\0]/.test(name)) return "Use a single folder name without path separators.";
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) return "This name is reserved by Windows.";
      return void 0;
    }
  });
  if (!projectName) return;
  const pickedTemplate = await vscode7.window.showQuickPick(
    STARTER_TEMPLATE_DEFINITIONS.map((template) => ({
      label: template.label,
      description: template.id,
      detail: template.description,
      template
    })),
    { title: "Create Project (3/3): Template", placeHolder: "Choose the document structure" }
  );
  if (!pickedTemplate) return;
  const preflight = await preflightCreateProject({ parentPath, projectName, templateId: pickedTemplate.template.id }, context.extensionPath);
  if (!preflight.ok) {
    const action = await vscode7.window.showErrorMessage(`Cannot create project: ${preflight.errors.join(" ")}`, "Show Log");
    output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] CREATE PROJECT PREFLIGHT`);
    for (const error of preflight.errors) output.appendLine(`- ${error}`);
    if (action === "Show Log") output.show(true);
    return;
  }
  if (preflight.targetExists && preflight.targetEmpty) {
    const choice = await vscode7.window.showWarningMessage(
      `The folder '${preflight.rootPath}' already exists and is empty. Use it for the new project?`,
      { modal: true },
      "Use Empty Folder"
    );
    if (choice !== "Use Empty Folder") return;
  }
  const nextRecent = [parentPath, ...recent.filter((item) => path16.normalize(item) !== path16.normalize(parentPath))].slice(0, 8);
  await context.globalState.update(RECENT_PROJECT_PARENTS_KEY, nextRecent);
  const service = new ToolkitService(preflight.rootPath, context.extensionPath, {
    additionalStylePresets: personalStyles?.definitions() ?? []
  });
  try {
    await vscode7.window.withProgress({ location: vscode7.ProgressLocation.Notification, title: "Creating LaTeX Toolkit project" }, () => runCreateProjectWorkflow(service, registry, preflight.rootPath, pickedTemplate.template.id));
  } catch (err) {
    logToolkitError(output, "latexEditingToolkit.createProject", preflight.rootPath, err);
    const message = err instanceof Error ? err.message : String(err);
    const action = await vscode7.window.showErrorMessage(
      `Project creation failed: ${message}. The folder may contain partially generated resources.`,
      "Open Folder",
      "Show Log"
    );
    if (action === "Open Folder") await vscode7.commands.executeCommand("vscode.openFolder", vscode7.Uri.file(preflight.rootPath), { forceNewWindow: false });
    if (action === "Show Log") output.show(true);
    return;
  }
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Created LaTeX Toolkit project: ${projectName}`, 3e3);
  await vscode7.commands.executeCommand("vscode.openFolder", vscode7.Uri.file(preflight.rootPath), { forceNewWindow: false });
}
async function restoreLastToolkitChange(context, treeProvider, output, direction, folderUri) {
  const scoped = await folderAndServiceForCommand(context, folderUri);
  if (!scoped) return;
  const command = direction === "undo" ? "undo-last-change" : "redo-last-change";
  try {
    await scoped.service.handle(command, {});
  } catch (err) {
    if (!(err instanceof HistoryConflictError)) throw err;
    const choice = await vscode7.window.showWarningMessage(
      `Cannot ${direction}: ${err.conflicts.length} tracked item(s) changed outside the recorded operation.`,
      { modal: true },
      "Show Conflicts",
      "Force Restore"
    );
    if (choice === "Show Conflicts") {
      output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${direction.toUpperCase()} CONFLICTS`);
      for (const conflict of err.conflicts) output.appendLine(`- ${conflict}`);
      output.show(true);
      return;
    }
    if (choice !== "Force Restore") return;
    await scoped.service.handle(command, { force: true });
  }
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`${direction === "undo" ? "Undid" : "Redid"} last Toolkit change`, 2500);
  if (activePanel?.folder?.uri.toString() === scoped.folder.uri.toString()) await activePanel.refreshState();
}
function registerToolkitCommand(output, commandId, handler) {
  return vscode7.commands.registerCommand(commandId, async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (isUserCancellation(err)) return void 0;
      const workspacePath = workspacePathFromArguments(args);
      logToolkitError(output, commandId, workspacePath, err);
      const message = err instanceof Error ? err.message : String(err);
      const action = await vscode7.window.showErrorMessage(`LaTeX Editing Toolkit: ${message}`, "Show Log");
      if (action === "Show Log") output.show(true);
      return void 0;
    }
  });
}
function isUserCancellation(err) {
  return err instanceof vscode7.CancellationError || err instanceof Error && /cancelled|canceled/i.test(err.message);
}
function workspacePathFromArguments(args) {
  for (const arg of args) {
    if (arg instanceof vscode7.Uri && arg.scheme === "file") return arg.fsPath;
    const projectPath = localProjectPathFromArgument(arg);
    if (projectPath) return projectPath;
  }
  return vscode7.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === "file")?.uri.fsPath ?? "(no local workspace)";
}
function logToolkitError(output, commandId, workspacePath, err) {
  const error = err instanceof Error ? err : new Error(String(err));
  output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] ERROR ${commandId}`);
  output.appendLine(`Workspace: ${workspacePath}`);
  output.appendLine(error.stack ?? error.message);
  output.appendLine("");
}
function logCompileResult(output, workspacePath, result) {
  output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] COMPILE ${result.success ? "SUCCESS" : "FAILED"}`);
  output.appendLine(`Workspace: ${workspacePath}`);
  output.appendLine(result.output?.trimEnd() || "(compiler returned no output)");
  output.appendLine("");
}
async function selectWorkspaceFolder(preferredFolderUri) {
  const folders = vscode7.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode7.window.showErrorMessage("Open a local workspace folder before using LaTeX Editing Toolkit.");
    return void 0;
  }
  const localFolders = folders.filter((folder) => folder.uri.scheme === "file");
  if (localFolders.length === 0) {
    vscode7.window.showErrorMessage("LaTeX Editing Toolkit currently supports local file workspaces only.");
    return void 0;
  }
  if (preferredFolderUri?.scheme === "file") {
    const matched = localFolders.find((folder) => folder.uri.toString() === preferredFolderUri.toString());
    if (matched) return matched;
  }
  if (localFolders.length === 1) return localFolders[0];
  const picked = await vscode7.window.showQuickPick(localFolders.map((folder) => ({ label: folder.name, folder })), { placeHolder: "Select Toolkit workspace" });
  return picked?.folder;
}
async function serviceForCommand(context, preferredFolderUri) {
  return (await folderAndServiceForCommand(context, preferredFolderUri))?.service;
}
async function folderAndServiceForCommand(context, preferredFolderUri) {
  const folder = await selectWorkspaceFolder(preferredFolderUri);
  if (!folder) return void 0;
  return { folder, service: toolkitService(context, folder.uri.fsPath) };
}
function toolkitService(context, rootPath) {
  let canonical = path16.resolve(rootPath);
  try {
    canonical = fs14.realpathSync.native(canonical);
  } catch {
  }
  const key = process.platform === "win32" || process.platform === "darwin" ? canonical.toLocaleLowerCase() : canonical;
  const existing = toolkitServices.get(key);
  if (existing) {
    existing.setAdditionalStylePresets(personalStyles?.definitions() ?? []);
    return existing;
  }
  const service = new ToolkitService(rootPath, context.extensionPath, {
    historyStorageDir: workspaceHistoryStorageRoot(context.globalStorageUri.fsPath, rootPath),
    additionalStylePresets: personalStyles?.definitions() ?? []
  });
  toolkitServices.set(key, service);
  return service;
}
function refreshPersonalStylesOnServices(registry) {
  const definitions = registry.definitions();
  for (const service of toolkitServices.values()) service.setAdditionalStylePresets(definitions);
}
async function responseForCommand(context, preferredFolderUri) {
  const scoped = await folderAndServiceForCommand(context, preferredFolderUri);
  if (!scoped) return void 0;
  const response = await scoped.service.handle("state", {});
  return { ...scoped, response };
}
function pdfForTarget(target) {
  return target && target.endsWith(".tex") ? `${target.slice(0, -4)}.pdf` : "main.pdf";
}
function currentPdfPath(state) {
  return state.compile_output_pdf || state.compile_output_pdf_expected || pdfForTarget(state.compile_target);
}
async function openLocalProject(projectPathArg) {
  const projectPath = localProjectPathFromArgument(projectPathArg);
  if (!projectPath) {
    vscode7.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  try {
    if (!(await fs14.promises.stat(projectPath)).isDirectory()) throw new Error("not a directory");
  } catch {
    vscode7.window.showWarningMessage(`Local note project not found: ${projectPath}`);
    return;
  }
  await vscode7.commands.executeCommand("vscode.openFolder", vscode7.Uri.file(projectPath), { forceNewWindow: false });
}
async function relocateLocalProject(registry, treeProvider, projectPathArg) {
  const oldPath = localProjectPathFromArgument(projectPathArg);
  if (!oldPath) {
    vscode7.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  const target = await vscode7.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Relocate Toolkit Project Here"
  });
  if (!target?.[0]) return;
  if (target[0].scheme !== "file") {
    vscode7.window.showErrorMessage("LaTeX Editing Toolkit only supports local project folders.");
    return;
  }
  const updated = await registry.relocate(oldPath, target[0].fsPath);
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Relocated local note project to ${updated.rootPath}.`, 2500);
}
async function removeLocalProject(registry, treeProvider, projectPathArg) {
  const projectPath = localProjectPathFromArgument(projectPathArg);
  if (!projectPath) {
    vscode7.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  const project = await registry.find(projectPath);
  const label = project?.label ?? path16.basename(path16.normalize(projectPath));
  const choice = await vscode7.window.showWarningMessage(
    `Forget local note project '${label}'? This only removes it from the Toolkit list and does not delete files.`,
    { modal: true },
    "Forget"
  );
  if (choice !== "Forget") return;
  const removed = await registry.remove(projectPath);
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(removed ? `Forgot local note project '${label}'.` : "Local note project was already removed.", 2500);
}
function localProjectPathFromArgument(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return void 0;
  const candidate = value;
  if (typeof candidate.fsPath === "string") return candidate.fsPath;
  const resourceUri = candidate.resourceUri;
  if (resourceUri && typeof resourceUri === "object" && typeof resourceUri.fsPath === "string") {
    return resourceUri.fsPath;
  }
  return void 0;
}
async function createStarterInWorkspace(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const templates = scoped.response.schema.starter_templates;
  const picked = await vscode7.window.showQuickPick(
    templates.map((template) => ({
      label: template.label,
      description: template.id,
      detail: template.description,
      template
    })),
    { placeHolder: "Select starter template" }
  );
  if (!picked) return;
  const outputTarget = await vscode7.window.showInputBox({
    title: "Generate Starter",
    prompt: "Workspace-relative .tex file to create",
    value: scoped.response.schema.starter_default_output_target || "main.tex"
  });
  if (!outputTarget) return;
  let overwrite = false;
  if (fs14.existsSync(path16.resolve(scoped.folder.uri.fsPath, outputTarget))) {
    const ok = await vscode7.window.showWarningMessage(`${outputTarget} already exists. Overwrite it?`, { modal: true }, "Overwrite");
    if (ok !== "Overwrite") return;
    overwrite = true;
  }
  const result = await scoped.service.handle("template-bootstrap", {
    template_id: picked.template.id,
    output_target: outputTarget,
    overwrite
  });
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Generated ${result.generated_target ?? outputTarget}.`, 2500);
}
async function pickCompileTarget(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const targets = scoped.response.state.compile_targets;
  if (targets.length === 0) {
    vscode7.window.showWarningMessage("No LaTeX compile targets found in this workspace.");
    return;
  }
  const picked = await vscode7.window.showQuickPick(
    targets.map((target) => ({
      label: target,
      description: target === scoped.response.state.compile_target ? "current" : ""
    })),
    { placeHolder: "Select compile target" }
  );
  if (!picked) return;
  await scoped.service.handle("target", { compile_target: picked.label });
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Compile target set to ${picked.label}.`, 2e3);
}
async function pickCompileRecipe(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const recipes = scoped.response.state.compile_recipes;
  if (recipes.length === 0) {
    vscode7.window.showWarningMessage("No VS Code LaTeX recipes found. Generate VS Code settings or use internal fallback.");
    return;
  }
  const picked = await vscode7.window.showQuickPick(
    recipes.map((recipe) => ({
      label: recipe.name,
      description: recipe.id === scoped.response.state.compile_recipe ? "current" : recipe.id,
      detail: recipe.tools.join(" -> "),
      recipe
    })),
    { placeHolder: "Select compile recipe" }
  );
  if (!picked) return;
  await scoped.service.handle("compile-config", {
    compile_recipe: picked.recipe.id,
    compile_use_internal_fallback: false
  });
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Compile recipe set to ${picked.recipe.name}.`, 2e3);
}
async function toggleInternalFallback(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const next = !scoped.response.state.compile_use_internal_fallback;
  await scoped.service.handle("compile-config", {
    compile_recipe: scoped.response.state.compile_recipe,
    compile_use_internal_fallback: next
  });
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Internal fallback ${next ? "enabled" : "disabled"}.`, 2e3);
}
async function openCurrentPdf(context, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const rawPath = currentPdfPath(scoped.response.state);
  try {
    const pdfPath = await scoped.service.readPdfIfExists(rawPath);
    await vscode7.commands.executeCommand("vscode.open", vscode7.Uri.file(pdfPath));
  } catch {
    vscode7.window.showWarningMessage(`PDF not found yet: ${rawPath}`);
  }
}
async function toggleThemeOption(context, treeProvider, folderUri, toggleId) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped || !toggleId) return;
  const toggle = scoped.response.schema.toggles.find((item) => item.id === toggleId);
  if (!toggle) return;
  const state = scoped.response.state;
  state.toggles[toggleId] = !state.toggles[toggleId];
  await scoped.service.handle("save", state);
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`${toggle.label}: ${state.toggles[toggleId] ? "on" : "off"}.`, 2e3);
}
async function pickClassConfig(context, treeProvider, folderUri, fieldId) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped || !fieldId) return;
  const field = scoped.response.schema.class_config.find((item) => item.id === fieldId);
  if (!field) return;
  const current = scoped.response.state.class_config[field.id];
  const picked = await vscode7.window.showQuickPick(
    field.options.map((option) => ({
      label: option.label,
      description: option.value === current ? "current" : option.value,
      option
    })),
    { placeHolder: field.label }
  );
  if (!picked) return;
  const state = scoped.response.state;
  state.class_config[field.id] = picked.option.value;
  await scoped.service.handle("save", state);
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`${field.label}: ${picked.option.label}.`, 2e3);
}
async function pickStylePreset(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const presets = scoped.response.schema.style_presets;
  const current = scoped.response.state.style_preset;
  const picked = await vscode7.window.showQuickPick(
    presets.map((preset) => ({
      label: preset.label,
      description: preset.id === current ? "current" : preset.id,
      detail: preset.description,
      preset
    })),
    { placeHolder: "Select style preset" }
  );
  if (!picked) return;
  await scoped.service.handle("style-preset", { style_preset: picked.preset.id });
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`Style preset: ${picked.preset.label}.`, 2e3);
}
async function pickBodyFontSize(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const config = scoped.response.schema.body_font_size;
  const values = [];
  for (let value = config.min; value <= config.max + config.step / 2; value += config.step) {
    values.push(Number(value.toFixed(2)));
  }
  const current = scoped.response.state.body_font_size_pt;
  const picked = await vscode7.window.showQuickPick(
    values.map((value) => ({
      label: `${formatPointSize(value)} pt`,
      description: value === current ? "current" : "",
      value
    })),
    { placeHolder: config.label }
  );
  if (!picked) return;
  const state = scoped.response.state;
  state.body_font_size_pt = picked.value;
  await scoped.service.handle("save", state);
  treeProvider.refresh();
  vscode7.window.setStatusBarMessage(`${config.label}: ${picked.label}.`, 2e3);
}
function formatPointSize(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
var ToolkitTreeProvider = class {
  constructor(context, projectRegistry) {
    this.context = context;
    this.projectRegistry = projectRegistry;
  }
  context;
  projectRegistry;
  changeEmitter = new vscode7.EventEmitter();
  onDidChangeTreeData = this.changeEmitter.event;
  refresh() {
    this.changeEmitter.fire();
  }
  dispose() {
    this.changeEmitter.dispose();
  }
  getTreeItem(node) {
    const collapsibleState = node.collapsibleState ?? (node.children ? vscode7.TreeItemCollapsibleState.Collapsed : vscode7.TreeItemCollapsibleState.None);
    const item = new vscode7.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip ?? node.label;
    item.contextValue = node.contextValue;
    item.resourceUri = node.resourceUri;
    if (node.iconId) item.iconPath = new vscode7.ThemeIcon(node.iconId);
    if (node.commandId) {
      item.command = {
        command: node.commandId,
        title: node.label,
        arguments: node.commandArgs
      };
    }
    return item;
  }
  async getChildren(node) {
    if (node) return node.children ?? [];
    return this.rootNodes();
  }
  async rootNodes() {
    const localFolders = (vscode7.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
    const nodes = [];
    nodes.push(await this.localNotesNode());
    if (localFolders.length === 0) {
      nodes.push({
        id: "open-local-folder",
        label: "Open Local Folder",
        description: "required",
        tooltip: "Open a local folder to use LaTeX Editing Toolkit.",
        iconId: "folder-opened",
        commandId: "workbench.action.files.openFolder",
        contextValue: "openFolder"
      });
    } else {
      nodes.push(...await Promise.all(localFolders.map((folder) => this.workspaceNode(folder, localFolders.length === 1))));
    }
    return nodes;
  }
  async localNotesNode() {
    const projects = await this.projectRegistry.list();
    const openProjectIds = new Set((await Promise.all(
      (vscode7.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file").map((folder) => this.projectRegistry.find(folder.uri.fsPath))
    )).filter((project) => Boolean(project)).map((project) => project.id));
    const children = projects.length > 0 ? projects.map((project) => this.localProjectNode(project, openProjectIds.has(project.id))) : [
      this.infoNode("local-notes-empty", "No local notes yet", "Create a project to add it here.", "info"),
      this.actionNode("local-notes-create", "Create New Project", "from template", "new-folder", "latexEditingToolkit.createProject", [])
    ];
    return this.groupNode(
      "local-notes",
      "Local Notes",
      "book",
      children,
      vscode7.TreeItemCollapsibleState.Expanded
    );
  }
  localProjectNode(project, isOpen) {
    const parent = path16.basename(path16.dirname(project.rootPath)) || path16.dirname(project.rootPath);
    return {
      id: `local-project:${project.id}`,
      label: project.label,
      description: project.missing ? "Missing" : isOpen ? `Open \xB7 ${parent}` : parent,
      tooltip: project.missing ? `Project folder not found: ${project.rootPath}` : project.rootPath,
      iconId: project.missing ? "warning" : isOpen ? "root-folder-opened" : "folder",
      commandId: "latexEditingToolkit.openLocalProject",
      commandArgs: [project.rootPath],
      contextValue: project.missing ? "localProjectMissing" : "localProject",
      resourceUri: vscode7.Uri.file(project.rootPath)
    };
  }
  async workspaceNode(folder, isOnlyFolder) {
    const response = await this.loadWorkspaceState(folder);
    const description = response instanceof Error ? "Needs attention" : `${this.presetLabel(response.schema.style_presets, response.state.style_preset)} \xB7 ${this.workspaceBuildSummary(response.state)}`;
    return {
      id: `workspace:${folder.uri.toString()}`,
      label: folder.name,
      description,
      tooltip: folder.uri.fsPath,
      iconId: "root-folder",
      resourceUri: folder.uri,
      collapsibleState: vscode7.TreeItemCollapsibleState.Expanded,
      contextValue: "workspace",
      children: response instanceof Error ? this.workspaceErrorGroups(folder, response) : this.workspaceGroups(folder, response)
    };
  }
  async loadWorkspaceState(folder) {
    try {
      return await toolkitService(this.context, folder.uri.fsPath).handle("state", {});
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }
  workspaceGroups(folder, response) {
    const folderArg = [folder.uri];
    const state = response.state;
    const schema = response.schema;
    const nodes = [
      this.actionNode("open-toolkit", "Open Toolkit", "visual workbench", "tools", "latexEditingToolkit.openToolkit", folderArg)
    ];
    if (response.history?.canUndo) nodes.push(this.actionNode("undo-last-change", "Undo Last Change", response.history.label, "discard", "latexEditingToolkit.undoLastChange", folderArg));
    if (response.history?.canRedo) nodes.push(this.actionNode("redo-last-change", "Redo Last Change", response.history.label, "redo", "latexEditingToolkit.redoLastChange", folderArg));
    const activeSnippetProfile = vscode7.workspace.getConfiguration("hsnips", folder.uri).get("profiles.activeProfile") || "";
    const snippetFileCount = getSnippetFiles(getSnippetDir(), activeSnippetProfile, path16.join(folder.uri.fsPath, ".vscode", "hsnips"), folder.uri.fsPath).length;
    nodes.push(
      this.groupNode(`snippets:${folder.uri.toString()}`, "Snippets", "symbol-snippet", [
        this.actionNode(
          "open-snippet-manager",
          "Open Snippet Manager",
          `${activeSnippetProfile || "base"} \xB7 ${snippetFileCount} file${snippetFileCount === 1 ? "" : "s"}`,
          "edit",
          "hsnips.openSnippetManager",
          folderArg
        ),
        this.actionNode("select-snippet-profile", "Select Profile", "base + profile + workspace", "account", "hsnips.selectProfile", folderArg),
        this.actionNode("reload-snippets", "Reload Snippets", ".hsnips files", "refresh", "hsnips.reloadSnippets", folderArg)
      ], vscode7.TreeItemCollapsibleState.Collapsed, `${activeSnippetProfile || "Base"} \xB7 ${snippetFileCount} files`),
      this.groupNode(`build:${folder.uri.toString()}`, "Build", "play", [
        this.actionNode("compile-pdf", "Compile PDF", state.compile_target || "current target", "play", "latexEditingToolkit.compilePdf", folderArg),
        this.actionNode("open-current-pdf", "Open Current PDF", currentPdfPath(state), "open-preview", "latexEditingToolkit.openCurrentPdf", folderArg),
        this.actionNode("pick-target", "Pick Target", `${state.compile_targets.length} found`, "symbol-file", "latexEditingToolkit.pickCompileTarget", folderArg),
        this.actionNode("pick-recipe", "Pick Recipe", `${state.compile_recipes.length} found`, "settings-gear", "latexEditingToolkit.pickCompileRecipe", folderArg),
        this.actionNode("toggle-internal-fallback", "Internal Fallback", state.compile_use_internal_fallback ? "on" : "off", "debug-restart", "latexEditingToolkit.toggleInternalFallback", folderArg),
        this.actionNode("clean-artifacts", "Clean Build Artifacts", "workspace", "trash", "latexEditingToolkit.cleanArtifacts", folderArg)
      ], vscode7.TreeItemCollapsibleState.Expanded),
      this.groupNode(`appearance:${folder.uri.toString()}`, "Appearance", "symbol-color", [
        this.actionNode("pick-style-preset", "Style Preset", this.presetLabel(schema.style_presets, state.style_preset), "symbol-color", "latexEditingToolkit.pickStylePreset", folderArg),
        this.actionNode("pick-body-font-size", "Body Font Size", `${formatPointSize(state.body_font_size_pt)} pt`, "text-size", "latexEditingToolkit.pickBodyFontSize", folderArg),
        this.groupNode(`appearance-toggles:${folder.uri.toString()}`, "Feature Toggles", "checklist", schema.toggles.map((toggle) => this.actionNode(
          `toggle-theme-${toggle.id}`,
          toggle.label,
          state.toggles[toggle.id] ? "on" : "off",
          state.toggles[toggle.id] ? "check" : "circle-slash",
          "latexEditingToolkit.toggleThemeOption",
          [folder.uri, toggle.id]
        )))
      ]),
      this.groupNode(`document:${folder.uri.toString()}`, "Document", "book", [
        this.infoNode(`document-class:${folder.uri.toString()}`, "Detected Class", this.documentClassDescription(state), "symbol-class"),
        this.groupNode(`document-class-config:${folder.uri.toString()}`, "Class Rules", "settings", schema.class_config.map((field) => this.actionNode(
          `pick-class-config-${field.id}`,
          field.label,
          this.optionLabel(field.options, state.class_config[field.id]),
          "settings",
          "latexEditingToolkit.pickClassConfig",
          [folder.uri, field.id]
        )))
      ]),
      this.groupNode(`project:${folder.uri.toString()}`, "Project Tools", "tools", [
        this.actionNode("generate-starter", "Generate Starter", schema.starter_default_output_target || "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg),
        this.actionNode("reset-overrides", "Reset All Toolkit Overrides", "deletes all generated settings", "discard", "latexEditingToolkit.resetOverrides", folderArg)
      ]),
      this.groupNode(`structure:${folder.uri.toString()}`, "Structure", "list-tree", [
        this.actionNode("split-current", "Split Current Target", "subfiles", "split-horizontal", "latexEditingToolkit.splitCurrentTarget", folderArg),
        this.actionNode("renumber-units", "Renumber Units", "references", "list-ordered", "latexEditingToolkit.renumberUnits", folderArg),
        this.actionNode("unsplit-unit", "Merge Unit Back To Root", "selected target", "git-merge", "latexEditingToolkit.unsplitUnit", folderArg)
      ])
    );
    if (state.config_warnings.length > 0 || state.compile_last_success === false) {
      const diagnostics = [this.infoNode(`last-compile:${folder.uri.toString()}`, "Last Compile", this.lastCompileDescription(state), this.lastCompileIcon(state))];
      if (state.config_warnings.length > 0) diagnostics.push({
        ...this.infoNode(`config-warnings:${folder.uri.toString()}`, "Configuration Warnings", `${state.config_warnings.length} warning(s)`, "warning"),
        tooltip: state.config_warnings.join("\n")
      });
      nodes.push(this.groupNode(`diagnostics:${folder.uri.toString()}`, "Diagnostics", "warning", diagnostics, vscode7.TreeItemCollapsibleState.Expanded));
    }
    return nodes;
  }
  workspaceBuildSummary(state) {
    if (state.compile_last_success === false) return "Build failed";
    if (state.compile_last_success === true) return "PDF ready";
    return "Not compiled";
  }
  workspaceErrorGroups(folder, error) {
    const folderArg = [folder.uri];
    return [
      this.actionNode("open-toolkit", "Open Toolkit", "visual workbench", "tools", "latexEditingToolkit.openToolkit", folderArg),
      this.groupNode(`diagnostics:${folder.uri.toString()}`, "Diagnostics", "warning", [
        this.infoNode(`state-error:${folder.uri.toString()}`, "State Unavailable", error.message, "error")
      ], vscode7.TreeItemCollapsibleState.Expanded),
      this.groupNode(`project:${folder.uri.toString()}`, "Project Tools", "repo", [
        this.actionNode("generate-starter", "Generate Starter", "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg)
      ], vscode7.TreeItemCollapsibleState.Expanded)
    ];
  }
  groupNode(id, label, iconId, children, collapsibleState = vscode7.TreeItemCollapsibleState.Collapsed, description) {
    return {
      id,
      label,
      description,
      iconId,
      children,
      collapsibleState,
      contextValue: "group"
    };
  }
  actionNode(id, label, description, iconId, commandId, commandArgs) {
    return {
      id: `${id}:${String(commandArgs[0])}`,
      label,
      description,
      tooltip: description ? `${label}: ${description}` : label,
      iconId,
      commandId,
      commandArgs,
      contextValue: "action"
    };
  }
  infoNode(id, label, description, iconId) {
    return {
      id,
      label,
      description,
      tooltip: description ? `${label}: ${description}` : label,
      iconId,
      contextValue: "info"
    };
  }
  compileRecipeDescription(state) {
    if (state.compile_use_internal_fallback) return "internal fallback";
    return state.compile_recipe_name || state.compile_recipe || "not set";
  }
  lastCompileDescription(state) {
    if (state.compile_last_success === null) return "not run";
    const status = state.compile_last_success ? "succeeded" : "failed";
    return state.compile_last_compile_at ? `${status} ${this.formatTimestamp(state.compile_last_compile_at)}` : status;
  }
  lastCompileIcon(state) {
    if (state.compile_last_success === null) return "circle-outline";
    return state.compile_last_success ? "pass-filled" : "error";
  }
  documentClassDescription(state) {
    const detected = state.detected_document_class || "unknown";
    const effective = state.effective_theme_class || "auto";
    const chapter = state.detected_document_class_has_chapter ? "chapter" : "section";
    return `${detected} -> ${effective}, ${chapter} headings`;
  }
  presetLabel(presets, value) {
    return presets.find((preset) => preset.id === value)?.label ?? value;
  }
  optionLabel(options, value) {
    return options.find((option) => option.value === value)?.label ?? value;
  }
  formatTimestamp(raw) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString(void 0, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
};
var ToolkitPanel = class _ToolkitPanel {
  constructor(context, folder, panel, output, styleRegistry, onStateChanged) {
    this.context = context;
    this.folder = folder;
    this.panel = panel;
    this.output = output;
    this.styleRegistry = styleRegistry;
    this.onStateChanged = onStateChanged;
    this.service = folder ? toolkitService(context, folder.uri.fsPath) : void 0;
    this.snippetService = new SnippetService(folder?.uri.fsPath);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables);
  }
  context;
  folder;
  panel;
  output;
  styleRegistry;
  onStateChanged;
  service;
  snippetService;
  disposables = [];
  disposed = false;
  static createOrShow(context, folder, output, styleRegistry, onStateChanged) {
    const panelKey = folder?.uri.toString() || "global-snippets";
    if (activePanel) {
      if (activePanel.panelKey === panelKey) {
        activePanel.panel.reveal(vscode7.ViewColumn.One);
        return activePanel;
      }
      activePanel.dispose();
    }
    const panel = vscode7.window.createWebviewPanel(
      "latexEditingToolkit.toolkit",
      "LaTeX Editing Toolkit",
      vscode7.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode7.Uri.file(path16.join(context.extensionPath, "dist")),
          vscode7.Uri.file(path16.join(context.extensionPath, "dist", "monaco"))
        ]
      }
    );
    return new _ToolkitPanel(context, folder, panel, output, styleRegistry, onStateChanged);
  }
  get panelKey() {
    return this.folder?.uri.toString() || "global-snippets";
  }
  requireService() {
    if (!this.service) throw new Error("Open a local workspace to use this Toolkit section.");
    return this.service;
  }
  get workspacePath() {
    return this.folder?.uri.fsPath || "global-snippets";
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    activePanel = void 0;
    try {
      this.panel.dispose();
    } catch {
    }
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
  async refreshState() {
    if (!this.service) return;
    const data = await this.service.handle("state", {});
    await this.panel.webview.postMessage({ type: "toolkit-state-refresh", data });
  }
  async openSection(section) {
    this.panel.reveal(vscode7.ViewColumn.One);
    await this.panel.webview.postMessage({ type: "toolkit-open-section", section });
  }
  async handleMessage(message) {
    const request = message;
    if (!request?.id || !request.command) return;
    try {
      let data;
      if (request.command === "confirm-action") {
        const action = request.payload?.action;
        if (!isConfirmAction(action)) throw new Error("Unknown Toolkit confirmation action.");
        const spec = confirmationSpec(action, String(request.payload?.detail ?? ""));
        const choice = await vscode7.window.showWarningMessage(
          spec.message,
          { modal: true, detail: spec.detail },
          spec.confirmLabel
        );
        data = { confirmed: choice === spec.confirmLabel };
      } else if (request.command === "show-log") {
        this.output.show(true);
        data = { shown: true };
      } else if (request.command === "snippets-state" || request.command === "snippets-reload") {
        if (request.command === "snippets-reload") await vscode7.commands.executeCommand("hsnips.reloadSnippets");
        data = await this.snippetService.state();
      } else if (request.command === "snippets-analyze") {
        data = await this.snippetService.analyze(String(request.payload?.file_path ?? ""), String(request.payload?.content ?? ""));
      } else if (request.command === "snippets-save") {
        data = await this.snippetService.save(
          String(request.payload?.file_path ?? ""),
          String(request.payload?.content ?? ""),
          typeof request.payload?.document_hash === "string" ? request.payload.document_hash : void 0,
          typeof request.payload?.mtime_ms === "number" ? request.payload.mtime_ms : void 0
        );
      } else if (request.command === "snippets-open-source") {
        await this.snippetService.openSource(String(request.payload?.file_path ?? ""), Number(request.payload?.line ?? 1));
        data = { opened: true };
      } else if (request.command === "snippets-create-file") {
        const scope = String(request.payload?.scope ?? "base");
        if (scope !== "base" && scope !== "profile" && scope !== "workspace") throw new Error("Unknown snippet scope.");
        data = await this.snippetService.create(String(request.payload?.language ?? "latex"), scope);
      } else if (request.command === "snippets-select-profile") {
        const profile = String(request.payload?.profile ?? "").trim();
        const current = await this.snippetService.state();
        if (profile && !current.profiles.includes(profile)) throw new Error("Unknown snippet profile.");
        await vscode7.workspace.getConfiguration("hsnips").update("profiles.activeProfile", profile, vscode7.ConfigurationTarget.Global);
        await vscode7.commands.executeCommand("hsnips.reloadSnippets");
        data = await this.snippetService.state();
      } else if (request.command === "snippets-open-directory") {
        const scope = String(request.payload?.scope ?? "base");
        if (scope === "base") await vscode7.commands.executeCommand("hsnips.openSnippetsDir");
        else if (scope === "profile") await vscode7.commands.executeCommand("hsnips.openActiveProfile");
        else if (scope === "workspace") await vscode7.commands.executeCommand("hsnips.openWorkspaceSnippetsDir");
        else throw new Error("Unknown snippet directory scope.");
        data = { opened: true };
      } else if (request.command === "pdf-status") {
        const service = this.requireService();
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = service.resolvePdfPath(rawPath);
        let exists2 = false;
        try {
          const stat = await fs14.promises.stat(pdfPath);
          exists2 = stat.isFile();
        } catch {
          exists2 = false;
        }
        data = { path: rawPath || path16.basename(pdfPath), exists: exists2 };
      } else if (request.command === "open-pdf") {
        const service = this.requireService();
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = await service.readPdfIfExists(rawPath);
        await vscode7.commands.executeCommand("vscode.open", vscode7.Uri.file(pdfPath));
        data = { opened: true };
      } else if (request.command === "personal-style-save") {
        const service = this.requireService();
        const state = request.payload?.state;
        if (!isPlainRecord(state) || !isPlainRecord(state.colors)) throw new Error("Current style state is unavailable.");
        const label = await vscode7.window.showInputBox({ title: "Save as Personal Style", prompt: "Style name", validateInput: (value) => value.trim() ? void 0 : "Style name is required." });
        if (!label) {
          data = await service.handle("state", {});
        } else {
          const record = await this.styleRegistry.add(label, String(state.style_base_preset ?? state.style_preset ?? "default"), state.colors);
          refreshPersonalStylesOnServices(this.styleRegistry);
          service.setAdditionalStylePresets(this.styleRegistry.definitions());
          data = await service.handle("autosave", { revision: request.payload?.revision ?? 0, state: { ...state, style_preset: record.id, style_base_preset: record.basePresetId } });
        }
      } else if (request.command === "personal-style-update") {
        const service = this.requireService();
        const state = request.payload?.state;
        if (!isPlainRecord(state) || !isPlainRecord(state.colors)) throw new Error("Current style state is unavailable.");
        await this.styleRegistry.update(String(request.payload?.style_id ?? state.style_preset ?? ""), state.colors);
        refreshPersonalStylesOnServices(this.styleRegistry);
        data = await service.handle("state", {});
      } else if (request.command === "personal-style-rename") {
        const service = this.requireService();
        const id = String(request.payload?.style_id ?? "");
        const current = this.styleRegistry.list().find((style) => style.id === id);
        if (!current) throw new Error("Personal style not found.");
        const label = await vscode7.window.showInputBox({ title: "Rename Personal Style", value: current.label, validateInput: (value) => value.trim() ? void 0 : "Style name is required." });
        if (label) await this.styleRegistry.rename(id, label);
        refreshPersonalStylesOnServices(this.styleRegistry);
        data = await service.handle("state", {});
      } else if (request.command === "personal-style-delete") {
        const service = this.requireService();
        const id = String(request.payload?.style_id ?? "");
        const current = this.styleRegistry.list().find((style) => style.id === id);
        if (!current) throw new Error("Personal style not found.");
        const confirmed = await vscode7.window.showWarningMessage(`Delete personal style '${current.label}'? Project colors will not be deleted.`, { modal: true }, "Delete Style");
        if (confirmed !== "Delete Style") data = await service.handle("state", {});
        else {
          await this.styleRegistry.remove(id);
          refreshPersonalStylesOnServices(this.styleRegistry);
          service.setAdditionalStylePresets(this.styleRegistry.definitions());
          const state = request.payload?.state;
          data = isPlainRecord(state) && state.style_preset === id ? await service.handle("autosave", { revision: request.payload?.revision ?? 0, state: { ...state, style_preset: current.basePresetId, style_base_preset: current.basePresetId } }) : await service.handle("state", {});
        }
      } else if (request.command === "personal-style-import") {
        const service = this.requireService();
        const picked = await vscode7.window.showOpenDialog({ title: "Import Personal Styles", canSelectMany: false, filters: { JSON: ["json"] } });
        if (!picked?.[0]) data = await service.handle("state", {});
        else {
          const raw = JSON.parse(await fs14.promises.readFile(picked[0].fsPath, "utf8"));
          const summary = await this.styleRegistry.importLibrary(raw);
          refreshPersonalStylesOnServices(this.styleRegistry);
          data = { ...await service.handle("state", {}), personal_style_import: summary };
        }
      } else if (request.command === "personal-style-export") {
        const service = this.requireService();
        const id = String(request.payload?.style_id ?? "");
        const library = this.styleRegistry.exportLibrary();
        const styles = id ? library.styles.filter((style) => style.id === id) : library.styles;
        const target = await vscode7.window.showSaveDialog({ title: "Export Personal Styles", defaultUri: vscode7.Uri.file(path16.join(this.workspacePath, id ? "personal-style.json" : "latex-toolkit-styles.json")), filters: { JSON: ["json"] } });
        if (target) await fs14.promises.writeFile(target.fsPath, `${JSON.stringify({ version: 1, styles }, null, 2)}
`, "utf8");
        data = { ...await service.handle("state", {}), exported: Boolean(target) };
      } else if (request.command === "undo-last-change" || request.command === "redo-last-change") {
        const service = this.requireService();
        try {
          data = await service.handle(request.command, request.payload ?? {});
        } catch (err) {
          if (!(err instanceof HistoryConflictError)) throw err;
          const direction = request.command.startsWith("undo") ? "undo" : "redo";
          const choice = await vscode7.window.showWarningMessage(
            `Cannot ${direction}: ${err.conflicts.length} tracked item(s) changed outside the recorded operation.`,
            { modal: true },
            "Show Conflicts",
            "Force Restore"
          );
          if (choice === "Show Conflicts") {
            this.output.appendLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${direction.toUpperCase()} CONFLICTS`);
            for (const conflict of err.conflicts) this.output.appendLine(`- ${conflict}`);
            this.output.show(true);
            data = await service.handle("state", {});
          } else if (choice === "Force Restore") data = await service.handle(request.command, { force: true });
          else data = await service.handle("state", {});
        }
      } else {
        data = await this.requireService().handle(request.command, request.payload ?? {});
      }
      if (request.command === "compile") {
        logCompileResult(this.output, this.workspacePath, data);
      }
      if (["autosave", "undo-last-change", "redo-last-change", "reset", "upgrade-theme-assets", "template-bootstrap", "split", "renumber", "unsplit", "personal-style-save", "personal-style-delete"].includes(request.command)) {
        this.onStateChanged();
      }
      await this.panel.webview.postMessage({ id: request.id, ok: true, data });
    } catch (err) {
      logToolkitError(this.output, `webview:${request.command}`, this.workspacePath, err);
      await this.panel.webview.postMessage({ id: request.id, ok: false, error: err.message });
    }
  }
  html() {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode7.Uri.file(path16.join(this.context.extensionPath, "dist", "webview.js")));
    const styleUri = webview.asWebviewUri(vscode7.Uri.file(path16.join(this.context.extensionPath, "dist", "webview.css")));
    const codiconStyleUri = webview.asWebviewUri(vscode7.Uri.file(path16.join(this.context.extensionPath, "dist", "codicon.css")));
    const monacoRootUri = webview.asWebviewUri(vscode7.Uri.file(path16.join(this.context.extensionPath, "dist", "monaco", "vs")));
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob: data:`,
      `connect-src ${webview.cspSource}`
    ].join("; ");
    const initial = JSON.stringify({
      workspaceName: this.folder?.name || "Global Snippets",
      workspacePath: this.folder?.uri.fsPath || "global-snippets",
      snippetsOnly: !this.folder,
      monacoBaseUri: monacoRootUri.toString()
    });
    const cssExists = fs14.existsSync(path16.join(this.context.extensionPath, "dist", "webview.css"));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>LaTeX Editing Toolkit</title>
  <link rel="stylesheet" href="${codiconStyleUri}">
  ${cssExists ? `<link rel="stylesheet" href="${styleUri}">` : ""}
</head>
<body>
  <div id="app" data-initial='${initial.replace(/'/g, "&#39;")}'></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
};
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
