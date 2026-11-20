import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddonService } from './addon.service';

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
  ],
};

describe('AddonService', () => {
  let svc: AddonService;
  let http: HttpTestingController;
  const scripts = () => document.head.querySelectorAll('script[src="/addon/elements.js"]');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(AddonService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    document.head
      .querySelectorAll('script[src^="/addon/"], link[href^="/addon/"]')
      .forEach((e) => e.remove());
  });

  const load = async (body: string | object, status = 200) => {
    const p = svc.load();
    http.expectOne('/addon/api/manifest').flush(body, { status, statusText: 'x' });
    await p;
  };

  it('a 502 leaves no entry', async () => {
    await load('bad gateway', 502);
    expect(svc.entries()).toEqual([]);
  });

  it('a hostile manifest leaves no entry', async () => {
    await load({ ...MANIFEST, script: 'https://evil.example/x.js' });
    expect(svc.entries()).toEqual([]);
  });

  it('a valid manifest gives its entries', async () => {
    await load(MANIFEST);
    expect(svc.entries().map((e) => e.id)).toEqual(['server']);
  });

  it('ensureLoaded injects one script however often it is called', async () => {
    await load(MANIFEST);
    const a = svc.ensureLoaded();
    const b = svc.ensureLoaded();
    expect(scripts().length).toBe(1);
    expect(document.head.querySelectorAll('link[href="/addon/elements.css"]').length).toBe(1);
    scripts()[0].dispatchEvent(new Event('load'));
    await Promise.all([a, b]);
    await svc.ensureLoaded();
    expect(scripts().length).toBe(1);
  });

  it('a failing script rejects, and a new call tries again', async () => {
    await load(MANIFEST);
    const first = svc.ensureLoaded();
    scripts()[0].dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow();
    const second = svc.ensureLoaded();
    expect(scripts().length).toBe(1);
    scripts()[0].dispatchEvent(new Event('load'));
    await second;
  });

  it('ensureLoaded without a manifest rejects', async () => {
    await expect(svc.ensureLoaded()).rejects.toThrow();
  });

  it('clear() empties the entries', async () => {
    await load(MANIFEST);
    svc.clear();
    expect(svc.entries()).toEqual([]);
  });
});
