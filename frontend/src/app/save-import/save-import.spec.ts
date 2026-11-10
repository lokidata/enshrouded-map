import { describe, expect, it } from 'vitest';
import { readKnowledge, guidId } from './knowledge';
import { KsdError, readKsd } from './ksd';
import { FOG_SIZE, fogShare, readFog, veilPixels } from './fog';
import { fresh, propose } from './save-import.logic';

const enc = new TextEncoder();

/** A tiny save with stored (not compressed) sections, built from the format notes. */
function makeKsd(sections: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(sections);
  const table = 0x30;
  let namesAt = table + 20 * names.length;
  const blocks: Uint8Array[] = [];
  const total = () => namesAt + names.reduce((n, x) => n + x.length, 0);
  let at = total();
  const out: number[] = [];
  const entries = names.map((name, i) => {
    const block = new Uint8Array(14 + sections[name].length);
    block.set(enc.encode('S2BH'), 0);
    block.set(sections[name], 14);
    blocks.push(block);
    const entry = {
      nameRel: namesAt - (table + 20 * i),
      nameLen: name.length,
      off: at,
      size: block.length,
    };
    namesAt += name.length;
    at += block.length;
    return entry;
  });
  const file = new Uint8Array(at);
  const v = new DataView(file.buffer);
  file.set(enc.encode('SV2C'), 0);
  v.setUint32(0x28, table - 0x28, true);
  v.setUint32(0x2c, names.length, true);
  let nameAt = table + 20 * names.length;
  entries.forEach((e, i) => {
    const p = table + 20 * i;
    v.setUint32(p, e.nameRel, true);
    v.setUint32(p + 4, e.nameLen, true);
    v.setUint32(p + 8, e.off, true);
    v.setUint32(p + 12, e.size, true);
    file.set(enc.encode(names[i]), nameAt);
    nameAt += names[i].length;
    file.set(blocks[i], e.off);
  });
  void out;
  return file;
}

function knowledge(entries: [number, number][]): Uint8Array {
  const b = new Uint8Array(8 + 8 * entries.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 1, true);
  v.setUint32(4, entries.length, true);
  entries.forEach(([id, flags], i) => {
    v.setUint32(8 + 4 * i, id, true);
    v.setUint32(8 + 4 * (entries.length + i), flags, true);
  });
  return b;
}

describe('ksd', () => {
  it('reads the sections of a save', () => {
    const k = knowledge([[7, 1]]);
    const s = readKsd(makeKsd({ player_knowledge: k, other: new Uint8Array([1, 2, 3]) }));
    expect([...s.keys()]).toEqual(['player_knowledge', 'other']);
    expect(readKnowledge(s.get('player_knowledge')!).get(7)).toBe(1);
  });

  it('refuses files that are not saves or are cut short', () => {
    expect(() => readKsd(new Uint8Array(100))).toThrow(KsdError);
    const good = makeKsd({ a: new Uint8Array(20) });
    expect(() => readKsd(good.subarray(0, good.length - 5))).toThrow(KsdError);
    const bad = knowledge([[1, 1]]).subarray(0, 12);
    expect(() => readKnowledge(bad)).toThrow(KsdError);
  });
});

describe('ids', () => {
  it('hashes a GUID like the pipeline (FNV-1a of its little-endian bytes)', () => {
    expect(guidId('f3bedfba-bea3-45d4-9ca1-a4019f93c4a7')).toBe(2390259004);
    expect(guidId('not a guid')).toBe(-1);
  });
});

describe('propose', () => {
  const g = 'f3bedfba-bea3-45d4-9ca1-a4019f93c4a7';
  const craft = { recipes: [{ id: g }], blocks: [{ id: '00000000-0000-0000-0000-000000000001' }] };
  const lore = {
    quests: [{ id: '2270544693' }, { id: '5' }],
    notes: [{ id: '77', pages: [{ kid: 900 }, { kid: 901 }, {}] }],
  };

  it('maps recipes, blocks and quests, and counts the rest', () => {
    const known = new Map([
      [2390259004, 1],
      [2270544693, 1],
      [5, 0], // flag 0: not known
      [99, 1], // matches nothing of ours
      [901, 1], // the second page of note 77
    ]);
    const p = propose(known, craft as never, lore as never);
    expect(p.marks.recipe).toEqual([`recipe:${g}`]);
    expect(p.marks.quest).toEqual(['quest:2270544693']);
    expect(p.marks.lore).toEqual(['lore:77:1']);
    expect(p.unmatched).toBe(1);
  });

  it('ticks discovered places and single-place items picked up', () => {
    const item = '11111111-1111-4111-8111-111111111111';
    const markers = [
      { cat: 'poi', x: 10, z: 20, kids: [5, 6] }, // known through its second id
      { cat: 'poi', x: 30, z: 40, kids: [7] }, // unknown
      { cat: 'unique', x: 50, z: 60, item }, // picked up (flag 1 | 4)
      { cat: 'cosmetic', x: 70, z: 80, item: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, // inspected only (4)
    ];
    const known = new Map([
      [6, 1],
      [guidId(item), 5],
      [guidId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 4],
    ]);
    const p = propose(known, null, null, markers as never);
    expect(p.marks.place).toEqual(['poi:10:20']);
    expect(p.marks.item).toEqual(['unique:50:60']);
  });

  it('works without data, and fresh() leaves out what is marked', () => {
    expect(propose(new Map([[1, 1]]), null, null)).toEqual({
      marks: { recipe: [], quest: [], lore: [], place: [], item: [] },
      unmatched: 1,
    });
    expect(fresh(['a', 'b'], new Set(['a']))).toEqual(['b']);
  });
});

describe('fog of war', () => {
  const header = new Uint8Array([5, 0, 25, 0, 0, 0, 0, 0, ...new TextEncoder().encode('FGOW'), 2]);

  it('reads the grid, its share and the veil', () => {
    const data = new Uint8Array(13 + FOG_SIZE * FOG_SIZE);
    data.set(header, 0);
    data.fill(255, 13, 13 + (FOG_SIZE * FOG_SIZE) / 4); // a quarter explored
    const cells = readFog(data);
    expect(cells.length).toBe(FOG_SIZE * FOG_SIZE);
    expect(fogShare(cells)).toBeCloseTo(0.25);
    const px = veilPixels(cells);
    expect(px[3]).toBe(0); // seen: clear
    expect(px[px.length - 1]).toBe(153); // unseen: 60 % veil
    expect(() => readFog(new Uint8Array(100))).toThrow(KsdError);
  });
});
