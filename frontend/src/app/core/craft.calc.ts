import { Entry, Input } from './craft.model';

/** What the calculator needs from craft.json. */
export interface CalcContext {
  recipes: ReadonlyMap<string, Entry>;
  byOutput: ReadonlyMap<string, readonly Entry[]>;
  categories: Readonly<Record<string, readonly { item: string }[]>>;
}

/** The player's choices: a recipe per item (RAW = do not break it down), an item per category. */
export interface Choices {
  recipe: Readonly<Record<string, string>>;
  category: Readonly<Record<string, string>>;
  /** Items the player already owns: they are subtracted and, when craftable, not broken down. */
  have?: Readonly<Record<string, number>>;
}

export const RAW = 'raw';

export interface Line {
  recipe: string;
  /** Wanted items; a recipe giving several per craft is made as many times as needed. */
  qty: number;
}

export interface Crafted {
  item: string;
  need: number;
  crafts: number;
  /** Items left over once the whole crafts are made. */
  spare: number;
  recipe: Entry;
}

export interface Result {
  raw: Map<string, number>;
  crafted: Crafted[];
  stations: Set<string | null>;
  /** Whole crafts to make, all recipes together. */
  steps: number;
}

/** One node of the breakdown shown as a tree. */
export interface TreeNode {
  item: string;
  qty: number;
  /** Quantity already owned (taken off before breaking the item down). */
  have: number;
  /** Null for a raw material (or an owned item, or the point where a cycle would close). */
  recipe: Entry | null;
  crafts: number;
  children: TreeNode[];
}

/** Without a choice: a recipe that needs no quest, then the one with the fewest ingredients, then the id. */
export function defaultRecipe(options: readonly Entry[]): Entry {
  const rank = (e: Entry): [number, number] => [e.unlock.type === 'quest' ? 1 : 0, e.inputs.length];
  return [...options].sort(
    (a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1] || a.id.localeCompare(b.id),
  )[0];
}

export function resolveInput(input: Input, ctx: CalcContext, choices: Choices): string {
  if (input.item) return input.item;
  const category = input.category!;
  return choices.category[category] ?? ctx.categories[category]?.[0]?.item ?? category;
}

const perCraft = (e: Entry): number => e.output?.count || 1;

/** The recipe an item is made with: the chosen one, else defaultRecipe; null for RAW or no recipe. */
function pickRecipe(item: string, ctx: CalcContext, choices: Choices): Entry | null {
  const pick = choices.recipe[item];
  const options = ctx.byOutput.get(item) ?? [];
  if (pick === RAW || !options.length) return null;
  return options.find((o) => o.id === pick) ?? defaultRecipe(options);
}

/** The breakdown of each project line, as the tree the calculator draws. */
export function tree(lines: readonly Line[], ctx: CalcContext, choices: Choices): TreeNode[] {
  const node = (item: string, qty: number, path: ReadonlySet<string>): TreeNode => {
    const have = Math.min(qty, choices.have?.[item] ?? 0);
    const recipe = path.has(item) ? null : pickRecipe(item, ctx, choices);
    const need = qty - have;
    if (!recipe || !need) return { item, qty, have, recipe: null, crafts: 0, children: [] };
    const crafts = Math.ceil(need / perCraft(recipe));
    const next = new Set(path).add(item);
    const children = recipe.inputs.map((i) =>
      node(resolveInput(i, ctx, choices), i.count * crafts, next),
    );
    return { item, qty, have, recipe, crafts, children };
  };
  const roots: TreeNode[] = [];
  for (const line of lines) {
    const recipe = ctx.recipes.get(line.recipe);
    if (!recipe?.output) continue;
    const crafts = Math.ceil(line.qty / perCraft(recipe));
    roots.push({
      item: recipe.output.item,
      qty: line.qty,
      have: 0,
      recipe,
      crafts,
      children: recipe.inputs.map((i) =>
        node(resolveInput(i, ctx, choices), i.count * crafts, new Set([recipe.output!.item])),
      ),
    });
  }
  return roots;
}

/**
 * Totals of a project. With `expand`, ingredients that can be crafted are broken down
 * into their own ingredients, down to raw materials. An item made by several recipes uses
 * the chosen one (or defaultRecipe). A cycle is cut where it closes: the ingredient that
 * would loop back stays a raw material. Quantities are added up per item before rounding
 * up to whole crafts, so two branches sharing a craft count it once.
 * The `scaling` of ingredient categories is not applied (its meaning is not confirmed).
 */
export function calculate(
  lines: readonly Line[],
  ctx: CalcContext,
  choices: Choices,
  expand: boolean,
): Result {
  const stations = new Set<string | null>();
  const raw = new Map<string, number>();
  const demand = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

  const chosen = new Map<string, Entry | null>();
  const choose = (item: string): Entry | null => {
    if (!expand) return null;
    if (chosen.has(item)) return chosen.get(item)!;
    const recipe = pickRecipe(item, ctx, choices);
    chosen.set(item, recipe);
    return recipe;
  };

  const cut = new Set<string>();
  const give = (item: string, n: number, from?: string) => {
    if (choose(item) && !(from && cut.has(`${from}>${item}`))) add(demand, item, n);
    else add(raw, item, n);
  };

  // depth-first walk of what is craftable: a cycle closes on an item still being visited
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (item: string) => {
    state.set(item, 1);
    for (const input of choose(item)!.inputs) {
      const child = resolveInput(input, ctx, choices);
      if (!choose(child)) continue;
      if (state.get(child) === 1) cut.add(`${item}>${child}`);
      else if (!state.has(child)) visit(child);
    }
    state.set(item, 2);
    order.push(item);
  };

  const roots: [Entry, number][] = [];
  for (const line of lines) {
    const recipe = ctx.recipes.get(line.recipe);
    if (recipe) roots.push([recipe, Math.ceil(line.qty / perCraft(recipe))]);
  }
  for (const [recipe, crafts] of roots) {
    stations.add(recipe.station);
    for (const input of recipe.inputs)
      give(resolveInput(input, ctx, choices), input.count * crafts);
  }
  for (const item of demand.keys()) if (!state.has(item)) visit(item);

  // consumers before producers, so an item's whole demand is known when it is reached
  const crafted: Crafted[] = [];
  for (const item of [...order].reverse()) {
    const need = Math.max(0, (demand.get(item) ?? 0) - (choices.have?.[item] ?? 0));
    const recipe = choose(item)!;
    const crafts = Math.ceil(need / perCraft(recipe));
    if (!need) continue;
    crafted.push({ item, need, crafts, spare: crafts * perCraft(recipe) - need, recipe });
    stations.add(recipe.station);
    for (const input of recipe.inputs)
      give(resolveInput(input, ctx, choices), input.count * crafts, item);
  }
  for (const [item, n] of raw) {
    const left = n - (choices.have?.[item] ?? 0);
    if (left > 0) raw.set(item, left);
    else raw.delete(item);
  }
  const steps =
    crafted.reduce((sum, c) => sum + c.crafts, 0) + roots.reduce((sum, [, c]) => sum + c, 0);
  return { raw, crafted, stations, steps };
}
