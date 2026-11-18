import { describe, expect, it } from 'vitest';
import fixture from '../../../e2e/fixtures/map/map-data.json';
import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';
import fr from '../../../public/i18n/fr.json';
import { SETTINGS } from './game-settings.model';
import { SECTIONS, sectionLabel } from './sections';
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

interface Tree {
  [k: string]: string | Tree;
}
const flat = (o: Tree, prefix = ''): Record<string, string> =>
  Object.entries(o).reduce(
    (acc, [k, v]) =>
      typeof v === 'string' ? { ...acc, [prefix + k]: v } : { ...acc, ...flat(v, `${prefix}${k}.`) },
    {} as Record<string, string>,
  );
const placeholders = (t: string) => (t.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();

describe('interface files', () => {
  const files: Record<string, Record<string, string>> = {
    fr: flat(fr as Tree),
    en: flat(en as Tree),
    de: flat(de as Tree),
  };
  it('there is one file per language of LANGUAGES', () => {
    expect(Object.keys(files).sort()).toEqual([...LANGUAGES].sort());
  });
  for (const code of Object.keys(files)) {
    it(`${code}.json has exactly the keys of en.json, with the same placeholders`, () => {
      expect(Object.keys(files[code]).sort()).toEqual(Object.keys(files['en']).sort());
      for (const [k, v] of Object.entries(files[code])) {
        expect(placeholders(v), k).toEqual(placeholders(files['en'][k]));
      }
    });
  }
  it('every language is named in its own words in every file', () => {
    for (const f of Object.values(files)) for (const c of LANGUAGES) expect(f['language_' + c]).toBeTruthy();
  });
});

describe('game settings texts', () => {
  it('every setting has a German label, and a German help where it has a help', () => {
    for (const d of SETTINGS) {
      expect(d.label['de'], d.key).toBeTruthy();
      if (d.help) expect(d.help['de'], d.key).toBeTruthy();
    }
  });
});

describe('hard-coded labels', () => {
  it('every menu section has a text for each language of LANGUAGES', () => {
    for (const s of SECTIONS) for (const code of LANGUAGES) expect(s.label[code], s.label.en).toBeTruthy();
  });
  it('a language without a section text shows the English one', () => {
    expect(sectionLabel(SECTIONS[0], 'xx')).toBe(SECTIONS[0].label.en);
  });
  it('English stays at position 1 of the data arrays (gear.logic and slot pickers read name[1])', () => {
    expect(LANGUAGES[1]).toBe('en');
  });
});
