import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProgressStore {
  private readonly http = inject(HttpClient);

  readonly done = signal<ReadonlySet<string>>(new Set());
  /** What the server holds, as far as this tab knows: what a refused change goes back to. */
  private confirmed = new Set<string>();
  /** Marked map elements (recipes, lore pages and quests are counted apart). */
  readonly mapCount = computed(() => {
    let n = 0;
    for (const id of this.done()) if (!/^(recipe|lore|quest):/.test(id)) n++;
    return n;
  });
  /** True after a save failed (the change was reverted). */
  readonly saveFailed = signal(false);

  /** The save in flight (null: none). A save sent while another one is, waits for it: the server must see them in click order. */
  private tail: Promise<unknown> | null = null;

  private save(body: { ids: readonly string[]; done: boolean }): Promise<unknown> {
    const send = () => firstValueFrom(this.http.put('api/v1/progress', body));
    const run = this.tail ? this.tail.then(send) : send();
    const mine: Promise<unknown> = run
      .catch(() => undefined)
      .then(() => {
        if (this.tail === mine) this.tail = null;
      });
    this.tail = mine;
    return run;
  }

  set(ids: readonly string[]): void {
    this.done.set(new Set(ids));
    this.confirmed = new Set(ids);
  }

  /** Marks or unmarks right away, and puts it back if the server refuses. */
  async toggle(id: string): Promise<void> {
    const now = !this.done().has(id);
    this.change(id, now);
    try {
      await this.save({ ids: [id], done: now });
      this.confirm([id], now);
      this.saveFailed.set(false);
    } catch {
      this.revert([id], now);
      this.saveFailed.set(true);
    }
  }

  /** Marks or unmarks several at once (what is already so is left alone); same revert on failure. */
  async setAll(ids: readonly string[], done: boolean): Promise<void> {
    const changed = ids.filter((id) => this.done().has(id) !== done);
    if (!changed.length) return;
    for (const id of changed) this.change(id, done);
    try {
      await this.save({ ids: changed, done });
      this.confirm(changed, done);
      this.saveFailed.set(false);
    } catch {
      this.revert(changed, done);
      this.saveFailed.set(true);
    }
  }

  private confirm(ids: readonly string[], done: boolean): void {
    for (const id of ids) {
      if (done) this.confirmed.add(id);
      else this.confirmed.delete(id);
    }
  }

  /**
   * A change the server refused goes back to what the server holds, unless the player changed that mark again
   * meanwhile (a later click is its own change, with its own answer): flipping it would show a mark the server lacks.
   */
  private revert(ids: readonly string[], done: boolean): void {
    for (const id of ids) {
      if (this.done().has(id) === done) this.change(id, this.confirmed.has(id));
    }
  }

  private change(id: string, done: boolean): void {
    const next = new Set(this.done());
    if (done) next.add(id);
    else next.delete(id);
    this.done.set(next);
  }
}
