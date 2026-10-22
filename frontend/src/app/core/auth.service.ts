import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** login: existing account; setup: the very first account; invite: account created from an invitation link. */
export type AuthMode = 'login' | 'setup' | 'invite';

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
  /** Token of the invitation link the page was opened with. */
  readonly inviteToken = signal<string | null>(null);
  /** Translation key of a message shown to the user, or null. */
  readonly notice = signal<string | null>(null);

  async me(): Promise<{ username: string | null; setup_required: boolean }> {
    return firstValueFrom(
      this.http.get<{ username: string | null; setup_required: boolean }>('api/v1/auth/me'),
    );
  }

  async authenticate(mode: AuthMode, credentials: Credentials): Promise<string> {
    const [path, body] =
      mode === 'invite'
        ? ['invitations/accept', { ...credentials, token: this.inviteToken() }]
        : [mode, credentials];
    return (await firstValueFrom(this.http.post<{ username: string }>(`api/v1/auth/${path}`, body)))
      .username;
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

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('api/v1/auth/logout', {}));
  }
}
