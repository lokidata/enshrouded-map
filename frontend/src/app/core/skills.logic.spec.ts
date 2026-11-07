import { describe, expect, it } from 'vitest';
import {
  add,
  attributes,
  canAdd,
  canRemove,
  decode,
  encode,
  fill,
  fromSaved,
  remove,
  segments,
  spent,
  toSaved,
  tree,
} from './skills.logic';
import { SkillNode, SkillsData } from './skills.model';

const node = (
  id: number,
  type: SkillNode['type'],
  cost = 1,
  max = 1,
  vals: string[] | null = null,
): SkillNode => ({
  id,
  x: id,
  y: 0,
  type,
  icon: null,
  label: null,
  attr: null,
  gain: 0,
  flame: false,
  cls: 'Neutral',
  name: [`n${id}`, `n${id}`],
  desc: ['', ''],
  cost,
  max,
  vals,
  per: null,
});

// root 1 - a(2) - b(3) - c(4), and d(5) off the root; e(6) alone
const data: SkillsData = {
  budget: 5,
  nodes: [
    node(1, 'Root'),
    node(2, 'Passive', 1, 3),
    node(3, 'Passive', 2),
    node(4, 'Active', 3),
    node(5, 'Attribute'),
    node(6, 'Passive'),
  ],
  links: [
    [1, 2],
    [2, 3],
    [3, 4],
    [1, 5],
  ],
};
const t = tree(data);

describe('taking nodes', () => {
  it('starts from a root or from a node already taken', () => {
    expect(canAdd(t, {}, 2, 5)).toBe(true);
    expect(canAdd(t, {}, 3, 5)).toBe(false); // not next to anything taken
    expect(canAdd(t, { 2: 1 }, 3, 5)).toBe(true);
    expect(canAdd(t, {}, 6, 5)).toBe(false); // linked to nothing
    expect(canAdd(t, {}, 1, 5)).toBe(false); // a root is not taken
  });

  it('takes levels up to the maximum, and counts points per level', () => {
    expect(canAdd(t, { 2: 2 }, 2, 5)).toBe(true);
    expect(canAdd(t, { 2: 3 }, 2, 5)).toBe(false);
    expect(spent(t, { 2: 3, 3: 1 })).toBe(5);
  });

  it('stops at the budget', () => {
    expect(canAdd(t, { 2: 1, 3: 1 }, 4, 5)).toBe(false); // 3 + 3 > 5
    expect(canAdd(t, { 2: 1, 3: 1 }, 4, 6)).toBe(true);
  });

  it('removes a level, but not the last of a node others hang from', () => {
    expect(canRemove(t, { 2: 2, 3: 1 }, 2)).toBe(true); // still level 1
    expect(canRemove(t, { 2: 1, 3: 1 }, 2)).toBe(false); // 3 would hang loose
    expect(canRemove(t, { 2: 1, 3: 1 }, 3)).toBe(true);
    expect(canRemove(t, { 5: 1 }, 5)).toBe(true);
    expect(canRemove(t, {}, 2)).toBe(false);
  });

  it('adds and removes levels', () => {
    expect(add({}, 2)).toEqual({ 2: 1 });
    expect(add({ 2: 1 }, 2)).toEqual({ 2: 2 });
    expect(remove({ 2: 2 }, 2)).toEqual({ 2: 1 });
    expect(remove({ 2: 1, 3: 1 }, 2)).toEqual({ 3: 1 });
  });
});

describe('saving and sharing', () => {
  it('keeps only what the tree knows when loading a saved build', () => {
    expect(fromSaved(t, { '2': 9, '3': 1, '1': 1, '99': 1, '4': 0 })).toEqual({ 2: 3, 3: 1 });
    expect(toSaved({ 2: 2, 3: 0 })).toEqual({ '2': 2 });
  });

  it('round-trips a link', () => {
    const levels = { 2: 3, 4: 1, 5: 1 };
    const text = encode(data, levels);
    expect(text).toBe('1.3-3.1-4.1');
    expect(decode(data, text)).toEqual(levels);
    expect(decode(data, 'zz.1-1.x-0.1-2.9')).toEqual({ 3: 1 }); // unknown, bad level, a root, capped
  });
});

describe('texts', () => {
  it('puts the value of the level in a description', () => {
    const n = node(2, 'Passive', 1, 3, ['10%', '20%', '30%']);
    expect(fill('Deals **%k** more, +900%%', n, 2)).toBe('Deals **20%** more, +900%');
    expect(fill('%k', n, 0)).toBe('10%'); // not taken: the first level
    expect(fill('%k', node(3, 'Passive'), 1)).toBe('…'); // the game gives no value
  });

  it('splits the bold and italic parts', () => {
    expect(segments('a **b** __c__ d')).toEqual([
      { text: 'a ', bold: false, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'c', bold: false, italic: true },
      { text: ' d', bold: false, italic: false },
    ]);
  });
});

describe('attributes', () => {
  it('adds up what the nodes taken raise, not the Flame ones', () => {
    const str = { ...node(7, 'Attribute'), attr: 'strength' as const, gain: 1 };
    const big = { ...node(8, 'Attribute', 5), attr: 'strength' as const, flame: true };
    const t2 = tree({
      ...data,
      nodes: [...data.nodes, str, big],
      links: [...data.links, [1, 7], [7, 8]],
    });
    const total = attributes(t2, { 7: 1, 8: 1, 2: 2 });
    expect(total.strength).toBe(1);
    expect(total.constitution).toBe(0);
  });
});
