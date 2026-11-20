import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { AddonService } from '../core/addon.service';
import { LangService } from '../core/lang.service';
import { ViewStore } from '../core/view.store';
import { AddonHost } from './addon-host';

const MANIFEST = {
  api_version: 1,
  script: '/addon/elements.js',
  styles: '/addon/elements.css',
  addons: [
    {
      id: 'server',
      version: '1',
      level: 'read',
      name: { fr: 'Serveur', en: 'Server' },
      element: 'addon-server',
    },
    {
      id: 'chestsort',
      version: '1',
      level: 'action',
      name: { fr: 'Coffres', en: 'Chests' },
      element: 'addon-chestsort',
    },
  ],
};

async function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LangService, useValue: { lang: () => 'fr' } },
      provideTransloco({
        config: { availableLangs: ['fr'], defaultLang: 'fr' },
        loader: class {
          getTranslation = () => of({});
        },
      }),
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const svc = TestBed.inject(AddonService);
  const p = svc.load();
  http.expectOne('/addon/api/manifest').flush(MANIFEST);
  await p;
  const fixture = TestBed.createComponent(AddonHost);
  const el: HTMLElement = fixture.nativeElement;
  const script = () => document.head.querySelector('script[src="/addon/elements.js"]');
  return { fixture, el, views: TestBed.inject(ViewStore), script };
}

describe('AddonHost', () => {
  afterEach(() => {
    document.head
      .querySelectorAll('script[src^="/addon/"], link[href^="/addon/"]')
      .forEach((e) => e.remove());
  });

  it('mounts the element with lang and active, and keeps it when another screen opens', async () => {
    const { fixture, el, views, script } = await setup();
    views.openAddon('server');
    fixture.detectChanges();
    await fixture.whenStable();
    script()!.dispatchEvent(new Event('load'));
    await fixture.whenStable();
    fixture.detectChanges();
    const node = el.querySelector('[data-addon] addon-server')!;
    expect(node.getAttribute('lang')).toBe('fr');
    expect(node.getAttribute('active')).toBe('true');
    views.set('map');
    fixture.detectChanges();
    expect(el.querySelector('[data-addon] addon-server')).toBe(node); // same node: a draft survives
    expect(node.getAttribute('active')).toBe('false');
    expect(node.closest('[data-addon]')!.hasAttribute('hidden')).toBe(true);
  });

  it('shows an error when the script fails, and Retry tries again', async () => {
    const { fixture, el, views, script } = await setup();
    views.openAddon('server');
    fixture.detectChanges();
    await fixture.whenStable();
    script()!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(script()).not.toBeNull(); // a new script was added
  });
});
