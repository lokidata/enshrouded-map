import { Injectable, effect, inject, untracked } from '@angular/core';
import { WorkshopNav, Tab } from '../workshop/workshop-nav';
import { EnemiesService } from './enemies.service';
import { NavState, asNav, sameNav } from './history.logic';
import { ViewStore } from './view.store';

/** Browser Back/Forward: each change of view or open page pushes an entry; popstate restores it. */
@Injectable({ providedIn: 'root' })
export class HistoryStore {
  private readonly views = inject(ViewStore);
  private readonly nav = inject(WorkshopNav);
  private readonly enemies = inject(EnemiesService);
  private last = this.snapshot();

  constructor() {
    history.replaceState({ nav: this.last }, '');
    addEventListener('popstate', (e) => {
      const n = asNav(e.state);
      if (!n) return;
      this.last = n;
      this.views.set(n.view);
      this.nav.tab.set(n.tab as Tab);
      this.nav.item.set(n.item);
      this.nav.station.set(n.station);
      this.nav.set.set(n.set);
      this.enemies.open.set(n.enemy);
    });
    effect(() => {
      const now = this.snapshot();
      untracked(() => {
        if (sameNav(now, this.last)) return;
        this.last = now;
        history.pushState({ nav: now }, '');
      });
    });
  }

  private snapshot(): NavState {
    return {
      view: this.views.view(),
      tab: this.nav.tab(),
      item: this.nav.item(),
      station: this.nav.station(),
      set: this.nav.set(),
      enemy: this.enemies.open(),
    };
  }
}
