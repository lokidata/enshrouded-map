import { describe, expect, it } from 'vitest';
import { readKnowledge, guidId } from './knowledge';
import { KsdError, readKsd } from './ksd';
import {
  FOG_BYTES,
  FOG_SIZE,
  bitsToCells,
  cellsFromVeil,
  cellsToBits,
  fogShare,
  fromBase64,
  isExplored,
  readFog,
  toBase64,
  unionCells,
  veilPixels,
} from './fog';
import { characterNumber, forgetImport, lastImport, rememberImport } from './import-history';
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

  it('stops when the sections together are too big', () => {
    const two = makeKsd({ a: new Uint8Array(100), b: new Uint8Array(100) });
    expect(readKsd(two, 200).size).toBe(2);
    expect(() => readKsd(two, 150)).toThrow(KsdError);
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

describe('explored area', () => {
  const size = 10240;
  const cells = new Uint8Array(FOG_SIZE * FOG_SIZE);
  cells.fill(255, 0, 100 * FOG_SIZE); // the 100 northern rows are explored

  it('reads the grid north-up: row 0 is the northern edge (z = size)', () => {
    expect(isExplored(cells, 4, size - 4, size)).toBe(true);
    expect(isExplored(cells, 4, 4, size)).toBe(false); // the south
    expect(isExplored(cells, -5, size - 4, size)).toBe(false); // outside the world
    expect(isExplored(cells, 4, size + 50, size)).toBe(false);
  });

  it('gets the cells back from the veil it was drawn as', () => {
    const back = cellsFromVeil(veilPixels(cells));
    expect(back[0]).toBeGreaterThanOrEqual(250);
    expect(back[back.length - 1]).toBeLessThan(10);
    expect(isExplored(back, 4, size - 4, size)).toBe(true);
  });
});

describe('import history', () => {
  it('names the character slot of a save file', () => {
    expect(characterNumber('character3.ksd')).toBe(3);
    expect(characterNumber('world0.ksd')).toBeNull();
  });

  it('keeps one entry per profile and survives bad or blocked storage', () => {
    forgetImport();
    expect(lastImport(1)).toBeNull();
    rememberImport(1, { name: 'character1.ksd', at: '2026-11-10T10:00:00Z', counts: { quest: 3 } });
    rememberImport(2, { name: 'character2.ksd', at: '2026-11-10T11:00:00Z', counts: { quest: 5 } });
    expect(lastImport(1)?.counts.quest).toBe(3);
    expect(lastImport(2)?.name).toBe('character2.ksd');
    forgetImport(1);
    expect(lastImport(1)).toBeNull();
    expect(lastImport(2)).not.toBeNull();
    localStorage.setItem('lastImport:2', '{bad');
    expect(lastImport(2)).toBeNull();
    forgetImport();
    expect(localStorage.getItem('lastImport:2')).toBeNull();
  });
});

describe('shared explored area', () => {
  const cells = new Uint8Array(FOG_SIZE * FOG_SIZE);
  for (const i of [0, 7, 8, 1000, FOG_SIZE * FOG_SIZE - 1]) cells[i] = 255;

  it('packs a bit per cell and gets the same cells back', () => {
    const bits = cellsToBits(cells);
    expect(bits.length).toBe(FOG_BYTES);
    expect(bits[0]).toBe(0b10000001); // cells 0 and 7
    expect(bits[1]).toBe(0b00000001); // cell 8
    expect(bitsToCells(bits)).toEqual(cells);
  });

  it('keeps a bit only from half seen, and is the same text both ways', () => {
    const soft = new Uint8Array(FOG_SIZE * FOG_SIZE);
    soft[3] = 127;
    soft[4] = 128;
    expect(cellsToBits(soft)[0]).toBe(0b00010000);
    const bytes = cellsToBits(cells);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('is explored by one or the other', () => {
    const other = new Uint8Array(FOG_SIZE * FOG_SIZE);
    other[1] = 255;
    const u = unionCells(cells, other);
    expect([u[0], u[1], u[2], u[1000]]).toEqual([255, 255, 0, 255]);
  });
});
