import { normalize } from './filter.store';

/** Groups items that share a key, in order of first appearance. */
export function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return [...groups].map(([k, list]) => ({ key: k, items: list }));
}

/** The key that ties the levels of one item together: same name (both languages), category and type. */
export function itemVariantKey(item: {
  name: readonly string[];
  cat?: string;
  type?: string;
}): string {
  return [normalize(item.name.join(' ')), item.cat ?? '', item.type ?? ''].join('|');
}
