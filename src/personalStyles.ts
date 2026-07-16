import { randomUUID } from "node:crypto";
import { COLOR_ORDER, STYLE_PRESET_DEFINITIONS } from "./schema";
import type { LocalProjectStateStore, PersonalStyleRecord, StylePresetDefinition } from "./types";
import { parseHexColor } from "./utils";

export const PERSONAL_STYLES_STATE_KEY = "latexEditingToolkit.personalStyles.v1";

export class PersonalStyleRegistry {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: LocalProjectStateStore) {}

  list(): PersonalStyleRecord[] {
    const raw = this.store.get<unknown>(PERSONAL_STYLES_STATE_KEY);
    if (!Array.isArray(raw)) return [];
    const out: PersonalStyleRecord[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const parsed = this.parseRecord(item);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      out.push(parsed);
    }
    return out.sort((left, right) => left.label.localeCompare(right.label));
  }

  definitions(): StylePresetDefinition[] {
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

  add(label: string, basePresetId: string, colors: Record<string, string>): Promise<PersonalStyleRecord> {
    return this.runSerialized(async () => {
      const normalizedLabel = label.trim();
      this.assertLabelAvailable(normalizedLabel, this.list());
      const base = this.validateBasePreset(basePresetId);
      const now = new Date().toISOString();
      const record: PersonalStyleRecord = {
        version: 1,
        id: `personal:${randomUUID()}`,
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

  update(id: string, colors: Record<string, string>): Promise<PersonalStyleRecord> {
    return this.runSerialized(async () => {
      const records = this.list();
      const current = records.find((record) => record.id === id);
      if (!current) throw new Error("Personal style not found.");
      const updated = { ...current, colors: this.validateColors(colors), updatedAt: new Date().toISOString() };
      await this.write(records.map((record) => record.id === id ? updated : record));
      return updated;
    });
  }

  rename(id: string, label: string): Promise<PersonalStyleRecord> {
    return this.runSerialized(async () => {
      const records = this.list();
      const current = records.find((record) => record.id === id);
      if (!current) throw new Error("Personal style not found.");
      const updated = {
        ...current,
        label: label.trim(),
        updatedAt: new Date().toISOString()
      };
      this.assertLabelAvailable(updated.label, records.filter((record) => record.id !== id));
      await this.write(records.map((record) => record.id === id ? updated : record));
      return updated;
    });
  }

  remove(id: string): Promise<PersonalStyleRecord | undefined> {
    return this.runSerialized(async () => {
      const records = this.list();
      const removed = records.find((record) => record.id === id);
      if (!removed) return undefined;
      await this.write(records.filter((record) => record.id !== id));
      return removed;
    });
  }

  importLibrary(raw: unknown): Promise<{ imported: number; skipped: number }> {
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

  exportLibrary(): { version: 1; styles: PersonalStyleRecord[] } {
    return { version: 1, styles: this.list() };
  }

  private parseRecord(raw: unknown): PersonalStyleRecord | undefined {
    if (!isRecord(raw) || raw.version !== 1 || typeof raw.id !== "string" || !raw.id.startsWith("personal:")) return undefined;
    if (typeof raw.label !== "string" || !raw.label.trim() || typeof raw.basePresetId !== "string") return undefined;
    let colors: Record<string, string>;
    try {
      colors = this.validateColors(isRecord(raw.colors) ? Object.fromEntries(Object.entries(raw.colors).map(([key, value]) => [key, String(value)])) : {});
      this.validateBasePreset(raw.basePresetId);
    } catch {
      return undefined;
    }
    const createdAt = validDate(raw.createdAt) ?? new Date(0).toISOString();
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

  private validateColors(raw: Record<string, string>): Record<string, string> {
    if (Object.keys(raw).length !== COLOR_ORDER.length || COLOR_ORDER.some((token) => !(token in raw))) {
      throw new Error("Personal style must contain every Toolkit color token.");
    }
    const colors: Record<string, string> = {};
    for (const token of COLOR_ORDER) {
      const parsed = parseHexColor(raw[token]);
      if (!parsed) throw new Error(`Invalid color for ${token}.`);
      colors[token] = parsed;
    }
    return colors;
  }

  private validateBasePreset(id: string): StylePresetDefinition {
    const base = STYLE_PRESET_DEFINITIONS.find((preset) => preset.id === id);
    if (!base) throw new Error(`Unknown built-in base style: ${id}.`);
    return base;
  }

  private uniqueLabel(raw: string, records: PersonalStyleRecord[]): string {
    const base = raw.trim();
    if (!base) throw new Error("Personal style name is required.");
    const used = new Set(records.map((record) => record.label.toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    let index = 2;
    while (used.has(`${base} (Imported ${index})`.toLocaleLowerCase())) index += 1;
    return `${base} (Imported ${index})`;
  }

  private assertLabelAvailable(label: string, records: PersonalStyleRecord[]): void {
    if (!label) throw new Error("Personal style name is required.");
    if (records.some((record) => record.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      throw new Error(`A personal style named '${label}' already exists.`);
    }
  }

  private async write(records: PersonalStyleRecord[]): Promise<void> {
    await this.store.update(PERSONAL_STYLES_STATE_KEY, records);
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function validDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
