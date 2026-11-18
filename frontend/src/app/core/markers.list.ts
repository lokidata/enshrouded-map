import { normalize } from './filter.store';

/** The markers whose name or note holds the search (accents and case ignored), sorted by name. Pure: the map is not touched. */
export function listMarkers<T extends { name: string; note: string; id: number }>(
  markers: readonly T[],
  query: string,
): T[] {
  const q = normalize(query.trim());
  return markers
    .filter((m) => !q || normalize(m.name).includes(q) || normalize(m.note).includes(q))
    .sort(
      (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id - b.id,
    );
}
