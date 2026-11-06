import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FilterStore } from './filter.store';
import { MapData } from './map-data.model';
import { MapDataService } from './map-data.service';

const data: MapData = {
  worldSize: 100,
  languages: ['fr', 'en'],
  biomes: {},
  categories: {
    boss: { label: ['Boss', 'Boss'], kind: 'icon', visible: true },
    chest: { label: ['Coffre', 'Chest'], kind: 'dots', visible: false },
  },
  markers: [
    { name: ['Alpha', 'Alpha'], raw: 'a', cat: 'boss', x: 1, y: 0, z: 1, fastTravel: false },
    { name: ['Bêta', 'Beta'], raw: 'b', cat: 'boss', x: 2, y: 0, z: 2, fastTravel: false },
  ],
};

function setup(): FilterStore {
  TestBed.configureTestingModule({});
  TestBed.inject(MapDataService).data = data;
  return TestBed.inject(FilterStore);
}

describe('FilterStore', () => {
  it('follows the category default until an element is changed', () => {
    const f = setup();
    expect(f.isShown('boss', 'Alpha\u0001Alpha')).toBe(true);
    expect(f.isShown('chest', 'x')).toBe(false);
    f.setShown('boss', 'Alpha\u0001Alpha', false);
    expect(f.overrides()).toEqual({ 'boss|Alpha\u0001Alpha': false });
    f.setShown('boss', 'Alpha\u0001Alpha', true);
    expect(f.overrides()).toEqual({}); // back to the default: nothing stored
  });

  it('hides and shows a whole category, and reports its state', () => {
    const f = setup();
    expect(f.cardState('boss')).toBe('all');
    f.setShown('boss', 'Bêta\u0001Beta', false);
    expect(f.cardState('boss')).toBe('some');
    f.setCategory('boss', false);
    expect(f.cardState('boss')).toBe('none');
    f.showAll();
    expect(f.cardState('boss')).toBe('all');
    f.hideAll();
    expect(f.cardState('boss')).toBe('none');
  });

  it('keeps a category choice for the elements added later', () => {
    const f = setup();
    f.setCategory('chest', true);
    expect(f.overrides()).toEqual({ 'chest|*': true });
    expect(f.isShown('chest', 'new element')).toBe(true);
    f.setShown('chest', 'old element', false);
    expect(f.overrides()).toEqual({ 'chest|*': true, 'chest|old element': false });
    f.setShown('chest', 'old element', true);
    expect(f.overrides()).toEqual({ 'chest|*': true }); // same as its category: nothing stored
    f.setCategory('chest', false); // back to the default: the exceptions go too
    expect(f.overrides()).toEqual({});
    f.showAll();
    expect(f.isShown('chest', 'another one')).toBe(true);
    f.hideAll();
    expect(f.isShown('boss', 'AlphaAlpha')).toBe(false);
    expect(f.overrides()).toEqual({ 'boss|*': false });
  });

  it('reads profiles saved before the category choices', () => {
    const f = setup();
    f.restore({ filters: { 'chest|old element': true } });
    expect(f.isShown('chest', 'old element')).toBe(true);
    expect(f.isShown('chest', 'new element')).toBe(false);
  });

  it('restores the saved format and ignores accents and case when searching', () => {
    const f = setup();
    f.restore({ filters: { 'boss|Alpha\u0001Alpha': false } });
    expect(f.isShown('boss', 'Alpha\u0001Alpha')).toBe(false);
    f.query.set('  BETA ');
    expect(f.matchesText('Bêta')).toBe(true);
    expect(f.matchesText('Alpha')).toBe(false);
    f.reset();
    expect(f.overrides()).toEqual({});
  });
});
