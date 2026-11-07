import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CraftService } from '../core/craft.service';
import { LAYOUTS, LayoutService } from '../core/layout.service';
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
      gap: 14px;
      flex-shrink: 0;
      height: 52px;
      padding: 0 16px;
      background: var(--panel-deep);
      border-bottom: 2px solid var(--gold-dim);
    }
    h1 {
      margin: 0;
      color: #f3d58a;
      font-size: 17px;
      font-stretch: condensed;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    nav {
      display: flex;
      align-self: stretch;
      gap: 2px;
    }
    nav button {
      padding: 0 18px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: none;
      color: var(--muted);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      font-stretch: condensed;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    nav button:hover {
      color: var(--text);
    }
    nav button.active {
      background: linear-gradient(to top, #c9a24d33, transparent 70%);
      border-bottom-color: var(--gold);
      color: #f3d58a;
    }
    .spacer {
      flex: 1;
    }
    .group {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 5px;
      overflow: hidden;
    }
    .group button {
      padding: 3px 8px;
      border: 0;
      background: var(--bg);
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
    }
    .group button.active {
      background: var(--accent);
      color: #1a1a1a;
    }
    button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    @media (max-width: 700px) {
      h1 {
        display: none;
      }
    }
  `,
})
export class TopBar {
  protected readonly craft = inject(CraftService);
  protected readonly views = inject(ViewStore);
  protected readonly layout = inject(LayoutService);
  protected readonly lang = inject(LangService);
  protected readonly layouts = LAYOUTS;
  protected readonly layoutIcon = { auto: 'A', left: '◧', top: '⬒' };
  protected readonly languages = inject(MapDataService).data.languages;
}
