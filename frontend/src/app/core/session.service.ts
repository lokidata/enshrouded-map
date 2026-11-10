import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthMode, AuthService, Credentials, UserInfo } from './auth.service';
import { CharacterStore } from './character.store';
import { CraftService } from './craft.service';
import { EnemiesService } from './enemies.service';
import { LoreService } from './lore.service';
import { PlannerStore } from './planner.store';
import { GearService } from './gear.service';
import { GamePresetsService } from './game-presets.service';
import { FogStore } from '../save-import/fog.store';
import { forgetImport } from '../save-import/import-history';
import { GameSettingsStore } from './game-settings.store';
import { GemsService } from './gems.service';
import { SkillsService } from './skills.service';
import { FilterStore } from './filter.store';
import { takeHashToken } from './links';
import { MapDataService } from './map-data.service';
import { ProgressStore } from './progress.store';
import { TeamStore } from './team.store';
import { ViewStore } from './view.store';

const SAVE_DELAY = 700;

/** Login state, plus what depends on it: progress marks and the filters saved in the profile. */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly progress = inject(ProgressStore);
  private readonly filters = inject(FilterStore);
  private readonly team = inject(TeamStore);
  private readonly views = inject(ViewStore);
  private readonly mapData = inject(MapDataService);
  private readonly craft = inject(CraftService);
  private readonly lore = inject(LoreService);
  private readonly enemies = inject(EnemiesService);
  private readonly skills = inject(SkillsService);
  private readonly gear = inject(GearService);
  private readonly gems = inject(GemsService);
  private readonly presets = inject(GamePresetsService);
  private readonly planner = inject(PlannerStore);
  private readonly gameSettings = inject(GameSettingsStore);
  private readonly fog = inject(FogStore);
  private readonly characters = inject(CharacterStore);

  private saved: string | null = null;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Team and role the game configuration was read for: a change (joined, left, handed over) reads it again. */
  private configFor = '';

  constructor() {
    effect(() => {
      const key = this.teamKey();
      if (this.auth.user() && key !== this.configFor) {
        this.configFor = key;
        void this.gameSettings.load();
      }
    });
    effect(() => {
      const json = JSON.stringify({ filters: this.filters.overrides() });
      if (!this.auth.user() || json === this.saved) return;
      this.pending = json;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
    });
    // Leaving the page right after a change: send it anyway.
    addEventListener('pagehide', () => {
      if (!this.auth.user() || !this.pending || this.pending === this.saved) return;
      const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '';
      void fetch('api/v1/settings', {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token) },
        body: JSON.stringify({ settings: JSON.parse(this.pending) }),
      });
    });
  }

  /** Restores the session at startup, or asks for what is missing: the first account, or an invitation / reset link. */
  async start(): Promise<void> {
    await this.restore();
    // Nothing is shown to someone who is not logged in except the login (or the link's) dialog.
    if (!this.auth.user() && !this.auth.dialog()) this.auth.dialog.set('login');
  }

  private async restore(): Promise<void> {
    const link = takeHashToken();
    try {
      const me = await this.auth.me();
      this.auth.passkeysEnabled.set(!!me.passkeys_enabled);
      if (me.username) return await this.enter(me);
      if (me.setup_required) return this.auth.dialog.set('setup');
      if (link?.kind === 'invite') {
        if (!(await this.auth.checkInvitation(link.token)))
          return this.auth.notice.set('errors.invitation_invalid');
        this.auth.inviteToken.set(link.token);
        this.auth.dialog.set('invite');
      } else if (link?.kind === 'reset') {
        const name = await this.auth.checkReset(link.token);
        if (!name) return this.auth.notice.set('errors.reset_invalid');
        this.auth.resetToken.set(link.token);
        this.auth.resetUser.set(name);
        this.auth.dialog.set('reset');
      }
    } catch {
      // API unreachable: the map works without an account
    }
  }

  async authenticate(mode: AuthMode, credentials: Credentials): Promise<void> {
    await this.enter(await this.auth.authenticate(mode, credentials));
  }

  async passkeyLogin(): Promise<void> {
    await this.enter(await this.auth.passkeyLogin());
  }

  async logout(): Promise<void> {
    clearTimeout(this.timer);
    await this.flush(); // last change before leaving the profile
    try {
      await this.auth.logout();
    } finally {
      this.forget();
    }
  }

  /** The account is gone (deleted): back to the logged-out state, nothing left to save. */
  forget(): void {
    clearTimeout(this.timer);
    this.auth.user.set(null);
    this.auth.isAdmin.set(false);
    this.progress.set([]);
    this.team.clear();
    this.craft.clear();
    this.lore.clear();
    this.enemies.clear();
    this.skills.clear();
    this.gear.clear();
    this.gems.clear();
    this.presets.clear();
    this.planner.clear();
    this.gameSettings.clear();
    this.fog.clear();
    forgetImport();
    this.characters.clear();
    this.views.set('map');
    this.filters.reset();
    this.saved = this.pending = null;
    this.configFor = '';
    this.auth.dialog.set('login');
  }

  private async enter(info: UserInfo): Promise<void> {
    const [, , , , , , , , marks, settings] = await Promise.all([
      this.mapData.load(),
      this.craft.load(), // never fails: a server without craft.json just has no workshop
      this.lore.load(), // same for lore.json
      this.enemies.load(), // and enemies.json
      this.skills.load(), // and skills.json
      this.gear.load(), // and gear.json
      this.gems.load(), // and gems.json
      this.presets.load(), // and settings-presets.json
      firstValueFrom(this.http.get<{ marks: string[] }>('api/v1/progress')),
      firstValueFrom(
        this.http.get<{ settings: { filters?: Record<string, boolean> } | null }>(
          'api/v1/settings',
        ),
      ),
    ]);
    clearTimeout(this.timer);
    this.pending = null;
    this.progress.set(marks.marks);
    // A new profile has no saved filters: it keeps the ones chosen so far, and they get saved.
    if (settings.settings) this.filters.restore(settings.settings);
    this.saved = settings.settings ? JSON.stringify({ filters: this.filters.overrides() }) : null;
    this.auth.isAdmin.set(info.is_admin);
    this.auth.user.set(info.username);
    await this.team.load();
    await this.gameSettings.load();
    this.configFor = this.teamKey();
    await this.characters.load();
    this.fog.use(this.characters.active()?.id ?? null);
    await this.planner.switchProfile(this.characters.active()?.id ?? null);
    if (this.enemies.openFromHash()) this.views.set('enemies');
    if (this.planner.openFromHash()) this.views.set('skills');
  }

  /** Follows another character profile: its marks, builds, explored area and, for the team, its halos. */
  async selectCharacter(id: number): Promise<void> {
    await this.characters.activate(id);
    await this.reloadProfile();
  }

  /** A new character profile, followed at once (empty). */
  async addCharacter(name: string): Promise<void> {
    await this.characters.create(name);
    await this.reloadProfile();
  }

  async removeCharacter(id: number): Promise<void> {
    await this.characters.remove(id);
    this.fog.forget(id);
    this.planner.forgetProfile(id);
    forgetImport(id);
    await this.reloadProfile();
  }

  private async reloadProfile(): Promise<void> {
    const [marks] = await Promise.all([
      firstValueFrom(this.http.get<{ marks: string[] }>('api/v1/progress')),
      this.planner.switchProfile(this.characters.active()?.id ?? null),
    ]);
    this.progress.set(marks.marks);
    this.fog.use(this.characters.active()?.id ?? null);
    await this.team.load();
  }

  private teamKey(): string {
    const t = this.team.team();
    return t ? `${t.id}:${t.is_owner}` : '';
  }

  private async flush(): Promise<void> {
    const json = this.pending;
    if (!json || !this.auth.user()) return;
    try {
      await firstValueFrom(this.http.put('api/v1/settings', { settings: JSON.parse(json) }));
      this.saved = json;
      if (this.pending === json) this.pending = null;
    } catch {
      // stays pending: sent again with the next change
    }
  }
}
