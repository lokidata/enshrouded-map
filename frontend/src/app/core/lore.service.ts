import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LangService } from './lang.service';
import { LoreData } from './lore.model';
import { Names } from './map-data.model';

/** The lore notes and quests of the journal, loaded after the login. */
@Injectable({ providedIn: 'root' })
export class LoreService {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);

  /** Null until loaded, and when the server has no lore.json (the Lore entry is then hidden). */
  readonly data = signal<LoreData | null>(null);

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<LoreData>('lore.json')));
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
