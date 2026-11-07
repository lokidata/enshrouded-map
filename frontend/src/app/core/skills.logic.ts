import { AttrKey, Levels, SkillNode, SkillsData } from './skills.model';

export const ATTRS: readonly AttrKey[] = [
  'constitution',
  'spirit',
  'resistance',
  'strength',
  'dexterity',
  'intelligence',
];

/** The tree as the planner reasons about it: nodes by id, neighbours (a link works both ways), the roots. */
export interface Tree {
  byId: ReadonlyMap<number, SkillNode>;
  next: ReadonlyMap<number, readonly number[]>;
  roots: ReadonlySet<number>;
}

export function tree(data: SkillsData): Tree {
  const next = new Map<number, number[]>();
  for (const [a, b] of data.links) {
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  return {
    byId: new Map(data.nodes.map((n) => [n.id, n])),
    next,
    roots: new Set(data.nodes.filter((n) => n.type === 'Root').map((n) => n.id)),
  };
}

/** Points spent. */
export function spent(t: Tree, levels: Levels): number {
  let total = 0;
  for (const [id, level] of Object.entries(levels)) total += (t.byId.get(+id)?.cost ?? 0) * level;
  return total;
}

/** A node can be taken from a root or from a node already taken next to it. */
export function reachable(t: Tree, levels: Levels, id: number): boolean {
  return (t.next.get(id) ?? []).some((n) => t.roots.has(n) || (levels[n] ?? 0) > 0);
}

export function canAdd(t: Tree, levels: Levels, id: number, budget: number): boolean {
  const node = t.byId.get(id);
  if (!node || node.type === 'Root' || (levels[id] ?? 0) >= node.max) return false;
  return reachable(t, levels, id) && spent(t, levels) + node.cost <= budget;
}

/** A level comes off unless it was the last of a node that others hang from: they must stay linked to a root. */
export function canRemove(t: Tree, levels: Levels, id: number): boolean {
  const level = levels[id] ?? 0;
  if (level === 0) return false;
  if (level > 1) return true;
  const rest = new Set(
    Object.keys(levels)
      .map(Number)
      .filter((n) => n !== id && levels[n] > 0),
  );
  const linked = new Set<number>();
  const queue = [...t.roots];
  while (queue.length) {
    for (const n of t.next.get(queue.pop()!) ?? []) {
      if (rest.has(n) && !linked.has(n)) {
        linked.add(n);
        queue.push(n);
      }
    }
  }
  return linked.size === rest.size;
}

/** The attributes the nodes taken raise (the Flame ones depend on the Flame level and are not counted). */
export function attributes(t: Tree, levels: Levels): Record<AttrKey, number> {
  const total = Object.fromEntries(ATTRS.map((a) => [a, 0])) as Record<AttrKey, number>;
  for (const [id, level] of Object.entries(levels)) {
    const node = t.byId.get(+id);
    if (node?.attr && !node.flame) total[node.attr] += node.gain * level;
  }
  return total;
}

export function add(levels: Levels, id: number): Levels {
  return { ...levels, [id]: (levels[id] ?? 0) + 1 };
}

export function remove(levels: Levels, id: number): Levels {
  const { [id]: level, ...rest } = levels;
  return level > 1 ? { ...rest, [id]: level - 1 } : rest;
}

/** Levels as the API stores them: only the nodes taken, keyed by id text. */
export const toSaved = (levels: Levels): Record<string, number> =>
  Object.fromEntries(Object.entries(levels).filter(([, l]) => l > 0));

/** Drops what the tree does not know (a saved build from before an update of the game). */
export function fromSaved(t: Tree, saved: Record<string, number>): Levels {
  const out: Record<number, number> = {};
  for (const [id, level] of Object.entries(saved)) {
    const node = t.byId.get(+id);
    if (node && node.type !== 'Root' && level > 0) out[+id] = Math.min(level, node.max);
  }
  return out;
}

/** A link to share: "index.level" in base 36 per node taken, index being the place in skills.json. */
export function encode(data: SkillsData, levels: Levels): string {
  const parts: string[] = [];
  data.nodes.forEach((n, i) => {
    if ((levels[n.id] ?? 0) > 0) parts.push(`${i.toString(36)}.${levels[n.id]}`);
  });
  return parts.join('-');
}

export function decode(data: SkillsData, text: string): Levels {
  const out: Record<number, number> = {};
  for (const part of text.split('-')) {
    const [index, level] = part.split('.');
    const node = data.nodes[parseInt(index, 36)];
    const n = Number(level);
    if (node && node.type !== 'Root' && Number.isInteger(n) && n > 0)
      out[node.id] = Math.min(n, node.max);
  }
  return out;
}

/** The text of a node at a level: %k is its value there, %% a percent sign. */
export function fill(text: string, node: SkillNode, level: number): string {
  const value = node.vals ? node.vals[Math.min(Math.max(level, 1), node.vals.length) - 1] : '…';
  return text.replace(/%k/g, value).replace(/%%/g, '%');
}

export interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Splits a text at its ** (bold) and __ (italic) marks, to draw them without any HTML. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let bold = false;
  let italic = false;
  for (const part of text.split(/(\*\*|__)/)) {
    if (part === '**') bold = !bold;
    else if (part === '__') italic = !italic;
    else if (part) out.push({ text: part, bold, italic });
  }
  return out;
}
