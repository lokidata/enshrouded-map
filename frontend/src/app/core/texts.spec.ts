import { describe, expect, it } from 'vitest';
import { mergeTexts } from './texts';

describe('mergeTexts', () => {
  it('puts the texts of one language back, integer keys first', () => {
    const data = { b: { name: ['', '', ''] }, '2': { name: ['', '', ''], tags: ['x', 'y', 'z'] }, '1': { desc: ['', '', ''] } };
    mergeTexts(data, ['one', 'two', 'b-name'], 1, 3);
    expect(data['1'].desc).toEqual(['', 'one', '']);
    expect(data['2'].name).toEqual(['', 'two', '']);
    expect(data['2'].tags).toEqual(['x', 'y', 'z']);
    expect(data.b.name).toEqual(['', 'b-name', '']);
  });

  it('keeps the other languages already merged', () => {
    const data = [{ name: ['', '', ''] }];
    mergeTexts(data, ['fr'], 0, 3);
    mergeTexts(data, ['de'], 2, 3);
    expect(data[0].name).toEqual(['fr', '', 'de']);
  });

  it('leaves stat lines whole', () => {
    const data = { stats: [{ name: ['a', 'b', 'c'] }], name: ['', '', ''] };
    mergeTexts(data, ['x'], 0, 3);
    expect(data.stats[0].name).toEqual(['a', 'b', 'c']);
    expect(data.name).toEqual(['x', '', '']);
  });

  it('refuses texts that do not fit', () => {
    expect(() => mergeTexts([{ name: ['', '', ''] }], [], 0, 3)).toThrow();
  });
});
