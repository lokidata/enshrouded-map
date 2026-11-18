import { describe, expect, it } from 'vitest';
import { measure } from './measure';

describe('measure', () => {
  it('is the straight line on x and z, with each axis', () => {
    expect(measure({ x: 0, z: 0 }, { x: 30, z: 40 })).toEqual({ distance: 50, dx: 30, dz: 40 });
  });

  it('is the same in both directions, and zero for the same point', () => {
    expect(measure({ x: 100, z: 20 }, { x: 40, z: 100 })).toEqual(
      measure({ x: 40, z: 100 }, { x: 100, z: 20 }),
    );
    expect(measure({ x: 5, z: 5 }, { x: 5, z: 5 })).toEqual({ distance: 0, dx: 0, dz: 0 });
  });

  it('rounds to the metre', () => {
    expect(measure({ x: 0, z: 0 }, { x: 1, z: 1 }).distance).toBe(1); // 1.414...
    expect(measure({ x: 0, z: 0 }, { x: 10, z: 11 }).distance).toBe(15); // 14.87
    expect(measure({ x: 0.4, z: 0 }, { x: 0, z: 0 })).toEqual({ distance: 0, dx: 0, dz: 0 });
  });

  it('handles the whole world (10,240 m)', () => {
    expect(measure({ x: 0, z: 0 }, { x: 10240, z: 10240 }).distance).toBe(14482);
  });
});
