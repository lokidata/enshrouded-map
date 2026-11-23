import { describe, expect, it } from 'vitest';
import { baseOf, entryLabel, parseEntries } from './addon.logic';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'server',
  key: 'main',
  name: { fr: 'Serveur', en: 'Server' },
  element: 'addon-server',
  capabilities: ['tab'],
  script: '/addon/main/main.js',
  styles: '/addon/main/main.css',
  level: 'read',
  ...over,
});
const list = (...e: Record<string, unknown>[]) =>
  e.length ? e : [entry(), entry({ id: 'chestsort', level: 'action', element: 'addon-chestsort' })];

describe('parseEntries', () => {
  it('reads valid entries', () => {
    const m = parseEntries(list());
    expect(m?.map((e) => e.id)).toEqual(['server', 'chestsort']);
    expect(m?.[1].level).toBe('action');
    expect(m?.[0].script).toBe('/addon/main/main.js');
  });

  it('accepts a 128-char path (the backend maximum) and refuses 129', () => {
    const key = 'k'.repeat(20);
    const path = (n: number) => `/addon/${key}/${'x'.repeat(n)}`;
    expect(path(100).length).toBe(128);
    const ok = entry({ key, script: path(100), styles: path(100) });
    expect(parseEntries([ok])).not.toBeNull();
    expect(parseEntries([entry({ key, script: path(101), styles: path(100) })])).toBeNull();
  });

  it('has no cap on the number of entries', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      entry({ id: `e${i}`, element: `addon-e${i}` }),
    );
    expect(parseEntries(many)?.length).toBe(50);
  });

  it('refuses a script or styles outside /addon/<key>/ or traversing', () => {
    for (const bad of [
      'https://x/y.js',
      '//x',
      '/addon/main/../x',
      '/addon/other/x.js',
      '/addon/main.js',
      '/addon/main//x',
      'main.js',
    ]) {
      expect(parseEntries([entry({ script: bad })])).toBeNull();
      expect(parseEntries([entry({ styles: bad })])).toBeNull();
    }
  });

  it('refuses an element that is not an addon- custom element', () => {
    for (const bad of ['script', 'div', 'addon-', 'addon-X', 'addon-a b']) {
      expect(parseEntries([entry({ element: bad })])).toBeNull();
    }
  });

  it('refuses an invalid id, key, level, name or shape', () => {
    for (const bad of ['', 'A', 'a b', 'x'.repeat(21), '../x']) {
      expect(parseEntries([entry({ id: bad })])).toBeNull();
      expect(parseEntries([entry({ key: bad })])).toBeNull();
    }
    expect(parseEntries([entry({ level: 'none' })])).toBeNull();
    expect(parseEntries([entry({ name: 'Server' })])).toBeNull();
    expect(parseEntries([entry({ name: { en: 'Server' } })])).toBeNull();
    expect(parseEntries([entry({ capabilities: 'tab' })])).toBeNull();
    for (const raw of [null, 'x', 3, {}, [null], [1]]) {
      expect(parseEntries(raw)).toBeNull();
    }
  });

  it('accepts no entry', () => {
    expect(parseEntries([])).toEqual([]);
  });
});

describe('baseOf', () => {
  it('is the entry public folder', () => {
    expect(baseOf(parseEntries(list())![0])).toBe('/addon/main/');
  });
});

describe('entryLabel', () => {
  const e = parseEntries(list())![0];
  it('uses the language, falling back to English', () => {
    expect(entryLabel(e, 'fr')).toBe('Serveur');
    expect(entryLabel(e, 'de')).toBe('Server');
  });
});
