import { describe, expect, it } from 'vitest';
import {
  foundPages,
  noteFound,
  noteMark,
  pageFound,
  pageMark,
  togglePagePlan,
  toggleNotePlan,
} from './lore-progress';
import { LoreNote } from './lore.model';

const page = { name: ['a', 'a'] as [string, string], text: ['t', 't'] as [string, string] };
const note: LoreNote = { id: '7', name: ['n', 'n'], cat: null, pages: [page, page, page] };
const set = (...ids: string[]) => new Set(ids);

describe('found notes and pages', () => {
  it('counts pages from their marks, and a marked note is all found', () => {
    expect(foundPages(set(), note)).toBe(0);
    expect(foundPages(set(pageMark('7', 0), pageMark('7', 2)), note)).toBe(2);
    expect(pageFound(set(noteMark('7')), note, 1)).toBe(true);
    expect(noteFound(set(noteMark('7')), note)).toBe(true);
    expect(noteFound(set(pageMark('7', 0), pageMark('7', 1)), note)).toBe(false);
    expect(noteFound(set(pageMark('7', 0), pageMark('7', 1), pageMark('7', 2)), note)).toBe(true);
  });

  it('ticks and unticks one page', () => {
    expect(togglePagePlan(set(), note, 1)).toEqual({ unmark: [], mark: [pageMark('7', 1)] });
    expect(togglePagePlan(set(pageMark('7', 1)), note, 1)).toEqual({
      unmark: [pageMark('7', 1)],
      mark: [],
    });
  });

  it('splits a marked note when one of its pages is unticked', () => {
    expect(togglePagePlan(set(noteMark('7')), note, 1)).toEqual({
      unmark: [noteMark('7')],
      mark: [pageMark('7', 0), pageMark('7', 2)],
    });
  });

  it('ticks a whole note, and clears it with its pages', () => {
    expect(toggleNotePlan(set(pageMark('7', 0)), note)).toEqual({
      unmark: [pageMark('7', 0), pageMark('7', 1), pageMark('7', 2)],
      mark: [noteMark('7')],
    });
    const all = set(pageMark('7', 0), pageMark('7', 1), pageMark('7', 2));
    expect(toggleNotePlan(all, note).mark).toEqual([]);
    expect(toggleNotePlan(all, note).unmark).toContain(noteMark('7'));
  });
});
