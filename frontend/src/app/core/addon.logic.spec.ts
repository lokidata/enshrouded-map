import { describe, expect, it } from 'vitest';
import schema from '../../../../contract/manifest.schema.json';
import {
  ADDON_API_VERSION,
  ELEMENT_RE,
  ID_RE,
  PATH_RE,
  entryLabel,
  parseManifest,
} from './addon.logic';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'server',
  version: '0.2.0',
  level: 'read',
  name: { fr: 'Serveur', en: 'Server' },
  element: 'addon-server',
  ...over,
});
const manifest = (over: Record<string, unknown> = {}) => ({
  api_version: 1,
  script: '/addon/elements.js',
  styles: '/addon/elements.css',
  addons: [entry(), entry({ id: 'chestsort', level: 'action', element: 'addon-chestsort' })],
  ...over,
});

describe('parseManifest', () => {
  it('reads a valid manifest', () => {
    const m = parseManifest(manifest());
    expect(m?.script).toBe('/addon/elements.js');
    expect(m?.entries.map((e) => e.id)).toEqual(['server', 'chestsort']);
    expect(m?.entries[1].level).toBe('action');
  });

  it('refuses everything on an unknown api_version', () => {
    expect(parseManifest(manifest({ api_version: 2 }))).toBeNull();
  });

  it('refuses an external or traversing script or styles', () => {
    for (const bad of [
      'https://x/y.js',
      '//x',
      '/addon/../x',
      '/other/x.js',
      '/addon//x',
      'elements.js',
    ]) {
      expect(parseManifest(manifest({ script: bad }))).toBeNull();
      expect(parseManifest(manifest({ styles: bad }))).toBeNull();
    }
  });

  it('refuses an element that is not an addon- custom element', () => {
    for (const bad of ['script', 'div', 'addon-', 'addon-X', 'addon-a b']) {
      expect(parseManifest(manifest({ addons: [entry({ element: bad })] }))).toBeNull();
    }
  });

  it('refuses an invalid id, level, name or shape', () => {
    for (const bad of ['', 'A', 'a b', 'x'.repeat(21), '../x']) {
      expect(parseManifest(manifest({ addons: [entry({ id: bad })] }))).toBeNull();
    }
    expect(parseManifest(manifest({ addons: [entry({ level: 'admin' })] }))).toBeNull();
    expect(parseManifest(manifest({ addons: [entry({ name: 'Server' })] }))).toBeNull();
    for (const raw of [null, 'x', 3, [], {}, manifest({ addons: 'no' })]) {
      expect(parseManifest(raw)).toBeNull();
    }
  });

  it('accepts a manifest with no add-on', () => {
    expect(parseManifest(manifest({ addons: [] }))?.entries).toEqual([]);
  });
});

describe('entryLabel', () => {
  const e = parseManifest(manifest())!.entries[0];
  it('uses the language, falling back to English', () => {
    expect(entryLabel(e, 'fr')).toBe('Serveur');
    expect(entryLabel(e, 'de')).toBe('Server');
  });
});

describe('the contract copy', () => {
  it('has the same rules as the code', () => {
    const item = schema.properties.addons.items.properties;
    expect(new RegExp(item.id.pattern).source).toBe(ID_RE.source);
    expect(new RegExp(item.element.pattern).source).toBe(ELEMENT_RE.source);
    expect(new RegExp(schema.$defs.path.pattern).source).toBe(PATH_RE.source);
    expect(schema.properties.api_version.const).toBe(ADDON_API_VERSION);
  });
});
