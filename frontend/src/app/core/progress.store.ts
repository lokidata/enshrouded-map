import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProgressStore {
  private readonly http = inject(HttpClient);

  readonly done = signal<ReadonlySet<string>>(new Set());
  /** True after a save failed (the change was reverted). */
  readonly saveFailed = signal(false);

  set(ids: readonly string[]): void {
    this.done.set(new Set(ids));
  }

  /** Marks or unmarks right away, and puts it back if the server refuses. */
  async toggle(id: string): Promise<void> {
    const now = !this.done().has(id);
    this.change(id, now);
    try {
      await firstValueFrom(this.http.put('api/v1/progress', { ids: [id], done: now }));
      this.saveFailed.set(false);
    } catch {
      this.change(id, !now);
      this.saveFailed.set(true);
    }
  }

  /** Marks or unmarks several at once (what is already so is left alone); same revert on failure. */
  async setAll(ids: readonly string[], done: boolean): Promise<void> {
    const changed = ids.filter((id) => this.done().has(id) !== done);
    if (!changed.length) return;
    for (const id of changed) this.change(id, done);
    try {
      await firstValueFrom(this.http.put('api/v1/progress', { ids: changed, done }));
      this.saveFailed.set(false);
    } catch {
      for (const id of changed) this.change(id, !done);
      this.saveFailed.set(true);
    }
  }

  private change(id: string, done: boolean): void {
    const next = new Set(this.done());
    if (done) next.add(id);
    else next.delete(id);
    this.done.set(next);
  }
}
