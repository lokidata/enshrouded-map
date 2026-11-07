import { describe, expect, it } from 'vitest';
import { CalcContext, RAW, calculate, defaultRecipe, tree } from './craft.calc';
import { Entry } from './craft.model';

const unlock = { type: 'none' as const, text: ['', ''] };
const recipe = (
  id: string,
  out: string | null,
  inputs: Entry['inputs'],
  count = 1,
  station: string | null = 'bench',
  type: 'none' | 'quest' = 'none',
): Entry => ({
  id,
  name: [id, id],
  output: out ? { item: out, count } : null,
  station,
  inputs,
  seconds: 0,
  unlock: { ...unlock, type },
});

function context(recipes: Entry[], categories: CalcContext['categories'] = {}): CalcContext {
  const byOutput = new Map<string, Entry[]>();
  for (const r of recipes)
    if (r.output) byOutput.set(r.output.item, [...(byOutput.get(r.output.item) ?? []), r]);
  return { recipes: new Map(recipes.map((r) => [r.id, r])), byOutput, categories };
}
const none = { recipe: {}, category: {} };
const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe('calculate', () => {
  const plank = recipe('plank', 'plank', [{ item: 'wood', count: 1 }], 2, 'saw');
  const table = recipe('table', 'table', [
    { item: 'plank', count: 3 },
    { item: 'nail', count: 4 },
  ]);
  const chair = recipe('chair', 'chair', [{ item: 'plank', count: 1 }]);
  const ctx = context([plank, table, chair]);

  it('adds the direct ingredients when it does not break them down', () => {
    const r = calculate([{ recipe: 'table', qty: 2 }], ctx, none, false);
    expect(obj(r.raw)).toEqual({ plank: 6, nail: 8 });
    expect(r.crafted).toEqual([]);
    expect([...r.stations]).toEqual(['bench']);
  });

  it('breaks craftable ingredients down and rounds crafts up once per item', () => {
    // 3 planks for the table + 1 for the chair = 4 planks = 2 crafts of 2 (not 2 + 1)
    const r = calculate(
      [
        { recipe: 'table', qty: 1 },
        { recipe: 'chair', qty: 1 },
      ],
      ctx,
      none,
      true,
    );
    expect(obj(r.raw)).toEqual({ nail: 4, wood: 2 });
    expect(r.crafted.map((c) => [c.item, c.need, c.crafts])).toEqual([['plank', 4, 2]]);
    expect(new Set(r.stations)).toEqual(new Set(['bench', 'saw']));
  });

  it('rounds the wanted quantity up to whole crafts', () => {
    expect(obj(calculate([{ recipe: 'plank', qty: 3 }], ctx, none, true).raw)).toEqual({ wood: 2 });
  });

  it('keeps an item raw when asked', () => {
    const r = calculate(
      [{ recipe: 'table', qty: 1 }],
      ctx,
      { ...none, recipe: { plank: RAW } },
      true,
    );
    expect(obj(r.raw)).toEqual({ plank: 3, nail: 4 });
  });

  it('uses the chosen recipe, else a recipe without quest, then the cheapest', () => {
    const quest = recipe('tar-quest', 'tar', [{ item: 'a', count: 1 }], 1, 'x', 'quest');
    const big = recipe('tar-big', 'tar', [
      { item: 'a', count: 1 },
      { item: 'b', count: 1 },
    ]);
    const small = recipe('tar-small', 'tar', [{ item: 'c', count: 1 }]);
    expect(defaultRecipe([quest, big, small]).id).toBe('tar-small');
    const barrel = recipe('barrel', 'barrel', [{ item: 'tar', count: 1 }]);
    const c = context([quest, big, small, barrel]);
    expect(obj(calculate([{ recipe: 'barrel', qty: 1 }], c, none, true).raw)).toEqual({ c: 1 });
    const choice = { ...none, recipe: { tar: 'tar-big' } };
    expect(obj(calculate([{ recipe: 'barrel', qty: 1 }], c, choice, true).raw)).toEqual({
      a: 1,
      b: 1,
    });
  });

  it('cuts a cycle where it closes', () => {
    const a = recipe('a', 'a', [{ item: 'b', count: 1 }]);
    const b = recipe('b', 'b', [
      { item: 'a', count: 1 },
      { item: 'ore', count: 1 },
    ]);
    const root = recipe('root', 'root', [{ item: 'a', count: 1 }]);
    const r = calculate([{ recipe: 'root', qty: 1 }], context([a, b, root]), none, true);
    expect(obj(r.raw)).toEqual({ a: 1, ore: 1 }); // a needs b which needs a: the second a stays raw
  });

  it('fills a category with the chosen item, else the first of the list', () => {
    const spear = recipe('spear', 'spear', [{ category: 'wood', count: 2 }]);
    const c = context([spear], { wood: [{ item: 'oak' }, { item: 'pine' }] });
    expect(obj(calculate([{ recipe: 'spear', qty: 1 }], c, none, true).raw)).toEqual({ oak: 2 });
    const pine = { ...none, category: { wood: 'pine' } };
    expect(obj(calculate([{ recipe: 'spear', qty: 1 }], c, pine, true).raw)).toEqual({ pine: 2 });
  });

  it('ignores a line whose recipe is gone', () => {
    expect(calculate([{ recipe: 'nope', qty: 1 }], ctx, none, true).raw.size).toBe(0);
  });
});

describe('owned items, leftovers and the tree', () => {
  const plank = recipe('plank', 'plank', [{ item: 'wood', count: 1 }], 2, 'saw');
  const table = recipe('table', 'table', [
    { item: 'plank', count: 3 },
    { item: 'nail', count: 4 },
  ]);
  const ctx = context([plank, table]);
  const lines = [{ recipe: 'table', qty: 1 }];

  it('counts the leftovers and the whole crafts', () => {
    const r = calculate(lines, ctx, none, true);
    expect(r.crafted[0]).toMatchObject({ item: 'plank', need: 3, crafts: 2, spare: 1 });
    expect(r.steps).toBe(3); // 1 table + 2 plank crafts
  });

  it('does not break down an owned craftable item, and takes owned raw materials off', () => {
    const r = calculate(lines, ctx, { ...none, have: { plank: 3, nail: 1 } }, true);
    expect(r.crafted).toEqual([]);
    expect(obj(r.raw)).toEqual({ nail: 3 }); // no wood: the planks are owned
    const part = calculate(lines, ctx, { ...none, have: { plank: 1 } }, true);
    expect(obj(part.raw)).toEqual({ wood: 1, nail: 4 }); // 2 planks missing: 1 craft of 2
  });

  it('draws the breakdown, an owned item stops its branch', () => {
    const [root] = tree(lines, ctx, { ...none, have: { nail: 1 } });
    expect(root).toMatchObject({ item: 'table', crafts: 1 });
    const [pl, nail] = root.children;
    expect(pl).toMatchObject({ item: 'plank', qty: 3, crafts: 2 });
    expect(pl.children[0]).toMatchObject({ item: 'wood', qty: 2, recipe: null });
    expect(nail).toMatchObject({ item: 'nail', qty: 4, have: 1, recipe: null });
  });

  it('cuts a cycle in the tree', () => {
    const a = recipe('a', 'a', [{ item: 'b', count: 1 }]);
    const b = recipe('b', 'b', [{ item: 'a', count: 1 }]);
    const [root] = tree([{ recipe: 'a', qty: 1 }], context([a, b]), none);
    expect(root.children[0].children[0]).toMatchObject({ item: 'a', recipe: null });
  });
});
