import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LangService } from '../core/lang.service';
import {
  Imported,
  diffAgainstDefault,
  minToNs,
  nsToMin,
  parseServerFile,
} from '../core/game-settings.logic';
import {
  GROUPS,
  GroupId,
  MAX_SLOTS,
  PRESETS,
  SETTINGS,
  SettingDef,
  SettingValue,
  Text,
} from '../core/game-settings.model';
import { GameSettingsStore } from '../core/game-settings.store';

/** « Partie » / « Game »: the server's game settings, with export and import of enshrouded_server.json. */
@Component({
  selector: 'app-game',
  imports: [TranslocoPipe],
  template: `
    <div id="game-panel" class="gs">
      <nav class="gs-nav" [attr.aria-label]="'game' | transloco">
        @for (g of groups; track g) {
          <button
            type="button"
            [attr.aria-current]="group() === g ? 'page' : null"
            (click)="group.set(g)"
          >
            {{ 'gsGroup_' + g | transloco }}
          </button>
        }
      </nav>
      <main class="gs-main">
        <header class="gs-head">
          <h2>{{ 'game' | transloco }} · {{ 'gsGroup_' + group() | transloco }}</h2>
          <label class="gs-preset">
            {{ 'gsPreset' | transloco }}
            <select
              [attr.aria-label]="'gsPreset' | transloco"
              [value]="store.preset()"
              (change)="store.preset.set($any($event.target).value)"
            >
              @for (p of presets; track p) {
                <option [value]="p" [selected]="store.preset() === p">
                  {{ 'gsPreset_' + p | transloco }}
                </option>
              }
            </select>
          </label>
          <button type="button" class="gs-btn" (click)="store.resetAll()">
            {{ 'gsResetAll' | transloco }}
          </button>
        </header>
        @if (store.preset() !== 'Custom') {
          <p class="note">{{ 'gsReadOnly' | transloco }}</p>
        }
        @if (!store.presetKnown()) {
          <p class="note" role="status">{{ 'gsPresetUnknown' | transloco }}</p>
        }
        <div class="gs-rows">
          @for (d of byGroup(group()); track d.key) {
            <div class="gs-field" [class.modified]="!isDefault(d)">
              <label class="gs-label" [for]="'gs-' + d.key">{{ text(d.label) }}</label>
              <div class="gs-control">
                @switch (d.kind) {
                  @case ('enum') {
                    <select
                      [id]="'gs-' + d.key"
                      [value]="store.values()[d.key]"
                      [attr.aria-describedby]="'gs-h-' + d.key"
                      (change)="store.set(d.key, $any($event.target).value)"
                    >
                      @for (o of d.options; track o) {
                        <option [value]="o" [selected]="store.values()[d.key] === o">
                          {{ o }}
                        </option>
                      }
                    </select>
                  }
                  @case ('boolean') {
                    <input
                      type="checkbox"
                      class="gs-toggle"
                      role="switch"
                      [id]="'gs-' + d.key"
                      [checked]="store.values()[d.key]"
                      [attr.aria-describedby]="'gs-h-' + d.key"
                      (change)="store.set(d.key, $any($event.target).checked)"
                    />
                  }
                  @default {
                    @if (d.kind === 'number' && d.min !== undefined) {
                      <input
                        type="range"
                        class="gs-range"
                        tabindex="-1"
                        aria-hidden="true"
                        [step]="d.int ? 1 : (d.max! - d.min) / 100"
                        [min]="d.min"
                        [max]="d.max"
                        [value]="shown(d)"
                        (input)="slide(d, $event)"
                      />
                    }
                    <input
                      type="number"
                      step="any"
                      [id]="'gs-' + d.key"
                      [value]="shown(d)"
                      [min]="d.min"
                      [max]="d.max"
                      [attr.aria-describedby]="'gs-h-' + d.key"
                      (change)="edit(d, $event)"
                    />
                  }
                }
              </div>
              <div class="gs-state">
                @if (isDefault(d)) {
                  <span class="gs-badge">{{ 'gsDefault' | transloco }}</span>
                } @else {
                  <button
                    type="button"
                    class="gs-reset"
                    [attr.aria-label]="'gsResetField' | transloco: { name: text(d.label) }"
                    [title]="'gsReset' | transloco"
                    (click)="store.reset(d.key)"
                  >
                    <span aria-hidden="true">↺</span>
                  </button>
                }
              </div>
              <small class="hint" [id]="'gs-h-' + d.key">{{ hint(d) }}</small>
            </div>
          }
        </div>
      </main>

      <aside class="gs-side">
        <details open class="gs-card">
          <summary>{{ 'gsExport' | transloco }}</summary>
          <div class="gs-body">
            <label class="gs-block">
              {{ 'gsServerName' | transloco }}
              <input
                type="text"
                [value]="store.name()"
                (input)="store.setName($any($event.target).value)"
              />
            </label>
            <label class="gs-block">
              {{ 'gsSlots' | transloco }}
              <input
                type="number"
                min="1"
                [max]="maxSlots"
                [value]="store.slotCount()"
                (change)="slots($event)"
              />
            </label>
            <p class="note">{{ 'gsPasswordWarn' | transloco }}</p>
            <p class="note">{{ 'gsExtraMemory' | transloco }}</p>
            <textarea
              class="gs-json"
              readonly
              rows="14"
              [attr.aria-label]="'gsPreview' | transloco"
              [value]="json()"
            ></textarea>
            <div class="actions">
              <button type="button" class="gs-btn" (click)="download()">
                {{ 'gsDownload' | transloco }}
              </button>
              <button type="button" class="gs-btn" (click)="copy()">
                {{ 'gsCopy' | transloco }}
              </button>
              <span class="note" role="status">{{ status() }}</span>
            </div>
          </div>
        </details>

        <details open class="gs-card">
          <summary>{{ 'gsImport' | transloco }}</summary>
          <div class="gs-body">
            <label class="gs-block">
              {{ 'gsImportFile' | transloco }}
              <input type="file" accept=".json,application/json" (change)="readFile($event)" />
            </label>
            <label class="gs-block">
              {{ 'gsImportPaste' | transloco }}
              <textarea
                class="gs-json"
                rows="8"
                spellcheck="false"
                [value]="pasted()"
                (input)="pasted.set($any($event.target).value); report.set(null)"
              ></textarea>
            </label>
            <div class="actions">
              <button type="button" class="gs-btn" (click)="check()">
                {{ 'gsImportCheck' | transloco }}
              </button>
            </div>
            <div role="status" class="gs-report">
              @if (error(); as e) {
                <p class="note">{{ 'gsImportError' | transloco }} {{ e }}</p>
              }
              @if (report(); as r) {
                @if (r.unknown.length) {
                  <p>
                    {{ 'gsImportUnknown' | transloco }} <code>{{ r.unknown.join(', ') }}</code>
                  </p>
                }
                @if (r.invalid.length) {
                  <p>
                    {{ 'gsImportInvalid' | transloco }} <code>{{ r.invalid.join(', ') }}</code>
                  </p>
                }
                @if (r.clamped.length) {
                  <p>
                    {{ 'gsImportClamped' | transloco }} <code>{{ r.clamped.join(', ') }}</code>
                  </p>
                }
                <h3>{{ 'gsImportDiff' | transloco }}</h3>
                <ul class="gs-diff">
                  @if (r.preset !== 'Default') {
                    <li>{{ 'gsPreset' | transloco }}: {{ 'gsPreset_' + r.preset | transloco }}</li>
                  }
                  @for (c of diff(); track c.key) {
                    <li>{{ label(c.key) }}: {{ fmt(c.key, c.from) }} → {{ fmt(c.key, c.to) }}</li>
                  } @empty {
                    <li>{{ 'gsImportNoDiff' | transloco }}</li>
                  }
                </ul>
                <button type="button" class="gs-btn" (click)="apply(r)">
                  {{ 'gsImportApply' | transloco }}
                </button>
              }
            </div>
          </div>
        </details>
      </aside>
    </div>
  `,
  host: { class: 'workshop' },
  styles: `
    .gs {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: grid;
      grid-template-columns: 200px minmax(0, 1fr) minmax(280px, 380px);
      gap: 16px;
      padding: 16px;
      align-items: start;
    }
    .gs-nav,
    .gs-main,
    .gs-card {
      border: 1px solid var(--gold-dim);
      border-radius: 3px;
      background: linear-gradient(180deg, var(--panel), var(--panel-deep));
      box-shadow: inset 0 1px 0 #ffffff0d;
    }
    .gs-nav {
      display: flex;
      flex-direction: column;
      padding: 6px;
      gap: 2px;
      position: sticky;
      top: 0;
    }
    .gs-nav button {
      text-align: left;
      padding: 10px 12px;
      border: 0;
      border-left: 3px solid transparent;
      background: none;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.08em;
      font-family: var(--display-sc);
      font-weight: 400;
      text-transform: none;
      cursor: pointer;
    }
    .gs-nav button:hover {
      color: var(--text);
      background: var(--hover);
    }
    .gs-nav button[aria-current='page'] {
      color: var(--gold);
      border-left-color: var(--gold);
      background: linear-gradient(to right, var(--gold-faint), transparent 80%);
    }
    .gs-main {
      padding: 0 0 8px;
      min-width: 0;
    }
    .gs-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 16px;
      padding: 12px 18px;
      background: var(--panel-deep);
      border-bottom: 2px solid var(--gold-dim);
    }
    .gs-head h2 {
      flex: 1 1 200px;
      margin: 0;
      border: 0;
      padding: 0;
    }
    .gs-preset {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
    }
    .gs-main > .note {
      margin: 10px 18px 0;
    }
    .gs-rows {
      padding: 6px 18px;
    }
    .gs-field {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(190px, 280px) 96px;
      gap: 2px 14px;
      align-items: center;
      padding: 8px 10px 8px 12px;
      border-bottom: 1px solid var(--border);
      border-left: 3px solid transparent;
    }
    .gs-field.modified {
      border-left-color: var(--gold);
      background: linear-gradient(to right, var(--gold-faint), transparent 70%);
    }
    .gs-field.modified .gs-label {
      color: var(--gold);
    }
    .gs-label {
      font-weight: 600;
    }
    .gs-control {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .gs-control select {
      width: 100%;
    }
    .gs-control input[type='number'] {
      width: 84px;
      flex: none;
      margin-left: auto;
    }
    .gs-range {
      flex: 1;
      min-width: 0;
      accent-color: var(--gold);
    }
    .gs-toggle {
      appearance: none;
      width: 44px;
      height: 24px;
      margin-left: auto;
      border: 1px solid var(--gold-dim);
      border-radius: 999px;
      background: var(--ink);
      position: relative;
      cursor: pointer;
    }
    .gs-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--muted);
      transition: transform 0.15s;
    }
    .gs-toggle:checked {
      background: var(--gold-dim);
      border-color: var(--gold);
    }
    .gs-toggle:checked::after {
      transform: translateX(20px);
      background: var(--gold);
    }
    .gs-toggle:disabled {
      cursor: default;
      opacity: 0.8;
    }
    .gs-toggle:focus-visible,
    .gs-nav button:focus-visible,
    .gs-reset:focus-visible,
    .gs-card summary:focus-visible {
      outline: 2px solid var(--gold);
      outline-offset: 2px;
    }
    .locked input[type='number']:disabled,
    .locked select:disabled {
      opacity: 1;
      color: var(--text);
      background: transparent;
      border-color: transparent;
      cursor: default;
    }
    .locked select:disabled {
      appearance: none;
    }
    .locked .gs-range {
      opacity: 0.45;
    }
    .gs-state {
      text-align: right;
    }
    .gs-badge {
      display: inline-block;
      white-space: nowrap;
      padding: 1px 6px;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--muted);
      font-size: 10px;
      font-family: var(--display-sc);
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0.05em;
    }
    .gs-reset {
      width: 32px;
      height: 32px;
      border: 1px solid var(--gold);
      border-radius: 3px;
      background: linear-gradient(180deg, var(--panel), var(--panel));
      color: var(--gold);
      font-size: 16px;
      cursor: pointer;
    }
    .gs-reset:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .gs-field .hint {
      grid-column: 1 / -1;
      margin: 0;
      color: var(--muted);
    }
    .gs-btn {
      padding: 6px 14px;
      border: 1px solid var(--gold);
      border-radius: 3px;
      background: linear-gradient(180deg, var(--panel), var(--panel));
      color: var(--gold);
      font-weight: 600;
      letter-spacing: 0.06em;
      font-family: var(--display-sc);
      font-weight: 400;
      text-transform: none;
      cursor: pointer;
    }
    .gs-btn:hover {
      background: linear-gradient(180deg, var(--gold-dim), var(--panel));
    }
    .gs-side {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 0;
    }
    .gs-card summary {
      padding: 12px 16px;
      cursor: pointer;
      color: var(--gold);
      font-weight: 600;
      letter-spacing: 0.08em;
      font-family: var(--display-sc);
      font-weight: 400;
      text-transform: none;
      border-bottom: 1px solid transparent;
    }
    .gs-card[open] summary {
      border-bottom-color: var(--gold-dim);
    }
    .gs-body {
      padding: 4px 16px 16px;
    }
    .gs-block {
      display: block;
      margin: 10px 0;
    }
    .gs-block input[type='text'],
    .gs-block input[type='number'] {
      display: block;
      width: 100%;
      margin-top: 4px;
    }
    .gs-json {
      width: 100%;
      box-sizing: border-box;
      margin-top: 4px;
      font-family: var(--mono);
      font-size: 14px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 3px;
      background: var(--ink);
      color: var(--text);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 10px 0;
    }
    .gs-report {
      margin: 12px 0;
    }
    @media (max-width: 1200px) {
      .gs {
        grid-template-columns: 180px minmax(0, 1fr);
      }
      .gs-side {
        grid-column: 1 / -1;
      }
    }
    @media (max-width: 900px) {
      .gs {
        grid-template-columns: minmax(0, 1fr);
        padding: 10px;
      }
      .gs-nav {
        position: static;
        flex-direction: row;
        overflow-x: auto;
      }
      .gs-nav button {
        white-space: nowrap;
        border-left: 0;
        border-bottom: 3px solid transparent;
      }
      .gs-nav button[aria-current='page'] {
        border-bottom-color: var(--gold);
      }
      .gs-rows {
        padding: 4px 8px;
      }
      .gs-field {
        grid-template-columns: minmax(0, 1fr) 72px;
      }
      .gs-label {
        grid-column: 1;
      }
      .gs-state {
        grid-column: 2;
        grid-row: 1;
      }
      .gs-control {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class Game {
  protected readonly store = inject(GameSettingsStore);
  private readonly lang = inject(LangService);
  protected readonly presets = PRESETS;
  protected readonly groups = GROUPS;
  protected readonly maxSlots = MAX_SLOTS;

  protected readonly group = signal<GroupId>('player');
  protected readonly pasted = signal('');
  protected readonly report = signal<Imported | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal('');
  protected readonly json = computed(() => JSON.stringify(this.store.file(), null, 2));
  protected readonly diff = computed(() => {
    const r = this.report();
    return r ? diffAgainstDefault(r.settings) : [];
  });

  protected byGroup(g: string): SettingDef[] {
    return SETTINGS.filter((d) => d.group === g);
  }

  protected text(t: Text): string {
    return this.lang.lang() === 'fr' ? t.fr : t.en;
  }

  protected isDefault(d: SettingDef): boolean {
    return this.store.values()[d.key] === d.def;
  }

  protected shown(d: SettingDef): number {
    const v = this.store.values()[d.key] as number;
    return d.kind === 'duration' ? nsToMin(v) : v;
  }

  protected hint(d: SettingDef): string {
    const unit = d.kind === 'duration' ? ` ${this.lang.t('gsMinutes')}` : '';
    const range = d.min === undefined ? '' : `${d.min}–${d.max}${unit} · `;
    const def = d.kind === 'duration' ? `${nsToMin(d.def as number)}${unit}` : `${d.def}`;
    return `${range}${this.lang.t('gsDefaultIs')} ${def}${d.help ? ' · ' + this.text(d.help) : ''}`;
  }

  protected label(key: string): string {
    const d = SETTINGS.find((s) => s.key === key);
    return d ? this.text(d.label) : key;
  }

  protected fmt(key: string, v: SettingValue): string {
    const d = SETTINGS.find((s) => s.key === key);
    return d?.kind === 'duration' ? `${nsToMin(v as number)} ${this.lang.t('gsMinutes')}` : `${v}`;
  }

  protected edit(d: SettingDef, event: Event): void {
    const input = event.target as HTMLInputElement;
    const n = input.valueAsNumber;
    this.store.set(d.key, d.kind === 'duration' ? minToNs(n) : n);
    input.value = `${this.shown(d)}`; // shows the clamped value, even when the signal did not change
  }

  protected slide(d: SettingDef, event: Event): void {
    this.store.set(
      d.key,
      Math.round((event.target as HTMLInputElement).valueAsNumber * 1000) / 1000,
    );
  }

  protected slots(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.store.setSlots(input.valueAsNumber);
    input.value = `${this.store.slotCount()}`;
  }

  protected download(): void {
    const url = URL.createObjectURL(new Blob([this.json()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'enshrouded_server.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.json());
      this.status.set(this.lang.t('gsCopied'));
    } catch {
      this.status.set(this.lang.t('gsCopyFailed'));
    }
  }

  protected async readFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pasted.set(await file.text());
    this.check();
  }

  protected check(): void {
    const r = parseServerFile(this.pasted());
    this.error.set('error' in r ? r.error : null);
    this.report.set('error' in r ? null : r);
  }

  protected apply(r: Imported): void {
    this.store.apply(r);
    this.report.set(null);
    this.status.set(this.lang.t('gsImported'));
  }
}
