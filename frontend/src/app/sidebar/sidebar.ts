import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { TeamStore } from '../core/team.store';
import { FogStore } from '../save-import/fog.store';
import { TranslocoPipe } from '@jsverse/transloco';
import { Catalog } from '../core/catalog.service';
import { FilterStore } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { MapDataService } from '../core/map-data.service';
import { SECTIONS } from '../core/sections';
import { CategoryCard } from './category-card';

@Component({
  selector: 'app-sidebar',
  imports: [TranslocoPipe, CategoryCard],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  protected readonly filters = inject(FilterStore);
  protected readonly fog = inject(FogStore);
  protected readonly team = inject(TeamStore);
  private readonly auth = inject(AuthService);
  protected readonly lang = inject(LangService);
  protected readonly mapData = inject(MapDataService);
  private readonly catalog = inject(Catalog);

  protected readonly sections = computed(() => {
    const items = this.catalog.items();
    const placed = new Set(SECTIONS.flatMap((s) => s.cats));
    const rest = this.catalog.order().filter((cat) => !placed.has(cat));
    return SECTIONS.map((section, i, all) => {
      const cats = i === all.length - 1 ? [...section.cats, ...rest] : section.cats;
      return { ...section, cats: cats.filter((cat) => items.has(cat)) };
    }).filter((section) => section.cats.length);
  });

  /** Shows my stored area to the team, or hides it again (possible at any time). */
  protected share(on: boolean): void {
    void this.fog.setShared(on).catch(() => this.auth.notice.set('errors.unknown'));
  }
}
