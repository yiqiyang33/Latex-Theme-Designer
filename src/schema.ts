import type { ClassConfigSchemaItem, ColorGroup, PresetDefinition, ToggleSchemaItem } from "./types";

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
    help: "Select theorem counter scope for definition/theorem family.",
    options: [
      { value: "auto", label: "Auto (book=chapter, article=section)" },
      { value: "section", label: "Within section" },
      { value: "chapter", label: "Within chapter (fallback section)" },
      { value: "none", label: "Global continuous counter" }
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

export const BOLD_TEXT_PRESETS = [
  { id: "soft-blue", label: "Soft Blue", color: "#3F6F9F" },
  { id: "slate-indigo", label: "Slate Indigo", color: "#4B5E8C" },
  { id: "deep-teal", label: "Deep Teal", color: "#2F6F73" },
  { id: "muted-violet", label: "Muted Violet", color: "#6F5A8A" },
  { id: "warm-rose", label: "Warm Rose", color: "#9A5C6A" },
  { id: "forest", label: "Forest", color: "#4E7357" }
];

export const DOCUMENT_COLOR_TOKENS = COLOR_ORDER.filter((token) => token.startsWith("theme-"));
export const INLINE_COLOR_TOKENS = COLOR_ORDER.filter((token) => token.startsWith("inline-"));
export const BLOCK_COLOR_TOKENS = COLOR_ORDER.filter((token) => !token.startsWith("theme-") && !INLINE_COLOR_TOKENS.includes(token));

export const STARTER_TEMPLATE_DEFINITIONS = [
  { id: "book-minimal", label: "Book Minimal", description: "Minimal book starter wired to theme.sty and theorem blocks.", filename: "book-minimal.tex" },
  { id: "article-minimal", label: "Article Minimal", description: "Minimal article starter wired to theme.sty and theorem blocks.", filename: "article-minimal.tex" },
  { id: "homework-assignment", label: "Homework Assignment", description: "Formal homework starter with problem, part, and solution environments.", filename: "homework-assignment.tex" }
];

export const CHAPTER_CLASS_NAMES = new Set(["book", "report", "memoir", "scrbook", "scrreprt", "ctexbook", "ctexrep", "bxjsbook"]);

export const BLOCK_PRESET_DEFINITIONS: PresetDefinition[] = [
  { id: "default", label: "Default", description: "Current built-in theorem/callout palette from theme.sty." },
  {
    id: "midnight",
    label: "Midnight",
    description: "Cool, high-contrast palette for theorem and callout blocks.",
    colors: {
      "definition-body-bg": "#EAF2FF", "definition-title-bg": "#C8DAFF", "definition-title-fg": "#0F2A5F", "definition-accent": "#2952A3",
      "theorem-body-bg": "#E6F9FF", "theorem-title-bg": "#B8EBF7", "theorem-title-fg": "#0D4A5A", "theorem-accent": "#1B7286",
      "lemma-body-bg": "#F5ECFF", "lemma-title-bg": "#DEC8F8", "lemma-title-fg": "#45226E", "lemma-accent": "#6A3CA0",
      "corollary-body-bg": "#FFF4E5", "corollary-title-bg": "#F9D7A8", "corollary-title-fg": "#6B3D00", "corollary-accent": "#A65A00",
      "proposition-body-bg": "#F7F8E8", "proposition-title-bg": "#E6E9B5", "proposition-title-fg": "#5C5E1A", "proposition-accent": "#8A8D2B",
      "claim-body-bg": "#FFF1F3", "claim-title-bg": "#F8CDD5", "claim-title-fg": "#612532", "claim-accent": "#9A4155",
      "fact-body-bg": "#F1F0F8", "fact-title-bg": "#D5D1EB", "fact-title-fg": "#2D234A", "fact-accent": "#5A4E88",
      "assumption-body-bg": "#FFF8E8", "assumption-title-bg": "#F2E2B5", "assumption-title-fg": "#5E4A14", "assumption-accent": "#927320",
      "note-bg": "#EEF2FF", "note-title-bg": "#CFD7FF", "note-title-fg": "#1B2562", "note-accent": "#3342A8", "note-frame": "#B8C3FF",
      "example-bg": "#E8FAFA", "example-label-fg": "#0F6E70", "example-accent": "#19989B",
      "remark-bg": "#F0F4FF", "remark-label-fg": "#233B88", "remark-inline-fg": "#2B4AB0", "remark-accent": "#3D56C2",
      "assump-bg": "#FFF9E9", "assump-label-fg": "#6B5B1F", "assump-accent": "#A0801A"
    }
  },
  {
    id: "meadow",
    label: "Meadow",
    description: "Soft green-blue palette with calm earth-tone accents.",
    colors: {
      "definition-body-bg": "#ECF8F1", "definition-title-bg": "#CDECDC", "definition-title-fg": "#1E4A34", "definition-accent": "#2F7A55",
      "theorem-body-bg": "#ECF7F9", "theorem-title-bg": "#CBE9F0", "theorem-title-fg": "#174452", "theorem-accent": "#2B7084",
      "lemma-body-bg": "#F2F0FA", "lemma-title-bg": "#DCCFF3", "lemma-title-fg": "#3F2D66", "lemma-accent": "#6945A6",
      "corollary-body-bg": "#FFF6E9", "corollary-title-bg": "#F8DBB3", "corollary-title-fg": "#6A4210", "corollary-accent": "#A0631C",
      "proposition-body-bg": "#F6F7E9", "proposition-title-bg": "#E2E7BD", "proposition-title-fg": "#4B5421", "proposition-accent": "#748233",
      "claim-body-bg": "#FFF1F0", "claim-title-bg": "#F9D3CF", "claim-title-fg": "#6A2F2A", "claim-accent": "#A14C43",
      "fact-body-bg": "#F3F2FA", "fact-title-bg": "#DCD6F0", "fact-title-fg": "#342A59", "fact-accent": "#5B4B8C",
      "assumption-body-bg": "#FFF9EA", "assumption-title-bg": "#F4E5BF", "assumption-title-fg": "#64531B", "assumption-accent": "#9A7A29",
      "note-bg": "#EEF8F5", "note-title-bg": "#D4ECE4", "note-title-fg": "#1F4A3D", "note-accent": "#2F7C64", "note-frame": "#B8DDD1",
      "example-bg": "#EBFAF6", "example-label-fg": "#1F6D5F", "example-accent": "#2D9E8A",
      "remark-bg": "#EEF4FB", "remark-label-fg": "#294A78", "remark-inline-fg": "#2F5A90", "remark-accent": "#3E6FB0",
      "assump-bg": "#F9FCEB", "assump-label-fg": "#5E6827", "assump-accent": "#8B9A33"
    }
  },
  {
    id: "ember",
    label: "Ember",
    description: "Warm sunset palette with rose, amber, and plum contrast.",
    colors: {
      "definition-body-bg": "#FFF3EE", "definition-title-bg": "#F7D4C7", "definition-title-fg": "#5F2D1F", "definition-accent": "#9A4B33",
      "theorem-body-bg": "#FFF7EC", "theorem-title-bg": "#F8DEB9", "theorem-title-fg": "#664110", "theorem-accent": "#A56A1E",
      "lemma-body-bg": "#F9F0FF", "lemma-title-bg": "#E7D2F6", "lemma-title-fg": "#4F2D67", "lemma-accent": "#7B49A2",
      "corollary-body-bg": "#FFF1F4", "corollary-title-bg": "#F8CFD8", "corollary-title-fg": "#652536", "corollary-accent": "#A0455C",
      "proposition-body-bg": "#FDF5E9", "proposition-title-bg": "#F0DDBD", "proposition-title-fg": "#5F481F", "proposition-accent": "#967034",
      "claim-body-bg": "#FFF0EB", "claim-title-bg": "#F8CEC0", "claim-title-fg": "#6A2C1D", "claim-accent": "#A44C33",
      "fact-body-bg": "#F2F3FD", "fact-title-bg": "#D8DCF7", "fact-title-fg": "#2C356D", "fact-accent": "#4657B5",
      "assumption-body-bg": "#FFF8EF", "assumption-title-bg": "#F5E3C6", "assumption-title-fg": "#6A4C20", "assumption-accent": "#A7782D",
      "note-bg": "#F8F2FF", "note-title-bg": "#E4D7F9", "note-title-fg": "#3F2A66", "note-accent": "#6243A3", "note-frame": "#CDBBEA",
      "example-bg": "#FFF9EF", "example-label-fg": "#7A4B13", "example-accent": "#B4711A",
      "remark-bg": "#FFF2F1", "remark-label-fg": "#7A3030", "remark-inline-fg": "#A04242", "remark-accent": "#C55A50",
      "assump-bg": "#FFF8E9", "assump-label-fg": "#6C5A20", "assump-accent": "#A58625"
    }
  }
];

export const HEADING_TOC_PRESET_DEFINITIONS: PresetDefinition[] = [
  { id: "default", label: "Default", description: "Current built-in heading/TOC palette from theme.sty." },
  { id: "inkstone", label: "Inkstone", description: "Deep indigo heading palette with restrained TOC contrast.", colors: { "theme-chapter": "#1F2A44", "theme-section": "#273B66", "theme-subsection": "#35589A", "theme-toc-title": "#1E2D53", "theme-toc-chapter": "#243A6A", "theme-toc-section": "#4465A8", "theme-header-rule": "#1B2948" } },
  { id: "aurora", label: "Aurora", description: "Cool teal-forward scheme for modern notes and reports.", colors: { "theme-chapter": "#0E5A61", "theme-section": "#12727E", "theme-subsection": "#2F94A3", "theme-toc-title": "#0F6169", "theme-toc-chapter": "#107681", "theme-toc-section": "#2C8D99", "theme-header-rule": "#0D4A50" } },
  { id: "sunset", label: "Sunset", description: "Warm rust and amber hierarchy for chapter and TOC headings.", colors: { "theme-chapter": "#8A2E3B", "theme-section": "#A3422E", "theme-subsection": "#C26C2A", "theme-toc-title": "#7A2A36", "theme-toc-chapter": "#954137", "theme-toc-section": "#B66232", "theme-header-rule": "#6F2D33" } }
];
