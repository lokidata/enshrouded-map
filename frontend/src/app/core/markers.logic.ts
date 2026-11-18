/** The levels of a Flame Altar; its build area is a square centred on it, 40 m per level (given by the player, not in the game data). */
export const ALTAR_LEVELS = [1, 2, 3, 4] as const;
const METRES_PER_LEVEL = 40;

/** The icons of the game's own custom markers, in the order of its dialog; the picture of key n is icons/custom_marker_<n>.png (pipeline). */
export const MARKER_ICONS = [
  'flag',
  'chest',
  'creature',
  'bag',
  'feather',
  'beast',
  'drop',
  'fish',
  'crystal',
  'sword',
] as const;

/** Picture of a marker icon; a key this version does not know (or none) shows the flag. */
export function markerIconUrl(key: string | null): string {
  const n = MARKER_ICONS.findIndex((k) => k === key);
  return `icons/custom_marker_${Math.max(n, 0)}.png`;
}

export const altarSide = (level: number): number => level * METRES_PER_LEVEL;

/**
 * Side in metres of the build area an Altar upgrade gives, from its `craft.json` entry level (kind "altar"): the entries are
 * Claim (level 0), then "Flame Altar Level 2", "3" and "4" (levels 1 to 3), so the altar reached is entry level + 1 (the
 * names agree in all three languages). null outside 1-4. The build area follows the altar's level, not the Flame level.
 */
export const altarAreaOfEntry = (entryLevel: number): number | null =>
  Number.isInteger(entryLevel) && entryLevel >= 0 && entryLevel <= 3
    ? altarSide(entryLevel + 1)
    : null;

/** Leaflet bounds [[south-west], [north-east]] of the build area, with latLng(x, z) = [z - world, x]. */
export function altarBounds(
  x: number,
  z: number,
  level: number,
  world: number,
): [[number, number], [number, number]] {
  const half = altarSide(level) / 2;
  return [
    [z - half - world, x - half],
    [z + half - world, x + half],
  ];
}

/** The 8 colours of the game's custom markers, in the order of its dialog; each is the token --marker-<name> of styles.css. */
export const MARKER_COLORS = [
  'white',
  'green',
  'pink',
  'lavender',
  'ochre',
  'purple',
  'teal',
  'grey',
] as const;

/** The token of a marker's colour; none, or a name this version does not know, is white. */
export const markerColorToken = (color: string | null): string =>
  `--marker-${MARKER_COLORS.find((c) => c === color) ?? MARKER_COLORS[0]}`;

/** What the server allows per profile (`max_markers`); the list shows "n / MAX_MARKERS". */
export const MAX_MARKERS = 100;

/** Layer keys: mine, or `u<user id>` for a teammate. The ticked layers are kept per browser as the list of unticked ones. */
const LAYER_KEY = /^(me|u\d+)$/;

/** Reads the stored list of unticked layers: anything else than an array of layer keys is dropped (a new member starts shown). */
export function readHiddenLayers(raw: string | null): string[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return [
      ...new Set(list.filter((k): k is string => typeof k === 'string' && LAYER_KEY.test(k))),
    ];
  } catch {
    return [];
  }
}
