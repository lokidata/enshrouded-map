/** Dedicated-server game settings (docs/server-settings.md, official article 0.9.0.0, corrected with the game's own ranges from settings-presets.json). */
export type SettingValue = number | string | boolean;
export interface Text {
  fr: string;
  en: string;
}
export type GroupId =
  'player' | 'survival' | 'world' | 'daynight' | 'resources' | 'xp' | 'enemies' | 'bosses';
export type Preset = 'Default' | 'Relaxed' | 'Hard' | 'Survival' | 'Custom';

export interface SettingDef {
  key: string;
  /** `duration`: stored in nanoseconds, edited in minutes (min/max are minutes). */
  kind: 'number' | 'enum' | 'boolean' | 'duration';
  /** Default as written in the file (nanoseconds for a duration). */
  def: SettingValue;
  min?: number;
  max?: number;
  options?: readonly string[];
  group: GroupId;
  label: Text;
  help?: Text;
  /** Whole numbers only. */
  int?: boolean;
}

export const GROUPS: readonly GroupId[] = [
  'player',
  'survival',
  'world',
  'daynight',
  'resources',
  'xp',
  'enemies',
  'bosses',
];
export const PRESETS: readonly Preset[] = ['Default', 'Relaxed', 'Hard', 'Survival', 'Custom'];
export const NS_PER_MIN = 60_000_000_000;

const num = (
  key: string,
  group: GroupId,
  min: number,
  max: number,
  fr: string,
  en: string,
  help?: Text,
  def = 1,
): SettingDef => ({ key, kind: 'number', def, min, max, group, label: { fr, en }, help });
const opt = (
  key: string,
  group: GroupId,
  def: string,
  options: string[],
  fr: string,
  en: string,
  help?: Text,
): SettingDef => ({ key, kind: 'enum', def, options, group, label: { fr, en }, help });
const bool = (key: string, group: GroupId, def: boolean, fr: string, en: string): SettingDef => ({
  key,
  kind: 'boolean',
  def,
  group,
  label: { fr, en },
});
const dur = (
  key: string,
  group: GroupId,
  minutes: number,
  min: number,
  max: number,
  fr: string,
  en: string,
): SettingDef => ({
  key,
  kind: 'duration',
  def: minutes * NS_PER_MIN,
  min,
  max,
  group,
  label: { fr, en },
});
const noBoss: Text = { fr: 'Ne concerne pas les boss.', en: 'Does not apply to bosses.' };

export const SETTINGS: readonly SettingDef[] = [
  num('playerHealthFactor', 'player', 0.25, 4, 'Santé des joueurs', 'Player health'),
  num('playerManaFactor', 'player', 0.25, 4, 'Mana des joueurs', 'Player mana'),
  num('playerStaminaFactor', 'player', 0.25, 4, 'Endurance des joueurs', 'Player stamina'),
  num('playerBodyHeatFactor', 'player', 0.5, 2, 'Chaleur corporelle', 'Player body heat', {
    fr: 'Bas 0,5, défaut 1, haut 1,5, max 2.',
    en: 'Low 0.5, default 1, high 1.5, max 2.',
  }),
  num('playerDivingTimeFactor', 'player', 0.75, 2, 'Temps de plongée', 'Diving time'),
  num('shroudTimeFactor', 'player', 0.5, 2, 'Temps dans la Brume', 'Time in the Shroud'),
  opt(
    'tombstoneMode',
    'player',
    'AddBackpackMaterials',
    ['AddBackpackMaterials', 'Everything', 'NoTombstone'],
    'Pierre tombale',
    'Tombstone',
  ),
  bool('enableGliderTurbulences', 'player', true, 'Turbulences du deltaplane', 'Glider turbulence'),

  bool('enableDurability', 'survival', true, 'Durabilité des objets', 'Item durability'),
  bool('enableStarvingDebuff', 'survival', false, 'Malus de famine', 'Starving debuff'),
  num(
    'foodBuffDurationFactor',
    'survival',
    0.5,
    2,
    'Durée des bonus de nourriture',
    'Food buff duration',
  ),
  dur(
    'fromHungerToStarving',
    'survival',
    10,
    5,
    20,
    'De la faim à la famine',
    'From hunger to starving',
  ),
  opt('curseModifier', 'survival', 'Normal', ['Easy', 'Normal', 'Hard'], 'Malédiction', 'Curse', {
    fr: 'Easy : désactivée. Hard : chance doublée.',
    en: 'Easy: off. Hard: double chance.',
  }),

  opt(
    'weatherFrequency',
    'world',
    'Normal',
    ['Disabled', 'Rare', 'Normal', 'Often'],
    'Fréquence de la météo',
    'Weather frequency',
  ),
  opt(
    'fishingDifficulty',
    'world',
    'Normal',
    ['VeryEasy', 'Easy', 'Normal', 'Hard', 'VeryHard'],
    'Difficulté de la pêche',
    'Fishing difficulty',
  ),
  {
    ...num(
      'flameLevelFogRemoval',
      'world',
      1,
      11,
      'Niveau de Flamme pour dissiper la Brume',
      'Flame level to clear the fog',
      { fr: 'Absent de l’article ; valeurs du jeu.', en: 'Not in the article; the game’s values.' },
      11,
    ),
    int: true,
  },
  dur('dayTimeDuration', 'daynight', 30, 2, 60, 'Durée du jour', 'Day length'),
  dur('nightTimeDuration', 'daynight', 12, 2, 60, 'Durée de la nuit', 'Night length'),

  num('miningDamageFactor', 'resources', 0.5, 2, 'Dégâts de minage', 'Mining damage'),
  num('plantGrowthSpeedFactor', 'resources', 0.25, 2, 'Pousse des plantes', 'Plant growth speed'),
  num(
    'resourceDropStackAmountFactor',
    'resources',
    0.25,
    2,
    'Quantité de ressources lâchées',
    'Resource drop amount',
  ),
  num(
    'factoryProductionSpeedFactor',
    'resources',
    0.25,
    2,
    'Vitesse de production',
    'Production speed',
  ),
  num(
    'perkUpgradeRecyclingFactor',
    'resources',
    0,
    1,
    'Recyclage des améliorations',
    'Upgrade recycling',
    {
      fr: 'Le fichier 0.9.0.0 donne 0,5 ; le texte de l’article dit 0,1.',
      en: 'The 0.9.0.0 file says 0.5; the article text says 0.1.',
    },
    0.5,
  ),
  num('perkCostFactor', 'resources', 0.25, 2, 'Coût des talents', 'Perk cost'),

  num('experienceCombatFactor', 'xp', 0.25, 2, 'XP de combat', 'Combat XP'),
  num('experienceMiningFactor', 'xp', 0, 2, 'XP de minage', 'Mining XP'),
  num(
    'experienceExplorationQuestsFactor',
    'xp',
    0.25,
    2,
    'XP d’exploration et de quêtes',
    'Exploration and quest XP',
  ),

  opt(
    'randomSpawnerAmount',
    'enemies',
    'Automatic',
    ['Automatic', 'Few', 'Normal', 'Many', 'Extreme'],
    'Apparitions aléatoires',
    'Random spawns',
  ),
  opt(
    'aggroPoolAmount',
    'enemies',
    'Normal',
    ['Few', 'Normal', 'Many', 'Extreme'],
    'Groupes d’ennemis agressifs',
    'Aggro pool',
  ),
  num('enemyDamageFactor', 'enemies', 0.25, 2.5, 'Dégâts des ennemis', 'Enemy damage', noBoss),
  num('enemyHealthFactor', 'enemies', 0.25, 4, 'Santé des ennemis', 'Enemy health', noBoss),
  num('enemyStaminaFactor', 'enemies', 0.5, 2, 'Endurance des ennemis', 'Enemy stamina', {
    fr: 'Résistance à l’étourdissement. Ne concerne pas les boss.',
    en: 'Stun resistance. Does not apply to bosses.',
  }),
  num(
    'enemyPerceptionRangeFactor',
    'enemies',
    0.5,
    2,
    'Perception des ennemis',
    'Enemy perception range',
    noBoss,
  ),
  num('threatBonus', 'enemies', 0.25, 4, 'Fréquence des attaques', 'Attack frequency', noBoss),
  bool('pacifyAllEnemies', 'enemies', false, 'Ennemis pacifiés', 'Pacify all enemies'),
  opt(
    'tamingStartleRepercussion',
    'enemies',
    'LoseSomeProgress',
    ['KeepProgress', 'LoseSomeProgress', 'LoseAllProgress'],
    'Apprivoisement : effarouchement',
    'Taming: startled animal',
  ),

  num('bossDamageFactor', 'bosses', 0.2, 5, 'Dégâts des boss', 'Boss damage'),
  num('bossHealthFactor', 'bosses', 0.2, 4, 'Santé des boss', 'Boss health'),
];

/**
 * The default enshrouded_server.json minus gameSettings. Group names, flags and the placeholder
 * passwords are the default file's (typed from memory of 0.9.0.0, check them against a real file):
 * the passwords are NOT secrets and must be changed.
 */
export const DEFAULT_SERVER = {
  name: 'Enshrouded Server',
  saveDirectory: './savegame',
  logDirectory: './logs',
  ip: '0.0.0.0',
  queryPort: 15637,
  slotCount: 16,
  tags: [] as unknown[],
  voiceChatMode: 'Proximity',
  enableVoiceChat: false,
  enableTextChat: false,
  gameSettingsPreset: 'Default',
  userGroups: [
    group('Admin', 'XXXXXXXX', true, true, true, true, true),
    group('Friend', 'XXXXXXXY', false, true, true, true, false),
    group('Guest', 'XXXXXXXZ', false, false, true, true, false),
    group('Visitor', 'XXXXXXXW', false, false, false, false, false),
  ] as unknown[],
  bans: [] as unknown[],
};
export const MAX_SLOTS = 16;
/** Top-level keys the user edits in the page or that come from gameSettings. */
export const OWN_KEYS = ['name', 'slotCount', 'gameSettingsPreset', 'gameSettings'];

function group(
  name: string,
  password: string,
  canKickBan: boolean,
  canAccessInventories: boolean,
  canEditWorld: boolean,
  canEditBase: boolean,
  canExtendBase: boolean,
) {
  return {
    name,
    password,
    canKickBan,
    canAccessInventories,
    canEditWorld,
    canEditBase,
    canExtendBase,
    reservedSlots: 0,
  };
}
