import { Names } from './map-data.model';

export interface Section {
  label: Names;
  color: string;
  cats: string[];
}

/** Menu layout; categories missing here end up in the last section. */
export const SECTIONS: Section[] = [
  {
    label: ['Flamme', 'Flame'],
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
    label: ['Ennemis', 'Enemies'],
    color: '#cf5345',
    cats: ['boss', 'elite', 'enemyCamp', 'balefire', 'summon'],
  },
  {
    label: ['Donjons', 'Dungeons'],
    color: '#8a77ea',
    cats: ['dungeon', 'dungeonEntrance', 'bigDungeon', 'hiddenGrave'],
  },
  {
    label: ['Lieux', 'Places'],
    color: '#b3ab99',
    cats: ['landmark', 'cave', 'camp', 'farm', 'mine', 'poi'],
  },
  {
    label: ['Butin', 'Loot'],
    color: '#d1913f',
    cats: ['unique', 'cosmetic', 'collectible', 'chest'],
  },
  { label: ['Brume', 'Shroud'], color: '#c95aa6', cats: ['shroudRoot', 'elixirWell'] },
  { label: ['Ressources', 'Resources'], color: '#5fb08c', cats: ['plant', 'ore'] },
  { label: ['Carte', 'Map'], color: '#8592a3', cats: ['region', 'areaName', 'hidden'] },
];
