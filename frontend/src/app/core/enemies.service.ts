import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { EnemiesData } from './enemies.model';
import { LangService } from './lang.service';
import { Names } from './map-data.model';

/** The bosses and elite enemies, loaded after the login. */
@Injectable({ providedIn: 'root' })
export class EnemiesService {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);

  /** Null until loaded, and when the server has no enemies.json (the Enemies entry is then hidden). */
  readonly data = signal<EnemiesData | null>(null);
  /** The enemy whose page is open: a link `#enemy=<id>` opens it. */
  readonly open = signal<string | null>(null);

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<EnemiesData>('enemies.json')));
    } catch {
      this.data.set(null);
    }
  }

  clear(): void {
    this.data.set(null);
    this.open.set(null);
  }

  /** Opens the enemy named by the address (`#enemy=<id>`); true when there is one. */
  openFromHash(): boolean {
    const id = new URLSearchParams(location.hash.slice(1)).get('enemy');
    const found = !!id && !!this.data()?.enemies.some((e) => e.id === id);
    if (found) this.open.set(id);
    return found;
  }

  text(names: Names): string {
    return names[this.lang.index()] ?? names[0];
  }
}
