import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { readHiddenLayers } from './markers.logic';

/** Which marker layers this browser has unticked (a view preference, wiped at logout). */
const VIEW = 'markerView';

export interface CustomMarker {
  id: number;
  x: number;
  z: number;
  name: string;
  note: string;
  kind: 'pin' | 'altar';
  level: number | null;
  /** A simple marker's map icon: a category key (null: the default). */
  icon: string | null;
  /** One of the game's 8 marker colours, by name (null: white). */
  color: string | null;
  shared: boolean;
}

/** What the player edits: a marker without its id. */
export type MarkerDraft = Omit<CustomMarker, 'id'>;

export interface MemberMarkers {
  user_id: number;
  username: string;
  markers: CustomMarker[];
}

/** The custom markers of the profile followed (editable) and the ones teammates share (read-only). Not map elements: no progress, no filter. */
@Injectable({ providedIn: 'root' })
export class MarkerStore {
  private readonly http = inject(HttpClient);

  readonly mine = signal<readonly CustomMarker[]>([]);
  readonly team = signal<readonly MemberMarkers[]>([]);
  /** The next click on the map places a marker. */
  readonly placing = signal(false);
  /** The ruler is on: the next clicks on the map are the two ends of a measure. One map mode at a time. */
  readonly measuring = signal(false);
  /** The marker of mine whose new point is the next click on the map. */
  readonly moving = signal<CustomMarker | null>(null);
  /** The move was refused or failed (the marker is where it was). */
  readonly moveFailed = signal(false);
  /** Asks the map to centre on a marker and open its popup: the layer key ('me' or 'u<user id>') and the marker. */
  readonly reveal = signal<{ key: string; id: number } | null>(null);
  /** Layers the player unticked: read by the map when it draws (not a signal: ticking must not redraw the layers). */
  readonly hiddenLayers = new Set<string>(this.readView());

  private tag = ''; // ETag of the team markers shown: the server answers 304 while nothing changed
  private wasInTeam = false;

  private readView(): string[] {
    try {
      return readHiddenLayers(localStorage.getItem(VIEW));
    } catch {
      return [];
    }
  }

  setLayerShown(key: string, shown: boolean): void {
    if (shown) this.hiddenLayers.delete(key);
    else this.hiddenLayers.add(key);
    try {
      localStorage.setItem(VIEW, JSON.stringify([...this.hiddenLayers]));
    } catch {
      // storage blocked: the choice is just not kept
    }
  }

  async loadMine(): Promise<void> {
    try {
      this.mine.set(await firstValueFrom(this.http.get<CustomMarker[]>('api/v1/markers')));
    } catch {
      // keeps what was shown
    }
  }

  /** The shared markers of the others. Leaving a team switches my own sharing off on the server: look again. */
  async loadTeam(inTeam: boolean): Promise<void> {
    if (!inTeam) {
      this.team.set([]);
      this.tag = '';
      if (this.wasInTeam) void this.loadMine();
      this.wasInTeam = false;
      return;
    }
    this.wasInTeam = true;
    const headers: Record<string, string> = this.tag ? { 'If-None-Match': this.tag } : {};
    try {
      const res = await firstValueFrom(
        this.http.get<{ members: MemberMarkers[] }>('api/v1/team/markers', {
          headers,
          observe: 'response',
        }),
      );
      this.team.set(res.body?.members ?? []);
      this.tag = res.headers.get('ETag') ?? '';
    } catch (e) {
      if (!(e instanceof HttpErrorResponse && e.status === 304)) return; // 304 or unreachable: keep what is shown
    }
  }

  async add(draft: MarkerDraft): Promise<void> {
    const made = await firstValueFrom(this.http.post<CustomMarker>('api/v1/markers', draft));
    this.mine.update((list) => [...list, made]);
  }

  async change(id: number, draft: MarkerDraft): Promise<void> {
    const changed = await firstValueFrom(
      this.http.patch<CustomMarker>(`api/v1/markers/${id}`, draft),
    );
    this.mine.update((list) => list.map((m) => (m.id === id ? changed : m)));
  }

  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`api/v1/markers/${id}`));
    this.mine.update((list) => list.filter((m) => m.id !== id));
  }

  clear(): void {
    this.mine.set([]);
    this.team.set([]);
    this.placing.set(false);
    this.moving.set(null);
    this.measuring.set(false);
    this.moveFailed.set(false);
    this.reveal.set(null);
    this.hiddenLayers.clear();
    try {
      localStorage.removeItem(VIEW);
    } catch {
      // nothing to remove
    }
    this.tag = '';
    this.wasInTeam = false;
  }
}
