import type { ClassConfigSchemaItem, ColorGroup, ToggleSchemaItem } from "./types";
export { STYLE_PRESET_DEFINITIONS } from "./stylePresets";

export const TOGGLE_SCHEMA: ToggleSchemaItem[] = [
  { id: "enable_heading_theme", command: "EnableHeadingTheme", label: "Heading Theme", help: "Style chapter/section/subsection headings." },
  { id: "enable_toc_theme", command: "EnableTOCTheme", label: "TOC Theme", help: "Style table of contents typography and spacing." },
  { id: "enable_page_theme", command: "EnablePageTheme", label: "Page Header Theme", help: "Enable custom header/footer with chapter marker." },
  { id: "enable_enhanced_env_style", command: "EnableEnhancedEnvStyle", label: "Enhanced Block Style", help: "Use richer theorem/callout box styling." },
  { id: "enable_plain_amsthm_theorem", command: "EnablePlainAmsthmTheorem", label: "Plain amsthm Theorem", help: "Switch theorem family to native amsthm environments.", default: false },
  { id: "enable_block_shadow", command: "EnableBlockShadow", label: "Block Shadow", help: "Add subtle right/bottom shadow lines on blocks." }
];

export const CLASS_CONFIG_SCHEMA: ClassConfigSchemaItem[] = [
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

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: "Document",
    items: [
      ["theme-chapter", "Chapter title"], ["theme-section", "Section title"], ["theme-subsection", "Subsection title"],
      ["theme-toc-title", "TOC title"], ["theme-toc-chapter", "TOC chapter"], ["theme-toc-section", "TOC section"],
      ["theme-header-rule", "Header rule"], ["theme-bold", "Bold text"]
    ].map(([id, label]) => ({ id, label }))
  },
  {
    title: "Inline Text",
    items: [
      ["inline-key-fg", "Key"], ["inline-term-bg", "Term bg"], ["inline-term-fg", "Term text"], ["inline-warn-fg", "Warn"],
      ["inline-todo-bg", "TODO bg"], ["inline-todo-fg", "TODO text"], ["inline-code-bg", "Code bg"], ["inline-code-fg", "Code text"],
      ["sidenote-fg", "Side note text"], ["sidenote-accent", "Side note accent"],
      ["chapter-overview-bg", "Overview bg"], ["chapter-overview-title-bg", "Overview title bg"], ["chapter-overview-title-fg", "Overview title"],
      ["chapter-overview-accent", "Overview accent"]
    ].map(([id, label]) => ({ id, label }))
  },
  ...[
    ["Definition", "definition"], ["Theorem", "theorem"], ["Lemma", "lemma"], ["Corollary", "corollary"],
    ["Proposition", "proposition"], ["Claim", "claim"], ["Fact", "fact"], ["Assumption", "assumption"]
  ].map(([title, prefix]) => ({
    title,
    items: [
      [`${prefix}-body-bg`, "Body bg"], [`${prefix}-title-bg`, "Title bg"],
      [`${prefix}-title-fg`, "Title fg"], [`${prefix}-accent`, "Accent"]
    ].map(([id, label]) => ({ id, label }))
  })),
  {
    title: "Note",
    items: [
      ["note-bg", "Body bg"], ["note-title-bg", "Title bg"], ["note-title-fg", "Title fg"], ["note-accent", "Accent"], ["note-frame", "Frame"]
    ].map(([id, label]) => ({ id, label }))
  },
  {
    title: "Example / Remark / Assump",
    items: [
      ["example-bg", "Example bg"], ["example-label-fg", "Example label"], ["example-accent", "Example accent"],
      ["remark-bg", "Remark bg"], ["remark-label-fg", "Remark label"], ["remark-inline-fg", "Remark inline"], ["remark-accent", "Remark accent"],
      ["assump-bg", "Assump bg"], ["assump-label-fg", "Assump label"], ["assump-accent", "Assump accent"]
    ].map(([id, label]) => ({ id, label }))
  },
  {
    title: "Study Callouts",
    items: [
      ["insight-bg", "Insight bg"], ["insight-label-fg", "Insight label"], ["insight-accent", "Insight accent"],
      ["pitfall-bg", "Pitfall bg"], ["pitfall-label-fg", "Pitfall label"], ["pitfall-accent", "Pitfall accent"],
      ["intuition-bg", "Intuition bg"], ["intuition-label-fg", "Intuition label"], ["intuition-accent", "Intuition accent"],
      ["summary-bg", "Summary bg"], ["summary-label-fg", "Summary label"], ["summary-accent", "Summary accent"],
      ["question-bg", "Question bg"], ["question-label-fg", "Question label"], ["question-accent", "Question accent"]
    ].map(([id, label]) => ({ id, label }))
  }
];

export const COLOR_ORDER = COLOR_GROUPS.flatMap((group) => group.items.map((item) => item.id));
export const COLOR_SET = new Set(COLOR_ORDER);
export const TOGGLE_IDS = TOGGLE_SCHEMA.map((item) => item.id);
export const CLASS_CONFIG_IDS = CLASS_CONFIG_SCHEMA.map((item) => item.id);
export const CLASS_CONFIG_COMMANDS = Object.fromEntries(CLASS_CONFIG_SCHEMA.map((item) => [item.id, item.command]));
export const CLASS_CONFIG_DEFAULTS = Object.fromEntries(CLASS_CONFIG_SCHEMA.map((item) => [item.id, item.options[0]?.value ?? "auto"]));
export const CLASS_CONFIG_VALID_OPTIONS = Object.fromEntries(CLASS_CONFIG_SCHEMA.map((item) => [item.id, new Set(item.options.map((opt) => opt.value))]));

export const BODY_FONT_SIZE_CONFIG = {
  id: "body_font_size_pt" as const,
  label: "Body Font Size",
  help: "Base body text font size applied at begin document.",
  min: 9.0,
  max: 14.0,
  step: 0.5,
  default: 10.0
};

export const STARTER_TEMPLATE_DEFINITIONS = [
  { id: "book-minimal", label: "Book Minimal", description: "Minimal book starter wired to theme.sty and theorem blocks.", filename: "book-minimal.tex" },
  { id: "article-minimal", label: "Article Minimal", description: "Minimal article starter wired to theme.sty and theorem blocks.", filename: "article-minimal.tex" },
  { id: "homework-assignment", label: "Homework Assignment", description: "Formal homework starter with problem, part, and solution environments.", filename: "homework-assignment.tex" }
];

export const CHAPTER_CLASS_NAMES = new Set(["book", "report", "memoir", "scrbook", "scrreprt", "ctexbook", "ctexrep", "bxjsbook"]);
