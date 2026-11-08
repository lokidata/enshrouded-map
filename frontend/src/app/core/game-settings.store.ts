import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { GamePresetsService } from './game-presets.service';
import {
  Imported,
  Values,
  buildServerFile,
  clampValue,
  defaultValues,
  isPreset,
  presetValues,
} from './game-settings.logic';
import { MAX_SLOTS, Preset, SETTINGS, SettingValue } from './game-settings.model';

const KEY = 'gameSettings';
const DEFAULT_NAME = 'Enshrouded Server';

/** The player's game settings: a preset and the Custom values. Only the differences from the default are stored in the browser. */
@Injectable({ providedIn: 'root' })
export class GameSettingsStore {
  private readonly presets = inject(GamePresetsService);
  readonly preset = signal<Preset>('Default');
  /** The Custom values (all keys). */
  readonly custom = signal<Values>(defaultValues());
  readonly name = signal(DEFAULT_NAME);
  readonly slotCount = signal(MAX_SLOTS);
  /** Imported server keys (ports, userGroups with passwords, bans...), kept in memory only so passwords never reach localStorage. */
  readonly extra = signal<Record<string, unknown>>({});

  /** The preset's values, `null` when the game's table is not loaded for it. */
  readonly presetKnown = computed(() => presetValues(this.preset(), this.presets.table()) !== null);
  /** What the page shows: Custom values, else the preset's (or the default when its values are unknown). */
  readonly values = computed<Values>(() =>
    this.preset() === 'Custom'
      ? this.custom()
      : (presetValues(this.preset(), this.presets.table()) ?? defaultValues()),
  );
  readonly file = computed(() =>
    buildServerFile({
      preset: this.preset(),
      settings: this.values(),
      name: this.name(),
      slotCount: this.slotCount(),
      extra: this.extra(),
    }),
  );

  constructor() {
    this.restore();
    effect(() => this.persist(this.preset(), this.custom(), this.name(), this.slotCount()));
  }

  set(key: string, raw: unknown): void {
    const d = SETTINGS.find((s) => s.key === key);
    const v = d && clampValue(d, raw);
    if (d && v !== null) this.edit((c) => ({ ...c, [key]: v as SettingValue }));
  }

  reset(key: string): void {
    const d = SETTINGS.find((s) => s.key === key);
    if (d) this.edit((c) => ({ ...c, [key]: d.def }));
  }

  /** Editing a field under another preset turns it into Custom, starting from that preset's values (as in the game). */
  private edit(change: (c: Values) => Values): void {
    const base = this.values();
    const next = change(base);
    if (SETTINGS.every((d) => next[d.key] === base[d.key])) return; // nothing changed: keep the preset
    this.custom.set(next);
    this.preset.set('Custom');
  }

  resetAll(): void {
    this.preset.set('Default');
    this.custom.set(defaultValues());
  }

  /** An import replaces the settings; a non-Custom preset keeps the file's gameSettings as the Custom values. */
  apply(i: Imported): void {
    this.preset.set(i.preset);
    this.custom.set(i.settings);
    if (i.name !== undefined) this.name.set(i.name);
    if (i.slotCount !== undefined) this.slotCount.set(i.slotCount);
    this.extra.set(i.extra);
  }

  setName(v: string): void {
    this.name.set(v);
  }

  setSlots(raw: number): void {
    if (Number.isFinite(raw)) this.slotCount.set(Math.min(Math.max(Math.round(raw), 1), MAX_SLOTS));
  }

  private restore(): void {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
      if (isPreset(o['preset'])) this.preset.set(o['preset']);
      if (typeof o['name'] === 'string') this.name.set(o['name']);
      if (typeof o['slotCount'] === 'number') this.setSlots(o['slotCount']);
      const diff = (o['diff'] ?? {}) as Record<string, unknown>;
      const c = defaultValues();
      for (const d of SETTINGS) {
        const v = clampValue(d, diff[d.key]);
        if (v !== null) c[d.key] = v;
      }
      this.custom.set(c);
    } catch {
      // unreadable or blocked storage: start from the default
    }
  }

  private persist(preset: Preset, custom: Values, name: string, slotCount: number): void {
    const diff = Object.fromEntries(
      SETTINGS.filter((d) => custom[d.key] !== d.def).map((d) => [d.key, custom[d.key]]),
    );
    try {
      localStorage.setItem(KEY, JSON.stringify({ preset, diff, name, slotCount }));
    } catch {
      // storage blocked: not remembered
    }
  }
}
