import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { EnemiesService } from '../core/enemies.service';
import { LAYOUTS, LayoutService } from '../core/layout.service';
import { LoreService } from '../core/lore.service';
import { GearService } from '../core/gear.service';
import { SkillsService } from '../core/skills.service';
import { LangService } from '../core/lang.service';
import { MapDataService } from '../core/map-data.service';
import { ViewStore } from '../core/view.store';
import { AccountBar } from '../sidebar/account-bar';

/** The fixed top bar: the map, the workshop, the language, the profile. */
@Component({
  selector: 'app-topbar',
  imports: [TranslocoPipe, AccountBar],
  template: `
    <h1>{{ 'title' | transloco }}</h1>
    <nav [attr.aria-label]="'mainNav' | transloco">
      <button
        type="button"
        [class.active]="views.view() === 'map'"
        [attr.aria-current]="views.view() === 'map' ? 'page' : null"
        (click)="views.set('map')"
      >
        {{ 'map' | transloco }}
      </button>
      @if (craft.data()) {
        <button
          type="button"
          [class.active]="views.view() === 'workshop'"
          [attr.aria-current]="views.view() === 'workshop' ? 'page' : null"
          (click)="views.set('workshop')"
        >
          {{ 'workshop' | transloco }}
        </button>
      }
      @if (lore.data()) {
        <button
          type="button"
          [class.active]="views.view() === 'lore'"
          [attr.aria-current]="views.view() === 'lore' ? 'page' : null"
          (click)="views.set('lore')"
        >
          {{ 'lore' | transloco }}
        </button>
      }
      @if (enemies.data()) {
        <button
          type="button"
          [class.active]="views.view() === 'enemies'"
          [attr.aria-current]="views.view() === 'enemies' ? 'page' : null"
          (click)="views.set('enemies')"
        >
          {{ 'enemies' | transloco }}
        </button>
      }
      @if (skills.data() || gear.data()) {
        <button
          type="button"
          [class.active]="inBuild()"
          [attr.aria-current]="inBuild() ? 'page' : null"
          (click)="views.set(gear.data() ? 'build' : 'skills')"
        >
          {{ 'build' | transloco }}
        </button>
      }
      <button
        type="button"
        [class.active]="views.view() === 'game'"
        [attr.aria-current]="views.view() === 'game' ? 'page' : null"
        (click)="views.set('game')"
      >
        {{ 'game' | transloco }}
      </button>
    </nav>
    <span class="spacer"></span>
    @if (views.view() === 'map') {
      <div class="group" role="group" [attr.aria-label]="'layout' | transloco">
        @for (l of layouts; track l) {
          <button
            type="button"
            [class.active]="layout.pref() === l"
            [attr.aria-pressed]="layout.pref() === l"
            [attr.aria-label]="'layout_' + l | transloco"
            [title]="'layout_' + l | transloco"
            (click)="layout.set(l)"
          >
            {{ layoutIcon[l] }}
          </button>
        }
      </div>
    }
    <div class="group" role="group" [attr.aria-label]="'language' | transloco">
      @for (code of languages; track code) {
        <button
          type="button"
          [class.active]="lang.lang() === code"
          [attr.aria-pressed]="lang.lang() === code"
          (click)="lang.set(code)"
        >
          {{ code.toUpperCase() }}
        </button>
      }
    </div>
    <app-account-bar />
  `,
  host: { class: 'topbar' },
  styles: `
    :host {
      /* above the map's own layers and controls (Leaflet goes up to 1000), under the toasts (2000):
         the profile menu and the invitation link open downwards, over the map */
      position: relative;
      z-index: 1500;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
      height: 54px;
      padding: 0 18px;
      background: linear-gradient(180deg, #19212d, var(--panel-deep));
      border-bottom: 1px solid var(--gold-dim);
      box-shadow:
        0 1px 0 #00000066,
        0 6px 14px -8px #000;
    }
    h1 {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 0;
      color: var(--gold);
      font-size: 22px;
      line-height: 1;
      white-space: nowrap;
    }
    h1::before {
      /* the Flame: the one warm light of the page */
      content: '';
      width: 16px;
      height: 22px;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 32'%3E%3Cpath fill='%23eb9440' d='M13 1c1 6 8 9 8 18a9 9 0 0 1-18 0c0-4 2-6 4-8 0 3 1 5 3 5 1-6-1-9 3-15z'/%3E%3Cpath fill='%23ffd9a0' d='M12 17c3 2 4 4 4 6a4 4 0 0 1-8 0c0-2 2-4 4-6z'/%3E%3C/svg%3E")
        center / contain no-repeat;
      filter: drop-shadow(0 0 5px #eb944088);
    }
    nav {
      display: flex;
      align-self: stretch;
      gap: 2px;
      margin-left: 8px;
    }
    nav button {
      position: relative;
      padding: 0 17px;
      border: 0;
      background: none;
      color: var(--muted);
      cursor: pointer;
      font: 400 17px/1 var(--display-sc);
      letter-spacing: 0.05em;
    }
    nav button:hover {
      color: var(--text);
    }
    nav button.active {
      color: var(--gold);
      background: linear-gradient(180deg, transparent 30%, #eb944022);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    .spacer {
      flex: 1;
    }
    .group {
      display: flex;
      border: 1px solid var(--gold-dim);
      border-radius: 3px;
      overflow: hidden;
    }
    .group button {
      padding: 3px 9px;
      border: 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: 14px;
    }
    .group button:hover {
      color: var(--text);
    }
    .group button.active {
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 700;
    }
    button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    @media (max-width: 700px) {
      h1 {
        display: none;
      }
      nav button {
        padding: 0 11px;
        font-size: 15px;
      }
    }
  `,
})
export class TopBar {
  protected readonly craft = inject(CraftService);
  protected readonly enemies = inject(EnemiesService);
  protected readonly lore = inject(LoreService);
  protected readonly skills = inject(SkillsService);
  protected readonly gear = inject(GearService);
  protected readonly views = inject(ViewStore);
  protected readonly layout = inject(LayoutService);
  protected readonly lang = inject(LangService);
  protected readonly layouts = LAYOUTS;
  protected readonly layoutIcon = { auto: 'A', left: '◧', top: '⬒' };
  protected readonly inBuild = computed(() =>
    ['build', 'equipment', 'skills'].includes(this.views.view()),
  );
  protected readonly languages = inject(MapDataService).data.languages;
}
