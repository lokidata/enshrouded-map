/** A text per language code; a language without one shows the English text. */
export type LabelByLang = Record<string, string> & { en: string };

export interface Section {
  label: LabelByLang;
  color: string;
  cats: string[];
}

/** Menu layout; categories missing here end up in the last section. */
export const SECTIONS: Section[] = [
  {
    label: { fr: 'Flamme', en: 'Flame', de: 'Flamme' },
    color: '#d9a43c',
    cats: [
      'fastTravel',
      'flameShrine',
      'nightTemple',
      'gemForge',
      'obelisk',
      'flameAltar',
      'start',
    ],
  },
  {
    label: { fr: 'Ennemis', en: 'Enemies', de: 'Gegner' },
    color: '#cf5345',
    cats: ['boss', 'elite', 'enemyCamp', 'balefire', 'summon'],
  },
  {
    label: { fr: 'Donjons', en: 'Dungeons', de: 'Verliese' },
    color: '#8a77ea',
    cats: ['dungeon', 'dungeonEntrance', 'bigDungeon', 'hiddenGrave'],
  },
  {
    label: { fr: 'Lieux', en: 'Places', de: 'Orte' },
    color: '#b3ab99',
    cats: ['landmark', 'cave', 'camp', 'farm', 'mine', 'poi'],
  },
  {
    label: { fr: 'Butin', en: 'Loot', de: 'Beute' },
    color: '#d1913f',
    cats: ['unique', 'cosmetic', 'palette', 'hairstyle', 'haircolor', 'eyecolor', 'collectible', 'chest'],
  },
  { label: { fr: 'Brume', en: 'Shroud', de: 'Miasma' }, color: '#c95aa6', cats: ['shroudRoot', 'elixirWell'] },
  { label: { fr: 'Ressources', en: 'Resources', de: 'Ressourcen' }, color: '#5fb08c', cats: ['plant', 'ore'] },
  { label: { fr: 'Carte', en: 'Map', de: 'Karte' }, color: '#8592a3', cats: ['region', 'areaName'] },
];

export const sectionLabel = (s: Section, lang: string): string => s.label[lang] ?? s.label.en;
