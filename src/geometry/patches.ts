/**
 * Patch construction from a repaired curve network.
 *
 * Each labelled patch lists its boundary as intended curves (sourceIds) in
 * cyclic order. Fragments of one sourceId are chained through graph vertices,
 * sides are oriented so consecutive sides share a corner vertex, and every
 * curve is resampled once to a global resolution N so that patches sharing a
 * curve share identical boundary samples (welded by key).
 *
 *  - 4 sides: bilinearly blended Coons patch on an (N+1)^2 grid.
 *  - 3 sides: triangular grid with a discrete harmonic interior
 *    (uniform umbrella Laplacian solved by CG).
 *
 * A patch whose boundary cannot be closed is reported as a failure with the
 * reason; it is never silently filled.
 */
import type { CurveNetwork, FeatureType, SurfacePatch, Vec3 } from './types';
import { endpointKey } from './types';
import { add, scale, sub } from './vec3';
import { resample } from './network';
import { LeastSquares, conjugateGradient } from './sparse';

export interface ChainedCurve {
  sourceId: string;
  points: Vec3[];
  v0: string;
  v1: string;
  feature: FeatureType;
}

export interface PatchFailure {
  patchId: string;
  reason: string;
}

export interface WeldedSurface {
  positions: Vec3[];
  /** Global vertex is fixed by a curve (boundary of at least one patch). */
  fixed: boolean[];
  keys: string[];
  /** Triangles with their patch index. */
  triangles: [number, number, number][];
  trianglePatch: number[];
  /** Union of grid-stencil neighbours over all patches. */
  neighbours: number[][];
  patches: SurfacePatch[];
  /** patch-local index -> global index, per patch. */
  globalIndex: number[][];
  /** Curves used as patch sides, keyed by sourceId. */
  curves: Map<string, ChainedCurve>;
  /** sourceId -> patch indices that use it as a side. */
  curvePatches: Map<string, number[]>;
  failures: PatchFailure[];
  n: number;
}

/** Chain the fragments of one intended curve into a single polyline. */
export function chainCurve(
  net: CurveNetwork,
  vertexOf: Record<string, string>,
  sourceId: string,
): ChainedCurve | string {
  const frags = net.curves.filter((c) => c.sourceId === sourceId);
  if (frags.length === 0) return `curve ${sourceId} is missing`;
  const ends = frags.map((c) => ({
    c,
    v0: vertexOf[endpointKey({ curveId: c.id, end: 0 })],
    v1: vertexOf[endpointKey({ curveId: c.id, end: 1 })],
  }));
  if (ends.some((e) => !e.v0 || !e.v1)) return `curve ${sourceId} has endpoints without graph vertices`;
  if (frags.length === 1) {
    const e = ends[0];
    if (e.v0 === e.v1) return `curve ${sourceId} is closed or collapsed`;
    return { sourceId, points: e.c.points, v0: e.v0, v1: e.v1, feature: e.c.feature };
  }
  const count = new Map<string, number>();
  for (const e of ends) for (const v of [e.v0, e.v1]) count.set(v, (count.get(v) ?? 0) + 1);
  const terminals = [...count.entries()].filter(([, n]) => n === 1).map(([v]) => v).sort();
  if (terminals.length !== 2 || [...count.values()].some((n) => n > 2))
    return `fragments of ${sourceId} do not form a single connected chain (unrepaired gap or branch)`;
  const used = new Set<number>();
  let at = terminals[0];
  const pts: Vec3[] = [];
  for (let k = 0; k < ends.length; k++) {
    const i = ends.findIndex((e, j) => !used.has(j) && (e.v0 === at || e.v1 === at));
    if (i < 0) return `fragments of ${sourceId} do not form a single chain`;
    used.add(i);
    const e = ends[i];
    const seg = e.v0 === at ? e.c.points : [...e.c.points].reverse();
    pts.push(...(pts.length ? seg.slice(1) : seg));
    at = e.v0 === at ? e.v1 : e.v0;
  }
  return { sourceId, points: pts, v0: terminals[0], v1: at, feature: frags[0].feature };
}

interface OrientedSide {
  sourceId: string;
  reversed: boolean;
  start: string;
  end: string;
}

function orientSides(chains: ChainedCurve[]): OrientedSide[] | string {
  const k = chains.length;
  for (const firstRev of [false, true]) {
    const out: OrientedSide[] = [];
    let ok = true;
    for (let i = 0; i < k; i++) {
      const c = chains[i];
      let rev: boolean;
      if (i === 0) rev = firstRev;
      else {
        const prev = out[i - 1].end;
        if (c.v0 === prev) rev = false;
        else if (c.v1 === prev) rev = true;
        else {
          ok = false;
          break;
        }
      }
      out.push({ sourceId: c.sourceId, reversed: rev, start: rev ? c.v1 : c.v0, end: rev ? c.v0 : c.v1 });
    }
    if (ok && out[k - 1].end === out[0].start && new Set(out.map((s) => s.start)).size === k) return out;
  }
  return 'boundary loop is not closed: consecutive sides do not share junctions';
}

function harmonicInterior(positions: Vec3[], fixed: boolean[], neighbours: number[][]): void {
  const free = positions.map((_, i) => i).filter((i) => !fixed[i]);
  const col = new Map(free.map((v, i) => [v, i]));
  for (let d = 0; d < 3; d++) {
    const lsq = new LeastSquares(free.length);
    for (const v of free) {
      const nb = neighbours[v];
      const idx = [col.get(v)!];
      const val = [1];
      let c = 0;
      for (const u of nb) {
        if (fixed[u]) c -= positions[u][d] / nb.length;
        else {
          idx.push(col.get(u)!);
          val.push(-1 / nb.length);
        }
      }
      lsq.add(idx, val, c, 1, 'harmonic');
    }
    const x0 = Float64Array.from(free.map((v) => positions[v][d]));
    const res = conjugateGradient(lsq, x0, 1e-12, 10 * free.length + 50);
    free.forEach((v, i) => (positions[v][d] = res.x[i]));
  }
}

function buildQuad(
  id: string,
  n: number,
  S: Vec3[][],
  keyOf: (side: number, k: number) => string,
): Omit<SurfacePatch, 'sideSources' | 'sideReversed'> {
  // S[0]: P00->P10 (j=0), S[1]: P10->P11 (i=n), S[2]: P11->P01 (j=n), S[3]: P01->P00 (i=0)
  const idx = (i: number, j: number) => j * (n + 1) + i;
  const bottom = (i: number) => S[0][i];
  const right = (j: number) => S[1][j];
  const top = (i: number) => S[2][n - i];
  const left = (j: number) => S[3][n - j];
  const P00 = S[0][0], P10 = S[1][0], P11 = S[2][0], P01 = S[3][0];
  const positions: Vec3[] = [];
  const keys: string[] = [];
  const fixed: boolean[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = j / n;
      const ruled = add(
        add(scale(bottom(i), 1 - v), scale(top(i), v)),
        add(scale(left(j), 1 - u), scale(right(j), u)),
      );
      const bilinear = add(
        add(scale(P00, (1 - u) * (1 - v)), scale(P10, u * (1 - v))),
        add(scale(P01, (1 - u) * v), scale(P11, u * v)),
      );
      let p = sub(ruled, bilinear);
      const onB = i === 0 || j === 0 || i === n || j === n;
      if (j === 0) p = bottom(i);
      else if (i === n) p = right(j);
      else if (j === n) p = top(i);
      else if (i === 0) p = left(j);
      positions.push([...p] as Vec3);
      fixed.push(onB);
      let key = `${id}:${i},${j}`;
      if (j === 0) key = keyOf(0, i);
      else if (i === n) key = keyOf(1, j);
      else if (j === n) key = keyOf(2, n - i);
      else if (i === 0) key = keyOf(3, n - j);
      keys.push(key);
    }
  const triangles: [number, number, number][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      triangles.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      triangles.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
    }
  const neighbours: number[][] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const nb: number[] = [];
      if (i > 0) nb.push(idx(i - 1, j));
      if (i < n) nb.push(idx(i + 1, j));
      if (j > 0) nb.push(idx(i, j - 1));
      if (j < n) nb.push(idx(i, j + 1));
      neighbours.push(nb);
    }
  const sideVertices = [
    Array.from({ length: n + 1 }, (_, k) => idx(k, 0)),
    Array.from({ length: n + 1 }, (_, k) => idx(n, k)),
    Array.from({ length: n + 1 }, (_, k) => idx(n - k, n)),
    Array.from({ length: n + 1 }, (_, k) => idx(0, n - k)),
  ];
  const inward = new Map<number, number[]>();
  for (let k = 1; k < n; k++) {
    inward.set(idx(k, 0), [idx(k, 1)]);
    inward.set(idx(n, k), [idx(n - 1, k)]);
    inward.set(idx(k, n), [idx(k, n - 1)]);
    inward.set(idx(0, k), [idx(1, k)]);
  }
  return { id, sides: 4, n, mesh: { positions, triangles }, keys, fixed, neighbours, inward, sideVertices };
}

function buildTriangle(
  id: string,
  n: number,
  S: Vec3[][],
  keyOf: (side: number, k: number) => string,
): Omit<SurfacePatch, 'sideSources' | 'sideReversed'> {
  // Vertex (i, j), i + j <= n. S[0]: A->B (j=0), S[1]: B->C (i+j=n), S[2]: C->A (i=0).
  const index = new Map<string, number>();
  const ij: [number, number][] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i + j <= n; i++) {
      index.set(`${i},${j}`, ij.length);
      ij.push([i, j]);
    }
  const idx = (i: number, j: number) => index.get(`${i},${j}`)!;
  const A = S[0][0], B = S[1][0], C = S[2][0];
  const positions: Vec3[] = [];
  const keys: string[] = [];
  const fixed: boolean[] = [];
  for (const [i, j] of ij) {
    let p: Vec3 = add(A, add(scale(sub(B, A), i / n), scale(sub(C, A), j / n)));
    let key = `${id}:${i},${j}`;
    let onB = true;
    if (j === 0) [p, key] = [S[0][i], keyOf(0, i)];
    else if (i + j === n) [p, key] = [S[1][j], keyOf(1, j)];
    else if (i === 0) [p, key] = [S[2][n - j], keyOf(2, n - j)];
    else onB = false;
    positions.push([...p] as Vec3);
    keys.push(key);
    fixed.push(onB);
  }
  const triangles: [number, number, number][] = [];
  for (const [i, j] of ij) {
    if (i + j < n) triangles.push([idx(i, j), idx(i + 1, j), idx(i, j + 1)]);
    if (i + j < n - 1) triangles.push([idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]);
  }
  const neighbours = ij.map(([i, j]) =>
    (
      [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
        [i + 1, j - 1],
        [i - 1, j + 1],
      ] as [number, number][]
    )
      .filter(([a, b]) => a >= 0 && b >= 0 && a + b <= n)
      .map(([a, b]) => idx(a, b)),
  );
  const sideVertices = [
    Array.from({ length: n + 1 }, (_, k) => idx(k, 0)),
    Array.from({ length: n + 1 }, (_, k) => idx(n - k, k)),
    Array.from({ length: n + 1 }, (_, k) => idx(0, n - k)),
  ];
  const inward = new Map<number, number[]>();
  for (let k = 1; k < n; k++) {
    inward.set(idx(k, 0), [idx(k - 1, 1), idx(k, 1)]);
    inward.set(idx(n - k, k), [idx(n - k - 1, k), idx(n - k, k - 1)]);
    inward.set(idx(0, k), [idx(1, k - 1), idx(1, k)]);
  }
  harmonicInterior(positions, fixed, neighbours);
  return { id, sides: 3, n, mesh: { positions, triangles }, keys, fixed, neighbours, inward, sideVertices };
}

/** Build and weld all patches. `vertexOf` maps endpoint keys of `net` curves to graph vertices. */
export function buildSurface(net: CurveNetwork, vertexOf: Record<string, string>, n = 12): WeldedSurface {
  const curves = new Map<string, ChainedCurve>();
  const sampled = new Map<string, Vec3[]>();
  const failures: PatchFailure[] = [];
  const patches: SurfacePatch[] = [];
  for (const spec of net.patches) {
    if (spec.sides.length !== 3 && spec.sides.length !== 4) {
      failures.push({ patchId: spec.id, reason: `${spec.sides.length}-sided patches are not supported (3 or 4 only)` });
      continue;
    }
    const chains: ChainedCurve[] = [];
    let err = '';
    for (const sid of spec.sides) {
      const c = curves.get(sid) ?? chainCurve(net, vertexOf, sid);
      if (typeof c === 'string') {
        err = c;
        break;
      }
      curves.set(sid, c);
      chains.push(c);
    }
    if (err) {
      failures.push({ patchId: spec.id, reason: err });
      continue;
    }
    const oriented = orientSides(chains);
    if (typeof oriented === 'string') {
      failures.push({ patchId: spec.id, reason: oriented });
      continue;
    }
    const S = oriented.map((o) => {
      if (!sampled.has(o.sourceId)) sampled.set(o.sourceId, resample(curves.get(o.sourceId)!.points, n));
      const pts = sampled.get(o.sourceId)!;
      return o.reversed ? [...pts].reverse() : pts;
    });
    const keyOf = (side: number, k: number): string => {
      const o = oriented[side];
      if (k === 0) return `v:${o.start}`;
      if (k === n) return `v:${o.end}`;
      return `c:${o.sourceId}:${o.reversed ? n - k : k}`;
    };
    const base = spec.sides.length === 4 ? buildQuad(spec.id, n, S, keyOf) : buildTriangle(spec.id, n, S, keyOf);
    patches.push({
      ...base,
      sideSources: oriented.map((o) => o.sourceId),
      sideReversed: oriented.map((o) => o.reversed),
    });
  }

  // Consistent orientation: patches sharing a curve must traverse it in
  // opposite directions; flip triangle winding by breadth-first propagation.
  const flip = new Array<boolean | undefined>(patches.length);
  const bySource = new Map<string, number[]>();
  patches.forEach((p, pi) => p.sideSources.forEach((s) => bySource.set(s, [...(bySource.get(s) ?? []), pi])));
  for (let root = 0; root < patches.length; root++) {
    if (flip[root] !== undefined) continue;
    flip[root] = false;
    const queue = [root];
    while (queue.length) {
      const p = queue.shift()!;
      patches[p].sideSources.forEach((s, si) => {
        for (const q of bySource.get(s)!) {
          if (q === p || flip[q] !== undefined) continue;
          const sameDir = patches[p].sideReversed[si] === patches[q].sideReversed[patches[q].sideSources.indexOf(s)];
          flip[q] = sameDir ? !flip[p] : flip[p];
          queue.push(q);
        }
      });
    }
  }
  // Choose the global sign so that normals point mostly upward (+z).
  let up = 0;
  patches.forEach((p, pi) => {
    for (const [a, b, c] of p.mesh.triangles) {
      const P = p.mesh.positions;
      const e1 = sub(P[b], P[a]);
      const e2 = sub(P[c], P[a]);
      up += (flip[pi] ? -1 : 1) * (e1[0] * e2[1] - e1[1] * e2[0]);
    }
  });
  patches.forEach((p, pi) => {
    if (flip[pi] !== up < 0) p.mesh.triangles = p.mesh.triangles.map(([a, b, c]) => [a, c, b]);
  });

  // Weld.
  const keyIndex = new Map<string, number>();
  const positions: Vec3[] = [];
  const fixed: boolean[] = [];
  const keys: string[] = [];
  const nbSets: Set<number>[] = [];
  const globalIndex: number[][] = [];
  const triangles: [number, number, number][] = [];
  const trianglePatch: number[] = [];
  const curvePatches = new Map<string, number[]>();
  patches.forEach((p, pi) => {
    const g = p.keys.map((k, i) => {
      let gi = keyIndex.get(k);
      if (gi === undefined) {
        gi = positions.length;
        keyIndex.set(k, gi);
        positions.push([...p.mesh.positions[i]] as Vec3);
        fixed.push(p.fixed[i]);
        keys.push(k);
        nbSets.push(new Set());
      } else fixed[gi] = fixed[gi] || p.fixed[i];
      return gi;
    });
    globalIndex.push(g);
    p.neighbours.forEach((nb, i) => nb.forEach((u) => nbSets[g[i]].add(g[u])));
    p.mesh.triangles.forEach((t) => {
      triangles.push([g[t[0]], g[t[1]], g[t[2]]]);
      trianglePatch.push(pi);
    });
    p.sideSources.forEach((s) => {
      if (!curvePatches.has(s)) curvePatches.set(s, []);
      curvePatches.get(s)!.push(pi);
    });
  });
  return {
    positions,
    fixed,
    keys,
    triangles,
    trianglePatch,
    neighbours: nbSets.map((s) => [...s].sort((a, b) => a - b)),
    patches,
    globalIndex,
    curves,
    curvePatches,
    failures,
    n,
  };
}
