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

// src/schema.ts
var TOGGLE_SCHEMA, CLASS_CONFIG_SCHEMA, COLOR_GROUPS, COLOR_ORDER, COLOR_SET, TOGGLE_IDS, CLASS_CONFIG_IDS, CLASS_CONFIG_COMMANDS, CLASS_CONFIG_DEFAULTS, CLASS_CONFIG_VALID_OPTIONS, BODY_FONT_SIZE_CONFIG, STYLE_PRESET_METADATA, DOCUMENT_COLOR_TOKENS, INLINE_COLOR_TOKENS, BLOCK_COLOR_TOKENS, STARTER_TEMPLATE_DEFINITIONS, CHAPTER_CLASS_NAMES, BLOCK_PRESET_DEFINITIONS, HEADING_TOC_PRESET_DEFINITIONS, DEFAULT_STYLE_COLORS, STYLE_SUPPORT_COLOR_SOURCES, STYLE_PRESET_DEFINITIONS;
var init_schema = __esm({
  "src/schema.ts"() {
    "use strict";
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
    STYLE_PRESET_METADATA = [
      {
        id: "default",
        label: "Default",
        description: "Balanced slate document colors with the built-in theorem and inline styles.",
        block_source: "default",
        heading_source: "default",
        bold_color: "#334155"
      },
      {
        id: "midnight",
        label: "Midnight",
        description: "Cool high-contrast blues for focused technical notes.",
        block_source: "midnight",
        heading_source: "inkstone",
        bold_color: "#273B66"
      },
      {
        id: "meadow",
        label: "Meadow",
        description: "Soft green-blue blocks with calm earth-tone accents.",
        block_source: "meadow",
        heading_source: "aurora",
        bold_color: "#12727E"
      },
      {
        id: "ember",
        label: "Ember",
        description: "Warm rust, amber, rose, and plum contrast.",
        block_source: "ember",
        heading_source: "sunset",
        bold_color: "#A3422E"
      },
      {
        id: "uchicago",
        label: "UChicago",
        description: "Maroon-forward colors with greystone contrast.",
        block_source: "uchicago",
        heading_source: "uchicago",
        bold_color: "#800000"
      }
    ];
    DOCUMENT_COLOR_TOKENS = COLOR_ORDER.filter((token) => token.startsWith("theme-"));
    INLINE_COLOR_TOKENS = COLOR_ORDER.filter((token) => token.startsWith("inline-"));
    BLOCK_COLOR_TOKENS = COLOR_ORDER.filter((token) => !token.startsWith("theme-") && !INLINE_COLOR_TOKENS.includes(token));
    STARTER_TEMPLATE_DEFINITIONS = [
      { id: "book-minimal", label: "Book Minimal", description: "Minimal book starter wired to theme.sty and theorem blocks.", filename: "book-minimal.tex" },
      { id: "article-minimal", label: "Article Minimal", description: "Minimal article starter wired to theme.sty and theorem blocks.", filename: "article-minimal.tex" },
      { id: "homework-assignment", label: "Homework Assignment", description: "Formal homework starter with problem, part, and solution environments.", filename: "homework-assignment.tex" }
    ];
    CHAPTER_CLASS_NAMES = /* @__PURE__ */ new Set(["book", "report", "memoir", "scrbook", "scrreprt", "ctexbook", "ctexrep", "bxjsbook"]);
    BLOCK_PRESET_DEFINITIONS = [
      { id: "default", label: "Default", description: "Current built-in theorem/callout palette from theme.sty." },
      {
        id: "midnight",
        label: "Midnight",
        description: "Cool, high-contrast palette for theorem and callout blocks.",
        colors: {
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
          "assump-accent": "#A0801A"
        }
      },
      {
        id: "meadow",
        label: "Meadow",
        description: "Soft green-blue palette with calm earth-tone accents.",
        colors: {
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
          "assump-accent": "#8B9A33"
        }
      },
      {
        id: "ember",
        label: "Ember",
        description: "Warm sunset palette with rose, amber, and plum contrast.",
        colors: {
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
          "assump-accent": "#A58625"
        }
      },
      {
        id: "uchicago",
        label: "UChicago",
        description: "Maroon-forward palette with greystone neutrals for University of Chicago styled notes.",
        colors: {
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
    HEADING_TOC_PRESET_DEFINITIONS = [
      { id: "default", label: "Default", description: "Current built-in heading/TOC palette from theme.sty." },
      { id: "inkstone", label: "Inkstone", description: "Deep indigo heading palette with restrained TOC contrast.", colors: { "theme-chapter": "#1F2A44", "theme-section": "#273B66", "theme-subsection": "#35589A", "theme-toc-title": "#1E2D53", "theme-toc-chapter": "#243A6A", "theme-toc-section": "#4465A8", "theme-header-rule": "#1B2948" } },
      { id: "aurora", label: "Aurora", description: "Cool teal-forward scheme for modern notes and reports.", colors: { "theme-chapter": "#0E5A61", "theme-section": "#12727E", "theme-subsection": "#2F94A3", "theme-toc-title": "#0F6169", "theme-toc-chapter": "#107681", "theme-toc-section": "#2C8D99", "theme-header-rule": "#0D4A50" } },
      { id: "sunset", label: "Sunset", description: "Warm rust and amber hierarchy for chapter and TOC headings.", colors: { "theme-chapter": "#8A2E3B", "theme-section": "#A3422E", "theme-subsection": "#C26C2A", "theme-toc-title": "#7A2A36", "theme-toc-chapter": "#954137", "theme-toc-section": "#B66232", "theme-header-rule": "#6F2D33" } },
      { id: "uchicago", label: "UChicago", description: "University of Chicago maroon with greystone heading contrast.", colors: { "theme-chapter": "#800000", "theme-section": "#800000", "theme-subsection": "#737373", "theme-toc-title": "#800000", "theme-toc-chapter": "#800000", "theme-toc-section": "#737373", "theme-header-rule": "#A6A6A6" } }
    ];
    DEFAULT_STYLE_COLORS = {
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
    };
    STYLE_SUPPORT_COLOR_SOURCES = {
      "inline-key-fg": "definition-accent",
      "inline-term-bg": "definition-body-bg",
      "inline-term-fg": "definition-title-fg",
      "inline-warn-fg": "claim-accent",
      "inline-todo-bg": "assumption-body-bg",
      "inline-todo-fg": "assumption-title-fg",
      "inline-code-bg": "fact-body-bg",
      "inline-code-fg": "fact-title-fg",
      "sidenote-fg": "note-title-fg",
      "sidenote-accent": "note-accent",
      "chapter-overview-bg": "note-bg",
      "chapter-overview-title-bg": "note-title-bg",
      "chapter-overview-title-fg": "note-title-fg",
      "chapter-overview-accent": "note-accent",
      "insight-bg": "example-bg",
      "insight-label-fg": "example-label-fg",
      "insight-accent": "example-accent",
      "pitfall-bg": "claim-body-bg",
      "pitfall-label-fg": "claim-title-fg",
      "pitfall-accent": "claim-accent",
      "intuition-bg": "lemma-body-bg",
      "intuition-label-fg": "lemma-title-fg",
      "intuition-accent": "lemma-accent",
      "summary-bg": "fact-body-bg",
      "summary-label-fg": "fact-title-fg",
      "summary-accent": "fact-accent",
      "question-bg": "assumption-body-bg",
      "question-label-fg": "assumption-title-fg",
      "question-accent": "assumption-accent"
    };
    STYLE_PRESET_DEFINITIONS = STYLE_PRESET_METADATA.map((definition) => {
      const block = BLOCK_PRESET_DEFINITIONS.find((item) => item.id === definition.block_source);
      const heading = HEADING_TOC_PRESET_DEFINITIONS.find((item) => item.id === definition.heading_source);
      const colors = { ...DEFAULT_STYLE_COLORS };
      Object.assign(colors, block?.colors ?? {});
      Object.assign(colors, heading?.colors ?? {});
      if (definition.block_source !== "default") {
        for (const [target, source] of Object.entries(STYLE_SUPPORT_COLOR_SOURCES)) {
          if (!(target in (block?.colors ?? {})) && colors[source]) colors[target] = colors[source];
        }
      }
      colors["theme-bold"] = definition.bold_color;
      for (const token of COLOR_ORDER) colors[token] ??= DEFAULT_STYLE_COLORS[token] ?? "#808080";
      return { ...definition, colors };
    });
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
    await import_node_fs2.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function statOrNull(filePath) {
  try {
    return await import_node_fs2.promises.stat(filePath);
  } catch {
    return null;
  }
}
function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}
function isSubpath(child, parent) {
  const childResolved = path2.resolve(child);
  const parentResolved = path2.resolve(parent);
  const relative3 = path2.relative(parentResolved, childResolved);
  return relative3 === "" || !!relative3 && !relative3.startsWith("..") && !path2.isAbsolute(relative3);
}
function workspaceRel(rootDir, absolutePath) {
  if (!isSubpath(absolutePath, rootDir)) {
    throw new Error(`Path is outside workspace: ${absolutePath}`);
  }
  return toPosixPath(path2.relative(rootDir, absolutePath));
}
function resolveWorkspacePath(rootDir, relPath, mustStayInside = true) {
  if (path2.isAbsolute(relPath)) {
    if (mustStayInside && !isSubpath(relPath, rootDir)) {
      throw new Error(`Path is outside workspace: ${relPath}`);
    }
    return path2.resolve(relPath);
  }
  const resolved = path2.resolve(rootDir, relPath);
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
  const resolved = path2.resolve(texPath);
  if (visited.has(resolved)) return "";
  visited.add(resolved);
  const text = await import_node_fs2.promises.readFile(resolved, "utf8");
  const declaration = extractDocumentclassDeclaration(text);
  if (!declaration) return "";
  if (declaration.className !== "subfiles") return declaration.className;
  const parentRef = declaration.options.split(",")[0]?.trim();
  if (!parentRef) return declaration.className;
  const parent = path2.resolve(path2.dirname(resolved), parentRef);
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
function matchesGlob(relPath, basename8, pattern) {
  const normalized = toPosixPath(relPath);
  if (!pattern.includes("/")) {
    return globToRegExp(pattern).test(basename8);
  }
  return globToRegExp(pattern).test(normalized);
}
async function listFilesRecursive(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await import_node_fs2.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORE_DIR_NAMES.has(entry.name)) continue;
      const abs = path2.join(dir, entry.name);
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
    if (IGNORE_TEX_FILENAMES.has(path2.basename(abs))) continue;
    try {
      const text = await import_node_fs2.promises.readFile(abs, "utf8");
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
  const text = await import_node_fs2.promises.readFile(themePath, "utf8");
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
var import_node_fs2, path2, import_node_url, IGNORE_TEX_FILENAMES, IGNORE_DIR_NAMES, BASE_COLORS;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    import_node_fs2 = require("node:fs");
    path2 = __toESM(require("node:path"));
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
var fs10 = __toESM(require("node:fs"));
var path10 = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));

// src/projectRegistry.ts
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"));
var LOCAL_PROJECTS_STATE_KEY = "latexEditingToolkit.localProjects";
var LocalProjectRegistry = class {
  constructor(store, stateKey = LOCAL_PROJECTS_STATE_KEY) {
    this.store = store;
    this.stateKey = stateKey;
  }
  store;
  stateKey;
  async list() {
    const entries = this.readEntries();
    const statuses = await Promise.all(entries.map(async (entry) => ({
      ...entry,
      missing: !await this.isDirectory(entry.rootPath)
    })));
    return statuses.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async add(rootPath, templateId) {
    const normalizedPath = normalizeProjectPath(rootPath);
    const entries = this.readEntries();
    const existing = entries.find((entry2) => sameProjectPath(entry2.rootPath, normalizedPath));
    const entry = existing ? {
      ...existing,
      rootPath: normalizedPath,
      label: path.basename(normalizedPath),
      templateId: String(templateId || existing.templateId || "unknown")
    } : {
      id: (0, import_node_crypto.randomUUID)(),
      rootPath: normalizedPath,
      label: path.basename(normalizedPath),
      templateId: String(templateId || "unknown"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const next = existing ? entries.map((item) => sameProjectPath(item.rootPath, normalizedPath) ? entry : item) : [...entries, entry];
    await this.writeEntries(next);
    return entry;
  }
  async remove(rootPath) {
    const normalizedPath = normalizeProjectPath(rootPath);
    const entries = this.readEntries();
    const next = entries.filter((entry) => !sameProjectPath(entry.rootPath, normalizedPath));
    if (next.length === entries.length) return false;
    await this.writeEntries(next);
    return true;
  }
  async relocate(oldRootPath, newRootPath) {
    const oldPath = normalizeProjectPath(oldRootPath);
    const newPath = normalizeProjectPath(newRootPath);
    if (!await this.isDirectory(newPath)) throw new Error("The selected location is not a local directory.");
    if (!await this.isRegularFile(path.join(newPath, "main.tex"))) {
      throw new Error("The selected directory does not contain main.tex.");
    }
    const entries = this.readEntries();
    const current = entries.find((entry) => sameProjectPath(entry.rootPath, oldPath));
    if (!current) throw new Error("The local note project is no longer registered.");
    const duplicate = entries.find((entry) => entry.id !== current.id && sameProjectPath(entry.rootPath, newPath));
    if (duplicate) throw new Error(`The selected directory is already registered as '${duplicate.label}'.`);
    const updated = {
      ...current,
      rootPath: newPath,
      label: path.basename(newPath)
    };
    await this.writeEntries(entries.map((entry) => entry.id === current.id ? updated : entry));
    return updated;
  }
  readEntries() {
    const raw = this.store.get(this.stateKey);
    if (!Array.isArray(raw)) return [];
    const entries = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of raw) {
      if (!isRecord(item)) continue;
      const rawRootPath = typeof item.rootPath === "string" ? item.rootPath : item.root_path;
      const rootPath = typeof rawRootPath === "string" ? safeNormalizeProjectPath(rawRootPath) : void 0;
      if (!rootPath) continue;
      const key = projectPathKey(rootPath);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: typeof item.id === "string" && item.id ? item.id : legacyProjectId(rootPath),
        rootPath,
        label: typeof item.label === "string" && item.label ? item.label : path.basename(rootPath),
        templateId: typeof item.templateId === "string" && item.templateId ? item.templateId : typeof item.template_id === "string" && item.template_id ? item.template_id : "unknown",
        createdAt: typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : typeof item.created_at === "string" && !Number.isNaN(Date.parse(item.created_at)) ? item.created_at : (/* @__PURE__ */ new Date(0)).toISOString()
      });
    }
    return entries;
  }
  async writeEntries(entries) {
    await this.store.update(this.stateKey, entries);
  }
  async isDirectory(target) {
    try {
      return (await import_node_fs.promises.stat(target)).isDirectory();
    } catch {
      return false;
    }
  }
  async isRegularFile(target) {
    try {
      return (await import_node_fs.promises.stat(target)).isFile();
    } catch {
      return false;
    }
  }
};
function normalizeProjectPath(rawPath) {
  const normalized = safeNormalizeProjectPath(rawPath);
  if (!normalized) throw new Error("Local note project path must be an absolute local path.");
  return normalized;
}
function safeNormalizeProjectPath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value || !path.isAbsolute(value)) return void 0;
  return path.normalize(value);
}
function sameProjectPath(left, right) {
  return projectPathKey(left) === projectPathKey(right);
}
function projectPathKey(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}
function legacyProjectId(rootPath) {
  return `legacy-${(0, import_node_crypto.createHash)("sha1").update(projectPathKey(rootPath)).digest("hex").slice(0, 16)}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/extension.ts
init_schema();

// src/toolkitService.ts
var import_node_fs9 = require("node:fs");
var path9 = __toESM(require("node:path"));

// src/cleanup.ts
var import_node_fs4 = require("node:fs");
var path4 = __toESM(require("node:path"));

// src/vscodeSettings.ts
var import_node_fs3 = require("node:fs");
var path3 = __toESM(require("node:path"));
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
  const settingsPath = path3.join(rootDir, ".vscode", "settings.json");
  try {
    const text = await import_node_fs3.promises.readFile(settingsPath, "utf8");
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
  const settingsPath = path3.join(rootDir, ".vscode", "settings.json");
  try {
    const stat = await import_node_fs3.promises.stat(settingsPath);
    if (stat.isDirectory()) throw new Error(".vscode/settings.json is a directory.");
    return { generated: false, generated_path: ".vscode/settings.json", message: ".vscode/settings.json already exists; left unchanged." };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await import_node_fs3.promises.mkdir(path3.dirname(settingsPath), { recursive: true });
  await import_node_fs3.promises.writeFile(settingsPath, `${JSON.stringify(toolkitVscodeSettingsTemplate(), null, 2)}
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
      const entries = await import_node_fs4.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "__pycache__"].includes(entry.name)) continue;
        const abs = path4.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile() && entry.name.endsWith(".tex")) {
          try {
            const text = await import_node_fs4.promises.readFile(abs, "utf8");
            const declaration = extractDocumentclassDeclaration(text);
            if (declaration?.className === "subfiles" && path4.dirname(abs) !== this.rootDir) {
              scope.add(workspaceRel(this.rootDir, path4.dirname(abs)));
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
      const scopeAbs = path4.resolve(this.rootDir, scope);
      if (!isSubpath(scopeAbs, this.rootDir) || !await exists(scopeAbs)) continue;
      const files = await this.listScopeFiles(scopeAbs, recursiveAll);
      for (const abs of files) {
        const relToScope = safeWorkspaceRel(scopeAbs, abs) || path4.basename(abs);
        const workspaceRelative = workspaceRel(this.rootDir, abs);
        const basename8 = path4.basename(abs);
        if (!patterns.some((pattern) => matchesGlob(relToScope, basename8, pattern))) continue;
        if (protectedPatterns.some((pattern) => matchesGlob(relToScope, basename8, pattern))) {
          skipped.push(workspaceRelative);
          continue;
        }
        try {
          if (!dryRun) await import_node_fs4.promises.unlink(abs);
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
      for (const entry of await import_node_fs4.promises.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || ["node_modules", ".git"].includes(entry.name)) continue;
        const abs = path4.join(dir, entry.name);
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
      const scopeAbs = path4.resolve(this.rootDir, scope);
      const dirs = [];
      const collect = async (dir) => {
        for (const entry of await import_node_fs4.promises.readdir(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const abs = path4.join(dir, entry.name);
            dirs.push(abs);
            await collect(abs);
          }
        }
      };
      if (await exists(scopeAbs)) await collect(scopeAbs);
      dirs.sort((a, b) => b.length - a.length);
      for (const dir of dirs) {
        try {
          const entries = await import_node_fs4.promises.readdir(dir);
          if (entries.length === 0) {
            if (!dryRun) await import_node_fs4.promises.rmdir(dir);
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
var import_node_fs5 = require("node:fs");
var path5 = __toESM(require("node:path"));
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
    const targetAbs = path5.resolve(this.rootDir, compileTarget);
    if (!isSubpath(targetAbs, this.rootDir)) throw new Error(`Compile target is outside workspace: ${compileTarget}`);
    const compileCwd = path5.dirname(targetAbs);
    const docfile = path5.basename(targetAbs);
    const docstem = path5.basename(targetAbs, path5.extname(targetAbs));
    const defaultPdfAbs = path5.join(compileCwd, `${docstem}.pdf`);
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
    const targetStat = await import_node_fs5.promises.stat(ctx.targetAbs).catch(() => null);
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
      const resolved = path5.resolve(filePath);
      if (visiting.has(resolved)) {
        issues.push(`Recursive subfile cycle detected: ${[...chain, resolved].map((item) => safeWorkspaceRel(this.rootDir, item) || item).join(" -> ")}`);
        return;
      }
      if (visited.has(resolved)) return;
      visited.add(resolved);
      visiting.add(resolved);
      let text = "";
      try {
        text = stripTexComments(await import_node_fs5.promises.readFile(resolved, "utf8"));
      } catch (err) {
        issues.push(`Failed to read source file: ${safeWorkspaceRel(this.rootDir, resolved)} (${err.message})`);
        visiting.delete(resolved);
        return;
      }
      for (const match of text.matchAll(SUBFILE_PATTERN)) {
        const raw = match[1].trim();
        const withExt = raw.endsWith(".tex") ? raw : `${raw}.tex`;
        const target = path5.isAbsolute(withExt) ? withExt : path5.resolve(path5.dirname(resolved), withExt);
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
    return value.replace(/%DOCFILE%/g, ctx.docfile).replace(/%DOC%/g, ctx.targetAbs).replace(/%DOC_EXT%/g, ctx.docfile).replace(/%DOCFILE_EXT%/g, ctx.docfile).replace(/%DOCFILE_NOEXT%/g, ctx.docstem).replace(/%DOC_NOEXT%/g, path5.join(ctx.compileCwd, ctx.docstem)).replace(/%OUTDIR%/g, outdir || ".");
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
    const outAbs = path5.isAbsolute(replaced) ? path5.resolve(replaced) : path5.resolve(ctx.compileCwd, replaced);
    if (!isSubpath(outAbs, this.rootDir)) return ctx.defaultPdfRel;
    return workspaceRel(this.rootDir, path5.join(outAbs, `${ctx.docstem}.pdf`));
  }
  async finalizeCompileOutput(ctx, logs, expectedPdfRel) {
    let pdfRel = expectedPdfRel;
    const expectedAbs = path5.resolve(this.rootDir, expectedPdfRel);
    if (!await exists(expectedAbs) && await exists(ctx.defaultPdfAbs)) {
      pdfRel = ctx.defaultPdfRel;
    }
    const pdfAbs = path5.resolve(this.rootDir, pdfRel);
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
    return new Promise((resolve9) => {
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
        resolve9({ code: 127, output: `${output}
${err.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve9({ code: code ?? 1, output });
      });
    });
  }
  async resolveBinary(command) {
    if (path5.isAbsolute(command) || command.includes(path5.sep)) return await exists(command) ? command : null;
    const paths = (process.env.PATH ?? "").split(path5.delimiter);
    const candidates = process.platform === "win32" ? [`${command}.exe`, `${command}.cmd`, command] : [command];
    for (const dir of paths) {
      for (const candidate of candidates) {
        const abs = path5.join(dir, candidate);
        if (await exists(abs)) return abs;
      }
    }
    return null;
  }
};

// src/splitter.ts
var import_node_fs6 = require("node:fs");
var path6 = __toESM(require("node:path"));
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
    const result = await this.splitTexFile(path6.resolve(this.rootDir, target), sectionsDir, dryRun);
    return { response: await this.stateService.buildResponseState(), split: result };
  }
  async renumberCompileTarget(compileTarget, mode, dryRun = false) {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.renumberReferences(path6.resolve(this.rootDir, target), mode, dryRun);
    return { response: await this.stateService.buildResponseState(), renumber: result };
  }
  async unsplitCompileTarget(compileTarget, dryRun = false, deleteSource = true) {
    const state = await this.stateService.loadState();
    const target = normalizeCompileTarget(this.rootDir, compileTarget, state.compile_targets);
    const result = await this.unsplitOneUnit(path6.resolve(this.rootDir, target), dryRun, deleteSource);
    return { response: await this.stateService.buildResponseState(), unsplit: result };
  }
  async splitTexFile(rootTexPath, sectionsDirRaw = "Sections", dryRun = false) {
    const rootAbs = path6.resolve(rootTexPath);
    if (!isSubpath(rootAbs, this.rootDir)) throw new Error("Split target is outside workspace.");
    const originalText = await import_node_fs6.promises.readFile(rootAbs, "utf8");
    const declaration = extractDocumentclassDeclaration(originalText);
    if (!declaration) throw new Error("Split source must contain a \\documentclass declaration.");
    if (declaration.className === "subfiles") throw new Error("Split source must be a root target, not a subfiles unit.");
    const splitCommand = isChapterCapableClass(declaration.className) ? "chapter" : "section";
    const bounds = this.findBodyBounds(originalText);
    const body = originalText.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path6.dirname(rootAbs), body);
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
    const sectionsAbs = path6.resolve(path6.dirname(rootAbs), sectionsRel);
    if (!isSubpath(sectionsAbs, this.rootDir)) throw new Error("Sections directory is outside workspace.");
    const seenSlugs = /* @__PURE__ */ new Map();
    const units = [];
    const replacements = [];
    let index = existingPrefixMax + 1;
    for (const chunk of newChunks) {
      const slug = this.stableSlug(chunk.anchor.title, seenSlugs);
      let unitPath;
      do {
        unitPath = path6.join(sectionsAbs, `${String(index).padStart(2, "0")}-${slug}.tex`);
        index += 1;
      } while (await exists(unitPath));
      const ref = this.relativeTexReference(path6.dirname(rootAbs), unitPath);
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
      await import_node_fs6.promises.mkdir(sectionsAbs, { recursive: true });
      await import_node_fs6.promises.copyFile(rootAbs, backupPath);
      await import_node_fs6.promises.writeFile(rootAbs, rewritten, "utf8");
      for (const unit of units) {
        const unitAbs = path6.resolve(this.rootDir, unit.path);
        const chunk = newChunks[units.indexOf(unit)];
        await import_node_fs6.promises.writeFile(unitAbs, this.buildSubfileUnitText(rootAbs, unitAbs, body.slice(chunk.anchor.start, chunk.end)), "utf8");
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
    const rootAbs = path6.resolve(rootTexPath);
    const text = await import_node_fs6.promises.readFile(rootAbs, "utf8");
    const bounds = this.findBodyBounds(text);
    const body = text.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path6.dirname(rootAbs), body);
    const renameMap = /* @__PURE__ */ new Map();
    const replacements = [];
    const warnings = [];
    let counter = 1;
    for (const ref of refs) {
      const ext = path6.extname(ref.path);
      const dir = path6.dirname(ref.path);
      const stem = path6.basename(ref.path, ext);
      const match = NUMERIC_PREFIX_PATTERN.exec(stem);
      let newStem;
      if (mode === "add") {
        newStem = match ? stem : `${String(counter).padStart(2, "0")}-${stem}`;
        counter += 1;
      } else {
        newStem = match ? match[2] : stem;
      }
      const newPath = path6.join(dir, `${newStem}${ext || ".tex"}`);
      if (newPath !== ref.path) {
        if (await exists(newPath)) {
          warnings.push(`Skipped rename because target exists: ${workspaceRel(this.rootDir, newPath)}`);
          continue;
        }
        renameMap.set(ref.path, newPath);
        const newRef = this.relativeTexReference(path6.dirname(rootAbs), newPath).replace(/\.tex$/i, "");
        replacements.push({ start: ref.start, end: ref.end, text: `\\${ref.macro}{${newRef}}` });
      }
    }
    const rewritten = `${text.slice(0, bounds.bodyStart)}${this.applyReplacements(body, replacements)}${text.slice(bounds.bodyEnd)}`;
    if (!dryRun) {
      for (const [from, to] of renameMap) await import_node_fs6.promises.rename(from, to);
      if (replacements.length > 0) await import_node_fs6.promises.writeFile(rootAbs, rewritten, "utf8");
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
    const unitAbs = path6.resolve(unitPath);
    const unitText = await import_node_fs6.promises.readFile(unitAbs, "utf8");
    const declaration = extractDocumentclassDeclaration(unitText);
    if (!declaration || declaration.className !== "subfiles") throw new Error("Selected target is not a subfiles unit.");
    const parentRef = declaration.options.split(",")[0]?.trim();
    if (!parentRef) throw new Error("Subfiles unit is missing parent root reference.");
    const rootAbs = path6.resolve(path6.dirname(unitAbs), parentRef);
    if (!isSubpath(rootAbs, this.rootDir)) throw new Error("Parent root is outside workspace.");
    const rootText = await import_node_fs6.promises.readFile(rootAbs, "utf8");
    const bounds = this.findBodyBounds(rootText);
    const body = rootText.slice(bounds.bodyStart, bounds.bodyEnd);
    const refs = this.extractTopLevelReferences(path6.dirname(rootAbs), body);
    const matching = refs.find((ref) => path6.resolve(ref.path) === unitAbs);
    if (!matching) throw new Error("Could not find matching \\subfile reference in parent root.");
    const unitBody = this.extractUnitBody(unitText);
    const replacement = unitBody.endsWith("\n") ? unitBody : `${unitBody}
`;
    const newBody = `${body.slice(0, matching.start)}${replacement}${body.slice(matching.end)}`;
    const updated = [workspaceRel(this.rootDir, rootAbs)];
    if (!dryRun) {
      await import_node_fs6.promises.writeFile(rootAbs, `${rootText.slice(0, bounds.bodyStart)}${newBody}${rootText.slice(bounds.bodyEnd)}`, "utf8");
      if (deleteSource) {
        await import_node_fs6.promises.unlink(unitAbs);
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
      target = path6.isAbsolute(target) ? target : path6.resolve(baseDir, target);
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
      const stem = path6.basename(ref.path, path6.extname(ref.path));
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
    return toPosixPath(path6.relative(rootDir, targetTexPath)).replace(/\.tex$/i, "");
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
    const rootRel = toPosixPath(path6.relative(path6.dirname(unitAbs), rootAbs));
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
var import_node_fs7 = require("node:fs");
var path7 = __toESM(require("node:path"));
init_schema();
init_utils();
var StateService = class {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }
  rootDir;
  cachedThemeDefaults;
  configPath() {
    return path7.join(this.rootDir, "theme.ui.json");
  }
  toggleOverridePath() {
    return path7.join(this.rootDir, "theme.overrides.tex");
  }
  colorOverridePath() {
    return path7.join(this.rootDir, "theme.colors.tex");
  }
  themePath() {
    return path7.join(this.rootDir, "theme.sty");
  }
  mainTexPath() {
    return path7.join(this.rootDir, "main.tex");
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
        style_presets: state.style_presets,
        body_font_size: BODY_FONT_SIZE_CONFIG,
        starter_templates: starterTemplates,
        starter_default_template: starterTemplates.some((item) => item.id === "book-minimal") ? "book-minimal" : starterTemplates[0]?.id ?? "",
        starter_default_output_target: "main.tex"
      }
    };
  }
  async parseThemeDefaults() {
    if (!await exists(this.themePath())) {
      const fallback = {};
      for (const token of COLOR_ORDER) fallback[token] = "#808080";
      return fallback;
    }
    return parseThemeColorDefaults(this.themePath(), COLOR_ORDER);
  }
  async loadState() {
    const themeDefaults = await this.parseThemeDefaults();
    this.cachedThemeDefaults = { ...themeDefaults };
    const styleCatalog = this.buildStylePresetCatalog(themeDefaults);
    const compileTargets = await this.listCandidateTexFiles();
    const recipeCatalog = await loadRecipeCatalog(this.rootDir);
    const compileRecipes = recipeCatalog.recipes;
    const state = {
      toggles: await this.parseMainToggleDefaults(),
      colors: { ...themeDefaults },
      style_preset: this.defaultPresetId(styleCatalog),
      style_presets: this.presetMeta(styleCatalog),
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
    this.finishNormalization(state, recipeCatalog);
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
    let requestedStylePreset;
    if ("style_preset" in payload) {
      requestedStylePreset = this.normalizePreset(String(payload.style_preset ?? ""), normalized.style_presets);
    } else if ("block_preset" in payload) {
      requestedStylePreset = this.styleIdFromBlockPreset(String(payload.block_preset ?? ""));
    } else if ("heading_toc_preset" in payload) {
      requestedStylePreset = this.styleIdFromHeadingPreset(String(payload.heading_toc_preset ?? ""));
    }
    if (requestedStylePreset) {
      normalized.style_preset = requestedStylePreset;
      const hasExplicitColors = rawColors && typeof rawColors === "object" && !Array.isArray(rawColors) && Object.keys(rawColors).length > 0;
      if (!hasExplicitColors) {
        const preset = this.buildStylePresetCatalog(this.cachedThemeDefaults ?? {}).find((item) => item.id === requestedStylePreset);
        if (preset) {
          for (const token of COLOR_ORDER) normalized.colors[token] = preset.colors?.[token] ?? "#808080";
        }
      }
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
    await import_node_fs7.promises.writeFile(this.configPath(), `${JSON.stringify(uiState, null, 2)}
`, "utf8");
  }
  async writeOverrideFiles(state) {
    state.style_preset = this.normalizePreset(state.style_preset, state.style_presets);
    state.body_font_size_pt = normalizeBodyFontSize(state.body_font_size_pt);
    state.class_config = this.normalizeClassConfigMap(state.class_config);
    await this.refreshDerivedState(state);
    await this.persistUiState(state);
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
    await import_node_fs7.promises.writeFile(this.toggleOverridePath(), `${toggleLines.join("\n")}
`, "utf8");
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
    await import_node_fs7.promises.writeFile(this.colorOverridePath(), `${colorLines.join("\n")}
`, "utf8");
  }
  async deleteOverrideFiles() {
    for (const file of [this.configPath(), this.toggleOverridePath(), this.colorOverridePath()]) {
      try {
        await import_node_fs7.promises.unlink(file);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
  }
  applyStylePreset(state, presetId) {
    const catalog = this.buildStylePresetCatalog(this.cachedThemeDefaults ?? {});
    const selected = this.normalizePreset(presetId, this.presetMeta(catalog));
    const preset = catalog.find((item) => item.id === selected);
    if (!preset) throw new Error(`Unknown style preset: ${presetId}`);
    for (const token of COLOR_ORDER) {
      state.colors[token] = preset.colors?.[token] ?? "#808080";
    }
    state.style_preset = selected;
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
    const templateDir = path7.join(this.rootDir, "templates");
    const assetTemplateDir = path7.resolve(__dirname, "..", "assets", "template", "templates");
    const out = [];
    for (const entry of STARTER_TEMPLATE_DEFINITIONS) {
      if (await exists(path7.join(templateDir, entry.filename)) || await exists(path7.join(assetTemplateDir, entry.filename))) {
        out.push({ id: entry.id, label: entry.label, description: entry.description });
      }
    }
    return out;
  }
  async templateSourcePath(filename) {
    const workspaceTemplate = path7.join(this.rootDir, "templates", filename);
    if (await exists(workspaceTemplate)) return workspaceTemplate;
    return path7.resolve(__dirname, "..", "assets", "template", "templates", filename);
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
      const targetAbs = path7.resolve(this.rootDir, state.compile_target);
      const targetDir = path7.dirname(targetAbs);
      const stem = path7.basename(targetAbs, ".tex");
      for (const toolName of recipe.tools) {
        const tool = catalog.tools[toolName];
        if (!tool) continue;
        const outdir = this.extractRecipeOutdir(tool.args);
        if (!outdir) continue;
        const normalizedOutdir = outdir === "%OUTDIR%" ? "." : outdir.replace(/%DOCFILE_NOEXT%/g, stem).replace(/%DOCFILE%/g, path7.basename(targetAbs)).replace(/%DOC%/g, targetAbs);
        const outAbs = path7.isAbsolute(normalizedOutdir) ? path7.resolve(normalizedOutdir) : path7.resolve(targetDir, normalizedOutdir);
        if (!isSubpath(outAbs, this.rootDir)) return compileOutputPdfRelpath(state.compile_target);
        return workspaceRel(this.rootDir, path7.join(outAbs, `${stem}.pdf`));
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
      const abs = path7.resolve(this.rootDir, targetRel);
      return await extractDocumentclassName(abs, this.rootDir);
    } catch {
      return "";
    }
  }
  async parseMainToggleDefaults() {
    const defaults = {};
    let text = "";
    try {
      text = await import_node_fs7.promises.readFile(this.mainTexPath(), "utf8");
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
    try {
      const raw = JSON.parse(await import_node_fs7.promises.readFile(this.configPath(), "utf8"));
      if (raw.toggles && typeof raw.toggles === "object" && !Array.isArray(raw.toggles)) {
        for (const [key, value] of Object.entries(raw.toggles)) if (key in state.toggles) state.toggles[key] = Boolean(value);
      }
      if (raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors)) {
        for (const [key, value] of Object.entries(raw.colors)) {
          const parsed = parseHexColor(String(value));
          if (parsed && key in state.colors) state.colors[key] = parsed;
        }
      }
      if (typeof raw.style_preset === "string") {
        state.style_preset = this.normalizePreset(raw.style_preset, state.style_presets);
      } else if (typeof raw.block_preset === "string") {
        state.style_preset = this.styleIdFromBlockPreset(raw.block_preset);
      }
      if ("body_font_size_pt" in raw) state.body_font_size_pt = normalizeBodyFontSize(raw.body_font_size_pt);
      if (raw.class_config && typeof raw.class_config === "object" && !Array.isArray(raw.class_config)) state.class_config = this.normalizeClassConfigMap(raw.class_config);
      if ("compile_target" in raw) state.compile_target = normalizeCompileTarget(this.rootDir, raw.compile_target, state.compile_targets);
      if ("compile_recipe" in raw) state.compile_recipe = this.normalizeCompileRecipe(raw.compile_recipe, state.compile_recipes);
      if (typeof raw.compile_use_internal_fallback === "boolean") state.compile_use_internal_fallback = raw.compile_use_internal_fallback;
      if (typeof raw.compile_output_pdf === "string") state.compile_output_pdf = raw.compile_output_pdf;
      if (typeof raw.compile_output_pdf_expected === "string") state.compile_output_pdf_expected = raw.compile_output_pdf_expected;
      if (typeof raw.compile_last_compile_at === "string") state.compile_last_compile_at = raw.compile_last_compile_at;
      if (typeof raw.compile_last_success === "boolean") state.compile_last_success = raw.compile_last_success;
    } catch (err) {
      if (err.code !== "ENOENT") {
      }
    }
  }
  async mergeOverrideFiles(state) {
    try {
      const text = await import_node_fs7.promises.readFile(this.toggleOverridePath(), "utf8");
      for (const entry of TOGGLE_SCHEMA) {
        const matches = Array.from(text.matchAll(new RegExp(`\\\\${entry.command}(true|false)`, "g")));
        if (matches.length > 0) state.toggles[entry.id] = boolFromTex(matches.at(-1)?.[1] ?? "") ?? state.toggles[entry.id];
      }
      for (const field of CLASS_CONFIG_IDS) {
        const command = CLASS_CONFIG_COMMANDS[field];
        const matches = Array.from(text.matchAll(new RegExp(`\\\\def\\\\${command}\\{([^}]+)\\}`, "g")));
        if (matches.length > 0) state.class_config[field] = this.normalizeClassConfigValue(field, matches.at(-1)?.[1]);
      }
      const fontMatch = Array.from(text.matchAll(/\\def\\ThemeBodyFontSizePt\{([^}]+)\}/g));
      if (fontMatch.length > 0) state.body_font_size_pt = normalizeBodyFontSize(fontMatch.at(-1)?.[1]);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    try {
      const text = await import_node_fs7.promises.readFile(this.colorOverridePath(), "utf8");
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
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  finishNormalization(state, _recipeCatalog) {
    for (const key of TOGGLE_IDS) state.toggles[key] = Boolean(state.toggles[key]);
    for (const key of COLOR_ORDER) state.colors[key] = parseHexColor(state.colors[key] ?? "") ?? "#808080";
    state.class_config = this.normalizeClassConfigMap(state.class_config);
    state.body_font_size_pt = normalizeBodyFontSize(state.body_font_size_pt);
    state.compile_output_pdf = safeWorkspaceRel(this.rootDir, state.compile_output_pdf) || state.compile_output_pdf_expected || compileOutputPdfRelpath(state.compile_target);
  }
  buildStylePresetCatalog(_defaults) {
    return STYLE_PRESET_DEFINITIONS.map((definition) => ({
      ...definition,
      colors: { ...definition.colors }
    }));
  }
  styleDefinition(styleId) {
    return STYLE_PRESET_DEFINITIONS.find((item) => item.id === styleId) ?? STYLE_PRESET_DEFINITIONS[0];
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
  await import_node_fs7.promises.mkdir(dest, { recursive: true });
  for (const entry of await import_node_fs7.promises.readdir(src, { withFileTypes: true })) {
    const srcPath = path7.join(src, entry.name);
    const destPath = path7.join(dest, entry.name);
    if (entry.isDirectory()) await copyDirectory(srcPath, destPath);
    else if (entry.isFile()) await import_node_fs7.promises.copyFile(srcPath, destPath);
  }
}
async function copyMissingDirectory(src, dest, relLabel, copied) {
  if (!await exists(dest)) {
    await copyDirectory(src, dest);
    copied.push(`${relLabel}/`);
    return;
  }
  for (const entry of await import_node_fs7.promises.readdir(src, { withFileTypes: true })) {
    const source = path7.join(src, entry.name);
    const target = path7.join(dest, entry.name);
    if (await exists(target)) continue;
    if (entry.isDirectory()) {
      await copyDirectory(source, target);
      copied.push(`${relLabel}/${entry.name}/`);
    } else if (entry.isFile()) {
      await import_node_fs7.promises.copyFile(source, target);
      copied.push(`${relLabel}/${entry.name}`);
    }
  }
}
async function ensureWorkspaceTemplateAssets(rootDir, extensionDir) {
  const assetRoot = path7.join(extensionDir, "assets", "template");
  const copied = [];
  const files = ["theme.sty", "theorems.tex", "commands.tex", "references.bib"];
  for (const file of files) {
    const target = path7.join(rootDir, file);
    if (!await exists(target)) {
      await import_node_fs7.promises.copyFile(path7.join(assetRoot, file), target);
      copied.push(file);
    }
  }
  await copyMissingDirectory(path7.join(assetRoot, "Fig"), path7.join(rootDir, "Fig"), "Fig", copied);
  await copyMissingDirectory(path7.join(assetRoot, "templates"), path7.join(rootDir, "templates"), "templates", copied);
  return copied.map((item) => item.endsWith("/") ? item : workspaceRel(rootDir, path7.join(rootDir, item)));
}

// src/template.ts
var import_node_fs8 = require("node:fs");
var path8 = __toESM(require("node:path"));
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
  async upgradeThemeAssets(resetColorOverrides) {
    const assetRoot = path8.join(this.extensionDir, "assets", "template");
    const backupDir = path8.join(this.rootDir, ".latex-editing-toolkit", "backups", this.timestamp());
    const upgradedFiles = [];
    const resetFiles = [];
    const skippedMissingFiles = [];
    for (const file of UPGRADE_THEME_ASSET_FILES) {
      const source = path8.join(assetRoot, file);
      const target = path8.join(this.rootDir, file);
      this.assertInsideWorkspace(target);
      if (!await exists(source)) {
        skippedMissingFiles.push(file);
        continue;
      }
      if (await exists(target)) await this.backupFile(target, backupDir);
      await import_node_fs8.promises.mkdir(path8.dirname(target), { recursive: true });
      await import_node_fs8.promises.copyFile(source, target);
      upgradedFiles.push(file);
    }
    if (resetColorOverrides) {
      for (const file of COLOR_OVERRIDE_FILES) {
        const target = path8.join(this.rootDir, file);
        this.assertInsideWorkspace(target);
        if (!await exists(target)) {
          skippedMissingFiles.push(file);
          continue;
        }
        await this.backupFile(target, backupDir);
        await import_node_fs8.promises.unlink(target);
        resetFiles.push(file);
      }
    }
    return {
      success: true,
      backup_dir: workspaceRel(this.rootDir, backupDir),
      upgraded_files: upgradedFiles,
      reset_files: resetFiles,
      skipped_missing_files: skippedMissingFiles
    };
  }
  async createStarter(templateId, outputTarget, overwrite) {
    await ensureWorkspaceTemplateAssets(this.rootDir, this.extensionDir);
    const normalizedTarget = this.normalizeOutputTarget(outputTarget);
    const template = STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === String(templateId || "").trim()) ?? STARTER_TEMPLATE_DEFINITIONS.find((entry) => entry.id === "book-minimal") ?? STARTER_TEMPLATE_DEFINITIONS[0];
    if (!template) throw new Error("No starter templates available.");
    const targetAbs = path8.resolve(this.rootDir, normalizedTarget);
    const existed = await exists(targetAbs);
    if (existed) {
      const stat = await import_node_fs8.promises.stat(targetAbs);
      if (stat.isDirectory()) throw new Error(`Output target is a directory: ${normalizedTarget}`);
      if (!overwrite) throw new Error(`Output target already exists: ${normalizedTarget}. Set overwrite=true to replace it.`);
    }
    const source = await this.stateService.templateSourcePath(template.filename);
    const text = await import_node_fs8.promises.readFile(source, "utf8");
    if (!extractDocumentclassDeclaration(text)) throw new Error(`Starter template is missing a valid \\documentclass declaration: ${template.filename}`);
    await import_node_fs8.promises.mkdir(path8.dirname(targetAbs), { recursive: true });
    await import_node_fs8.promises.writeFile(targetAbs, text, "utf8");
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
    if (path8.isAbsolute(target)) throw new Error("Output target must be workspace-relative.");
    if (!path8.extname(target)) target += ".tex";
    if (path8.extname(target).toLowerCase() !== ".tex") throw new Error("Output target must end with .tex.");
    const resolved = path8.resolve(this.rootDir, target);
    if (!isSubpath(resolved, this.rootDir)) throw new Error("Output target is outside workspace.");
    return workspaceRel(this.rootDir, resolved);
  }
  async backupFile(source, backupDir) {
    this.assertInsideWorkspace(source);
    const rel = workspaceRel(this.rootDir, source);
    const backupPath = path8.join(backupDir, rel);
    this.assertInsideWorkspace(backupPath);
    await import_node_fs8.promises.mkdir(path8.dirname(backupPath), { recursive: true });
    await import_node_fs8.promises.copyFile(source, backupPath);
  }
  assertInsideWorkspace(absPath) {
    if (!isSubpath(path8.resolve(absPath), this.rootDir)) throw new Error("Theme asset path is outside workspace.");
  }
  timestamp() {
    return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(".", "-");
  }
};

// src/toolkitService.ts
var ToolkitService = class {
  constructor(rootDir, extensionDir) {
    this.rootDir = rootDir;
    this.extensionDir = extensionDir;
    this.state = new StateService(rootDir);
    this.compile = new CompileService(rootDir, this.state);
    this.cleanup = new CleanupService(rootDir);
    this.splitter = new SplitterService(rootDir, this.state);
    this.template = new TemplateService(rootDir, extensionDir, this.state);
  }
  rootDir;
  extensionDir;
  state;
  compile;
  cleanup;
  splitter;
  template;
  queue = Promise.resolve();
  async handle(command, payload = {}) {
    switch (command) {
      case "state":
        return this.state.buildResponseState();
      case "save":
        return this.runSerialized(async () => {
          const normalized = await this.state.normalizePayload(payload);
          await this.state.writeOverrideFiles(normalized);
          return this.state.buildResponseState();
        });
      case "target":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, { compile_target: normalized.compile_target });
          await this.state.persistUiState(current);
          return this.state.buildResponseState();
        });
      case "compile-config":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          const normalized = await this.state.normalizePayload(payload, current);
          await this.state.applyCompilePreferences(current, {
            compile_recipe: normalized.compile_recipe,
            compile_use_internal_fallback: normalized.compile_use_internal_fallback
          });
          await this.state.persistUiState(current);
          return this.state.buildResponseState();
        });
      case "template-bootstrap":
        return this.runSerialized(async () => {
          const result = await this.template.createStarter(payload.template_id, payload.output_target, Boolean(payload.overwrite));
          return { ...result.response, generated_target: result.generated_target, overwrote_existing: result.overwrote_existing };
        });
      case "vscode-settings-generate":
        return this.runSerialized(async () => {
          const generated = await generateVscodeSettingsIfMissing(this.rootDir);
          return { ...await this.state.buildResponseState(), ...generated };
        });
      case "split":
      case "split-preview":
        return this.runSerialized(async () => {
          const result = await this.splitter.splitCompileTarget(String(payload.compile_target ?? ""), command === "split-preview" ? true : Boolean(payload.dry_run), String(payload.sections_dir ?? "Sections"));
          return { ...result.response, split: result.split };
        });
      case "renumber":
        return this.runSerialized(async () => {
          const result = await this.splitter.renumberCompileTarget(String(payload.compile_target ?? ""), String(payload.mode ?? "add"), Boolean(payload.dry_run));
          return { ...result.response, renumber: result.renumber };
        });
      case "unsplit":
        return this.runSerialized(async () => {
          const result = await this.splitter.unsplitCompileTarget(String(payload.compile_target ?? ""), Boolean(payload.dry_run), payload.delete_source !== false);
          return { ...result.response, unsplit: result.unsplit };
        });
      case "style-preset":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          this.state.applyStylePreset(current, String(payload.style_preset ?? current.style_preset));
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "block-preset":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          this.state.applyBlockPreset(current, String(payload.block_preset ?? current.style_preset));
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "heading-toc-preset":
        return this.runSerialized(async () => {
          const current = await this.state.loadState();
          this.state.applyHeadingTocPreset(current, String(payload.heading_toc_preset ?? current.style_preset));
          await this.state.writeOverrideFiles(current);
          return this.state.buildResponseState();
        });
      case "reset":
        return this.runSerialized(async () => {
          await this.state.deleteOverrideFiles();
          return this.state.buildResponseState();
        });
      case "clean":
        return this.runSerialized(async () => this.cleanup.clean(Boolean(payload.dry_run)));
      case "compile":
        return this.runSerialized(async () => this.compile.compileFromPayload(payload));
      case "initialize-workspace":
        return this.runSerialized(async () => this.template.initializeWorkspace());
      case "upgrade-theme-assets":
        return this.runSerialized(async () => this.template.upgradeThemeAssets(Boolean(payload.reset_color_overrides)));
      case "pdf-uri":
        return this.resolvePdfPath(String(payload.path ?? ""));
      default:
        throw new Error(`Unknown toolkit command: ${command}`);
    }
  }
  resolvePdfPath(rawPath) {
    const rel = rawPath.trim() || "main.pdf";
    const resolved = path9.resolve(this.rootDir, rel);
    if (!resolved.endsWith(".pdf")) throw new Error("PDF path must end with .pdf.");
    if (!resolved.startsWith(path9.resolve(this.rootDir) + path9.sep) && resolved !== path9.resolve(this.rootDir)) {
      throw new Error("PDF path is outside workspace.");
    }
    return resolved;
  }
  async readPdfIfExists(rawPath) {
    const pdf = this.resolvePdfPath(rawPath);
    await import_node_fs9.promises.access(pdf);
    return pdf;
  }
  runSerialized(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => void 0);
    return next;
  }
};

// src/extension.ts
var activePanel;
function activate(context) {
  const projectRegistry = new LocalProjectRegistry(context.globalState);
  const treeProvider = new ToolkitTreeProvider(context, projectRegistry);
  context.subscriptions.push(
    treeProvider,
    vscode.window.registerTreeDataProvider("latexEditingToolkit.actions", treeProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => treeProvider.refresh()),
    vscode.commands.registerCommand("latexEditingToolkit.openToolkit", async (folderUri) => {
      const folder = await selectWorkspaceFolder(folderUri);
      if (!folder) return;
      activePanel = ToolkitPanel.createOrShow(context, folder);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.createProject", async () => {
      const target = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Create Toolkit Project Here"
      });
      if (!target?.[0]) return;
      if (target[0].scheme !== "file") {
        vscode.window.showErrorMessage("LaTeX Editing Toolkit currently supports local file workspaces only.");
        return;
      }
      const pickedTemplate = await vscode.window.showQuickPick(
        STARTER_TEMPLATE_DEFINITIONS.map((template) => ({
          label: template.label,
          description: template.id,
          detail: template.description,
          template
        })),
        { placeHolder: "Select starter template" }
      );
      if (!pickedTemplate) return;
      const service = new ToolkitService(target[0].fsPath, context.extensionPath);
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Creating LaTeX Toolkit project" }, async () => {
        await service.handle("initialize-workspace", {});
        await service.handle("template-bootstrap", { template_id: pickedTemplate.template.id, output_target: "main.tex", overwrite: false });
      });
      await projectRegistry.add(target[0].fsPath, pickedTemplate.template.id);
      vscode.window.showInformationMessage(`Created LaTeX Toolkit project in ${target[0].fsPath}.`);
      treeProvider.refresh();
      await vscode.commands.executeCommand("vscode.openFolder", target[0], { forceNewWindow: false });
    }),
    vscode.commands.registerCommand("latexEditingToolkit.openLocalProject", async (projectPath) => {
      await openLocalProject(projectPath);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.relocateLocalProject", async (projectPath) => {
      await relocateLocalProject(projectRegistry, treeProvider, projectPath);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.removeLocalProject", async (projectPath) => {
      await removeLocalProject(projectRegistry, treeProvider, projectPath);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.refreshTree", () => {
      treeProvider.refresh();
    }),
    vscode.commands.registerCommand("latexEditingToolkit.createStarterInWorkspace", async (folderUri) => {
      await createStarterInWorkspace(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickCompileTarget", async (folderUri) => {
      await pickCompileTarget(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickCompileRecipe", async (folderUri) => {
      await pickCompileRecipe(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.toggleInternalFallback", async (folderUri) => {
      await toggleInternalFallback(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.openCurrentPdf", async (folderUri) => {
      await openCurrentPdf(context, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.toggleThemeOption", async (folderUri, toggleId) => {
      await toggleThemeOption(context, treeProvider, folderUri, toggleId);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickClassConfig", async (folderUri, fieldId) => {
      await pickClassConfig(context, treeProvider, folderUri, fieldId);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickStylePreset", async (folderUri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    // Legacy command aliases now use the unified style preset.
    vscode.commands.registerCommand("latexEditingToolkit.pickBlockPreset", async (folderUri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickHeadingTocPreset", async (folderUri) => {
      await pickStylePreset(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.pickBodyFontSize", async (folderUri) => {
      await pickBodyFontSize(context, treeProvider, folderUri);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.initializeWorkspace", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("initialize-workspace", {});
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Initialized LaTeX Toolkit workspace: ${JSON.stringify(result)}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.upgradeWorkspaceThemeAssets", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const choice = await vscode.window.showWarningMessage(
        "Upgrade workspace theme assets from the bundled extension template? Existing files will be backed up first.",
        { modal: true },
        "Upgrade + Reset Colors",
        "Upgrade Assets Only"
      );
      if (!choice) return;
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Upgrading LaTeX Toolkit theme assets" },
        () => service.handle("upgrade-theme-assets", { reset_color_overrides: choice === "Upgrade + Reset Colors" })
      );
      const resetSuffix = result.reset_files?.length ? ` Reset ${result.reset_files.length} color override file(s).` : "";
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Upgraded ${result.upgraded_files?.length ?? 0} theme asset(s). Backup: ${result.backup_dir}.${resetSuffix}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.generateVscodeSettings", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const result = await service.handle("vscode-settings-generate", {});
      treeProvider.refresh();
      vscode.window.showInformationMessage(result.message ?? "VS Code settings checked.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.saveOverrides", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      await service.handle("save", response.state);
      treeProvider.refresh();
      vscode.window.showInformationMessage("Saved LaTeX Toolkit overrides.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.resetOverrides", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Delete theme.ui.json, theme.overrides.tex, and theme.colors.tex?", { modal: true }, "Delete");
      if (ok !== "Delete") return;
      await service.handle("reset", {});
      treeProvider.refresh();
      vscode.window.showInformationMessage("Deleted LaTeX Toolkit override files.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.compilePdf", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Compiling LaTeX PDF" }, () => service.handle("compile", response.state));
      const success = Boolean(result.success);
      treeProvider.refresh();
      vscode.window.showInformationMessage(success ? "LaTeX compile succeeded." : "LaTeX compile failed. Open Toolkit for logs.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.cleanArtifacts", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const ok = await vscode.window.showWarningMessage("Clean LaTeX build artifacts in the workspace?", { modal: true }, "Clean");
      if (ok !== "Clean") return;
      const result = await service.handle("clean", {});
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Cleaned ${result.deleted_count ?? 0} file(s).${result.errors?.length ? " Some errors occurred." : ""}`);
    }),
    vscode.commands.registerCommand("latexEditingToolkit.splitCurrentTarget", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      await service.handle("split", { compile_target: response.state.compile_target ?? "main.tex", dry_run: false });
      treeProvider.refresh();
      vscode.window.showInformationMessage("Split current LaTeX target.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.renumberUnits", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      await service.handle("renumber", { compile_target: response.state.compile_target ?? "main.tex", mode: "add", dry_run: false });
      treeProvider.refresh();
      vscode.window.showInformationMessage("Renumbered referenced units.");
    }),
    vscode.commands.registerCommand("latexEditingToolkit.unsplitUnit", async (folderUri) => {
      const service = await serviceForCommand(context, folderUri);
      if (!service) return;
      const response = await service.handle("state", {});
      const ok = await vscode.window.showWarningMessage("Merge selected subfiles unit back to its root and delete the source unit?", { modal: true }, "Merge");
      if (ok !== "Merge") return;
      await service.handle("unsplit", { compile_target: response.state.compile_target ?? "", dry_run: false, delete_source: true });
      treeProvider.refresh();
      vscode.window.showInformationMessage("Merged selected unit back to root.");
    })
  );
}
function deactivate() {
  activePanel?.dispose();
  activePanel = void 0;
}
async function selectWorkspaceFolder(preferredFolderUri) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage("Open a local workspace folder before using LaTeX Editing Toolkit.");
    return void 0;
  }
  const localFolders = folders.filter((folder) => folder.uri.scheme === "file");
  if (localFolders.length === 0) {
    vscode.window.showErrorMessage("LaTeX Editing Toolkit currently supports local file workspaces only.");
    return void 0;
  }
  if (preferredFolderUri?.scheme === "file") {
    const matched = localFolders.find((folder) => folder.uri.toString() === preferredFolderUri.toString());
    if (matched) return matched;
  }
  if (localFolders.length === 1) return localFolders[0];
  const picked = await vscode.window.showQuickPick(localFolders.map((folder) => ({ label: folder.name, folder })), { placeHolder: "Select Toolkit workspace" });
  return picked?.folder;
}
async function serviceForCommand(context, preferredFolderUri) {
  return (await folderAndServiceForCommand(context, preferredFolderUri))?.service;
}
async function folderAndServiceForCommand(context, preferredFolderUri) {
  const folder = await selectWorkspaceFolder(preferredFolderUri);
  if (!folder) return void 0;
  return { folder, service: new ToolkitService(folder.uri.fsPath, context.extensionPath) };
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
    vscode.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  try {
    if (!fs10.statSync(projectPath).isDirectory()) throw new Error("not a directory");
  } catch {
    vscode.window.showWarningMessage(`Local note project not found: ${projectPath}`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(projectPath), { forceNewWindow: false });
}
async function relocateLocalProject(registry, treeProvider, projectPathArg) {
  const oldPath = localProjectPathFromArgument(projectPathArg);
  if (!oldPath) {
    vscode.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  const target = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Relocate Toolkit Project Here"
  });
  if (!target?.[0]) return;
  if (target[0].scheme !== "file") {
    vscode.window.showErrorMessage("LaTeX Editing Toolkit only supports local project folders.");
    return;
  }
  try {
    const updated = await registry.relocate(oldPath, target[0].fsPath);
    treeProvider.refresh();
    vscode.window.showInformationMessage(`Relocated local note project to ${updated.rootPath}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Could not relocate local note project: ${err.message}`);
  }
}
async function removeLocalProject(registry, treeProvider, projectPathArg) {
  const projectPath = localProjectPathFromArgument(projectPathArg);
  if (!projectPath) {
    vscode.window.showWarningMessage("The selected local note project could not be resolved.");
    return;
  }
  const project = (await registry.list()).find((entry) => entry.rootPath === path10.normalize(projectPath));
  const label = project?.label ?? path10.basename(path10.normalize(projectPath));
  const choice = await vscode.window.showWarningMessage(
    `Forget local note project '${label}'? This only removes it from the Toolkit list and does not delete files.`,
    { modal: true },
    "Forget"
  );
  if (choice !== "Forget") return;
  const removed = await registry.remove(projectPath);
  treeProvider.refresh();
  vscode.window.showInformationMessage(removed ? `Forgot local note project '${label}'.` : "Local note project was already removed.");
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
  const picked = await vscode.window.showQuickPick(
    templates.map((template) => ({
      label: template.label,
      description: template.id,
      detail: template.description,
      template
    })),
    { placeHolder: "Select starter template" }
  );
  if (!picked) return;
  const outputTarget = await vscode.window.showInputBox({
    title: "Generate Starter",
    prompt: "Workspace-relative .tex file to create",
    value: scoped.response.schema.starter_default_output_target || "main.tex"
  });
  if (!outputTarget) return;
  let overwrite = false;
  if (fs10.existsSync(path10.resolve(scoped.folder.uri.fsPath, outputTarget))) {
    const ok = await vscode.window.showWarningMessage(`${outputTarget} already exists. Overwrite it?`, { modal: true }, "Overwrite");
    if (ok !== "Overwrite") return;
    overwrite = true;
  }
  const result = await scoped.service.handle("template-bootstrap", {
    template_id: picked.template.id,
    output_target: outputTarget,
    overwrite
  });
  treeProvider.refresh();
  vscode.window.showInformationMessage(`Generated ${result.generated_target ?? outputTarget}.`);
}
async function pickCompileTarget(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const targets = scoped.response.state.compile_targets;
  if (targets.length === 0) {
    vscode.window.showWarningMessage("No LaTeX compile targets found in this workspace.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target,
      description: target === scoped.response.state.compile_target ? "current" : ""
    })),
    { placeHolder: "Select compile target" }
  );
  if (!picked) return;
  await scoped.service.handle("target", { compile_target: picked.label });
  treeProvider.refresh();
  vscode.window.showInformationMessage(`Compile target set to ${picked.label}.`);
}
async function pickCompileRecipe(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const recipes = scoped.response.state.compile_recipes;
  if (recipes.length === 0) {
    vscode.window.showWarningMessage("No VS Code LaTeX recipes found. Generate VS Code settings or use internal fallback.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
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
  vscode.window.showInformationMessage(`Compile recipe set to ${picked.recipe.name}.`);
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
  vscode.window.showInformationMessage(`Internal fallback ${next ? "enabled" : "disabled"}.`);
}
async function openCurrentPdf(context, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const rawPath = currentPdfPath(scoped.response.state);
  try {
    const pdfPath = await scoped.service.readPdfIfExists(rawPath);
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(pdfPath));
  } catch {
    vscode.window.showWarningMessage(`PDF not found yet: ${rawPath}`);
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
  vscode.window.showInformationMessage(`${toggle.label}: ${state.toggles[toggleId] ? "on" : "off"}.`);
}
async function pickClassConfig(context, treeProvider, folderUri, fieldId) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped || !fieldId) return;
  const field = scoped.response.schema.class_config.find((item) => item.id === fieldId);
  if (!field) return;
  const current = scoped.response.state.class_config[field.id];
  const picked = await vscode.window.showQuickPick(
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
  vscode.window.showInformationMessage(`${field.label}: ${picked.option.label}.`);
}
async function pickStylePreset(context, treeProvider, folderUri) {
  const scoped = await responseForCommand(context, folderUri);
  if (!scoped) return;
  const presets = scoped.response.schema.style_presets;
  const current = scoped.response.state.style_preset;
  const picked = await vscode.window.showQuickPick(
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
  vscode.window.showInformationMessage(`Style preset: ${picked.preset.label}.`);
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
  const picked = await vscode.window.showQuickPick(
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
  vscode.window.showInformationMessage(`${config.label}: ${picked.label}.`);
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
  changeEmitter = new vscode.EventEmitter();
  onDidChangeTreeData = this.changeEmitter.event;
  refresh() {
    this.changeEmitter.fire();
  }
  dispose() {
    this.changeEmitter.dispose();
  }
  getTreeItem(node) {
    const collapsibleState = node.collapsibleState ?? (node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip ?? node.label;
    item.contextValue = node.contextValue;
    item.resourceUri = node.resourceUri;
    if (node.iconId) item.iconPath = new vscode.ThemeIcon(node.iconId);
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
    const localFolders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
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
    nodes.push({
      id: "create-new-project",
      label: "Create New Project",
      description: "from template",
      tooltip: "Create a LaTeX Toolkit project in a selected local folder.",
      iconId: "new-folder",
      commandId: "latexEditingToolkit.createProject",
      contextValue: "createProject"
    });
    return nodes;
  }
  async localNotesNode() {
    const projects = await this.projectRegistry.list();
    const children = projects.length > 0 ? projects.map((project) => this.localProjectNode(project)) : [
      this.infoNode("local-notes-empty", "No local notes yet", "Create a project to add it here.", "info"),
      this.actionNode("local-notes-create", "Create New Project", "from template", "new-folder", "latexEditingToolkit.createProject", [])
    ];
    return this.groupNode(
      "local-notes",
      "Local Notes",
      "book",
      children,
      vscode.TreeItemCollapsibleState.Expanded
    );
  }
  localProjectNode(project) {
    return {
      id: `local-project:${project.id}`,
      label: project.label,
      description: project.missing ? "Missing" : project.rootPath,
      tooltip: project.missing ? `Project folder not found: ${project.rootPath}` : project.rootPath,
      iconId: project.missing ? "warning" : "folder",
      commandId: "latexEditingToolkit.openLocalProject",
      commandArgs: [project.rootPath],
      contextValue: project.missing ? "localProjectMissing" : "localProject",
      resourceUri: vscode.Uri.file(project.rootPath)
    };
  }
  async workspaceNode(folder, isOnlyFolder) {
    const description = isOnlyFolder ? path10.dirname(folder.uri.fsPath) : folder.uri.fsPath;
    const response = await this.loadWorkspaceState(folder);
    return {
      id: `workspace:${folder.uri.toString()}`,
      label: folder.name,
      description,
      tooltip: folder.uri.fsPath,
      iconId: "root-folder",
      resourceUri: folder.uri,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      contextValue: "workspace",
      children: response instanceof Error ? this.workspaceErrorGroups(folder, response) : this.workspaceGroups(folder, response)
    };
  }
  async loadWorkspaceState(folder) {
    try {
      return await new ToolkitService(folder.uri.fsPath, this.context.extensionPath).handle("state", {});
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }
  workspaceGroups(folder, response) {
    const folderArg = [folder.uri];
    const state = response.state;
    const schema = response.schema;
    return [
      this.groupNode(`status:${folder.uri.toString()}`, "Status", "pulse", [
        this.actionNode("status-target", "Target", state.compile_target || "select target", "symbol-file", "latexEditingToolkit.pickCompileTarget", folderArg),
        this.actionNode("status-recipe", "Recipe", this.compileRecipeDescription(state), "settings-gear", "latexEditingToolkit.pickCompileRecipe", folderArg),
        this.actionNode("status-pdf", "PDF", currentPdfPath(state), "open-preview", "latexEditingToolkit.openCurrentPdf", folderArg),
        this.infoNode(`status-last-compile:${folder.uri.toString()}`, "Last Compile", this.lastCompileDescription(state), this.lastCompileIcon(state)),
        this.infoNode(`status-class:${folder.uri.toString()}`, "Document Class", this.documentClassDescription(state), "symbol-class")
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`project:${folder.uri.toString()}`, "Project", "repo", [
        this.actionNode("open-toolkit", "Open Toolkit", "webview", "tools", "latexEditingToolkit.openToolkit", folderArg),
        this.actionNode("generate-starter", "Generate Starter", schema.starter_default_output_target || "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg)
      ]),
      this.groupNode(`build:${folder.uri.toString()}`, "Build", "run-all", [
        this.actionNode("compile-pdf", "Compile PDF", state.compile_target || "current target", "play", "latexEditingToolkit.compilePdf", folderArg),
        this.actionNode("pick-target", "Pick Target", `${state.compile_targets.length} found`, "symbol-file", "latexEditingToolkit.pickCompileTarget", folderArg),
        this.actionNode("pick-recipe", "Pick Recipe", `${state.compile_recipes.length} found`, "settings-gear", "latexEditingToolkit.pickCompileRecipe", folderArg),
        this.actionNode("toggle-internal-fallback", "Internal Fallback", state.compile_use_internal_fallback ? "on" : "off", "debug-restart", "latexEditingToolkit.toggleInternalFallback", folderArg),
        this.actionNode("open-current-pdf", "Open Current PDF", currentPdfPath(state), "open-preview", "latexEditingToolkit.openCurrentPdf", folderArg),
        this.actionNode("clean-artifacts", "Clean Build Artifacts", "workspace", "trash", "latexEditingToolkit.cleanArtifacts", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`structure:${folder.uri.toString()}`, "Structure", "list-tree", [
        this.actionNode("split-current", "Split Current Target", "subfiles", "split-horizontal", "latexEditingToolkit.splitCurrentTarget", folderArg),
        this.actionNode("renumber-units", "Renumber Units", "references", "list-ordered", "latexEditingToolkit.renumberUnits", folderArg),
        this.actionNode("unsplit-unit", "Merge Unit Back To Root", "selected target", "git-merge", "latexEditingToolkit.unsplitUnit", folderArg)
      ]),
      this.groupNode(`theme:${folder.uri.toString()}`, "Theme", "symbol-color", [
        this.groupNode(`theme-presets:${folder.uri.toString()}`, "Presets", "symbol-misc", [
          this.actionNode("pick-style-preset", "Style Preset", this.presetLabel(schema.style_presets, state.style_preset), "symbol-color", "latexEditingToolkit.pickStylePreset", folderArg),
          this.actionNode("pick-body-font-size", "Body Font Size", `${formatPointSize(state.body_font_size_pt)} pt`, "text-size", "latexEditingToolkit.pickBodyFontSize", folderArg)
        ], vscode.TreeItemCollapsibleState.Expanded),
        this.groupNode(`theme-class-config:${folder.uri.toString()}`, "Class Rules", "symbol-class", schema.class_config.map((field) => this.actionNode(
          `pick-class-config-${field.id}`,
          field.label,
          this.optionLabel(field.options, state.class_config[field.id]),
          "settings",
          "latexEditingToolkit.pickClassConfig",
          [folder.uri, field.id]
        )), vscode.TreeItemCollapsibleState.Expanded),
        this.groupNode(`theme-toggles:${folder.uri.toString()}`, "Feature Toggles", "checklist", schema.toggles.map((toggle) => this.actionNode(
          `toggle-theme-${toggle.id}`,
          toggle.label,
          state.toggles[toggle.id] ? "on" : "off",
          state.toggles[toggle.id] ? "check" : "circle-slash",
          "latexEditingToolkit.toggleThemeOption",
          [folder.uri, toggle.id]
        )), vscode.TreeItemCollapsibleState.Expanded),
        this.actionNode("save-overrides", "Save Overrides", "theme files", "save", "latexEditingToolkit.saveOverrides", folderArg),
        this.actionNode("reset-overrides", "Reset Overrides", "delete generated files", "discard", "latexEditingToolkit.resetOverrides", folderArg)
      ])
    ];
  }
  workspaceErrorGroups(folder, error) {
    const folderArg = [folder.uri];
    return [
      this.groupNode(`status:${folder.uri.toString()}`, "Status", "warning", [
        this.infoNode(`state-error:${folder.uri.toString()}`, "State Unavailable", error.message, "error"),
        this.actionNode("open-toolkit", "Open Toolkit", "webview", "tools", "latexEditingToolkit.openToolkit", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded),
      this.groupNode(`project:${folder.uri.toString()}`, "Project", "repo", [
        this.actionNode("generate-starter", "Generate Starter", "main.tex", "new-file", "latexEditingToolkit.createStarterInWorkspace", folderArg),
        this.actionNode("initialize-workspace", "Initialize Workspace", "copy", "package", "latexEditingToolkit.initializeWorkspace", folderArg),
        this.actionNode("upgrade-theme-assets", "Upgrade Theme Assets", "backup first", "cloud-download", "latexEditingToolkit.upgradeWorkspaceThemeAssets", folderArg),
        this.actionNode("generate-settings", "Generate VS Code Settings", ".vscode/settings.json", "settings-gear", "latexEditingToolkit.generateVscodeSettings", folderArg)
      ], vscode.TreeItemCollapsibleState.Expanded)
    ];
  }
  groupNode(id, label, iconId, children, collapsibleState = vscode.TreeItemCollapsibleState.Collapsed) {
    return {
      id,
      label,
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
      tooltip: label,
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
  constructor(context, folder, panel) {
    this.context = context;
    this.folder = folder;
    this.panel = panel;
    this.service = new ToolkitService(folder.uri.fsPath, context.extensionPath);
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables);
  }
  context;
  folder;
  panel;
  service;
  disposables = [];
  disposed = false;
  static createOrShow(context, folder) {
    if (activePanel) {
      if (activePanel.folder.uri.toString() === folder.uri.toString()) {
        activePanel.panel.reveal(vscode.ViewColumn.One);
        return activePanel;
      }
      activePanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      "latexEditingToolkit.toolkit",
      "LaTeX Editing Toolkit",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path10.join(context.extensionPath, "dist")),
          vscode.Uri.file(folder.uri.fsPath)
        ]
      }
    );
    return new _ToolkitPanel(context, folder, panel);
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
  async handleMessage(message) {
    const request = message;
    if (!request?.id || !request.command) return;
    try {
      let data;
      if (request.command === "pdf-uri") {
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = await this.service.readPdfIfExists(rawPath);
        data = { uri: this.panel.webview.asWebviewUri(vscode.Uri.file(pdfPath)).toString(), path: rawPath };
      } else if (request.command === "open-pdf") {
        const rawPath = String(request.payload?.path ?? "");
        const pdfPath = await this.service.readPdfIfExists(rawPath);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(pdfPath));
        data = { opened: true };
      } else {
        data = await this.service.handle(request.command, request.payload ?? {});
      }
      await this.panel.webview.postMessage({ id: request.id, ok: true, data });
    } catch (err) {
      await this.panel.webview.postMessage({ id: request.id, ok: false, error: err.message });
    }
  }
  html() {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path10.join(this.context.extensionPath, "dist", "webview.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path10.join(this.context.extensionPath, "dist", "webview.css")));
    const nonce = String(Date.now()) + String(Math.random()).slice(2);
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `frame-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`
    ].join("; ");
    const initial = JSON.stringify({ workspaceName: this.folder.name, workspacePath: this.folder.uri.fsPath });
    const cssExists = fs10.existsSync(path10.join(this.context.extensionPath, "dist", "webview.css"));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>LaTeX Editing Toolkit</title>
  ${cssExists ? `<link rel="stylesheet" href="${styleUri}">` : ""}
</head>
<body>
  <div id="app" data-initial='${initial.replace(/'/g, "&#39;")}'></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
