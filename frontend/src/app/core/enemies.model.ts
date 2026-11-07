import { Sources } from './craft.model';
import { Names } from './map-data.model';

/** Format of enemies.json, written by pipeline/build_enemies.py. */
export interface Enemy {
  id: string;
  name: Names;
  boss: boolean;
  /** The picture of its head or trophy item; null when the game has none. */
  image: string | null;
  /** Key of EnemiesData.factions. */
  faction: string | null;
  /** Experience multiplier. */
  xp: number | null;
  /** Name of its head or trophy item. */
  trophy: Names | null;
  /** Named areas nearest to where it stands. */
  places: readonly Names[];
  /** Extra health per extra player, 0.6 = +60%. */
  scaling: number | null;
  /** Keys of EnemiesData.regions. */
  regions: readonly string[];
  /** Number of places where it stands on the map. */
  spots: number;
  sources?: Sources;
}

export interface EnemiesData {
  factions: Record<string, Names>;
  regions: Record<string, Names>;
  enemies: readonly Enemy[];
}
