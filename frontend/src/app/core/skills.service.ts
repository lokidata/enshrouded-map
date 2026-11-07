import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LangService } from './lang.service';
import { Names } from './map-data.model';
import { Tree, tree } from './skills.logic';
import { SkillsData } from './skills.model';

/** The skill tree of the game, loaded after the login. */
@Injectable({ providedIn: 'root' })
export class SkillsService {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);

  /** Null until loaded, and when the server has no skills.json (the Skills entry is then hidden). */
  readonly data = signal<SkillsData | null>(null);
  readonly tree = computed<Tree | null>(() => {
    const data = this.data();
    return data ? tree(data) : null;
  });

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<SkillsData>('skills.json')));
    } catch {
      this.data.set(null);
    }
  }

  clear(): void {
    this.data.set(null);
  }

  text(names: Names): string {
    return names[this.lang.index()] ?? names[0];
  }
}
