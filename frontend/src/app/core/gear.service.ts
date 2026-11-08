import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LangService } from './lang.service';
import { GearData, GearItem, GearUpgrade, SlotKey } from './gear.model';
import { perkDamage, rarityColor } from './gear.logic';
import { Names } from './map-data.model';

/** Equipment stats and character constants, loaded after the login. */
@Injectable({ providedIn: 'root' })
export class GearService {
  private readonly http = inject(HttpClient);
  private readonly lang = inject(LangService);

  /** Null until loaded, and when the server has no gear.json (no Equipment screen then). */
  readonly data = signal<GearData | null>(null);

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<GearData>('gear.json')));
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

  /**
   * A damage perk as the item card shows it, `item` at its current level: "+5.1 — 10% of base damage" (the game's
   * /inventory/damagePerkDescription); null for another upgrade.
   */
  perkLine(item: GearItem, u: GearUpgrade): string | null {
    const c = this.data()?.constants;
    const v = u.damage && c ? perkDamage(c, item, u.damage.share) : null;
    if (v === null) return null;
    const pct = `${Math.round(u.damage!.share * 100)}%`;
    const text = this.data()?.texts?.['/inventory/damagePerkDescription'];
    return `+${v} — ${text ? this.text(text).replace('%k', pct) : pct}`;
  }

  /** The game's colour of a rarity (gear.json `colors`, else the built-in one). */
  color(rarity: string | undefined): string | null {
    return rarityColor(this.data()?.colors, rarity);
  }

  /** The game's empty-slot picture (gear.json `ui`), when the data has it. */
  slotArt(slot: SlotKey): string | null {
    const name = SLOT_ART[slot];
    return this.data()?.ui?.[name] ?? null;
  }
}

const SLOT_ART: Record<SlotKey, string> = {
  head: 'equipmentslot_head',
  chest: 'equipmentslot_upperbody',
  hands: 'equipmentslot_arms',
  legs: 'equipmentslot_legs',
  feet: 'equipmentslot_feet',
  ring1: 'equipmentslot_ring',
  ring2: 'equipmentslot_ring',
  weapon1: 'equipmentslot_mainhand',
  weapon2: 'equipmentslot_mainhand',
  weapon3: 'equipmentslot_mainhand',
  shield: 'equipmentslot_shield',
  ranged: 'equipmentslot_ranged',
};
