import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddonService } from './addon.service';

const row = (key: string, id: string) => ({
  id,
  key,
  name: { fr: 'Serveur', en: 'Server' },
  element: `addon-${id}`,
  capabilities: ['tab'],
  script: `/addon/${key}/main.js`,
  styles: `/addon/${key}/main.css`,
  level: 'read',
});
const LIST = [row('a', 'server'), row('b', 'other')];

describe('AddonService', () => {
  let svc: AddonService;
  let http: HttpTestingController;
  const scripts = (k: string) =>
    document.head.querySelectorAll(`script[src="/addon/${k}/main.js"]`);

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
    http.expectOne('/api/v1/addons').flush(body, { status, statusText: 'x' });
    await p;
  };

  it('a 502 leaves no entry', async () => {
    await load('bad gateway', 502);
    expect(svc.entries()).toEqual([]);
  });

  it('a hostile answer leaves no entry', async () => {
    await load([{ ...row('a', 'server'), script: 'https://evil.example/x.js' }]);
    expect(svc.entries()).toEqual([]);
  });

  it('a valid answer gives its entries', async () => {
    await load(LIST);
    expect(svc.entries().map((e) => e.id)).toEqual(['server', 'other']);
  });

  const entry = (id: string) => svc.entries().find((e) => e.id === id)!;

  it('ensureLoaded injects one script per entry however often it is called', async () => {
    await load(LIST);
    const a = svc.ensureLoaded(entry('server'));
    const b = svc.ensureLoaded(entry('server'));
    expect(scripts('a').length).toBe(1);
    expect(document.head.querySelectorAll('link[href="/addon/a/main.css"]').length).toBe(1);
    scripts('a')[0].dispatchEvent(new Event('load'));
    await Promise.all([a, b]);
    await svc.ensureLoaded(entry('server'));
    expect(scripts('a').length).toBe(1);
  });

  it('two keys load two scripts', async () => {
    await load(LIST);
    void svc.ensureLoaded(entry('server'));
    void svc.ensureLoaded(entry('other'));
    expect(scripts('a').length + scripts('b').length).toBe(2);
  });

  it('two entries of one key with different scripts load one script each', async () => {
    await load([
      row('a', 'one'),
      { ...row('a', 'two'), script: '/addon/a/two.js', styles: '/addon/a/two.css' },
    ]);
    void svc.ensureLoaded(entry('one'));
    void svc.ensureLoaded(entry('two'));
    expect(scripts('a').length).toBe(1);
    expect(document.head.querySelectorAll('script[src="/addon/a/two.js"]').length).toBe(1);
    expect(document.head.querySelectorAll('link[href="/addon/a/two.css"]').length).toBe(1);
  });

  it('two entries of one key sharing the same files load them once', async () => {
    await load([row('a', 'one'), row('a', 'two')]);
    void svc.ensureLoaded(entry('one'));
    void svc.ensureLoaded(entry('two'));
    expect(scripts('a').length).toBe(1);
    expect(document.head.querySelectorAll('link[href="/addon/a/main.css"]').length).toBe(1);
  });

  it('a failing script rejects, and a new call tries again', async () => {
    await load(LIST);
    const first = svc.ensureLoaded(entry('server'));
    scripts('a')[0].dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow();
    expect(scripts('a').length).toBe(0);
    const second = svc.ensureLoaded(entry('server'));
    expect(scripts('a').length).toBe(1);
    expect(document.head.querySelectorAll('link[href="/addon/a/main.css"]').length).toBe(1);
    scripts('a')[0].dispatchEvent(new Event('load'));
    await second;
  });

  it('clear() empties the entries', async () => {
    await load(LIST);
    svc.clear();
    expect(svc.entries()).toEqual([]);
  });
});
