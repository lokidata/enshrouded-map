import { Injectable, signal } from '@angular/core';
import { Choices, Line } from './craft.calc';

const KEY = 'project';

interface Saved {
  lines: Line[];
  expand: boolean;
  choices: Choices;
}

/** The calculator's project: kept in this browser only. */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  readonly lines = signal<Line[]>([]);
  readonly expand = signal(true);
  readonly choices = signal<Choices>({ recipe: {}, category: {} });

  constructor() {
    const saved = this.read();
    if (saved) {
      this.lines.set(saved.lines);
      this.expand.set(saved.expand);
      this.choices.set(saved.choices);
    }
  }

  add(recipe: string, qty = 1): void {
    this.update(() => {
      const lines = this.lines();
      const same = lines.find((l) => l.recipe === recipe);
      this.lines.set(
        same
          ? lines.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l))
          : [...lines, { recipe, qty }],
      );
    });
  }

  setQty(recipe: string, qty: number): void {
    const n = Math.max(1, Math.min(9999, Math.floor(qty) || 1));
    this.update(() =>
      this.lines.update((ls) => ls.map((l) => (l.recipe === recipe ? { ...l, qty: n } : l))),
    );
  }

  remove(recipe: string): void {
    this.update(() => this.lines.update((ls) => ls.filter((l) => l.recipe !== recipe)));
  }

  clear(): void {
    this.update(() => this.lines.set([]));
  }

  setExpand(expand: boolean): void {
    this.update(() => this.expand.set(expand));
  }

  chooseRecipe(item: string, recipe: string): void {
    this.update(() =>
      this.choices.update((c) => ({ ...c, recipe: { ...c.recipe, [item]: recipe } })),
    );
  }

  chooseCategory(category: string, item: string): void {
    this.update(() =>
      this.choices.update((c) => ({ ...c, category: { ...c.category, [category]: item } })),
    );
  }

  private update(change: () => void): void {
    change();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ lines: this.lines(), expand: this.expand(), choices: this.choices() }),
      );
    } catch {
      // storage blocked: the project just is not remembered
    }
  }

  private read(): Saved | null {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
      if (!raw || !Array.isArray(raw.lines)) return null;
      return {
        lines: raw.lines.filter((l) => typeof l?.recipe === 'string' && l.qty > 0),
        expand: raw.expand !== false,
        choices: { recipe: raw.choices?.recipe ?? {}, category: raw.choices?.category ?? {} },
      };
    } catch {
      return null;
    }
  }
}
