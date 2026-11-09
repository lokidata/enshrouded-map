import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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
  private readonly http = inject(HttpClient);
  /** False for a team member who is not the owner: they see the team's configuration, they do not change it. */
  readonly canEdit = signal(true);
  /** Whose configuration this is: the team's, or the player's own without a team. */
  readonly scope = signal<'team' | 'user'>('user');
  private readonly savedJson = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveFailed = signal(false);
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

  /** What is saved on the server: the preset, the differences from the default, the server name and the slots. */
  private readonly payload = computed(() => ({
    preset: this.preset(),
    diff: this.diffOf(this.custom()),
    name: this.name(),
    slotCount: this.slotCount(),
  }));
  /** The current settings differ from the saved ones. */
  readonly dirty = computed(() => JSON.stringify(this.payload()) !== this.savedJson());

  constructor() {
    this.restore();
    effect(() => {
      if (this.canEdit()) this.persist(this.payload());
    });
  }

  /** Reads the saved configuration after login (team's, else own) and shows it. A failure keeps the browser's draft. */
  async load(): Promise<void> {
    try {
      const r = await firstValueFrom(
        this.http.get<{ config: unknown; can_edit: boolean; scope: 'team' | 'user' }>(
          'api/v1/game-config',
        ),
      );
      this.canEdit.set(r.can_edit);
      this.scope.set(r.scope);
      if (r.config) this.read(r.config as Record<string, unknown>);
      else if (!r.can_edit) this.resetAll(true);
      // No saved configuration yet: whatever is on screen is the unsaved draft.
      this.savedJson.set(r.config ? JSON.stringify(this.payload()) : null);
    } catch {
      // server unreachable: keep the draft, saving will report the failure
    }
  }

  async save(): Promise<void> {
    if (!this.canEdit() || this.saving()) return;
    const body = this.payload();
    this.saving.set(true);
    this.saveFailed.set(false);
    try {
      await firstValueFrom(this.http.put('api/v1/game-config', { settings: body }));
      this.savedJson.set(JSON.stringify(body));
    } catch {
      this.saveFailed.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  /** Logout: the next account starts from its own draft. */
  clear(): void {
    this.canEdit.set(true);
    this.scope.set('user');
    this.savedJson.set(null);
    this.saveFailed.set(false);
    this.preset.set('Default');
    this.custom.set(defaultValues());
    this.name.set(DEFAULT_NAME);
    this.slotCount.set(MAX_SLOTS);
    this.extra.set({});
  }

  setPreset(p: Preset): void {
    if (this.canEdit()) this.preset.set(p);
  }

  set(key: string, raw: unknown): void {
    if (!this.canEdit()) return;
    const d = SETTINGS.find((s) => s.key === key);
    const v = d && clampValue(d, raw);
    if (d && v !== null) this.edit((c) => ({ ...c, [key]: v as SettingValue }));
  }

  reset(key: string): void {
    if (!this.canEdit()) return;
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

  resetAll(force = false): void {
    if (!this.canEdit() && !force) return;
    this.preset.set('Default');
    this.custom.set(defaultValues());
  }

  /** An import replaces the settings; a non-Custom preset keeps the file's gameSettings as the Custom values. */
  apply(i: Imported): void {
    if (!this.canEdit()) return;
    this.preset.set(i.preset);
    this.custom.set(i.settings);
    if (i.name !== undefined) this.name.set(i.name);
    if (i.slotCount !== undefined) this.slotCount.set(i.slotCount);
    this.extra.set(i.extra);
  }

  setName(v: string): void {
    if (this.canEdit()) this.name.set(v);
  }

  setSlots(raw: number): void {
    if (this.canEdit() && Number.isFinite(raw))
      this.slotCount.set(Math.min(Math.max(Math.round(raw), 1), MAX_SLOTS));
  }

  private restore(): void {
    try {
      this.read(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>);
    } catch {
      // unreadable or blocked storage: start from the default
    }
  }

  /** Puts a stored or saved payload on screen; unknown or out-of-range keys are ignored. */
  private read(o: Record<string, unknown>): void {
    if (isPreset(o['preset'])) this.preset.set(o['preset']);
    if (typeof o['name'] === 'string') this.name.set(o['name']);
    if (typeof o['slotCount'] === 'number')
      this.slotCount.set(Math.min(Math.max(Math.round(o['slotCount']), 1), MAX_SLOTS));
    const diff = (o['diff'] ?? {}) as Record<string, unknown>;
    const c = defaultValues();
    for (const d of SETTINGS) {
      const v = clampValue(d, diff[d.key]);
      if (v !== null) c[d.key] = v;
    }
    this.custom.set(c);
  }

  private diffOf(custom: Values): Record<string, SettingValue> {
    return Object.fromEntries(
      SETTINGS.filter((d) => custom[d.key] !== d.def).map((d) => [d.key, custom[d.key]]),
    );
  }

  private persist(payload: object): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch {
      // storage blocked: not remembered
    }
  }
}
