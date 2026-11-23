import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../core/auth.service';
import { AdminDialog } from './admin-dialog';

const row = (enabled: boolean) => ({
  id: 'srv',
  key: 'main',
  name: { fr: 'Serveur', en: 'Server' },
  description: { fr: 'Gère le serveur', en: 'Runs the server' },
  capabilities: ['tab', 'map-layer'],
  version: '1.2.3',
  enabled,
});

async function setup(enabled: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTransloco({
        config: { availableLangs: ['fr'], defaultLang: 'fr' },
        loader: class {
          getTranslation = () => of({});
        },
      }),
    ],
  });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  const http = TestBed.inject(HttpTestingController);
  const fx = TestBed.createComponent(AdminDialog);
  fx.detectChanges();
  TestBed.inject(AuthService).adminOpen.set(true);
  fx.detectChanges();
  http.match('api/v1/auth/users').forEach((r) => r.flush([]));
  http.expectOne('/api/v1/addons/admin').flush([row(enabled)]);
  await fx.whenStable();
  fx.detectChanges();
  const el = fx.nativeElement as HTMLElement;
  (el.querySelector('#admin-tab-srv') as HTMLElement).click();
  fx.detectChanges();
  return { http, fx, el };
}

describe('AdminDialog add-on tabs', () => {
  it('shows one tab per entry with name, version and capabilities', async () => {
    const { el } = await setup(false);
    const text = el.querySelector('#admin-panel')?.textContent ?? '';
    expect(text).toContain('1.2.3');
    expect(text).toContain('addon.capTab');
    expect(text).toContain('addon.capMapLayer');
    expect(el.querySelector('#admin-tab-srv')?.textContent).toContain('Serveur');
  });

  it('hides the access table while the entry is disabled', async () => {
    const { el } = await setup(false);
    expect(el.querySelector('app-addon-access')).toBeNull();
  });

  it('shows it when enabled', async () => {
    const { http, el } = await setup(true);
    expect(el.querySelector('app-addon-access')).not.toBeNull();
    http.match('/api/v1/addons/srv/access').forEach((r) => r.flush([]));
  });

  it('toggling calls the PUT, then reloads the add-on list', async () => {
    const { http, fx, el } = await setup(false);
    const box = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.click();
    const put = http.expectOne('/api/v1/addons/srv');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ enabled: true });
    put.flush(row(true));
    await fx.whenStable();
    http.expectOne('/api/v1/addons').flush([]);
    fx.detectChanges();
    expect(el.querySelector('app-addon-access')).not.toBeNull();
    http.match('/api/v1/addons/srv/access').forEach((r) => r.flush([]));
  });
});
