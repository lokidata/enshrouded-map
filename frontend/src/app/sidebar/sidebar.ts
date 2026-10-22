import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Catalog } from '../core/catalog.service';
import { FilterStore } from '../core/filter.store';
import { LangService } from '../core/lang.service';
import { MapDataService } from '../core/map-data.service';
import { SECTIONS } from '../core/sections';
import { AccountBar } from './account-bar';
import { CategoryCard } from './category-card';

@Component({
  selector: 'app-sidebar',
  imports: [TranslocoPipe, CategoryCard, AccountBar],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  protected readonly filters = inject(FilterStore);
  protected readonly lang = inject(LangService);
  protected readonly mapData = inject(MapDataService);
  private readonly catalog = inject(Catalog);

  protected readonly languages = this.mapData.data.languages;

  protected readonly sections = computed(() => {
    const items = this.catalog.items();
    const placed = new Set(SECTIONS.flatMap((s) => s.cats));
    const rest = this.catalog.order().filter((cat) => !placed.has(cat));
    return SECTIONS.map((section, i, all) => {
      const cats = i === all.length - 1 ? [...section.cats, ...rest] : section.cats;
      return { ...section, cats: cats.filter((cat) => items.has(cat)) };
    }).filter((section) => section.cats.length);
  });
}
