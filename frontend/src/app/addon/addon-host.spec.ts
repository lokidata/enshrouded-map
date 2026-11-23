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

const row = (id: string, level: string, fr: string, en: string, key = 'main') => ({
  id,
  key,
  name: { fr, en },
  element: `addon-${id}`,
  capabilities: ['tab'],
  script: `/addon/${key}/elements.js`,
  styles: `/addon/${key}/elements.css`,
  level,
});
const LIST = [
  row('server', 'read', 'Serveur', 'Server'),
  row('chestsort', 'action', 'Coffres', 'Chests'),
  row('other', 'read', 'Autre', 'Other', 'second'),
];

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
  http.expectOne('/api/v1/addons').flush(LIST);
  await p;
  const fixture = TestBed.createComponent(AddonHost);
  const el: HTMLElement = fixture.nativeElement;
  const script = () => document.head.querySelector('script[src="/addon/main/elements.js"]');
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
    expect(node.getAttribute('base')).toBe('/addon/main/');
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

  it('loads one script per key, each element gets its own base, and the error is per entry', async () => {
    const { fixture, el, views, script } = await setup();
    const second = () => document.head.querySelector('script[src="/addon/second/elements.js"]');
    views.openAddon('server');
    fixture.detectChanges();
    await fixture.whenStable();
    script()!.dispatchEvent(new Event('load'));
    await fixture.whenStable();
    views.openAddon('other');
    fixture.detectChanges();
    await fixture.whenStable();
    second()!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('addon-other')).toBeNull();
    views.openAddon('server'); // another entry: no error for it
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('addon-server')!.getAttribute('base')).toBe('/addon/main/');
    expect(el.querySelector('addon-server')!.getAttribute('active')).toBe('true');
  });
});
