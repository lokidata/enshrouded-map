import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GemsData } from './gems.model';
import { LangService } from './lang.service';
import { Names } from './map-data.model';

/** Weapon gems and comfort constants, loaded after the login. */
@Injectable({ providedIn: 'root' })
export class GemsService {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);

  /** Null until loaded, and when the server has no gems.json (no Gems entry then). */
  readonly data = signal<GemsData | null>(null);
  readonly gems = computed(() => this.data()?.gems ?? []);

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<GemsData>('gems.json')));
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
