import { CraftData } from '../core/craft.model';
import { LoreData } from '../core/lore.model';
import { MapMarker, markId } from '../core/map-data.model';
import { pageMark } from '../core/lore-progress';
import { guidId } from './knowledge';

export type Kind = 'recipe' | 'quest' | 'lore' | 'place' | 'item';

/** Bit of an item's knowledge flags that says it was picked up (1 pick up, 2 use, 4 inspect: deduced from saves). */
const PICKUP = 1;

export interface Proposal {
  /** Marks the save knows, by kind. */
  marks: Record<Kind, string[]>;
  /** Ids of the save that match nothing of ours (recipes of the Flame Altar, places, items...). */
  unmatched: number;
}

/** Turns the ids of `player_knowledge` into our marks: recipes and blocks (`recipe:<guid>`) finished quests (`quest:<id>`) and collected lore pages (`lore:<note>:<page>`, only with a `kid` in lore.json). A flag of 0 does not count. */
export function propose(
  known: ReadonlyMap<number, number>,
  craft: Pick<CraftData, 'recipes' | 'blocks'> | null,
  lore: Pick<LoreData, 'quests' | 'notes'> | null,
  markers: readonly MapMarker[] = [],
): Proposal {
  const marks: Record<Kind, string[]> = { recipe: [], quest: [], lore: [], place: [], item: [] };
  const seen = new Set<number>();
  for (const e of [...(craft?.recipes ?? []), ...(craft?.blocks ?? [])]) {
    const id = guidId(e.id);
    if (known.get(id)) {
      marks.recipe.push(`recipe:${e.id}`);
      seen.add(id);
    }
  }
  for (const q of lore?.quests ?? []) {
    const id = Number(q.id);
    if (known.get(id)) {
      marks.quest.push(`quest:${q.id}`);
      seen.add(id);
    }
  }
  for (const n of lore?.notes ?? []) {
    n.pages.forEach((pg, i) => {
      if (pg.kid !== undefined && known.get(pg.kid)) {
        marks.lore.push(pageMark(n.id, i));
        seen.add(pg.kid);
      }
    });
  }
  // Places the player discovered: a marker whose entity set any of its knowledge ids.
  for (const m of markers) {
    const hit = m.kids?.find((k) => known.get(k));
    if (hit !== undefined) {
      marks.place.push(markId(m.cat, m.x, m.z));
      m.kids?.forEach((k) => seen.add(k));
    }
  }
  // Unique items, cosmetics and collectibles picked up (flag 1): only an item with a single place is tied to its marker.
  const places = new Map<string, MapMarker[]>();
  for (const m of markers) if (m.item) places.set(m.item, [...(places.get(m.item) ?? []), m]);
  for (const [item, list] of places) {
    const id = guidId(item);
    if (list.length === 1 && ((known.get(id) ?? 0) & PICKUP) !== 0) {
      marks.item.push(markId(list[0].cat, list[0].x, list[0].z));
      seen.add(id);
    }
  }
  marks.place = marks.place.filter((id) => !marks.item.includes(id)); // an item marker counts once
  let unmatched = 0;
  for (const [id, flags] of known) if (flags && !seen.has(id)) unmatched++;
  return { marks, unmatched };
}

/** What an import would change: the marks of a kind that are not marked yet. */
export function fresh(ids: readonly string[], done: ReadonlySet<string>): string[] {
  return ids.filter((id) => !done.has(id));
}
