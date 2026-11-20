/** The manifest an add-on publishes (contract/manifest.schema.json). Anything malformed means "no add-on". */

export const ADDON_API_VERSION = 1;
export const ID_RE = /^[a-z0-9-]{1,20}$/;
export const ELEMENT_RE = /^addon-[a-z0-9-]{1,30}$/;
export const PATH_RE = /^(?!.*(\.\.|\/\/))\/addon\/[A-Za-z0-9._/-]{1,100}$/;

export interface LabelByLang {
  fr: string;
  en: string;
}

export interface AddonEntry {
  id: string;
  name: LabelByLang;
  element: string;
  level: 'read' | 'action';
}

export interface AddonManifest {
  script: string;
  styles: string;
  entries: AddonEntry[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** null = refuse everything: the script and the elements are injected into the page, so one bad field voids all. */
export function parseManifest(raw: unknown): AddonManifest | null {
  if (!isObj(raw) || raw['api_version'] !== ADDON_API_VERSION) return null;
  const { script, styles, addons } = raw;
  if (!str(script, 120) || !PATH_RE.test(script) || !str(styles, 120) || !PATH_RE.test(styles))
    return null;
  if (!Array.isArray(addons) || addons.length > 20) return null;
  const entries: AddonEntry[] = [];
  for (const a of addons) {
    if (!isObj(a) || !isObj(a['name'])) return null;
    const { id, level, element } = a;
    const { fr, en } = a['name'];
    if (!str(id, 20) || !ID_RE.test(id) || !str(element, 40) || !ELEMENT_RE.test(element))
      return null;
    if (level !== 'read' && level !== 'action') return null;
    if (!str(fr, 40) || !str(en, 40)) return null;
    entries.push({ id, name: { fr, en }, element, level });
  }
  return { script, styles, entries };
}

export function entryLabel(e: AddonEntry, lang: string): string {
  return lang === 'fr' ? e.name.fr : e.name.en;
}
