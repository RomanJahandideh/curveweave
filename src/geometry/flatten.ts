/**
 * Optional fabrication module: flatten one patch to the plane.
 *
 * Initialization projects the patch onto its best-fit plane; the layout is
 * then refined by minimizing the edge-length stress
 *   E(u) = Σ_edges ((|u_i − u_j| − L_ij) / L_ij)²
 * with gradient descent and backtracking line search. Distortion is reported,
 * never hidden: a doubly curved patch cannot be developed without strain.
 */
import type { Vec3 } from './types';
import { cross, dot, normalize, sub } from './vec3';
import { fitPlane } from './solver';

export type Vec2 = [number, number];

export interface FlattenResult {
  uv: Vec2[];
  triangles: [number, number, number][];
  iterations: number;
  energyHistory: number[];
  meanEdgeDistortion: number;
  maxEdgeDistortion: number;
  meanAreaDistortion: number;
  invertedTriangles: number;
  boundary: number[][];
}

function edges(tris: [number, number, number][]): [number, number][] {
  const s = new Map<string, [number, number]>();
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      s.set(a < b ? `${a}_${b}` : `${b}_${a}`, a < b ? [a, b] : [b, a]);
    }
  return [...s.values()];
}

const area2 = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Boundary loops of a triangle mesh as vertex index cycles. */
export function boundaryLoops(tris: [number, number, number][]): number[][] {
  const count = new Map<string, number>();
  const directed: [number, number][] = [];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
      directed.push([a, b]);
    }
  const next = new Map<number, number>();
  for (const [a, b] of directed) if (count.get(a < b ? `${a}_${b}` : `${b}_${a}`) === 1) next.set(a, b);
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let v = start;
    while (!seen.has(v) && next.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v)!;
    }
    loops.push(loop);
  }
  return loops;
}

export function flattenPatch(P: Vec3[], tris: [number, number, number][], maxIterations = 500): FlattenResult {
  const E = edges(tris);
  const L = E.map(([a, b]) => Math.hypot(...sub(P[a], P[b])));
  // Initial layout: projection onto the best-fit plane.
  const { n } = fitPlane(P);
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(cross(n, ref));
  const e2 = cross(n, e1);
  let uv: Vec2[] = P.map((p) => [dot(p, e1), dot(p, e2)]);

  const energy = (U: Vec2[]) =>
    E.reduce((s, [a, b], k) => {
      const l = Math.hypot(U[a][0] - U[b][0], U[a][1] - U[b][1]);
      return s + ((l - L[k]) / L[k]) ** 2;
    }, 0);
  const grad = (U: Vec2[]) => {
    const g: Vec2[] = U.map(() => [0, 0]);
    E.forEach(([a, b], k) => {
      const dx = U[a][0] - U[b][0];
      const dy = U[a][1] - U[b][1];
      const l = Math.max(Math.hypot(dx, dy), 1e-15);
      const f = (2 * (l - L[k])) / (L[k] * L[k] * l);
      g[a][0] += f * dx;
      g[a][1] += f * dy;
      g[b][0] -= f * dx;
      g[b][1] -= f * dy;
    });
    return g;
  };
  const history = [energy(uv)];
  let step = 0.1 * Math.min(...L) ** 2;
  let it = 0;
  for (; it < maxIterations; it++) {
    const g = grad(uv);
    const gg = g.reduce((s, v) => s + v[0] * v[0] + v[1] * v[1], 0);
    if (gg < 1e-24) break;
    const e0 = history[history.length - 1];
    let accepted = false;
    for (let tries = 0; tries < 30; tries++) {
      const trial: Vec2[] = uv.map((p, i) => [p[0] - step * g[i][0], p[1] - step * g[i][1]]);
      const e = energy(trial);
      if (e <= e0 - 1e-4 * step * gg) {
        uv = trial;
        history.push(e);
        step *= 1.5;
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted || e0 - history[history.length - 1] < 1e-12 * Math.max(1, e0)) break;
  }

  const dist = E.map(([a, b], k) => Math.abs(Math.hypot(uv[a][0] - uv[b][0], uv[a][1] - uv[b][1]) - L[k]) / L[k]);
  const signs = tris.map(([a, b, c]) => area2(uv[a], uv[b], uv[c]));
  const positive = signs.filter((s) => s > 0).length;
  const majority = positive >= signs.length / 2 ? 1 : -1;
  const areaDist = tris.map(([a, b, c], k) => {
    const A3 = Math.hypot(...cross(sub(P[b], P[a]), sub(P[c], P[a])));
    return A3 > 0 ? Math.abs(Math.abs(signs[k]) - A3) / A3 : 0;
  });
  return {
    uv,
    triangles: tris,
    iterations: it,
    energyHistory: history,
    meanEdgeDistortion: dist.reduce((a, b) => a + b, 0) / Math.max(1, dist.length),
    maxEdgeDistortion: Math.max(0, ...dist),
    meanAreaDistortion: areaDist.reduce((a, b) => a + b, 0) / Math.max(1, areaDist.length),
    invertedTriangles: signs.filter((s) => s * majority <= 0).length,
    boundary: boundaryLoops(tris),
  };
}

/** SVG cut pattern: boundary outline plus light triangle edges, in model units scaled to millimetres. */
export function flattenToSVG(f: FlattenResult, title: string, unitsToMm = 100): string {
  const xs = f.uv.map((p) => p[0] * unitsToMm);
  const ys = f.uv.map((p) => -p[1] * unitsToMm);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const pad = 10;
  const w = Math.max(...xs) - minX + 2 * pad;
  const h = Math.max(...ys) - minY + 2 * pad;
  const X = (i: number) => (xs[i] - minX + pad).toFixed(3);
  const Y = (i: number) => (ys[i] - minY + pad).toFixed(3);
  const mesh = edges(f.triangles)
    .map(([a, b]) => `M${X(a)} ${Y(a)}L${X(b)} ${Y(b)}`)
    .join('');
  const outline = f.boundary.map((loop) => 'M' + loop.map((i) => `${X(i)} ${Y(i)}`).join('L') + 'Z').join('');
  const esc = title.replace(/[<&>"]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(1)}mm" height="${h.toFixed(1)}mm" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}">
  <title>${esc}</title>
  <desc>CurveWeave flattening. Mean edge distortion ${(100 * f.meanEdgeDistortion).toFixed(2)}%, max ${(100 * f.maxEdgeDistortion).toFixed(2)}%, inverted triangles ${f.invertedTriangles}.</desc>
  <path d="${mesh}" fill="none" stroke="#9aa4b2" stroke-width="0.15"/>
  <path d="${outline}" fill="none" stroke="#d0342c" stroke-width="0.4"/>
</svg>
`;
}
