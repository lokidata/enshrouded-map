import { LoreNote } from './lore.model';

/** Marks of the journal: a whole note, one page of a note, a quest. */
export const noteMark = (id: string): string => `lore:${id}`;
export const pageMark = (id: string, page: number): string => `lore:${id}:${page}`;
export const questMark = (id: string): string => `quest:${id}`;

/** A page is found when it is marked, or when the whole note is (the mark of the first version). */
export function pageFound(done: ReadonlySet<string>, note: LoreNote, page: number): boolean {
  return done.has(noteMark(note.id)) || done.has(pageMark(note.id, page));
}

export function foundPages(done: ReadonlySet<string>, note: LoreNote): number {
  return note.pages.filter((_, i) => pageFound(done, note, i)).length;
}

export function noteFound(done: ReadonlySet<string>, note: LoreNote): boolean {
  return foundPages(done, note) === note.pages.length;
}

export interface Plan {
  mark: string[];
  unmark: string[];
}

/** Ticking a page; when the whole note was marked, it is split into its other pages first. */
export function togglePagePlan(done: ReadonlySet<string>, note: LoreNote, page: number): Plan {
  if (done.has(noteMark(note.id))) {
    const others = note.pages.map((_, i) => i).filter((i) => i !== page);
    return { unmark: [noteMark(note.id)], mark: others.map((i) => pageMark(note.id, i)) };
  }
  const mark = pageMark(note.id, page);
  return done.has(mark) ? { unmark: [mark], mark: [] } : { unmark: [], mark: [mark] };
}

/** Ticking a note: all its pages, as one mark; unticking it clears the note and its pages. */
export function toggleNotePlan(done: ReadonlySet<string>, note: LoreNote): Plan {
  const pages = note.pages.map((_, i) => pageMark(note.id, i));
  return noteFound(done, note)
    ? { unmark: [noteMark(note.id), ...pages], mark: [] }
    : { unmark: pages, mark: [noteMark(note.id)] };
}
