import { CraftData } from '../core/craft.model';
import { LoreData } from '../core/lore.model';
import { pageMark } from '../core/lore-progress';
import { MapMarker, markId } from '../core/map-data.model';

export type SummaryKind = 'recipe' | 'quest' | 'lore' | 'place' | 'item' | 'fog';

export interface SummaryLine {
  kind: SummaryKind;
  done: number;
  /** Null when the data file has no such information (an older lore.json or map-data.json): shown as a dash. */
  total: number | null;
}

/** What the player has done, per kind: marks against what the data files list. `explored` is the share (0..1) of the map seen, null without an imported save. */
export function summarize(
  done: ReadonlySet<string>,
  craft: Pick<CraftData, 'recipes' | 'blocks'> | null,
  lore: Pick<LoreData, 'quests' | 'notes'> | null,
  markers: readonly MapMarker[],
  explored: number | null,
): SummaryLine[] {
  const recipes = [...(craft?.recipes ?? []), ...(craft?.blocks ?? [])];
  const pages = (lore?.notes ?? []).flatMap((n) =>
    n.pages.map((_, i) => done.has(pageMark(n.id, i)) || done.has(`lore:${n.id}`)),
  );
  const places = markers.filter((m) => m.kids?.length);
  const perItem = new Map<string, number>();
  for (const m of markers) if (m.item) perItem.set(m.item, (perItem.get(m.item) ?? 0) + 1);
  const items = markers.filter((m) => m.item && perItem.get(m.item) === 1);
  const marked = (m: MapMarker): boolean => done.has(markId(m.cat, m.x, m.z));
  return [
    {
      kind: 'recipe',
      done: recipes.filter((r) => done.has(`recipe:${r.id}`)).length,
      total: craft ? recipes.length : null,
    },
    {
      kind: 'quest',
      done: (lore?.quests ?? []).filter((q) => done.has(`quest:${q.id}`)).length,
      total: lore ? lore.quests.length : null,
    },
    { kind: 'lore', done: pages.filter(Boolean).length, total: lore ? pages.length : null },
    { kind: 'place', done: places.filter(marked).length, total: places.length || null },
    { kind: 'item', done: items.filter(marked).length, total: items.length || null },
    { kind: 'fog', done: Math.round((explored ?? 0) * 100), total: explored === null ? null : 100 },
  ];
}
