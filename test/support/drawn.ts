import type { Overlay } from '../../src/livePreview/overlays';

/**
 * The text as the preview draws it, for asserting on: hidden source left out, inserted text added
 * (**bold**, *italic*, [link colour], !warning!), and styled source marked as <style>…</style>.
 */
export function drawn(text: string, overlays: readonly Overlay[]): string {
  const hidden = new Set<number>();
  const at = (map: Map<number, string[]>, index: number, value: string) => map.set(index, [...map.get(index) ?? [], value]);
  const inserts = new Map<number, string[]>();
  const opens = new Map<number, string[]>();
  const closes = new Map<number, string[]>();
  for (const item of overlays) {
    for (const [start, end] of item.hide) for (let i = start; i < end; i++) hidden.add(i);
    for (const insertion of item.insert) {
      let shown = insertion.text;
      if (insertion.bold) shown = `**${shown}**`;
      if (insertion.italic) shown = `*${shown}*`;
      if (insertion.color === 'link') shown = `[${shown}]`;
      if (insertion.color === 'warning') shown = `!${shown}!`;
      at(inserts, insertion.at, shown);
    }
    for (const part of item.style) {
      at(opens, part.start, `<${part.style}>`);
      closes.set(part.end, [`</${part.style}>`, ...closes.get(part.end) ?? []]);
    }
  }
  let out = '';
  for (let i = 0; i <= text.length; i++) {
    out += (closes.get(i) ?? []).join('') + (inserts.get(i) ?? []).join('') + (opens.get(i) ?? []).join('');
    if (i < text.length && !hidden.has(i)) out += text[i];
  }
  return out;
}
