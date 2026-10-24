import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { ProgressStore } from './progress.store';

export interface Team {
  id: number;
  name: string;
  owner_id: number;
  is_owner: boolean;
  members: { id: number; username: string }[];
}

export interface TeamInvite {
  token: string;
  expires_at: string;
}

export interface Player {
  id: number;
  username: string;
}

/** none: nobody marked it; mine: I did, not everyone; others: someone else did, I did not; all: every member (or me, without a team). */
export type Halo = 'none' | 'mine' | 'others' | 'all';

const REFRESH_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class TeamStore {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly progress = inject(ProgressStore);

  readonly team = signal<Team | null>(null);
  /** What the other members marked: mark id -> user ids. Mine come from the ProgressStore. */
  readonly others = signal<Readonly<Record<string, readonly number[]>>>({});
  readonly dialogOpen = signal(false);
  readonly total = computed(() => this.team()?.members.length ?? 1);

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // Other members mark while this page stays open: look again now and then, and when it comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.load();
    });
  }

  async load(): Promise<void> {
    if (!this.auth.user()) return;
    try {
      const team = await firstValueFrom(this.http.get<Team | null>('api/v1/team'));
      this.team.set(team);
      this.others.set(
        team
          ? (
              await firstValueFrom(
                this.http.get<{ marks: Record<string, number[]> }>('api/v1/team/marks'),
              )
            ).marks
          : {},
      );
    } catch {
      return; // keeps what was shown
    }
    clearInterval(this.timer);
    if (this.team()) this.timer = setInterval(() => void this.load(), REFRESH_MS);
  }

  clear(): void {
    clearInterval(this.timer);
    this.team.set(null);
    this.others.set({});
    this.dialogOpen.set(false);
  }

  halo(id: string): Halo {
    const mine = this.progress.done().has(id);
    const count = (mine ? 1 : 0) + (this.others()[id]?.length ?? 0);
    return count === 0 ? 'none' : count >= this.total() ? 'all' : mine ? 'mine' : 'others';
  }

  /** Names of the players who marked it, me first. */
  markedBy(id: string): string[] {
    const members = this.team()?.members ?? [];
    const names = (this.others()[id] ?? []).map(
      (uid) => members.find((m) => m.id === uid)?.username ?? '?',
    );
    const me = this.auth.user();
    return me && this.progress.done().has(id) ? [me, ...names] : names;
  }

  async create(name: string): Promise<void> {
    await firstValueFrom(this.http.post('api/v1/team', { name }));
    await this.load();
  }

  async rename(name: string): Promise<void> {
    await firstValueFrom(this.http.patch('api/v1/team', { name }));
    await this.load();
  }

  invite(): Promise<TeamInvite> {
    return firstValueFrom(this.http.post<TeamInvite>('api/v1/team/invitations', {}));
  }

  available(): Promise<Player[]> {
    return firstValueFrom(this.http.get<Player[]>('api/v1/team/available'));
  }

  async add(userId: number): Promise<void> {
    await firstValueFrom(this.http.post('api/v1/team/members', { user_id: userId }));
    await this.load();
  }

  async leave(): Promise<void> {
    await firstValueFrom(this.http.post('api/v1/team/leave', {}));
    await this.load();
  }

  async remove(userId: number): Promise<void> {
    await firstValueFrom(this.http.delete(`api/v1/team/members/${userId}`));
    await this.load();
  }

  async dissolve(): Promise<void> {
    await firstValueFrom(this.http.delete('api/v1/team'));
    await this.load();
  }
}
