import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { MapDataService } from './map-data.service';

@Injectable({ providedIn: 'root' })
export class LangService {
  private readonly transloco = inject(TranslocoService);
  private readonly mapData = inject(MapDataService);

  readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  /** Position of the language in the map data's name arrays. */
  readonly index = computed(() => Math.max(0, this.mapData.data.languages.indexOf(this.lang())));

  async set(code: string): Promise<void> {
    await firstValueFrom(this.transloco.load(code)); // translations ready before the switch
    this.transloco.setActiveLang(code);
    document.documentElement.lang = code;
    try {
      localStorage.setItem('lang', code);
    } catch {
      // storage blocked: the choice just is not remembered
    }
  }

  /** Translation for code that is not a template (popups, tooltips). */
  t(key: string): string {
    return this.transloco.translate(key);
  }
}
