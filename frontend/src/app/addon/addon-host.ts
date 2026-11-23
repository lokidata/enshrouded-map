import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { baseOf } from '../core/addon.logic';
import { AddonService } from '../core/addon.service';
import { LangService } from '../core/lang.service';
import { ViewStore } from '../core/view.store';

/**
 * Mounts an add-on's custom element in the page. Elements stay mounted once opened (hidden, `active="false"`)
 * so a draft survives a change of screen; `[data-addon]` is the one scope the site styles for them.
 */
@Component({
  selector: 'app-addon-host',
  imports: [TranslocoPipe],
  template: `
    @if (failedId() !== null && failedId() === shownId()) {
      <div class="addon-error" role="alert">
        <p>{{ 'addon.loadError' | transloco }}</p>
        <button type="button" class="retry" (click)="retry()">
          {{ 'addon.retry' | transloco }}
        </button>
      </div>
    }
  `,
  host: { class: 'addon-host' },
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    :host([hidden]) {
      display: none;
    }
  `,
})
export class AddonHost {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly addons = inject(AddonService);
  private readonly views = inject(ViewStore);
  private readonly lang = inject(LangService);
  // the entry whose script failed: the error shows only while that entry is the one open
  protected readonly failedId = signal<string | null>(null);
  protected readonly shownId = computed(() =>
    this.views.view() === 'addon' ? this.views.addonId() : null,
  );

  constructor() {
    effect(() => {
      const id = this.views.view() === 'addon' ? this.views.addonId() : null;
      const lang = this.lang.lang();
      const entries = this.addons.entries();
      untracked(() => void this.sync(id, lang, entries));
    });
  }

  protected retry(): void {
    this.failedId.set(null);
    void this.sync(
      this.shownId(),
      this.lang.lang(),
      this.addons.entries(),
    );
  }

  private async sync(
    id: string | null,
    lang: string,
    entries: ReturnType<AddonService['entries']>,
  ): Promise<void> {
    const entry = id ? entries.find((e) => e.id === id) : undefined;
    if (entry && !this.wrapper(entry.id)) {
      try {
        await this.addons.ensureLoaded(entry);
      } catch {
        this.failedId.set(entry.id);
        return;
      }
      this.failedId.set(null);
      if (!this.wrapper(entry.id)) {
        // two syncs can wait for the same script: only the first one mounts
        const box = document.createElement('div');
        box.setAttribute('data-addon', '');
        box.dataset['id'] = entry.id;
        box.append(document.createElement(entry.element));
        this.host.append(box);
      }
    }
    // after the await the screen may have changed: read it again
    const current = this.views.view() === 'addon' ? this.views.addonId() : null;
    for (const box of this.host.querySelectorAll<HTMLElement>('[data-addon]')) {
      const shown = box.dataset['id'] === current;
      box.toggleAttribute('hidden', !shown);
      const el = box.firstElementChild;
      const own = entries.find((e) => e.id === box.dataset['id']);
      if (own) el?.setAttribute('base', baseOf(own));
      el?.setAttribute('lang', lang);
      el?.setAttribute('active', String(shown));
    }
  }

  private wrapper(id: string): HTMLElement | null {
    return this.host.querySelector(`[data-addon][data-id="${id}"]`);
  }
}
