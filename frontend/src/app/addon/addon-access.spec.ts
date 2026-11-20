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
    .expectOne(`/addon/api/${addon}/access`)
    .flush([{ user_key: '2:t', username: 'alice', level: 'read' }]);
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

  it('sends the change to that add-on with the X-Addon header and the encoded key', async () => {
    const { http, sel } = await setup('server');
    pick(sel, 'action');
    const req = http.expectOne('/addon/api/server/access/2%3At');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('X-Addon')).toBe('1');
    expect(req.request.body).toEqual({ level: 'action' });
    req.flush({});
  });

  it('puts the old level back and says so when the add-on refuses', async () => {
    const { http, fx, sel } = await setup('server');
    pick(sel, 'action');
    http.expectOne('/addon/api/server/access/2%3At').flush({}, { status: 403, statusText: 'x' });
    await fx.whenStable();
    fx.detectChanges();
    expect(sel.value).toBe('read');
    expect(fx.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'addon.accessError',
    );
  });
});
