import { describe, expect, it } from 'vitest';
import fixture from '../../../e2e/fixtures/map/map-data.json';
import { DEFAULT_LANG, LANGUAGES, chooseLang, supportedLang } from './lang';

describe('supportedLang', () => {
  it('keeps a supported code', () => {
    for (const code of LANGUAGES) expect(supportedLang(code)).toBe(code);
  });
  it('refuses anything else', () => {
    for (const bad of ['xx', 'FR', '', null, undefined, 1]) expect(supportedLang(bad)).toBeNull();
  });
});

describe('chooseLang', () => {
  it("takes the account's language first", () => {
    expect(chooseLang('en', 'fr')).toBe('en');
  });
  it("falls back to this browser's one when the account has none", () => {
    expect(chooseLang(undefined, 'en')).toBe('en');
    expect(chooseLang(null, 'en')).toBe('en');
  });
  it('ignores an unsupported value on either side', () => {
    expect(chooseLang('xx', 'en')).toBe('en');
    expect(chooseLang('xx', 'yy')).toBe(DEFAULT_LANG);
    expect(chooseLang(undefined, undefined)).toBe(DEFAULT_LANG);
  });
});

describe('languages of the data', () => {
  it('the map data holds the names of every language the site offers, in the same order', () => {
    // LangService.index reads the names arrays by this position: a language missing there shows French names
    expect(fixture.languages).toEqual([...LANGUAGES]);
  });
});
