import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface Character {
  id: number;
  name: string;
  active: boolean;
}

/** The player's character profiles: each has its own progress marks, saved builds and imported explored area. */
@Injectable({ providedIn: 'root' })
export class CharacterStore {
  private readonly http = inject(HttpClient);

  readonly list = signal<readonly Character[]>([]);
  readonly active = computed(() => this.list().find((c) => c.active) ?? null);
  readonly dialogOpen = signal(false);

  async load(): Promise<void> {
    try {
      this.list.set(await firstValueFrom(this.http.get<Character[]>('api/v1/characters')));
    } catch {
      this.list.set([]);
    }
  }

  /** A new profile, which becomes the active one. */
  async create(name: string): Promise<void> {
    this.list.set(await firstValueFrom(this.http.post<Character[]>('api/v1/characters', { name })));
  }

  async activate(id: number): Promise<void> {
    this.list.set(
      await firstValueFrom(this.http.post<Character[]>(`api/v1/characters/${id}/activate`, {})),
    );
  }

  async rename(id: number, name: string): Promise<void> {
    this.list.set(
      await firstValueFrom(this.http.patch<Character[]>(`api/v1/characters/${id}`, { name })),
    );
  }

  async remove(id: number): Promise<void> {
    this.list.set(await firstValueFrom(this.http.delete<Character[]>(`api/v1/characters/${id}`)));
  }

  clear(): void {
    this.list.set([]);
    this.dialogOpen.set(false);
  }
}
