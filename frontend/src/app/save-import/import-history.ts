import { Kind } from './save-import.logic';

const KEY = 'lastImport';

export interface ImportEntry {
  name: string;
  /** ISO date of the import. */
  at: string;
  /** How many marks each kind added. */
  counts: Partial<Record<Kind, number>>;
}

/** What the last import was, kept in this browser to tell a re-import apart; forgotten at logout. */
export function rememberImport(entry: ImportEntry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // storage blocked: not remembered
  }
}

export function lastImport(): ImportEntry | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ImportEntry> | null;
    return o && typeof o.name === 'string' && typeof o.at === 'string' && o.counts
      ? (o as ImportEntry)
      : null;
  } catch {
    return null;
  }
}

export function forgetImport(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to remove
  }
}

/** "character3.ksd" -> 3: the number of the character slot, null for any other name. */
export function characterNumber(name: string): number | null {
  const m = /^character(\d+)\.ksd$/i.exec(name);
  return m ? Number(m[1]) : null;
}
