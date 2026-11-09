import { describe, expect, it } from 'vitest';
import { GearItem } from './gear.model';
import {
  armorTotals,
  flameSkillBonus,
  levelPoints,
  shroudMinutes,
  frostSeconds,
  restedMinutes,
  xpToNext,
  xpTotal,
  attributeTotals,
  fits,
  headline,
  rankGain,
  lineSum,
  pieceArmor,
  protection,
  statSums,
  vitals,
  upgraded,
  worn,
  effectTotals,
  parryPoints,
  parryPower,
  blockPower,
  blockPoints,
  perkDamage,
  rankDamage,
  rarityColor,
  rowValue,
  vitalParts,
  rowParts,
  weaponBaseDamage,
  weaponClassPct,
  weaponDamage,
  weaponGuard,
} from './gear.logic';
import { damageRows, formatRow, miscRows, regenRows, weaponRows } from '../build/build-rows';

const c = {
  armorOffset: 23,
  armorGradient: 15,
  apPerFlameLevel: 1,
  damageScalePerAttributePoint: 0.05,
  playerBaseHealth: 100,
  playerHealthPerAP: 50,
  playerBaseMana: 100,
  playerManaPerAP: 20,
  playerBaseStamina: 100,
  playerStaminaPerAP: 10,
  playerBaseOxygen: 30,
};
/** The constants of gear.json the parry and block formulas read (BalancingTable). */
const game = {
  genericWeaponSeed: 10,
  powerCreepWeapon: 0.15000000596046448,
  armorOffset: 23,
  armorGradient: 15,
  flameLevelMax: 20,
  playerLevelMax: 100,
  critBonus: 0.800000011920929,
  baseCritChance: 0.10000000149011612,
  htkStartPve: 5,
  htkEndPve: 10,
  playerBaseHealth: 100,
  playerHealthPerAP: 50,
  playerStaminaPerAP: 10,
  htkStartEvp: 5,
  htkEndEvp: 3,
  epicWeaponBonus: 1.600000023841858,
  parryToDepletion: 0.3499999940395355,
  expectedBaseDamageFactor: 2.5,
};
const stat = (en: string, value: number, format: 'Normal' | 'Percentage' = 'Normal') => ({
  id: 1,
  name: [en, en] as [string, string],
  value,
  format,
});
const chest: GearItem = {
  name: ['a', 'a'],
  slot: 'Chest',
  rarity: 'Rare',
  lvl: [9, 10],
  armor: { physical: 0.14, fire: 0.03 },
  stats: [stat('Health', 40), stat('Poison Resistance', 5, 'Percentage')],
  upgrades: [],
};
const ring: GearItem = {
  name: ['b', 'b'],
  slot: 'Ring',
  rarity: 'Rare',
  lvl: [1, 1],
  stats: [stat('Health', 10), stat('Melee Damage', 5, 'Percentage')],
  upgrades: [],
};

const warlock: GearItem = {
  ...chest,
  lvl: [20, 20],
  armor: { physical: 0.065, magical: 0.075 },
  stats: [],
  upgrades: [
    { name: ['a', 'Blunt Armor'], armor: { blunt: 0.03 }, stats: [] },
    { name: ['b', 'Mana Regeneration'], armor: {}, stats: [stat('Mana Regeneration', 16)] },
  ],
};

describe('gear logic', () => {
  it('upgrades: chain, base armour at L + n, each upgrade at L + its rank', () => {
    expect(pieceArmor(c, warlock)).toEqual({ physical: 21, magical: 24 }); // level 20: 323
    expect(pieceArmor(c, upgraded(c, warlock, 1))).toEqual({
      physical: 22,
      magical: 25,
      blunt: 10,
    }); // 338, 0.03 * 338
    const two = upgraded(c, warlock, 2); // level 22: 353
    expect(pieceArmor(c, two)).toEqual({ physical: 23, magical: 26, blunt: 10 });
    expect(statSums([two]).get('Mana Regeneration|Normal')?.value).toBe(16);
    expect(upgraded(c, warlock, 9).lvl[1]).toBe(22); // capped at the chain
    expect(upgraded(c, warlock, 0)).toBe(warlock);
    expect(worn(c, { head: 'x' }, { x: warlock }, { head: 1 })[0].bonus).toEqual({ blunt: 10 });
  });

  it('a base level below the maximum lowers the armour and keeps the upgrade chain on top', () => {
    const wide: GearItem = { ...warlock, lvl: [10, 20] };
    expect(upgraded(c, wide, 0, 15).lvl[1]).toBe(15);
    expect(upgraded(c, wide, 1, 15).lvl[1]).toBe(16);
    expect(upgraded(c, wide, 0, 99).lvl[1]).toBe(20); // clamped to the item's range
    expect(pieceArmor(c, upgraded(c, wide, 0, 10)).physical).toBeLessThan(
      pieceArmor(c, wide).physical ?? 0,
    );
    expect(worn(c, { head: 'x' }, { x: wide }, {}, { head: 12 })[0].lvl[1]).toBe(12);
  });

  it('headline armour and what each upgrade rank gains', () => {
    expect(headline(pieceArmor(c, upgraded(c, warlock, 1)))).toEqual({ physical: 22, magical: 25 });
    expect(rankGain(c, warlock, 0)).toEqual({ physical: 1, magical: 1 }); // 21/24 -> 22/25
    expect(rankGain(c, warlock, 1)).toEqual({ physical: 1, magical: 1 }); // 22/25 -> 23/26
    expect(rankGain(c, { ...warlock, upgrades: [] }, 0)).toEqual({ physical: 0, magical: 0 });
  });

  it('armour of a piece: round(share * (offset + gradient * level)), highest level', () => {
    expect(pieceArmor(c, chest)).toEqual({ physical: 24, fire: 5 }); // 0.14*173 = 24.2, 0.03*173 = 5.2
    expect(armorTotals(c, [chest, chest]).physical).toBe(48);
  });
  it('adds stat lines by name and format, and knows when nothing is known', () => {
    const sums = statSums([chest, ring]);
    expect(lineSum(sums, ['Health'], 'Normal')).toBe(50);
    expect(lineSum(sums, ['Health'], 'Percentage')).toBeNull();
    expect(lineSum(sums, ['Frost Resistance'], 'Normal')).toBeNull();
  });
  it('Flame adds apPerFlameLevel per level above 1', () => {
    const base = {
      constitution: 3,
      spirit: 2,
      resistance: 0,
      strength: 8,
      dexterity: 0,
      intelligence: 0,
    };
    expect(attributeTotals(c, base, 4).constitution).toBe(6);
    expect(attributeTotals(c, base, 0).strength).toBe(8);
    expect(attributeTotals(c, base, 1).strength).toBe(8);
  });
  it('vitals: ranged damage 0.05 x dexterity, estimates add the lines', () => {
    const a = {
      constitution: 6,
      spirit: 5,
      resistance: 3,
      strength: 11,
      dexterity: 3,
      intelligence: 3,
    };
    const v = vitals(c, a, statSums([chest, ring]));
    expect(v.ranged).toBe(15);
    expect(v.health).toBe(100 + 300 + 50);
    expect(v.melee).toBe(60);
    expect(v.oxygen).toBe(30);
  });
  it('breakdowns reproduce the game screen (health lines 100 + 105 + 300, mana 216, stamina 138)', () => {
    const a = {
      constitution: 6,
      spirit: 5,
      resistance: 3,
      strength: 11,
      dexterity: 3,
      intelligence: 3,
    };
    const line = (name: string, value: number) =>
      ({ name: [name, name], format: 'Normal', value }) as const;
    const sums = new Map(
      [line('Health', 105), line('Mana', 16), line('Stamina', 8)].map((l) => [
        `${l.name[1]}|Normal`,
        l,
      ]),
    );
    const p = vitalParts(c, a, sums);
    expect(p.health.map((x) => x.value)).toEqual([100, 105, 0, 300]);
    expect(p.mana.map((x) => x.value)).toEqual([100, 16, 0, 100]);
    expect(p.stamina.map((x) => x.value)).toEqual([100, 8, 0, 30]);
    const v = vitals(c, a, sums);
    expect([v.health, v.mana, v.stamina, v.melee, v.ranged]).toEqual([505, 216, 138, 55, 15]);
    // the game's 525: the ring's "Health +20" upgrade counts in the total, not in the tooltip's Equipment 105
    const all = new Map(sums).set('Health|Normal', line('Health', 125));
    const up = vitalParts(c, a, all, {}, sums);
    expect(up.health.map((x) => [x.key, x.value])).toEqual([
      ['player', 100],
      ['equipment', 105],
      ['upgrades', 20],
      ['constitution', 300],
    ]);
    expect(vitals(c, a, all).health).toBe(525);
  });
  it('rowParts adds up to rowValue', () => {
    const d = damageRows[0];
    const player = { [d.attr!]: 1.5 };
    const parts = rowParts(d, player, {}, new Map())!;
    expect(parts.base + parts.skills + parts.equip).toBe(rowValue(d, player, {}, new Map()));
  });
  it('protection table: armour per kind, resistance only where a line exists', () => {
    const rows = protection(c, [chest]);
    expect(rows.find((r) => r.kind === 'physical')).toEqual({
      kind: 'physical',
      armor: 24,
      resistance: null,
    });
    expect(rows.find((r) => r.kind === 'ice')?.armor).toBe(0);
  });
  it('slots and worn items', () => {
    const bow: GearItem = { ...ring, slot: 'Weapon', type: 'Bow' };
    expect(fits('ranged', bow)).toBe(true);
    expect(fits('weapon1', bow)).toBe(false);
    expect(fits('ring2', ring)).toBe(true);
    expect(worn(c, { chest: 'x', head: 'gone' }, { x: chest })).toEqual([chest]);
  });

  it('XP: level 20 needs 8562, levels 1..49 add up to 429094', () => {
    expect(xpToNext(20)).toBe(8562);
    expect(xpToNext(3)).toBe(3046);
    expect(xpTotal(50)).toBe(429094);
    expect(xpTotal(1)).toBe(0);
    expect(levelPoints(50)).toBe(98);
  });
  it('Shroud time and Flame skills', () => {
    expect(shroudMinutes(1)).toBe(5);
    expect(shroudMinutes(11)).toBe(15);
    expect(shroudMinutes(0)).toBeNull();
    const node = (id: number, flame: boolean) =>
      ({ id, attr: 'strength', gain: flame ? 0 : 1, flame, type: 'Attribute' }) as never;
    const t = {
      byId: new Map([
        [1, node(1, true)],
        [2, node(2, false)],
      ]),
      next: new Map(),
      roots: new Set<number>(),
    };
    expect(flameSkillBonus(t, { 1: 1, 2: 3 }, 5).strength).toBe(2); // floor(5/2), once
    expect(flameSkillBonus(t, { 1: 1 }, 4).strength).toBe(2); // the game's screen at Flame 4
    expect(flameSkillBonus(t, { 1: 1 }, 1).strength).toBe(0);
  });

  describe('rows from the player template', () => {
    const player = {
      CritChance_Base: 0.05,
      CritDamageMod_Base: 1.5,
      DamageModSneak_Base: 10,
      DamageModBackstab_Multiplier: 1.1,
      Revive_Delay_Base: 6,
      Mana_Recharge: 5,
      Mana_RechargeTimeout: 500,
      WeaponCategoryDamageMod_TwoHand: 1,
    };
    const def = (rows: typeof damageRows, key: string) => rows.find((r) => r.key === key)!;
    const shown = (rows: typeof damageRows, key: string, fx = {}, pieces: GearItem[] = []) => {
      const d = def(rows, key);
      return formatRow(rowValue(d, player, fx, statSums(pieces)), d);
    };
    it('level 1, nothing worn: the base values', () => {
      expect(shown(damageRows, 'critDamage')).toBe('+150%');
      expect(shown(damageRows, 'critChance')).toBe('5%');
      expect(shown(damageRows, 'sneak')).toBe('+900%');
      expect(shown(damageRows, 'backstab')).toBe('+10%');
      expect(shown(miscRows, 'reviveTime')).toBe('6s');
      expect(shown(regenRows, 'manaDelay')).toBe('0.50s');
      expect(shown(weaponRows, 'twoHanded')).toBe('0%');
    });
    it('a skill effect adds up, per level taken', () => {
      const node = {
        id: 1,
        effects: [{ attr: 'WeaponCategoryDamageMod_TwoHand', value: 0.05, level: true }],
      };
      const t = { byId: new Map([[1, node]]) } as never;
      const fx = effectTotals(t, { 1: 3 });
      expect(fx['WeaponCategoryDamageMod_TwoHand']).toBeCloseTo(0.15);
      expect(shown(weaponRows, 'twoHanded', fx)).toBe('+15%');
      expect(shown(miscRows, 'reviveTime', { Revive_Delay_Base: -2 })).toBe('4s');
      expect(shown(regenRows, 'manaRegen', { Mana_Recharge: 10 })).toBe('15');
      expect(shown(damageRows, 'sneak', { DamageModSneak_Adder: 2 })).toBe('+1100%');
    });
    it('an item line adds to the base', () => {
      const bow: GearItem = { ...ring, stats: [stat('Critical Strike Chance', 3, 'Percentage')] };
      expect(shown(damageRows, 'critChance', {}, [bow])).toBe('8%');
    });
    it('no player data: only the items lines, "—" when none', () => {
      const d = def(damageRows, 'critChance');
      expect(rowValue(d, undefined, {}, statSums([ring]))).toBeNull();
      const line: GearItem = { ...ring, stats: [stat('Critical Strike Chance', 3, 'Percentage')] };
      expect(rowValue(d, undefined, {}, statSums([line]))).toBe(3);
    });
  });
  it('protection resistance: 0 % base and skill effects once the effects are known', () => {
    const rows = protection(c, [chest], { DamageSusceptibility_Fire: 0.1 });
    expect(rows.find((r) => r.kind === 'fire')?.resistance).toBe(10);
    expect(rows.find((r) => r.kind === 'blunt')?.resistance).toBe(0);
  });
  it("block and parry: the game's formulas (Attributes screen of 2026-11-08)", () => {
    // Riptide (block quality 0.25) at item level 16: "Bloquer 15", even with the two-handed sword in hand
    expect(blockPower(game, 0.25, 16)).toBe(15);
    expect(blockPower(game, 0.25, 21)).toBe(20);
    expect(blockPower({}, 0.25, 16)).toBeNull();
    // Ornate Greatsword (parry 0.7) at item level 16: 30 at the default world setting; the screen's 26 needs the
    // world's "enemy stamina" factor between 0.85 and 0.88
    expect(parryPower(game, 0.7, 16)).toBe(30);
    expect(parryPower(game, 0.7, 16, 0.85)).toBe(26);
    expect(parryPower(game, 1, 18)).toBe(51);
    expect(parryPower({}, 0.7, 16)).toBeNull();
    // 0.85..0.88 all give 26, no game preset has it (Default/Hard/Survival 1, Relaxed 0.5)
    for (const k of [0.84, 0.85, 0.88, 0.89, 0.5])
      expect([k, parryPower(game, 0.7, 16, k)]).toEqual([
        k,
        { 0.84: 25, 0.89: 27, 0.5: 15 }[k] ?? 26,
      ]);
  });

  it('world settings (enshrouded.exe): health/mana/stamina base, oxygen, Shroud, parry', () => {
    const a = {
      constitution: 6,
      spirit: 5,
      resistance: 3,
      strength: 11,
      dexterity: 3,
      intelligence: 3,
    };
    const sums = statSums([chest, ring]);
    const def = vitals(c, a, sums);
    // a default world (or an unknown key) changes nothing
    expect(vitals(c, a, sums, {}, { playerHealthFactor: 1 })).toEqual(def);
    expect(vitals(c, a, sums, {}, { playerHealthFactor: 'x' })).toEqual(def);
    // health x1.5: round((100 + 300) x 1.5) = 600, the items' 50 is not scaled
    const w = {
      playerHealthFactor: 1.5,
      playerManaFactor: 0.25,
      playerStaminaFactor: 2,
      playerDivingTimeFactor: 0.75,
    };
    const v = vitals(c, a, sums, {}, w);
    expect([v.health, v.mana, v.stamina, v.oxygen]).toEqual([650, 50, 260, 23]);
    const p = vitalParts(c, a, sums, {}, sums, w);
    expect(p.health.map((x) => [x.key, x.value])).toEqual([
      ['player', 150],
      ['equipment', 50],
      ['upgrades', 0],
      ['constitution', 450],
    ]);
    // Shroud: round((240 + 60 x Flame) s x factor)
    expect(shroudMinutes(1, 2)).toBe(10);
    expect(shroudMinutes(3, 1.5)).toBe(10.5);
    expect(shroudMinutes(11, 0.5)).toBe(7.5);
    // parry: the "enemy stamina" factor through the piece and the weapon guard
    const sword = { ...chest, lvl: [16, 16] as const, parry: 0.7 };
    expect(parryPoints(game, sword, 0.85)).toBe(26);
  });

  it('parry of a piece and rarity colours', () => {
    const helm = { ...chest, lvl: [15, 15] as const, parry: 0.19 };
    expect(parryPoints(game, helm)).toBe(7);
    expect(parryPoints(game, ring)).toBeNull();
    expect(rarityColor({ rare: '#123456' }, 'Rare')).toBe('#123456');
    expect(rarityColor(undefined, 'Epic')).toBe('#c58bff');
    expect(rarityColor(undefined, 'Weird')).toBeNull();
  });
});

describe('weapons', () => {
  const k = game;
  const axe: GearItem = {
    name: ['Hache', 'Axe'],
    slot: 'Weapon',
    rarity: 'Rare',
    lvl: [20, 20],
    type: 'TwoHandedAxe',
    damage: { mod: 1.5, speed: 1, hands: 2, attr: 'strength', types: { cut: 1 } },
    stats: [],
    upgrades: [],
  };
  const sword: GearItem = {
    ...axe,
    type: 'OneHandedSword',
    parry: 1,
    damage: { ...axe.damage!, mod: 1, hands: 1 },
  };
  const shield: GearItem = {
    ...axe,
    slot: 'Shield',
    type: undefined,
    damage: undefined,
    parry: 1,
    block: 0.25,
  };

  it("base damage is the game's trunc(seed x creep x L + seed), in float", () => {
    expect(weaponBaseDamage(k, 20)).toBe(40);
    expect(weaponBaseDamage(k, 1)).toBe(11);
    expect(weaponBaseDamage(k, 46)).toBe(79);
    expect(weaponBaseDamage({}, 46)).toBeNull();
  });

  it('damage = base x factor x attribute and class bonuses', () => {
    expect(weaponDamage(k, axe, 55, 0)).toEqual({
      base: 40,
      factor: 1.5,
      attr: 55,
      cls: 0,
      total: 93,
    });
    expect(weaponDamage(k, axe, 0, 10)!.total).toBe(66);
    expect(weaponDamage(k, shield, 55, 0)).toBeNull();
    expect(
      weaponClassPct(
        axe,
        { WeaponCategoryDamageMod_TwoHand: 1 },
        { WeaponCategoryDamageMod_TwoHand: 0.1 },
      ),
    ).toBe(10);
    expect(weaponClassPct(axe, undefined, {})).toBe(0);
  });

  it('the shield only goes with a one-handed weapon of a weapon slot', () => {
    const one = weaponGuard(k, 'weapon3', sword, shield);
    expect(one.shield).toBe(true);
    expect(one.by).toBe(shield);
    expect(one.parry).toBe(parryPoints(k, shield));
    expect(one.block).toBe(blockPoints(k, shield));
    // a two-handed weapon parries itself; the game still shows the shield's block
    const two = weaponGuard(k, 'weapon1', axe, shield);
    expect([two.shield, two.by, two.parry, two.block]).toEqual([false, axe, null, one.block]);
    expect(weaponGuard(k, 'ranged', sword, shield).by).toBe(sword);
    expect(weaponGuard(k, 'weapon1', sword, undefined).block).toBeNull();
  });

  it("upgrades of a weapon: the card's damage column and its damage perks (Ornate Greatsword, L 11 -> 16)", () => {
    const cut = { type: 'cut' as const, share: 0.1, label: null };
    const great: GearItem = {
      ...axe,
      lvl: [1, 11],
      upgrades: [0, 1, 2, 3, 4].map(() => ({ name: null, armor: {}, stats: [], damage: cut })),
    };
    // trunc(base x 1.5): 39 42 43.5 46.5 48 51 -> the card's +3 +1 +3 +2 +3
    expect([0, 1, 2, 3, 4].map((i) => rankDamage(k, great, i))).toEqual([3, 1, 3, 2, 3]);
    expect(perkDamage(k, upgraded(k, great, 5), 0.1)).toBe(5.1); // level 16: 10 % of 51
    expect(rankDamage({}, great, 0)).toBeNull();
    expect(perkDamage(k, shield, 0.1)).toBeNull();
  });
});

describe('frostSeconds', () => {
  const c = { freezeDurationFactor: 95, freezeDurationOffset: 75 };
  it('is 95 x resistance + 20 s at the default world', () => {
    expect(frostSeconds(c, 0)).toBe(20);
    expect(frostSeconds(c, 4)).toBe(400);
    expect(frostSeconds(c, 10)).toBe(970);
  });
  it('scales with the body heat factor and needs the constants', () => {
    expect(frostSeconds(c, 4, 0.5)).toBe(200);
    expect(frostSeconds({}, 4)).toBeNull();
  });
});

describe('restedMinutes', () => {
  it('matches the game formula (34 x ln(1 + 0.04 C) + 5 min)', () => {
    expect(restedMinutes(34, 0.04, 0)).toBeCloseTo(5, 3);
    expect(restedMinutes(34, 0.04, 10)).toBeCloseTo(16.44, 2);
    expect(restedMinutes(34, 0.04, 50)).toBeCloseTo(42.35, 2);
  });
  it('caps comfort at 255 and adds Well Rested', () => {
    expect(restedMinutes(34, 0.04, 9999)).toBeCloseTo(restedMinutes(34, 0.04, 255), 6);
    expect(restedMinutes(34, 0.04, 0, 11)).toBeCloseTo(11, 3);
  });
});
