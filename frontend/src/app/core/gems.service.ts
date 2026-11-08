import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { gemLevel, gemLines, gemText } from './gems.logic';
import { Gem, GemPick, GemsData } from './gems.model';
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
  /** BalancingTable powerCreepWeapon, for the gem scaling (see gemValue). */
  readonly creep = computed(() => this.data()?.constants?.powerCreepWeapon);

  /** A gem set in a weapon: its level (clamped), its lines and its text with the values; null for an unknown gem. */
  effect(pick: GemPick | undefined): {
    gem: Gem;
    level: number;
    lines: { name: string; text: string; estimate: boolean }[];
    text: string | null;
  } | null {
    const gem = pick && this.gems().find((g) => g.id === pick.id);
    if (!gem) return null;
    const level = gemLevel(gem, pick.level);
    const lines = gemLines(gem, level, this.creep());
    return {
      gem,
      level,
      lines: lines.map((l) => ({
        name: this.text(l.stat.name),
        text: l.text,
        estimate: l.estimate,
      })),
      text: gem.desc ? gemText(this.text(gem.desc)) : null,
    };
  }

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
