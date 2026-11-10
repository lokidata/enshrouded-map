import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  FOG_SIZE,
  bitsToCells,
  cellsFromVeil,
  cellsToBits,
  fogShare,
  fromBase64,
  toBase64,
  unionCells,
  veilPixels,
} from './fog';

const KEY = 'fog';
const PERCENT = 'fogShare';

/** localStorage keys of one character profile's explored area. */
const keyOf = (id: number): string => `${KEY}:${id}`;
const percentOf = (id: number): string => `${PERCENT}:${id}`;
/** When the server's copy was made: a cache that does not carry the same stamp is old. */
const atOf = (id: number): string => `fogAt:${id}`;
/** Which areas this browser shows (a view preference, not tied to a profile). */
const VIEW = 'fogView';

/** Removes the stored explored areas: one profile's, or every profile's (and the one of the first version). */
function wipe(id: number | null): void {
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      id === null
        ? k === KEY || k === PERCENT || k === VIEW || /^fog(Share|At)?:/.test(k)
        : k === keyOf(id) || k === percentOf(id) || k === atOf(id),
    );
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // nothing to remove
  }
}

/** A dark veil over what is not explored, as a PNG data URL. */
function veilUrl(cells: Uint8Array): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FOG_SIZE;
  const px = veilPixels(cells);
  canvas.getContext('2d')?.putImageData(new ImageData(px as never, FOG_SIZE, FOG_SIZE), 0, 0);
  return canvas.toDataURL('image/png');
}

/** An area a team member shares. */
export interface TeamArea {
  id: number;
  name: string;
  at: string;
  cells: Uint8Array;
}

/** What is shown: my area or not, and the members whose areas are switched off (new members start shown). */
interface View {
  mine: boolean;
  off: readonly number[];
}

function readView(): View {
  try {
    const o = JSON.parse(localStorage.getItem(VIEW) ?? '{}') as Partial<View>;
    return {
      mine: o.mine !== false,
      off: Array.isArray(o.off) ? o.off.filter((n) => Number.isInteger(n)) : [],
    };
  } catch {
    return { mine: true, off: [] };
  }
}

/** The union of several areas: explored by any of them. */
const combine = (list: readonly Uint8Array[]): Uint8Array | null =>
  list.length ? list.reduce((a, b) => unionCells(a, b)) : null;

/**
 * The explored area imported from a save, one per character profile, as a veil image. The server keeps it
 * (a bit per cell, private to its owner) so that it comes back after a logout or on another browser; this
 * browser caches it (the soft edges of the game's grid) and forgets the cache at logout. The team sees it
 * only if the player shares it (`setShared`, at any time). Each player chooses which areas the map shows:
 * their own and, one by one, those the other members share (`toggleMine`, `toggleMember`).
 */
@Injectable({ providedIn: 'root' })
export class FogStore {
  private readonly http = inject(HttpClient);
  /** PNG data URL of the veil, null without an import. */
  readonly url = signal<string | null>(null);
  /** Share of the map explored (0..1), null without an import. */
  readonly share = signal<number | null>(null);
  /** The explored cells (north-up grid), decoded from the veil; null without an import or until decoded. */
  readonly cells = signal<Uint8Array | null>(null);
  /** The profile followed shares its area with the team (server state). */
  readonly shared = signal(false);
  /** The areas the other members share (those of the members who stopped sharing are dropped). */
  readonly team = signal<readonly TeamArea[]>([]);
  readonly view = signal<View>(readView());
  /** The areas the map shows: mine (if chosen) and the members' that are switched on. */
  private readonly selected = computed(() => {
    const v = this.view();
    const mine = this.cells();
    return [
      ...(v.mine && mine ? [mine] : []),
      ...this.team()
        .filter((t) => !v.off.includes(t.id))
        .map((t) => t.cells),
    ];
  });
  /** The areas that can be shown, one layer each in the map's layers control; only changes when the list does. */
  readonly areas = computed<readonly { key: string; name: string | null }[]>(
    () => [
      ...(this.cells() ? [{ key: 'me', name: null }] : []),
      ...this.team().map((t) => ({ key: String(t.id), name: t.name })),
    ],
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  /** Explored in what is shown: what the veil and the explored-area filter go by; null when nothing is shown. */
  readonly known = computed(() => combine(this.selected()));
  /** The veil over everything that is not in `known` (a single source keeps its soft edges). */
  readonly viewUrl = computed(() => {
    const list = this.selected();
    if (list.length === 1 && list[0] === this.cells()) return this.url();
    const known = combine(list);
    return known ? veilUrl(known) : null;
  });
  /** The cache being read back into cells. */
  private decoding: Promise<void> = Promise.resolve();
  /** The character profile whose area is shown. */
  private id: number | null = null;

  /** Shows the area of this profile (or none). The first version kept one area per browser: the first profile that asks takes it. */
  use(id: number | null): void {
    this.id = id;
    this.url.set(null);
    this.share.set(null);
    this.cells.set(null);
    this.shared.set(false);
    if (id === null) return;
    try {
      if (localStorage.getItem(keyOf(id)) === null && localStorage.getItem(KEY) !== null) {
        localStorage.setItem(keyOf(id), localStorage.getItem(KEY)!);
        localStorage.setItem(percentOf(id), localStorage.getItem(PERCENT) ?? '');
        localStorage.removeItem(KEY);
        localStorage.removeItem(PERCENT);
      }
      const url = localStorage.getItem(keyOf(id));
      const n = Number(localStorage.getItem(percentOf(id)));
      this.url.set(url);
      this.share.set(url && Number.isFinite(n) ? n : null);
      if (url) this.decoding = this.decode(url);
    } catch {
      // storage blocked: nothing remembered
    }
    void this.restore(id);
  }

  set(cells: Uint8Array): void {
    const url = veilUrl(cells);
    this.url.set(url);
    this.cells.set(cells);
    this.share.set(fogShare(cells));
    if (this.id === null) return;
    try {
      localStorage.setItem(keyOf(this.id), url);
      localStorage.setItem(percentOf(this.id), String(this.share()));
    } catch {
      // too big or blocked: shown for this visit only
    }
  }

  /** An import: the area is shown, cached here and kept by the server for this profile (shared with the team or not). */
  async save(cells: Uint8Array, shared: boolean): Promise<void> {
    this.set(cells);
    const r = await firstValueFrom(
      this.http.put<{ updated_at: string }>('api/v1/fog', {
        bits: toBase64(cellsToBits(cells)),
        shared,
      }),
    );
    this.stamp(r.updated_at);
    this.shared.set(shared);
  }

  private stamp(at: string | null): void {
    if (this.id === null || !at) return;
    try {
      localStorage.setItem(atOf(this.id), at);
    } catch {
      // storage blocked: the cache is just not trusted next time
    }
  }

  /** Shows the stored area to the team, or hides it again. */
  async setShared(on: boolean): Promise<void> {
    await firstValueFrom(this.http.patch('api/v1/fog', { shared: on }));
    this.shared.set(on);
  }

  /**
   * What the server keeps for this profile: shown when this browser has nothing (a new browser, after a
   * logout); and an area imported before the server kept them is sent now.
   */
  private async restore(id: number): Promise<void> {
    try {
      const r = await firstValueFrom(
        this.http.get<{ bits: string | null; shared: boolean; updated_at: string | null }>(
          'api/v1/fog',
        ),
      );
      await this.decoding;
      if (this.id !== id) return; // the player already moved to another profile
      this.shared.set(r.shared);
      const cached = this.cells();
      if (r.bits && (!cached || localStorage.getItem(atOf(id)) !== r.updated_at)) {
        // nothing here, or another browser imported since: the server's copy is the newer
        this.set(bitsToCells(fromBase64(r.bits)));
        this.stamp(r.updated_at);
      } else if (!r.bits && cached) {
        await this.save(cached, false);
      }
    } catch {
      // server unreachable: this browser's copy, if any, is shown
    }
  }

  /** What the other members share: the list, then the area of each one that is new or changed. */
  async loadTeam(inTeam: boolean): Promise<void> {
    if (!inTeam) {
      this.team.set([]);
      return;
    }
    try {
      const { members } = await firstValueFrom(
        this.http.get<{ members: { user_id: number; username: string; updated_at: string }[] }>(
          'api/v1/team/fog',
        ),
      );
      const known = new Map(this.team().map((t) => [t.id, t]));
      const areas = await Promise.all(
        members.map(async (m): Promise<TeamArea> => {
          const have = known.get(m.user_id);
          if (have && have.at === m.updated_at) return { ...have, name: m.username };
          const { bits } = await firstValueFrom(
            this.http.get<{ bits: string }>(`api/v1/team/fog/${m.user_id}`),
          );
          return {
            id: m.user_id,
            name: m.username,
            at: m.updated_at,
            cells: bitsToCells(fromBase64(bits)),
          };
        }),
      );
      this.team.set(areas);
    } catch {
      // keeps what was shown
    }
  }

  /** Shows my area on the map, or not. */
  toggleMine(on: boolean): void {
    this.setView({ ...this.view(), mine: on });
  }

  /** Shows the area a member shares, or not. */
  toggleMember(id: number, on: boolean): void {
    const off = this.view().off.filter((n) => n !== id);
    this.setView({ ...this.view(), off: on ? off : [...off, id] });
  }

  private setView(v: View): void {
    this.view.set(v);
    try {
      localStorage.setItem(VIEW, JSON.stringify(v));
    } catch {
      // storage blocked: the choice is just not kept
    }
  }

  /** Reads the cells back from the stored veil (after a reload). */
  private async decode(url: string): Promise<void> {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = FOG_SIZE;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const data = ctx?.getImageData(0, 0, FOG_SIZE, FOG_SIZE).data;
      if (data) this.cells.set(cellsFromVeil(data));
    } catch {
      // unreadable image: the filter simply has nothing to work with
    }
  }

  /** A deleted profile's area goes with it. */
  forget(id: number): void {
    wipe(id);
  }

  /** Logout: nothing stays for the next account. */
  clear(): void {
    this.id = null;
    this.url.set(null);
    this.share.set(null);
    this.cells.set(null);
    this.shared.set(false);
    this.team.set([]);
    this.view.set({ mine: true, off: [] });
    wipe(null);
  }
}
