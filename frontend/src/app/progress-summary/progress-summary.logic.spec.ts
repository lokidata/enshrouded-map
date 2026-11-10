import { describe, expect, it } from 'vitest';
import { summarize } from './progress-summary.logic';

const craft = { recipes: [{ id: 'r1' }, { id: 'r2' }], blocks: [{ id: 'b1' }] };
const lore = {
  quests: [{ id: '10' }, { id: '11' }],
  notes: [
    { id: '5', pages: [{}, {}] },
    { id: '6', pages: [{}] },
  ],
};
const markers = [
  { cat: 'poi', x: 1, z: 2, kids: [9] },
  { cat: 'poi', x: 3, z: 4, kids: [8] },
  { cat: 'poi', x: 5, z: 6 }, // no knowledge id: not a place of the save
  { cat: 'unique', x: 7, z: 8, item: 'i1' },
  { cat: 'unique', x: 9, z: 10, item: 'i2' },
  { cat: 'unique', x: 11, z: 12, item: 'i2' }, // two places: not tied to one marker
];
const get = (l: ReturnType<typeof summarize>, k: string) => l.find((x) => x.kind === k)!;

describe('summarize', () => {
  it('counts each kind against the data files', () => {
    const done = new Set([
      'recipe:r1',
      'recipe:b1',
      'quest:10',
      'lore:5:1',
      'lore:6',
      'poi:1:2',
      'unique:7:8',
    ]);
    const l = summarize(done, craft as never, lore as never, markers as never, 0.12);
    expect(get(l, 'recipe')).toEqual({ kind: 'recipe', done: 2, total: 3 });
    expect(get(l, 'quest')).toEqual({ kind: 'quest', done: 1, total: 2 });
    expect(get(l, 'lore')).toEqual({ kind: 'lore', done: 2, total: 3 }); // page 1 of note 5 and the whole note 6
    expect(get(l, 'place')).toEqual({ kind: 'place', done: 1, total: 2 });
    expect(get(l, 'item')).toEqual({ kind: 'item', done: 1, total: 1 });
    expect(get(l, 'fog')).toEqual({ kind: 'fog', done: 12, total: 100 });
  });

  it('reports missing data as a null total, not as 0 %', () => {
    const l = summarize(new Set(), null, null, [{ cat: 'poi', x: 1, z: 2 }] as never, null);
    for (const k of ['recipe', 'quest', 'lore', 'place', 'item', 'fog'])
      expect(get(l, k).total, k).toBeNull();
  });
});
