import { Names } from './map-data.model';

/** Format of lore.json, written by pipeline/build_lore.py. */
export interface LorePage {
  name: Names;
  text: Names;
}

export interface LoreNote {
  id: string;
  name: Names;
  /** Key of LoreData.categories; null for the notes the game puts in no category. */
  cat: string | null;
  pages: readonly LorePage[];
}

export interface LoreQuest {
  id: string;
  name: Names;
  /** Key of LoreData.givers. */
  giver: string | null;
  main: boolean;
  steps: readonly LorePage[];
  /** Guids of LoreData.items. */
  rewards: readonly string[];
}

export interface LoreData {
  categories: Record<string, Names>;
  notes: readonly LoreNote[];
  quests: readonly LoreQuest[];
  givers: Record<string, { name: Names; region: boolean }>;
  items: Record<string, { name: Names; icon: string | null }>;
}
