export type JsonObject = Record<string, unknown>;

export interface LocalProjectStateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void> | Thenable<void>;
}

export interface PersonalStyleRecord {
  version: 1;
  id: string;
  label: string;
  description: string;
  basePresetId: string;
  colors: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectDraft {
  parentPath: string;
  projectName: string;
  templateId: string;
}

export interface CreateProjectPreflightResult {
  ok: boolean;
  rootPath: string;
  targetExists: boolean;
  targetEmpty: boolean;
  errors: string[];
  warnings: string[];
  plannedFiles: string[];
}

export interface LocalNoteProject {
  id: string;
  rootPath: string;
  label: string;
  templateId: string;
  createdAt: string;
}

export interface LocalNoteProjectStatus extends LocalNoteProject {
  missing: boolean;
}

export interface ToggleSchemaItem {
  id: string;
  command: string;
  label: string;
  help: string;
  default?: boolean;
}

export interface OptionItem {
  value: string;
  label: string;
}

export interface ClassConfigSchemaItem {
  id: string;
  command: string;
  label: string;
  help: string;
  options: OptionItem[];
}

export interface ColorGroup {
  title: string;
  items: Array<{ id: string; label: string }>;
}

export interface CompileRecipe {
  id: string;
  name: string;
  tools: string[];
}

export interface CompileTool {
  name: string;
  command: string;
  args: string[];
}

export interface RecipeCatalog {
  tools: Record<string, CompileTool>;
  recipes: CompileRecipe[];
  errors: string[];
}

export interface ToolkitState {
  toggles: Record<string, boolean>;
  colors: Record<string, string>;
  style_preset: string;
  style_base_preset: string;
  style_presets: PresetMeta[];
  config_warnings: string[];
  body_font_size_pt: number;
  class_config: Record<string, string>;
  compile_target: string;
  compile_targets: string[];
  compile_recipe: string;
  compile_recipe_name: string;
  compile_recipes: CompileRecipe[];
  compile_recipe_errors: string[];
  compile_use_internal_fallback: boolean;
  compile_output_pdf: string;
  compile_output_pdf_expected: string;
  compile_last_compile_at: string;
  compile_last_success: boolean | null;
  detected_document_class: string;
  detected_document_class_has_chapter: boolean;
  effective_theme_class: "book" | "article";
}

export interface ToolkitSchema {
  toggles: ToggleSchemaItem[];
  groups: ColorGroup[];
  class_config: ClassConfigSchemaItem[];
  style_presets: StylePresetSchema[];
  body_font_size: {
    id: "body_font_size_pt";
    label: string;
    help: string;
    min: number;
    max: number;
    step: number;
    default: number;
  };
  starter_templates: StarterTemplateMeta[];
  starter_default_template: string;
  starter_default_output_target: string;
}

export interface ResponseState {
  state: ToolkitState;
  schema: ToolkitSchema;
  history?: ToolkitHistoryState;
}

export interface PresetMeta {
  id: string;
  label: string;
  description: string;
}

export interface StylePresetDefinition extends PresetMeta {
  block_source: string;
  heading_source: string;
  source?: "builtin" | "personal";
  base_preset_id?: string;
  editable?: boolean;
  /** Complete color-token package applied atomically by the Style Preset action. */
  colors: Record<string, string>;
}

export interface StylePresetSchema extends PresetMeta {
  colors: Record<string, string>;
  source: "builtin" | "personal";
  base_preset_id: string;
  editable: boolean;
}

export interface ToolkitEditableState {
  toggles: Record<string, boolean>;
  colors: Record<string, string>;
  style_preset: string;
  style_base_preset: string;
  body_font_size_pt: number;
  class_config: Record<string, string>;
  compile_target: string;
  compile_recipe: string;
  compile_use_internal_fallback: boolean;
}

export interface ToolkitHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  label: string;
  createdAt: string;
}

export interface ToolkitSnapshotValue {
  kind: "missing" | "file" | "directory" | "symlink";
  content_base64?: string;
  link_target?: string;
  mode?: number;
  fingerprint: string;
}

export interface ToolkitFileSnapshot {
  path: string;
  before: ToolkitSnapshotValue;
  after: ToolkitSnapshotValue;
}

export interface ToolkitChangeRecord {
  version: 1;
  id: string;
  rootPath: string;
  command: string;
  label: string;
  createdAt: string;
  state: "applied" | "undone";
  beforeEditableState?: ToolkitEditableState;
  afterEditableState?: ToolkitEditableState;
  files: ToolkitFileSnapshot[];
}

export interface StarterTemplateMeta {
  id: string;
  label: string;
  description: string;
}

export interface CompileContext {
  targetRel: string;
  targetAbs: string;
  compileCwd: string;
  docfile: string;
  docstem: string;
  defaultPdfAbs: string;
  defaultPdfRel: string;
}

export interface CompileResult {
  success: boolean;
  output: string;
  compile_target: string;
  compile_recipe: string;
  compile_use_internal_fallback: boolean;
  pdf_path: string;
  compile_output_pdf_expected: string;
  compile_last_compile_at: string;
  compile_last_success: boolean | null;
  class_config: Record<string, string>;
  detected_document_class: string;
  detected_document_class_has_chapter: boolean;
  effective_theme_class: string;
}

export interface SplitUnit {
  path: string;
  title: string;
  reference: string;
}

export interface SplitResult {
  success: boolean;
  dry_run: boolean;
  already_split: boolean;
  document_class: string;
  split_command: string;
  standalone_mode: string;
  include_macro: string;
  subfiles_package_injected: boolean;
  backup_path: string;
  generated_subfile_targets: string[];
  updated_files: string[];
  units: SplitUnit[];
  warnings: string[];
}

export interface RenumberResult {
  success: boolean;
  dry_run: boolean;
  mode: string;
  root_target: string;
  renamed: Record<string, string>;
  updated_files: string[];
  warnings: string[];
}

export interface UnsplitResult {
  success: boolean;
  dry_run: boolean;
  root_target: string;
  source_target: string;
  delete_source: boolean;
  updated_files: string[];
  warnings: string[];
}

export interface CleanResult {
  success: boolean;
  dry_run: boolean;
  scope: string[];
  patterns: string[];
  protected_patterns: string[];
  deleted_files: string[];
  deleted_count: number;
  skipped_protected_files: string[];
  skipped_protected_count: number;
  errors: string[];
  root_scope: string[];
  subfile_scope: string[];
  root_patterns: string[];
  root_protected_patterns: string[];
  subfile_keep_patterns: string[];
  removed_empty_dirs: string[];
  removed_empty_dir_count: number;
}

export interface UpgradeThemeAssetsResult {
  success: boolean;
  backup_dir: string;
  upgraded_files: string[];
  color_policy: UpgradeColorPolicy;
  updated_override_files: string[];
  /** @deprecated Compatibility alias for older webviews. */
  reset_files: string[];
  skipped_missing_files: string[];
}

export type UpgradeColorPolicy = "preserve" | "default";

export interface UpgradeThemeAssetsOptions {
  colorPolicy: UpgradeColorPolicy;
}
