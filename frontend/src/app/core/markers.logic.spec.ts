import { describe, expect, it } from 'vitest';
import {
  ALTAR_LEVELS,
  MARKER_COLORS,
  MARKER_ICONS,
  altarAreaOfEntry,
  altarBounds,
  altarSide,
  markerColorToken,
  markerIconUrl,
  readHiddenLayers,
} from './markers.logic';

describe('altar build area', () => {
  it('is a square of 40 m per level', () => {
    expect(ALTAR_LEVELS.map(altarSide)).toEqual([40, 80, 120, 160]);
  });

  it('is centred on the marker, in the map frame (lat = z - world size, lng = x)', () => {
    // world 10,240 m; level 2 = 80 m: 40 m each side of (5000, 6000)
    expect(altarBounds(5000, 6000, 2, 10240)).toEqual([
      [6000 - 40 - 10240, 5000 - 40],
      [6000 + 40 - 10240, 5000 + 40],
    ]);
  });

  it('is as wide as it is tall', () => {
    const [[south, west], [north, east]] = altarBounds(100, 200, 4, 10240);
    expect(east - west).toBe(160);
    expect(north - south).toBe(160);
  });
});

describe('build area of an altar upgrade', () => {
  it('is 40 m for the Claim and 80, 120, 160 m for the Level 2, 3 and 4 upgrades', () => {
    expect([0, 1, 2, 3].map(altarAreaOfEntry)).toEqual([40, 80, 120, 160]);
  });

  it('is none for an entry outside the four altar levels', () => {
    expect([-1, 4, 1.5].map(altarAreaOfEntry)).toEqual([null, null, null]);
  });
});

describe('marker icons', () => {
  it('are the 10 pictures of the game, by their position', () => {
    expect(MARKER_ICONS).toHaveLength(10);
    expect(markerIconUrl('flag')).toBe('icons/custom_marker_0.png');
    expect(markerIconUrl('sword')).toBe('icons/custom_marker_9.png');
  });

  it('shows the flag for no key or an unknown one', () => {
    expect(markerIconUrl(null)).toBe('icons/custom_marker_0.png');
    expect(markerIconUrl('camp')).toBe('icons/custom_marker_0.png');
  });
});

describe('marker colours', () => {
  it('are the 8 of the game, each a token', () => {
    expect(MARKER_COLORS).toHaveLength(8);
    expect(markerColorToken('teal')).toBe('--marker-teal');
  });

  it('are white for none or an unknown name', () => {
    expect(markerColorToken(null)).toBe('--marker-white');
    expect(markerColorToken('#fff')).toBe('--marker-white');
  });
});

describe('ticked layers kept by the browser', () => {
  it('reads the unticked layers', () => {
    expect(readHiddenLayers('["me","u7"]')).toEqual(['me', 'u7']);
  });

  it('starts with every layer shown when nothing, or something broken, is stored', () => {
    expect(readHiddenLayers(null)).toEqual([]);
    expect(readHiddenLayers('not json')).toEqual([]);
    expect(readHiddenLayers('{"me":true}')).toEqual([]);
  });

  it('drops what is not a layer key, and repeats', () => {
    expect(readHiddenLayers('["me",3,"u","u2","u2","<b>x</b>"]')).toEqual(['me', 'u2']);
  });
});
