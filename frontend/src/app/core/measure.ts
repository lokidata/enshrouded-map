export interface Measure {
  /** Whole metres between the two points: the straight line on x and z (the height is not used), and each axis. */
  distance: number;
  dx: number;
  dz: number;
}

/** The distance between two map points (x and z in metres), rounded to the metre; dx and dz are absolute. Rounding is done last, so dx and dz can differ by 1 from the distance's parts. */
export function measure(a: { x: number; z: number }, b: { x: number; z: number }): Measure {
  return {
    distance: Math.round(Math.hypot(b.x - a.x, b.z - a.z)),
    dx: Math.round(Math.abs(b.x - a.x)),
    dz: Math.round(Math.abs(b.z - a.z)),
  };
}
