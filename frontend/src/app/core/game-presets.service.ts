import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PresetTable } from './game-settings.logic';

/** The game's own Relaxed / Hard / Survival values (settings-presets.json); absent = those presets show as unknown. */
@Injectable({ providedIn: 'root' })
export class GamePresetsService {
  private readonly http = inject(HttpClient);
  readonly table = signal<PresetTable | null>(null);

  async load(): Promise<void> {
    try {
      const d = await firstValueFrom(
        this.http.get<{ presets: PresetTable }>('settings-presets.json'),
      );
      this.table.set(d.presets);
    } catch {
      this.table.set(null);
    }
  }

  clear(): void {
    this.table.set(null);
  }
}
