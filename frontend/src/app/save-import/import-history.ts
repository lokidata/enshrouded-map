import { Kind } from './save-import.logic';

const KEY = 'lastImport';
const keyOf = (id: number): string => `${KEY}:${id}`;

export interface ImportEntry {
  name: string;
  /** ISO date of the import. */
  at: string;
  /** How many marks each kind added. */
  counts: Partial<Record<Kind, number>>;
}

/** What the last import of a character profile was, kept in this browser to tell a re-import apart; forgotten at logout. */
export function rememberImport(id: number, entry: ImportEntry): void {
  try {
    localStorage.setItem(keyOf(id), JSON.stringify(entry));
  } catch {
    // storage blocked: not remembered
  }
}

export function lastImport(id: number): ImportEntry | null {
  try {
    // the first version kept one entry per browser: the first profile that asks takes it
    const legacy = localStorage.getItem(KEY);
    if (legacy !== null && localStorage.getItem(keyOf(id)) === null) {
      localStorage.setItem(keyOf(id), legacy);
      localStorage.removeItem(KEY);
    }
    const o = JSON.parse(localStorage.getItem(keyOf(id)) ?? 'null') as Partial<ImportEntry> | null;
    return o && typeof o.name === 'string' && typeof o.at === 'string' && o.counts
      ? (o as ImportEntry)
      : null;
  } catch {
    return null;
  }
}

/** One profile's entry, or every one (logout). */
export function forgetImport(id?: number): void {
  try {
    const keys =
      id === undefined
        ? Object.keys(localStorage).filter((k) => k === KEY || k.startsWith(`${KEY}:`))
        : [keyOf(id)];
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // nothing to remove
  }
}

/** "character3.ksd" -> 3: the number of the character slot, null for any other name. */
export function characterNumber(name: string): number | null {
  const m = /^character(\d+)\.ksd$/i.exec(name);
  return m ? Number(m[1]) : null;
}
