import { describe, expect, it } from 'vitest';
import { listMarkers } from './markers.list';

const m = (id: number, name: string, note = '') => ({ id, name, note });
const all = [m(1, 'Zèbre'), m(2, 'base', 'près du Lac'), m(3, 'Alpha'), m(4, 'alpha')];

describe('listMarkers', () => {
  it('sorts by name, ignoring case, ties by id', () => {
    expect(listMarkers(all, '').map((x) => x.id)).toEqual([3, 4, 2, 1]);
  });

  it('searches the name and the note, ignoring accents and case', () => {
    expect(listMarkers(all, 'zebre').map((x) => x.id)).toEqual([1]);
    expect(listMarkers(all, ' LAC ').map((x) => x.id)).toEqual([2]);
    expect(listMarkers(all, 'nothing')).toEqual([]);
  });

  it('does not change the list it is given', () => {
    const copy = [...all];
    listMarkers(all, 'a');
    expect(all).toEqual(copy);
  });
});
