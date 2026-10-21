import type { Vec3 } from './vec3';
import { dist } from './vec3';

/**
 * Uniform-grid spatial hash for radius queries. With cell size >= radius a
 * query inspects the 27 neighbouring cells, so it is exact (no missed pairs).
 */
export class SpatialHash<T> {
  private cells = new Map<string, { p: Vec3; item: T }[]>();
  constructor(private cell: number) {
    if (!(cell > 0)) throw new Error('SpatialHash cell size must be positive');
  }
  private key(i: number, j: number, k: number): string {
    return `${i},${j},${k}`;
  }
  insert(p: Vec3, item: T): void {
    const k = this.key(Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell), Math.floor(p[2] / this.cell));
    let bucket = this.cells.get(k);
    if (!bucket) this.cells.set(k, (bucket = []));
    bucket.push({ p, item });
  }
  /** All items within `radius` of p (radius must be <= cell size). */
  query(p: Vec3, radius: number): { item: T; d: number }[] {
    if (radius > this.cell * (1 + 1e-12)) throw new Error('query radius exceeds cell size');
    const ci = Math.floor(p[0] / this.cell);
    const cj = Math.floor(p[1] / this.cell);
    const ck = Math.floor(p[2] / this.cell);
    const out: { item: T; d: number }[] = [];
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (let k = ck - 1; k <= ck + 1; k++) {
          const bucket = this.cells.get(this.key(i, j, k));
          if (!bucket) continue;
          for (const e of bucket) {
            const d = dist(p, e.p);
            if (d <= radius) out.push({ item: e.item, d });
          }
        }
    return out;
  }
}
