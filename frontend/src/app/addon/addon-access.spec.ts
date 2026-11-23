import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { AddonAccess } from './addon-access';

async function setup(addon: string) {
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
  const http = TestBed.inject(HttpTestingController);
  const fx = TestBed.createComponent(AddonAccess);
  fx.componentRef.setInput('addon', addon);
  fx.detectChanges();
  http
    .expectOne(`/api/v1/addons/${addon}/access`)
    .flush([{ user_id: 2, username: 'alice', level: 'read' }]);
  await fx.whenStable();
  fx.detectChanges();
  const sel = fx.nativeElement.querySelector('select') as HTMLSelectElement;
  return { http, fx, sel };
}
const pick = (sel: HTMLSelectElement, v: string) => {
  sel.value = v;
  sel.dispatchEvent(new Event('change'));
};

describe('AddonAccess', () => {
  it('reads the list of its own add-on and shows the level', async () => {
    const { sel } = await setup('chestsort');
    expect(sel.value).toBe('read');
  });

  it('sends the change to the site API by entry id and user id, without X-Addon', async () => {
    const { http, sel } = await setup('server');
    pick(sel, 'action');
    const req = http.expectOne('/api/v1/addons/server/access/2');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.has('X-Addon')).toBe(false);
    expect(req.request.body).toEqual({ level: 'action' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('puts the old level back and says so when the add-on refuses', async () => {
    const { http, fx, sel } = await setup('server');
    pick(sel, 'action');
    http.expectOne('/api/v1/addons/server/access/2').flush({}, { status: 403, statusText: 'x' });
    await fx.whenStable();
    fx.detectChanges();
    expect(sel.value).toBe('read');
    expect(fx.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'addon.accessError',
    );
  });
});
