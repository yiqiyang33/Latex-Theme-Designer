export type StructureOperation = "split" | "renumber" | "unsplit";

export interface StructureSummaryEntry {
  kind: "Created" | "Updated" | "Renamed" | "Deleted" | "Warning";
  value: string;
}

export interface StructureSummary {
  created: number;
  updated: number;
  renamed: number;
  deleted: number;
  warnings: number;
  entries: StructureSummaryEntry[];
}

export function buildStructureSummary(operation: StructureOperation, result: any): StructureSummary {
  const created = operation === "split" ? strings(result?.generated_subfile_targets) : [];
  let updated = [...new Set(strings(result?.updated_files))];
  const renamed = operation === "renumber"
    ? Object.entries(result?.renamed || {}).map(([from, to]) => `${from} → ${String(to)}`)
    : [];
  const deleted = operation === "unsplit" && result?.delete_source && typeof result?.source_target === "string"
    ? [result.source_target]
    : [];
  if (deleted.length > 0) updated = updated.filter((value) => !deleted.includes(value));
  const warnings = strings(result?.warnings);
  return {
    created: created.length,
    updated: updated.length,
    renamed: renamed.length,
    deleted: deleted.length,
    warnings: warnings.length,
    entries: [
      ...created.map((value) => ({ kind: "Created" as const, value })),
      ...updated.map((value) => ({ kind: "Updated" as const, value })),
      ...renamed.map((value) => ({ kind: "Renamed" as const, value })),
      ...deleted.map((value) => ({ kind: "Deleted" as const, value })),
      ...warnings.map((value) => ({ kind: "Warning" as const, value }))
    ]
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
