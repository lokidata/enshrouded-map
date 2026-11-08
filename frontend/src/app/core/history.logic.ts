import { View } from './view.store';

/** Everything Back/Forward restores: the view, the workshop tab and what is open in it, the open enemy. */
export interface NavState {
  view: View;
  tab: string;
  item: string | null;
  station: string | null;
  set: string | null;
  enemy: string | null;
}

export const sameNav = (a: NavState, b: NavState): boolean =>
  a.view === b.view &&
  a.tab === b.tab &&
  a.item === b.item &&
  a.station === b.station &&
  a.set === b.set &&
  a.enemy === b.enemy;

/** A popped history state is only trusted when it has the shape we pushed. */
export function asNav(s: unknown): NavState | null {
  const o = s as { nav?: Partial<NavState> } | null;
  const n = o?.nav;
  return n && typeof n.view === 'string' && typeof n.tab === 'string' ? (n as NavState) : null;
}
