/**
 * Seeded perturbation of a clean curve network, used to create benchmark
 * inputs with known ground truth. Every perturbation is driven by a single
 * mulberry32 stream, so the same (network, settings) always yields the same
 * output.
 */
import type { CurveNetwork, CurveSegment } from './types';
import type { Vec3 } from './vec3';
import { add, scale, sub, normalize } from './vec3';
import { arcLengths, boundingBox, displaceEnd, pointAt, curveLength } from './network';
import { mulberry32, randomUnit } from './rng';

export interface NoiseSettings {
  seed: number;
  /** Max endpoint displacement, fraction of bounding-box diagonal. */
  jitter: number;
  /** Max gap: each end trimmed back by up to this fraction of the diagonal. */
  gap: number;
  /** Max overshoot: each end extended along its tangent by up to this fraction. */
  overshoot: number;
  /** Interior sample noise amplitude, fraction of the diagonal. */
  sampleNoise: number;
  /** Probability that a curve is split into two fragments. */
  fragmentProbability: number;
  /** Probability that a curve is drawn twice (near-duplicate stroke). */
  duplicateProbability: number;
}

export const defaultNoise: NoiseSettings = {
  seed: 1,
  jitter: 0.006,
  gap: 0.004,
  overshoot: 0.004,
  sampleNoise: 0.0008,
  fragmentProbability: 0.1,
  duplicateProbability: 0.05,
};

function trimEnd(points: Vec3[], end: 0 | 1, amount: number): Vec3[] {
  const pts = end === 0 ? points : [...points].reverse();
  const L = arcLengths(pts);
  const s = Math.min(amount, 0.25 * L[L.length - 1]);
  const kept = pts.filter((_, i) => L[i] > s);
  const out = [pointAt(pts, s, L), ...kept];
  return end === 0 ? out : out.reverse();
}

function extendEnd(points: Vec3[], end: 0 | 1, amount: number): Vec3[] {
  const pts = end === 0 ? points : [...points].reverse();
  const dir = normalize(sub(pts[0], pts[1]));
  const out = [add(pts[0], scale(dir, amount)), ...pts];
  return end === 0 ? out : out.reverse();
}

export function perturbNetwork(clean: CurveNetwork, s: NoiseSettings): CurveNetwork {
  const rand = mulberry32(s.seed);
  const diag = boundingBox(clean.curves).diagonal || 1;
  let curves: CurveSegment[] = [];

  // 1. Fragmentation (new interior junction known by construction).
  for (const c of clean.curves) {
    if (c.points.length >= 4 && rand() < s.fragmentProbability) {
      const mid = Math.floor(c.points.length / 2);
      const j = `frag:${c.id}`;
      curves.push(
        { ...c, id: `${c.id}.a`, points: c.points.slice(0, mid + 1), gtJunction: [c.gtJunction?.[0] ?? null, j] },
        { ...c, id: `${c.id}.b`, points: c.points.slice(mid), gtJunction: [j, c.gtJunction?.[1] ?? null] },
      );
    } else curves.push({ ...c, points: c.points.map((p) => [...p] as Vec3) });
  }

  // 2. Duplicated strokes.
  const dups: CurveSegment[] = [];
  for (const c of curves)
    if (rand() < s.duplicateProbability) {
      const off = scale(randomUnit(rand), 0.3 * s.jitter * diag);
      dups.push({ ...c, id: `${c.id}.dup`, points: c.points.map((p) => add(p, off)) });
    }
  curves = curves.concat(dups);

  // 3. Endpoint gap / overshoot / jitter and interior sample noise.
  curves = curves.map((c) => {
    let pts = c.points;
    for (const end of [0, 1] as const) {
      const L = curveLength(pts);
      if (rand() < 0.5) pts = trimEnd(pts, end, rand() * s.gap * diag);
      else pts = extendEnd(pts, end, rand() * s.overshoot * diag);
      pts = displaceEnd(pts, end, scale(randomUnit(rand), rand() * s.jitter * diag), 0.3 * L);
    }
    pts = pts.map((p, i) =>
      i === 0 || i === pts.length - 1 ? p : add(p, scale(randomUnit(rand), rand() * s.sampleNoise * diag)),
    );
    return { ...c, points: pts };
  });

  return { ...clean, name: `${clean.name} (noise seed ${s.seed})`, curves };
}
