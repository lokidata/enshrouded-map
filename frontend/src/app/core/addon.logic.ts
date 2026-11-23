/** The add-on list the site's API serves (GET /api/v1/addons): a second guard, since scripts and elements are injected into the page. */

export const KEY_RE = /^[a-z0-9-]{1,20}$/;
export const ID_RE = KEY_RE;
export const ELEMENT_RE = /^addon-[a-z0-9-]{1,30}$/;
const pathRe = (key: string) =>
  new RegExp(`^(?!.*(\\.\\.|//))/addon/${key}/[A-Za-z0-9._/-]{1,100}$`);
/** Longest legal path: `/addon/` + key (20) + `/` + 100. */
const PATH_MAX = 128;

export interface LabelByLang {
  fr: string;
  en: string;
}

export interface AddonEntry {
  id: string;
  key: string;
  name: LabelByLang;
  element: string;
  capabilities: string[];
  script: string;
  styles: string;
  level: 'read' | 'action';
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** null = refuse everything: one bad field voids the whole list. */
export function parseEntries(raw: unknown): AddonEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: AddonEntry[] = [];
  for (const a of raw) {
    if (!isObj(a) || !isObj(a['name'])) return null;
    const { id, key, level, element, script, styles, capabilities } = a;
    const { fr, en } = a['name'];
    if (!str(id, 20) || !ID_RE.test(id) || !str(key, 20) || !KEY_RE.test(key)) return null;
    if (!str(element, 40) || !ELEMENT_RE.test(element)) return null;
    const path = pathRe(key);
    if (!str(script, PATH_MAX) || !path.test(script) || !str(styles, PATH_MAX) || !path.test(styles))
      return null;
    if (level !== 'read' && level !== 'action') return null;
    if (!str(fr, 40) || !str(en, 40)) return null;
    if (!Array.isArray(capabilities) || !capabilities.every((c) => str(c, 20))) return null;
    entries.push({ id, key, name: { fr, en }, element, capabilities, script, styles, level });
  }
  return entries;
}

/** Public folder of the entry's add-on. */
export const baseOf = (e: AddonEntry): string => `/addon/${e.key}/`;

export function entryLabel(e: Pick<AddonEntry, 'name'>, lang: string): string {
  return lang === 'fr' ? e.name.fr : e.name.en;
}

/** One row of GET /api/v1/addons/admin (administrator view, enabled or not). */
export interface AdminAddon {
  id: string;
  key: string;
  name: LabelByLang;
  description: LabelByLang;
  capabilities: string[];
  version: string;
  enabled: boolean;
}

/** Description in the current language (fr, else en). */
export const entryDescription = (e: AdminAddon, lang: string): string =>
  lang === 'fr' ? e.description.fr : e.description.en;
