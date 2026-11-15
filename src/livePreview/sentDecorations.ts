/** A stretch of a document, as offsets. */
export interface Span {
  start: number;
  end: number;
}

/** One edit of a change event: `length` characters at `offset` replaced by `inserted` new ones. */
export interface Edit {
  offset: number;
  length: number;
  inserted: number;
}

/** A decoration as the comparison needs it: where it is and everything else it shows. */
export interface SentItem extends Span {
  shows: string;
}

/**
 * Where a span is after one change event, whose edits VS Code reports against the text before it.
 * Undefined if an edit touches the span: VS Code may then grow or shrink a decoration on it, so
 * that decoration has to be sent again rather than assumed moved.
 */
export function moveSpan(span: Span, edits: readonly Edit[]): Span | undefined {
  let shift = 0;
  for (const edit of edits) {
    if (edit.offset + edit.length < span.start) shift += edit.inserted - edit.length;
    else if (edit.offset <= span.end) return undefined;
  }
  return shift ? { start: span.start + shift, end: span.end + shift } : span;
}

/**
 * What one editor's decoration types hold. VS Code moves decorations along with the text, so after
 * an edit elsewhere a type still holds what it was sent, moved; sending it again would make VS Code
 * redo every decoration of that type for nothing.
 *
 * Each piece of markup keeps the slot it was first given for as long as edits leave it alone, so
 * that a slot's contents only change when its own markup does.
 */
export class SentDecorations<Type> {
  private slots = new Map<string, number>();
  private readonly sent = new Map<Type, SentItem[]>();
  private readonly sentAt = new Map<Type, number>();
  /** Types VS Code may have given their last decorations on text that had changed since. */
  private readonly uncertain = new Set<Type>();
  private allUncertain = false;

  constructor(private readonly settleMs: number) {}

  /** The slot of the markup at `owner`, given by `assign` the first time it is seen. */
  slotOf(owner: Span, assign: () => number): number {
    const key = `${owner.start}:${owner.end}`;
    let slot = this.slots.get(key);
    if (slot === undefined) this.slots.set(key, slot = assign());
    return slot;
  }

  /** Whether `type` needs `items` sent: unless it holds exactly these already. */
  differs(type: Type, items: readonly SentItem[]): boolean {
    const held = this.sent.get(type) ?? [];
    if (this.allUncertain || this.uncertain.has(type)) return items.length > 0 || held.length > 0;
    if (held.length !== items.length) return true;
    for (let i = 0; i < items.length; i++) {
      const a = held[i];
      const b = items[i];
      if (a.start !== b.start || a.end !== b.end || a.shows !== b.shows) return true;
    }
    return false;
  }

  record(type: Type, items: readonly SentItem[], now: number): void {
    if (items.length) this.sent.set(type, items.map(({ start, end, shows }) => ({ start, end, shows })));
    else this.sent.delete(type);
    this.sentAt.set(type, now);
    this.uncertain.delete(type);
  }

  /** The types that hold anything, which an update sending nothing to them has to empty. */
  heldTypes(): IterableIterator<Type> {
    return this.sent.keys();
  }

  /** Ends an update that sent every type that differed, so nothing is uncertain any more. */
  settle(): void {
    this.allUncertain = false;
  }

  /** Has the next update send everything again, whatever is assumed held. */
  unsettle(): void {
    this.allUncertain = true;
  }

  /**
   * Moves everything through a change event as VS Code moves the decorations. Decorations sent just
   * before the edit may have reached VS Code after it, placed on the changed text: their types are
   * then sent again on the next update.
   */
  move(edits: readonly Edit[], now: number): void {
    for (const [type, at] of this.sentAt) {
      if (now - at < this.settleMs) this.uncertain.add(type);
      else this.sentAt.delete(type);
    }
    const slots = new Map<string, number>();
    for (const [key, slot] of this.slots) {
      const separator = key.indexOf(':');
      const moved = moveSpan({ start: Number(key.slice(0, separator)), end: Number(key.slice(separator + 1)) }, edits);
      if (moved) slots.set(`${moved.start}:${moved.end}`, slot);
    }
    this.slots = slots;
    for (const [type, items] of this.sent) {
      const moved: SentItem[] = [];
      for (const item of items) {
        const span = moveSpan(item, edits);
        // One that an edit touched is no longer known; the type is sent again when next updated.
        moved.push(span ? { ...span, shows: item.shows } : { start: -1, end: -1, shows: '' });
      }
      this.sent.set(type, moved);
    }
  }
}
