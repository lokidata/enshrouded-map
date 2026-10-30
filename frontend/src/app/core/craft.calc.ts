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
  recipe: Entry;
}

export interface Result {
  raw: Map<string, number>;
  crafted: Crafted[];
  stations: Set<string | null>;
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
    const pick = choices.recipe[item];
    const options = ctx.byOutput.get(item) ?? [];
    let recipe: Entry | null = null;
    if (pick !== RAW && options.length)
      recipe = options.find((o) => o.id === pick) ?? defaultRecipe(options);
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
    const need = demand.get(item) ?? 0;
    const recipe = choose(item)!;
    const crafts = Math.ceil(need / perCraft(recipe));
    if (!need) continue;
    crafted.push({ item, need, crafts, recipe });
    stations.add(recipe.station);
    for (const input of recipe.inputs)
      give(resolveInput(input, ctx, choices), input.count * crafts, item);
  }
  return { raw, crafted, stations };
}
