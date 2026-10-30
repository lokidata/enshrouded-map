import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MapData, ResourceData } from './map-data.model';

@Injectable({ providedIn: 'root' })
export class MapDataService {
  private readonly http = inject(HttpClient);

  /** Set by load() when the player logs in (the file is for logged-in players only). */
  data!: MapData;
  /** Chests, plants and ores (large): loaded in the background after the first render. */
  readonly resources = signal<ResourceData>({});

  async load(): Promise<void> {
    this.data ??= await firstValueFrom(this.http.get<MapData>('map-data.json'));
  }

  async loadResources(): Promise<void> {
    if (Object.keys(this.resources()).length) return; // the map is created once per page, the workshop may load them first
    this.resources.set(await firstValueFrom(this.http.get<ResourceData>('resources.json')));
  }
}
