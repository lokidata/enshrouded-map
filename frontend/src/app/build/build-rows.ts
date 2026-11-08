/** The rows of the Build screen (Bases / Damage tabs): base values of the player template, plus skills and worn items (see `rowValue`). */
import { RowDef } from '../core/gear.logic';
import { GearStat } from '../core/gear.model';

export type Format = GearStat['format'];
export const TABS = ['bases', 'damage', 'protection'] as const;
export type Tab = (typeof TABS)[number];

/** A percentage row: the attribute is a multiplier (1 = +0 %) unless `sub` is 0. */
const pct = (
  key: string,
  names: string | undefined,
  attr: string,
  text: string,
  o: Partial<RowDef> = {},
): RowDef => ({
  key,
  names: names ? [names] : [],
  format: 'Percentage',
  attr,
  sub: 1,
  k: 100,
  text,
  ...o,
});
const regen = (key: string, name: string, attr: string, text: string): RowDef => ({
  key,
  names: [name],
  format: 'Normal',
  attr,
  text,
  est: true, // the game adds food and the Rested buff
  plain: true,
});
const delay = (key: string, name: string, attr: string, text: string): RowDef => ({
  key,
  names: [name],
  format: 'DurationMilliseconds',
  attr,
  k: 0.001,
  text,
});

export const regenRows: RowDef[] = [
  regen('healthRegen', 'Health Regeneration', 'Health_Recharge', 'healthRegeneration'),
  delay(
    'healthDelay',
    'Health Regeneration Delay',
    'Health_RechargeTimeout',
    'healthRegenerationDelay',
  ),
  regen('manaRegen', 'Mana Regeneration', 'Mana_Recharge', 'manaRegeneration'),
  delay('manaDelay', 'Mana Regeneration Delay', 'Mana_RechargeTimeout', 'manaRegenerationDelay'),
  regen('staminaRegen', 'Stamina Regeneration', 'Stamina_Recharge', 'staminaRegeneration'),
  delay(
    'staminaDelay',
    'Stamina Regeneration Delay',
    'Stamina_RechargeTimeout',
    'staminaRegenerationDelay',
  ),
];
export const miscRows: RowDef[] = [
  pct('healing', 'Healing', 'HealingMod_Base', 'healing', { fx: ['HealingMod_Adder'] }),
  {
    key: 'reviveTime',
    names: ['Revive Duration'],
    format: 'Duration',
    attr: 'Revive_Delay_Base',
    text: 'reviveDuration',
  },
  pct('reviveHeal', 'Revive Heal Percentage', 'Revive_Healing_Percentage', 'reviveHealth', {
    sub: 0,
  }),
  { key: 'frost', names: ['Frost Resistance'], format: 'Normal', text: 'freezeResistance' },
  {
    key: 'wet',
    names: ['Wet Duration Reduction'],
    format: 'Duration',
    attr: 'WetDurationReduction',
    text: 'wetDurationReduction',
  },
];
export const damageRows: RowDef[] = [
  pct('critDamage', 'Critical Strike Damage', 'CritDamageMod_Base', 'offenseCritical', {
    sub: 0,
    fx: [],
  }),
  pct('critChance', 'Critical Strike Chance', 'CritChance_Base', 'offenseCritChance', {
    sub: 0,
    fx: [],
    plain: true,
  }),
  pct('critMelee', 'Melee Critical Strike Chance', 'CritChance_Adder_Melee', 'critChanceMelee', {
    sub: 0,
    alt: true,
    plain: true,
  }),
  pct(
    'critMagic',
    'Magical Critical Strike Chance',
    'CritChance_Adder_Magic',
    'critChanceMagical',
    { sub: 0, alt: true, plain: true },
  ),
  pct(
    'critRanged',
    'Ranged Critical Strike Chance',
    'CritChance_Adder_Ranged',
    'critChanceRanged',
    { sub: 0, alt: true, plain: true },
  ),
  pct('sneak', 'Sneak Attack Damage', 'DamageModSneak_Base', 'sneakAttack', {
    fx: ['DamageModSneak_Adder'],
  }),
  pct('merciless', 'Merciless Attack Damage', 'DamageModMerciless_Base', 'mercilessAttack', {
    fx: ['DamageModMerciless_Adder'],
  }),
  // multiplier 1.1 = +10 %; Backstab Mastery adds its percentage
  pct('backstab', 'Backstab Damage', 'DamageModBackstab_Multiplier', 'offenseBackstab', {
    fx: ['DamageModBackstab_Adder'],
  }),
  pct('skillshot', 'Skillshot Damage', 'DamageModSkillShot_Base', 'skillShotDamage', {
    fx: ['DamageModSkillShot_Adder'],
  }),
];
export const againstRows: RowDef[] = [
  pct('vsMagical', 'Damage against Magical enemies', 'DamageModAgainst_Mage', 'foeMagicalDamage', {
    alt: true,
  }),
  pct('vsMelee', 'Damage against Melee enemies', 'DamageModAgainst_Melee', 'foeMeleeDamage', {
    alt: true,
  }),
  pct('vsRanged', 'Damage against Ranged enemies', 'DamageModAgainst_Ranged', 'foeRangedDamage', {
    alt: true,
  }),
  pct('vsFlying', 'Damage against Flying enemies', 'DamageModAgainst_Flying', 'foeFlyingDamage', {
    alt: true,
  }),
  pct(
    'vsHollow',
    'Damage against Hollow',
    'DamageModAgainst_Faction_Skeleton',
    'foeSkeletonDamage',
    { alt: true },
  ),
  pct('vsDrak', 'Damage against Drak', 'DamageModAgainst_Faction_Drak', 'foeDrakDamage', {
    alt: true,
  }),
  pct('vsFell', 'Damage against Fell', 'DamageModAgainst_Faction_Fogger', 'foeFellDamage', {
    alt: true,
  }),
  pct(
    'vsScavenger',
    'Damage against Scavenger',
    'DamageModAgainst_Faction_Scavenger',
    'foeScavengerDamage',
    { alt: true },
  ),
  pct('vsVukah', 'Damage against Vukah', 'DamageModAgainst_Faction_Vukah', 'foeVukahDamage', {
    alt: true,
  }),
  pct(
    'vsWildlife',
    'Damage against Wildlife and Wildbeasts',
    'DamageModAgainst_Faction_Wildlife_Wildbeast',
    'foeWildlifeDamage',
    { alt: true },
  ),
];
export const weaponRows: RowDef[] = [
  pct('oneHanded', 'One-Handed Melee Damage', 'WeaponCategoryDamageMod_Single', 'oneHandDamage', {
    alt: true,
  }),
  pct('twoHanded', 'Two-Handed Melee Damage', 'WeaponCategoryDamageMod_TwoHand', 'twoHandDamage', {
    alt: true,
  }),
  pct(
    'greatsword',
    'Greatsword Damage',
    'WeaponCategoryDamageMod_GreatSword',
    'twoHandedGreatswordDamage',
    { alt: true },
  ),
  pct('staff', 'Staff Damage', 'WeaponCategoryDamageMod_Staff', 'staffDamage', { alt: true }),
  pct('wand', 'Wand Damage', 'WeaponCategoryDamageMod_Wand', 'wandDamage', { alt: true }),
  pct('bow', 'Bow Damage', 'WeaponCategoryDamageMod_Bow', 'bowDamage', { alt: true }),
  pct('dagger', 'Dagger Damage', 'WeaponCategoryDamageMod_Dagger', 'daggerDamage', { alt: true }),
  pct('thrown', undefined, 'WeaponCategoryDamageMod_Throwable', 'throwableDamage', { alt: true }),
  pct('unarmed', 'Unarmed Melee Damage', 'WeaponCategoryDamageMod_Unarmed', 'unarmedDamage', {
    alt: true,
  }),
  // by damage kind: the melee multipliers (the skills raise the ranged and magic ones alike)
  pct('blunt', 'All Blunt Damage', 'MeleeDamageMod_Physical_Blunt', 'magicDamageBlunt'),
  pct('cutting', 'All Cut Damage', 'MeleeDamageMod_Physical_Cut', 'magicDamageCut'),
  pct('piercing', undefined, 'MeleeDamageMod_Physical_Pierce', 'magicDamagePierce'),
  pct('fire', 'All Magic Fire Damage', 'MeleeDamageMod_Magical_Fire', 'magicDamageFire'),
  pct('ice', 'All Magic Ice Damage', 'MeleeDamageMod_Magical_Ice', 'magicDamageIce'),
  pct(
    'shock',
    'All Magic Shock Damage',
    'MeleeDamageMod_Magical_Lightning',
    'magicDamageLightning',
  ),
  pct('shroud', 'All Magic Shroud Damage', 'MeleeDamageMod_Magical_Fog', 'magicDamageFog'),
];

/** A row's value as the game writes it: +150%, 5%, 0%, 6s, 0.50s, 25. */
export function formatRow(value: number | null, d: RowDef): string {
  if (value === null) return '—';
  switch (d.format) {
    case 'Percentage':
      return `${value > 0 && !d.plain ? '+' : ''}${value}%`;
    case 'DurationMilliseconds':
      return `${value.toFixed(2)}s`;
    case 'Duration':
      return `${value}s`;
    default:
      return d.plain ? `${value}` : `+${value}`;
  }
}
