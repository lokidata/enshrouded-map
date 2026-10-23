import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** login; setup: the very first account; invite: account created from an invitation link; reset: new password from a reset link. */
export type AuthMode = 'login' | 'setup' | 'invite' | 'reset';

export interface UserInfo {
  username: string | null;
  setup_required: boolean;
  is_admin: boolean;
}

export interface Credentials {
  username: string;
  password: string;
  /** Only for the very first account: shown in the API log, or set as SETUP_TOKEN. */
  setup_token?: string;
}

export interface Invitation {
  token: string;
  expires_at: string;
}

/** Error code sent by the API ({"detail": "taken"}), or "network" when it did not answer. */
export function errorCode(err: unknown): string {
  if (!(err instanceof HttpErrorResponse) || err.status === 0) return 'network';
  return typeof err.error?.detail === 'string' ? err.error.detail : 'unknown';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly user = signal<string | null>(null);
  /** The login / setup / invitation dialog: null when closed. */
  readonly dialog = signal<AuthMode | null>(null);
  /** Token of the invitation or reset link the page was opened with, and who a reset is for. */
  readonly inviteToken = signal<string | null>(null);
  readonly resetToken = signal<string | null>(null);
  readonly resetUser = signal<string | null>(null);
  /** The first account: can generate password reset links. */
  readonly isAdmin = signal(false);
  readonly accountOpen = signal(false);
  /** Translation key of a message shown to the user, or null. */
  readonly notice = signal<string | null>(null);

  me(): Promise<UserInfo> {
    return firstValueFrom(this.http.get<UserInfo>('api/v1/auth/me'));
  }

  authenticate(mode: AuthMode, credentials: Credentials): Promise<UserInfo> {
    const [path, body] =
      mode === 'invite'
        ? ['invitations/accept', { ...credentials, token: this.inviteToken() }]
        : mode === 'reset'
          ? ['password-resets/accept', { token: this.resetToken(), password: credentials.password }]
          : [mode, credentials];
    return firstValueFrom(this.http.post<UserInfo>(`api/v1/auth/${path}`, body));
  }

  async checkInvitation(token: string): Promise<boolean> {
    return (
      await firstValueFrom(
        this.http.post<{ valid: boolean }>('api/v1/auth/invitations/check', { token }),
      )
    ).valid;
  }

  createInvitation(): Promise<Invitation> {
    return firstValueFrom(this.http.post<Invitation>('api/v1/auth/invitations', {}));
  }

  async checkReset(token: string): Promise<string | null> {
    const r = await firstValueFrom(
      this.http.post<{ valid: boolean; username: string | null }>(
        'api/v1/auth/password-resets/check',
        { token },
      ),
    );
    return r.valid ? r.username : null;
  }

  async changePassword(current: string, next: string): Promise<void> {
    await firstValueFrom(
      this.http.post('api/v1/auth/password', { current_password: current, new_password: next }),
    );
  }

  listUsers(): Promise<{ id: number; username: string }[]> {
    return firstValueFrom(this.http.get<{ id: number; username: string }[]>('api/v1/auth/users'));
  }

  createReset(userId: number): Promise<Invitation> {
    return firstValueFrom(
      this.http.post<Invitation>('api/v1/auth/password-resets', { user_id: userId }),
    );
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('api/v1/auth/logout', {}));
  }
}
