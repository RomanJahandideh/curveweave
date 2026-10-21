/** Mesh utilities: normals with sharp-seam splitting, and geometric metrics. */
import type { Vec3 } from './types';
import { add, angleBetween, cross, norm, normalize, sub } from './vec3';
import type { WeldedSurface } from './patches';

export function triangleNormal(P: Vec3[], [a, b, c]: [number, number, number]): Vec3 {
  return cross(sub(P[b], P[a]), sub(P[c], P[a])); // length = 2 * area
}

/** Area-weighted vertex normals over the given triangles. */
export function vertexNormals(P: Vec3[], tris: [number, number, number][]): Vec3[] {
  const N: Vec3[] = P.map(() => [0, 0, 0]);
  for (const t of tris) {
    const n = triangleNormal(P, t);
    for (const v of t) N[v] = add(N[v], n);
  }
  return N.map((n) => normalize(n));
}

/** Global vertices that lie on a sharp curve (including its corner vertices). */
export function sharpVertices(s: WeldedSurface): Set<number> {
  const sharp = new Set<number>();
  const sharpCurves = [...s.curves.values()].filter((c) => c.feature === 'sharp');
  const sharpIds = new Set(sharpCurves.map((c) => c.sourceId));
  const corners = new Set(sharpCurves.flatMap((c) => [`v:${c.v0}`, `v:${c.v1}`]));
  s.keys.forEach((k, i) => {
    if (corners.has(k)) sharp.add(i);
    else if (k.startsWith('c:') && sharpIds.has(k.slice(2, k.lastIndexOf(':')))) sharp.add(i);
  });
  return sharp;
}

/**
 * Per-patch render normals: welded (averaged across patches) everywhere
 * except on sharp curves, where each patch keeps its own normal so the
 * crease stays visible.
 */
export function renderNormals(s: WeldedSurface, positions = s.positions): Vec3[][] {
  const global = vertexNormals(positions, s.triangles);
  const sharp = sharpVertices(s);
  return s.patches.map((p, pi) => {
    const g = s.globalIndex[pi];
    const local = p.mesh.triangles.map(([a, b, c]) => [g[a], g[b], g[c]] as [number, number, number]);
    const own = vertexNormals(positions, local);
    return g.map((gi) => (sharp.has(gi) ? own[gi] : global[gi]));
  });
}

export interface SeamMetric {
  sourceId: string;
  feature: string;
  /** Mean angle (degrees) between the normals of the two triangles adjacent to each seam edge. */
  meanNormalAngleDeg: number;
  maxNormalAngleDeg: number;
  edges: number;
}

export interface SurfaceMetrics {
  patches: number;
  failedPatches: number;
  vertices: number;
  triangles: number;
  area: number;
  nonManifoldEdges: number;
  boundaryEdges: number;
  degenerateTriangles: number;
  minTriangleAngleDeg: number;
  seams: SeamMetric[];
  /** Mean normal angle over smooth seams (0 = tangent-continuous). */
  smoothSeamAngleDeg: number;
  /** Mean normal angle over sharp seams (the fold). */
  sharpSeamAngleDeg: number;
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export function surfaceMetrics(s: WeldedSurface, positions = s.positions): SurfaceMetrics {
  const P = positions;
  const edgeTris = new Map<string, number[]>();
  let area = 0;
  let degenerate = 0;
  let minAngle = 180;
  s.triangles.forEach((t, ti) => {
    const n = triangleNormal(P, t);
    const a2 = norm(n);
    area += a2 / 2;
    const scaleLen = Math.max(norm(sub(P[t[1]], P[t[0]])), norm(sub(P[t[2]], P[t[0]])), 1e-300);
    if (a2 <= 1e-12 * scaleLen * scaleLen) degenerate++;
    else
      for (let k = 0; k < 3; k++) {
        const o = P[t[k]];
        const ang = (angleBetween(sub(P[t[(k + 1) % 3]], o), sub(P[t[(k + 2) % 3]], o)) * 180) / Math.PI;
        minAngle = Math.min(minAngle, ang);
      }
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(t[k], t[(k + 1) % 3]);
      if (!edgeTris.has(key)) edgeTris.set(key, []);
      edgeTris.get(key)!.push(ti);
    }
  });
  let nonManifold = 0;
  let boundary = 0;
  for (const tris of edgeTris.values()) {
    if (tris.length > 2) nonManifold++;
    if (tris.length === 1) boundary++;
  }

  const keyIndex = new Map(s.keys.map((k, i) => [k, i]));
  const seams: SeamMetric[] = [];
  for (const [sid, pis] of s.curvePatches) {
    if (pis.length !== 2) continue;
    const c = s.curves.get(sid)!;
    const ids: number[] = [];
    for (let k = 0; k <= s.n; k++) {
      const key = k === 0 ? `v:${c.v0}` : k === s.n ? `v:${c.v1}` : `c:${sid}:${k}`;
      ids.push(keyIndex.get(key)!);
    }
    const angles: number[] = [];
    for (let k = 0; k < s.n; k++) {
      const tris = edgeTris.get(edgeKey(ids[k], ids[k + 1])) ?? [];
      if (tris.length !== 2) continue;
      const n0 = triangleNormal(P, s.triangles[tris[0]]);
      const n1 = triangleNormal(P, s.triangles[tris[1]]);
      angles.push((angleBetween(n0, n1) * 180) / Math.PI);
    }
    if (!angles.length) continue;
    seams.push({
      sourceId: sid,
      feature: c.feature,
      meanNormalAngleDeg: angles.reduce((a, b) => a + b, 0) / angles.length,
      maxNormalAngleDeg: Math.max(...angles),
      edges: angles.length,
    });
  }
  const meanOf = (f: string) => {
    const xs = seams.filter((m) => m.feature === f);
    return xs.length ? xs.reduce((a, m) => a + m.meanNormalAngleDeg, 0) / xs.length : NaN;
  };
  return {
    patches: s.patches.length,
    failedPatches: s.failures.length,
    vertices: P.length,
    triangles: s.triangles.length,
    area,
    nonManifoldEdges: nonManifold,
    boundaryEdges: boundary,
    degenerateTriangles: degenerate,
    minTriangleAngleDeg: s.triangles.length ? minAngle : NaN,
    seams,
    smoothSeamAngleDeg: meanOf('smooth'),
    sharpSeamAngleDeg: meanOf('sharp'),
  };
}
