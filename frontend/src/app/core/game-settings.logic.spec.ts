import {
  buildServerFile,
  clampValue,
  defaultValues,
  diffAgainstDefault,
  minToNs,
  nsToMin,
  parseServerFile,
  presetValues,
} from './game-settings.logic';
import { SETTINGS } from './game-settings.model';

const def = (k: string) => SETTINGS.find((d) => d.key === k)!;
const input = () => ({
  preset: 'Custom' as const,
  settings: defaultValues(),
  name: 'Mine',
  slotCount: 8,
  extra: {},
});

describe('game settings logic', () => {
  it('has the 38 keys with defaults inside their range', () => {
    expect(SETTINGS.length).toBe(38);
    expect(new Set(SETTINGS.map((d) => d.key)).size).toBe(38);
    expect(defaultValues()['fromHungerToStarving']).toBe(600_000_000_000);
    expect(defaultValues()['dayTimeDuration']).toBe(1_800_000_000_000);
    expect(defaultValues()['randomSpawnerAmount']).toBe('Automatic');
    for (const d of SETTINGS.filter((s) => s.kind === 'number'))
      expect(clampValue(d, d.def)).toBe(d.def);
  });
  it('clamps like the server and rejects wrong types', () => {
    expect(clampValue(def('playerHealthFactor'), 9)).toBe(4);
    expect(clampValue(def('enemyDamageFactor'), 9)).toBe(2.5);
    expect(clampValue(def('playerDivingTimeFactor'), 0.1)).toBe(0.75);
    expect(clampValue(def('flameLevelFogRemoval'), 3.6)).toBe(4);
    expect(clampValue(def('dayTimeDuration'), 1)).toBe(minToNs(2));
    expect(clampValue(def('tombstoneMode'), 'Nope')).toBeNull();
    expect(clampValue(def('enableDurability'), 'true')).toBeNull();
    expect(clampValue(def('threatBonus'), NaN)).toBeNull();
  });
  it('converts minutes and nanoseconds', () => {
    expect(minToNs(10)).toBe(600_000_000_000);
    expect(nsToMin(minToNs(12.5))).toBe(12.5);
  });
  it('uses the game table when known, else nothing for the other presets', () => {
    expect(presetValues('Hard', null)).toBeNull();
    expect(presetValues('Default', null)).toEqual(defaultValues());
    expect(presetValues('Hard', { Hard: { bossHealthFactor: 1.5 } })?.['bossHealthFactor']).toBe(
      1.5,
    );
    expect(presetValues('Hard', { Hard: { bossHealthFactor: 1.5 } })?.['threatBonus']).toBe(1);
  });
  it('round-trips an export, keeping the imported server keys', () => {
    const settings = { ...defaultValues(), playerHealthFactor: 2, tombstoneMode: 'Everything' };
    const extra = {
      queryPort: 20000,
      userGroups: [{ name: 'Admin', password: 'secret' }],
      bans: [{ id: 1 }],
    };
    const file = buildServerFile({ ...input(), settings, extra });
    const back = parseServerFile(JSON.stringify(file));
    if ('error' in back) throw new Error(back.error);
    expect(back.unknown).toEqual([]);
    expect(back.invalid).toEqual([]);
    expect(back.settings).toEqual(settings);
    expect(back.extra).toMatchObject(extra);
    expect(
      buildServerFile({
        ...input(),
        settings: back.settings,
        extra: back.extra,
        name: back.name!,
        slotCount: back.slotCount!,
      }),
    ).toEqual(file);
    expect(diffAgainstDefault(back.settings).map((d) => d.key)).toEqual([
      'playerHealthFactor',
      'tombstoneMode',
    ]);
  });
  it('exports the default placeholder passwords, never a made-up one', () => {
    const groups = buildServerFile(input())['userGroups'] as { password: string }[];
    expect(groups.every((g) => /^X+/.test(g.password))).toBe(true);
  });
  it('lists unknown keys and bad values and clamps the rest', () => {
    const r = parseServerFile(
      JSON.stringify({
        name: 'X',
        slotCount: 99,
        foo: 1,
        queryPort: 'x',
        gameSettingsPreset: 'Hard',
        gameSettings: { playerHealthFactor: 50, bar: 2, tombstoneMode: 'Nope' },
      }),
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.unknown).toEqual(['foo', 'gameSettings.bar']);
    expect(r.invalid).toEqual(['queryPort', 'gameSettings.tombstoneMode']);
    expect(r.clamped).toEqual(['slotCount', 'gameSettings.playerHealthFactor']);
    expect(r.slotCount).toBe(16);
    expect(r.preset).toBe('Hard');
    expect(r.settings['playerHealthFactor']).toBe(4);
    expect(r.settings['tombstoneMode']).toBe('AddBackpackMaterials');
  });
  it('rejects text that is not a JSON object', () => {
    expect('error' in parseServerFile('{oops')).toBe(true);
    expect('error' in parseServerFile('[1]')).toBe(true);
  });
});
