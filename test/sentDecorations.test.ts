import { describe, expect, it } from 'vitest';
import { moveSpan, SentDecorations, type SentItem } from '../src/livePreview/sentDecorations';

const insert = (offset: number, text: string) => ({ offset, length: 0, inserted: text.length });
const remove = (offset: number, length: number) => ({ offset, length, inserted: 0 });

describe('moveSpan', () => {
  const span = { start: 10, end: 15 };

  it('shifts a span by the edits before it and leaves it for those after', () => {
    expect(moveSpan(span, [insert(3, 'abc')])).toEqual({ start: 13, end: 18 });
    expect(moveSpan(span, [remove(2, 4)])).toEqual({ start: 6, end: 11 });
    expect(moveSpan(span, [insert(16, 'x'), remove(30, 2)])).toBe(span);
    // Edits of one event are all against the text before it, in any order.
    expect(moveSpan(span, [insert(20, 'x'), insert(0, 'yy'), remove(5, 1)])).toEqual({ start: 11, end: 16 });
  });

  it('gives up on a span an edit touches, inside or at either edge', () => {
    expect(moveSpan(span, [insert(12, 'x')])).toBeUndefined();
    expect(moveSpan(span, [insert(10, 'x')])).toBeUndefined();
    expect(moveSpan(span, [insert(15, 'x')])).toBeUndefined();
    expect(moveSpan(span, [remove(8, 2)])).toBeUndefined();
    expect(moveSpan({ start: 10, end: 10 }, [insert(10, 'x')])).toBeUndefined();
  });
});

describe('SentDecorations', () => {
  const item = (start: number, end: number, shows = ''): SentItem => ({ start, end, shows });

  it('tells a type it holds what it is sent, moved through the edits since', () => {
    const sent = new SentDecorations<string>(50);
    const items = [item(10, 15, 'a.svg'), item(40, 40)];
    expect(sent.differs('images', items)).toBe(true);
    sent.record('images', items, 0);
    expect(sent.differs('images', items)).toBe(false);
    sent.move([insert(0, 'abc')], 1000);
    expect(sent.differs('images', items)).toBe(true);
    expect(sent.differs('images', [item(13, 18, 'a.svg'), item(43, 43)])).toBe(false);
    expect(sent.differs('images', [item(13, 18, 'b.svg'), item(43, 43)])).toBe(true);
  });

  it('sends a type again once an edit touches one of its decorations', () => {
    const sent = new SentDecorations<string>(50);
    sent.record('hidden', [item(10, 15), item(20, 25)], 0);
    sent.move([insert(12, 'x')], 1000);
    expect(sent.differs('hidden', [item(10, 16), item(21, 26)])).toBe(true);
    expect(sent.differs('hidden', [item(21, 26)])).toBe(true);
  });

  it('sends a type again after an edit right after it was sent, which VS Code may have applied first', () => {
    const sent = new SentDecorations<string>(50);
    sent.record('images', [item(40, 40, 'a.svg')], 0);
    sent.record('hidden', [item(10, 15)], 1000);
    sent.move([insert(30, 'x')], 1020);
    expect(sent.differs('hidden', [item(10, 15)])).toBe(true);
    // Sent long before the edit, so VS Code had it in place already.
    expect(sent.differs('images', [item(41, 41, 'a.svg')])).toBe(false);
    expect(sent.differs('empty', [])).toBe(false);
    sent.record('hidden', [item(10, 15)], 1100);
    expect(sent.differs('hidden', [item(10, 15)])).toBe(false);
  });

  it('sends everything again when told to, until an update has', () => {
    const sent = new SentDecorations<string>(50);
    sent.record('hidden', [item(10, 15)], 0);
    sent.unsettle();
    expect(sent.differs('hidden', [item(10, 15)])).toBe(true);
    sent.settle();
    expect(sent.differs('hidden', [item(10, 15)])).toBe(false);
  });

  it('keeps the slot of markup that edits leave alone, and gives new markup a slot of its own', () => {
    const sent = new SentDecorations<string>(50);
    let next = 0;
    const assign = () => next++;
    expect(sent.slotOf({ start: 10, end: 15 }, assign)).toBe(0);
    expect(sent.slotOf({ start: 30, end: 35 }, assign)).toBe(1);
    sent.move([insert(20, '\n\n')], 1000);
    expect(sent.slotOf({ start: 10, end: 15 }, assign)).toBe(0);
    expect(sent.slotOf({ start: 32, end: 37 }, assign)).toBe(1);
    sent.move([insert(12, 'x')], 2000);
    expect(sent.slotOf({ start: 10, end: 16 }, assign)).toBe(2);
  });

  it('lists the types that hold anything, so an update can empty those it sends nothing', () => {
    const sent = new SentDecorations<string>(50);
    sent.record('a', [item(1, 2)], 0);
    sent.record('b', [], 0);
    expect([...sent.heldTypes()]).toEqual(['a']);
    sent.record('a', [], 0);
    expect([...sent.heldTypes()]).toEqual([]);
  });
});
