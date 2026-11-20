/**
 * The data files craft, gear, lore, skills and gems come in two parts (pipeline/split_languages.py): the structure, where
 * every text array is blank, and `<file>.<code>.json`, the texts of one language as a flat list. This puts that list back
 * at the language's position, walking the structure in the order the pipeline did.
 */
const TEXT_KEYS = new Set(['name', 'desc', 'label', 'text']);
const KEEP_UNDER = 'stats'; // the code matches the English names of stat lines: they stay whole

/** Same rule as the pipeline: array indexes first (ascending), then the other keys as written. JS objects already walk that way. */
export function mergeTexts(data: unknown, texts: readonly string[], index: number, count: number): void {
  let next = 0;
  const walk = (v: unknown, key: string, keep: boolean): void => {
    if (Array.isArray(v)) {
      if (!keep && TEXT_KEYS.has(key) && v.length === count && v.every((s) => typeof s === 'string')) {
        v[index] = texts[next++];
      } else {
        for (const x of v) walk(x, key, keep || key === KEEP_UNDER);
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k, keep || k === KEEP_UNDER);
    }
  };
  walk(data, '', false);
  if (next !== texts.length) throw new Error(`texts do not fit the data: ${next} places, ${texts.length} texts`);
}
