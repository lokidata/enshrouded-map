import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  add,
  canAdd,
  canRemove,
  decode,
  encode,
  fromSaved,
  remove,
  spent,
  toSaved,
} from './skills.logic';
import { Levels, SavedBuild } from './skills.model';
import { SkillsService } from './skills.service';

const DRAFT = 'skillDraft';

/** The build being planned, and the builds the player saved (api/v1/builds). */
@Injectable({ providedIn: 'root' })
export class PlannerStore {
  private readonly http = inject(HttpClient);
  private readonly skills = inject(SkillsService);

  readonly levels = signal<Levels>(this.readDraft());
  readonly name = signal('');
  readonly saved = signal<readonly SavedBuild[]>([]);
  /** The saved build being edited; null for a new one. */
  readonly currentId = signal<number | null>(null);
  readonly error = signal<'too_many' | 'failed' | null>(null);

  readonly used = computed(() => {
    const tree = this.skills.tree();
    return tree ? spent(tree, this.levels()) : 0;
  });
  readonly budget = computed(() => this.skills.data()?.budget ?? 0);

  canAdd(id: number): boolean {
    const tree = this.skills.tree();
    return !!tree && canAdd(tree, this.levels(), id, this.budget());
  }

  canRemove(id: number): boolean {
    const tree = this.skills.tree();
    return !!tree && canRemove(tree, this.levels(), id);
  }

  addLevel(id: number): void {
    if (this.canAdd(id)) this.set(add(this.levels(), id));
  }

  removeLevel(id: number): void {
    if (this.canRemove(id)) this.set(remove(this.levels(), id));
  }

  reset(): void {
    this.set({});
  }

  /** A new, empty build. */
  create(): void {
    this.currentId.set(null);
    this.name.set('');
    this.error.set(null);
    this.set({});
  }

  open(build: SavedBuild): void {
    const tree = this.skills.tree();
    this.currentId.set(build.id);
    this.name.set(build.name);
    this.error.set(null);
    this.set(tree ? fromSaved(tree, build.nodes) : {});
  }

  async load(): Promise<void> {
    try {
      this.saved.set(await firstValueFrom(this.http.get<SavedBuild[]>('api/v1/builds')));
    } catch {
      this.saved.set([]);
    }
  }

  clear(): void {
    this.saved.set([]);
    this.currentId.set(null);
    this.name.set('');
    this.error.set(null);
    this.levels.set({});
    this.writeDraft({});
  }

  /** Saves the build under its name: a new one, or an update of the one being edited. */
  async save(): Promise<void> {
    const body = {
      name: this.name().trim() || `Build ${this.saved().length + 1}`,
      nodes: toSaved(this.levels()),
    };
    this.error.set(null);
    try {
      const id = this.currentId();
      const result = await firstValueFrom(
        id === null
          ? this.http.post<SavedBuild>('api/v1/builds', body)
          : this.http.put<SavedBuild>(`api/v1/builds/${id}`, body),
      );
      this.currentId.set(result.id);
      this.name.set(result.name);
      this.saved.update((list) => [result, ...list.filter((b) => b.id !== result.id)]);
    } catch (e) {
      this.error.set((e as { status?: number }).status === 409 ? 'too_many' : 'failed');
    }
  }

  async delete(id: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`api/v1/builds/${id}`));
      this.saved.update((list) => list.filter((b) => b.id !== id));
      if (this.currentId() === id) this.currentId.set(null);
    } catch {
      this.error.set('failed');
    }
  }

  /** A link that opens this build on the planner. */
  link(): string {
    const data = this.skills.data();
    return `${location.origin}${location.pathname}#build=${data ? encode(data, this.levels()) : ''}`;
  }

  /** Opens the build named by the address (`#build=<code>`); true when there is one. */
  openFromHash(): boolean {
    const code = new URLSearchParams(location.hash.slice(1)).get('build');
    const data = this.skills.data();
    if (code === null || !data) return false;
    this.currentId.set(null);
    this.name.set('');
    this.set(decode(data, code));
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  private set(levels: Levels): void {
    this.levels.set(levels);
    this.writeDraft(levels);
  }

  private readDraft(): Levels {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT) ?? '{}') as Record<string, number>;
      return Object.fromEntries(
        Object.entries(raw).filter(([, l]) => Number.isInteger(l) && l > 0),
      );
    } catch {
      return {};
    }
  }

  private writeDraft(levels: Levels): void {
    try {
      localStorage.setItem(DRAFT, JSON.stringify(levels));
    } catch {
      // storage blocked: the draft is just not kept between visits
    }
  }
}
