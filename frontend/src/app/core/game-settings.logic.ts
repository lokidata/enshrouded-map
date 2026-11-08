import {
  DEFAULT_SERVER,
  MAX_SLOTS,
  NS_PER_MIN,
  OWN_KEYS,
  PRESETS,
  Preset,
  SETTINGS,
  SettingDef,
  SettingValue,
} from './game-settings.model';

export type Values = Record<string, SettingValue>;
/** Preset id -> its (possibly partial) values, from settings-presets.json. */
export type PresetTable = Partial<Record<string, Values>>;

const BY_KEY = new Map(SETTINGS.map((d) => [d.key, d]));
export const nsToMin = (ns: number): number => ns / NS_PER_MIN;
export const minToNs = (min: number): number => Math.round(min * NS_PER_MIN);
export const defaultValues = (): Values => Object.fromEntries(SETTINGS.map((d) => [d.key, d.def]));
export const isPreset = (p: unknown): p is Preset => PRESETS.includes(p as Preset);

/** Bounds in the unit of the stored value (nanoseconds for a duration). */
export function bounds(d: SettingDef): [number, number] {
  const k = d.kind === 'duration' ? NS_PER_MIN : 1;
  return [(d.min ?? 0) * k, (d.max ?? 0) * k];
}

/** Clamp like the server: a number goes to the nearest bound; a wrong type or option is `null` (the server would not boot). */
export function clampValue(d: SettingDef, raw: unknown): SettingValue | null {
  if (d.kind === 'boolean') return typeof raw === 'boolean' ? raw : null;
  if (d.kind === 'enum') return typeof raw === 'string' && d.options?.includes(raw) ? raw : null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const [lo, hi] = bounds(d);
  const v = Math.min(Math.max(raw, lo), hi);
  return d.int || d.kind === 'duration' ? Math.round(v) : v;
}

/** Values of a preset: the game's table when known (a missing key falls back to the default), else `null`. */
export function presetValues(preset: Preset, table: PresetTable | null): Values | null {
  const t = table?.[preset];
  if (preset === 'Default') return { ...defaultValues(), ...t };
  return t ? { ...defaultValues(), ...t } : null;
}

export const diffKeys = (v: Values): string[] =>
  SETTINGS.filter((d) => v[d.key] !== d.def).map((d) => d.key);

export interface ServerInput {
  preset: Preset;
  settings: Values;
  name: string;
  slotCount: number;
  extra: Record<string, unknown>;
}

/** The full enshrouded_server.json: the default file, the page's name / slots / settings, then the kept imported keys. */
export function buildServerFile(s: ServerInput): Record<string, unknown> {
  const file: Record<string, unknown> = { ...DEFAULT_SERVER, ...s.extra };
  file['name'] = s.name;
  file['slotCount'] = s.slotCount;
  file['gameSettingsPreset'] = s.preset;
  file['gameSettings'] = Object.fromEntries(
    SETTINGS.map((d) => [d.key, s.settings[d.key] ?? d.def]),
  );
  return file;
}

export interface Imported {
  preset: Preset;
  settings: Values;
  name?: string;
  slotCount?: number;
  extra: Record<string, unknown>;
  unknown: string[];
  invalid: string[];
  clamped: string[];
}

const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : typeof v);

/** Validate a pasted or loaded server file. Unknown keys are listed and dropped, bad values reported and left at the default. */
export function parseServerFile(text: string): Imported | { error: string } {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { error: 'not an object' };
  const r = o as Record<string, unknown>;
  const out: Imported = {
    preset: 'Default',
    settings: defaultValues(),
    extra: {},
    unknown: [],
    invalid: [],
    clamped: [],
  };
  const known = DEFAULT_SERVER as Record<string, unknown>;
  for (const [k, v] of Object.entries(r)) {
    if (k === 'gameSettings' || k === 'gameSettingsPreset') continue;
    if (k === 'name') {
      if (typeof v === 'string') out.name = v;
      else out.invalid.push(k);
    } else if (k === 'slotCount') {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.slotCount = Math.min(Math.max(Math.round(v), 1), MAX_SLOTS);
        if (out.slotCount !== v) out.clamped.push(k);
      } else out.invalid.push(k);
    } else if (!(k in known) || OWN_KEYS.includes(k)) out.unknown.push(k);
    else if (typeOf(v) === typeOf(known[k])) out.extra[k] = v;
    else out.invalid.push(k);
  }
  if ('gameSettingsPreset' in r) {
    if (isPreset(r['gameSettingsPreset'])) out.preset = r['gameSettingsPreset'];
    else out.invalid.push('gameSettingsPreset');
  }
  const gs = r['gameSettings'];
  if (gs !== undefined && (typeof gs !== 'object' || gs === null || Array.isArray(gs)))
    out.invalid.push('gameSettings');
  else
    for (const [k, v] of Object.entries(gs ?? {})) {
      const d = BY_KEY.get(k);
      if (!d) {
        out.unknown.push(`gameSettings.${k}`);
        continue;
      }
      const c = clampValue(d, v);
      if (c === null) out.invalid.push(`gameSettings.${k}`);
      else {
        out.settings[k] = c;
        if (c !== v) out.clamped.push(`gameSettings.${k}`);
      }
    }
  return out;
}

/** Settings that differ from the default, for the import preview. */
export function diffAgainstDefault(
  v: Values,
): { key: string; from: SettingValue; to: SettingValue }[] {
  return SETTINGS.filter((d) => v[d.key] !== d.def).map((d) => ({
    key: d.key,
    from: d.def,
    to: v[d.key],
  }));
}
