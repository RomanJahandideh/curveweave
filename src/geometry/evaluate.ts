/**
 * Benchmark evaluation against ground truth.
 *
 * Ground truth comes from construction: every endpoint of a clean preset (and
 * of fragments created by the noise model) carries the id of its intended
 * junction, or null when it is intentionally free. Near-duplicate strokes
 * (ids ending in ".dup") are excluded from the junction evaluation for every
 * method, because their endpoints have no unique correct partner; their effect
 * is measured through the surface metrics instead.
 */
import type { CurveNetwork, Vec3 } from './types';
import { endpointKey } from './types';
import type { RepairResult } from './repair';
import type { PipelineOutput } from './pipeline';
import { boundingBox, endpointPosition } from './network';
import { dist, dot, sub } from './vec3';

export interface JunctionScore {
  truePairs: number;
  predictedPairs: number;
  correctPairs: number;
  precision: number;
  recall: number;
  f1: number;
  /** Mean distance from each repaired junction-endpoint position to its true junction, relative to the diagonal. */
  meanPositionError: number;
}

const isEvaluated = (curveId: string) => !curveId.endsWith('.dup') && !curveId.includes('.dup.');

/** Positions of every ground-truth junction id in the clean network (including noise-fragment midpoints). */
export function junctionPositions(clean: CurveNetwork): Map<string, Vec3> {
  const m = new Map<string, Vec3>();
  for (const c of clean.curves) {
    c.gtJunction?.forEach((j, end) => {
      if (j && !m.has(j)) m.set(j, endpointPosition(c, end as 0 | 1));
    });
    // Noise fragments split at the middle sample (see noise.ts).
    m.set(`frag:${c.id}`, c.points[Math.floor(c.points.length / 2)]);
  }
  return m;
}

export function scoreJunctions(noisy: CurveNetwork, clean: CurveNetwork, r: RepairResult): JunctionScore {
  const gt = new Map<string, string | null>();
  for (const c of noisy.curves) {
    if (!isEvaluated(c.id)) continue;
    gt.set(endpointKey({ curveId: c.id, end: 0 }), c.gtJunction?.[0] ?? null);
    gt.set(endpointKey({ curveId: c.id, end: 1 }), c.gtJunction?.[1] ?? null);
  }
  const keys = [...gt.keys()].sort();
  const clusterOf = new Map<string, number>();
  r.clusters.forEach((g, i) => g.forEach((k) => clusterOf.set(k, i)));
  let truePairs = 0;
  let predicted = 0;
  let correct = 0;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const ja = gt.get(keys[i]);
      const jb = gt.get(keys[j]);
      const t = ja != null && ja === jb;
      const ca = clusterOf.get(keys[i]);
      const p = ca !== undefined && ca === clusterOf.get(keys[j]);
      if (t) truePairs++;
      if (p) predicted++;
      if (t && p) correct++;
    }
  const precision = predicted ? correct / predicted : 1;
  const recall = truePairs ? correct / truePairs : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  // Position error: snapped position = mean of the endpoint's cluster in the (normalized) input.
  const pos = new Map<string, Vec3>();
  for (const c of noisy.curves)
    for (const end of [0, 1] as const) pos.set(endpointKey({ curveId: c.id, end }), endpointPosition(c, end));
  const jpos = junctionPositions(clean);
  const diag = boundingBox(clean.curves).diagonal || 1;
  let err = 0;
  let count = 0;
  for (const k of keys) {
    const j = gt.get(k);
    const ci = clusterOf.get(k);
    if (!j || ci === undefined || !jpos.has(j)) continue;
    const g = r.clusters[ci].filter((x) => pos.has(x));
    const m: Vec3 = [0, 0, 0];
    for (const x of g) {
      const p = pos.get(x)!;
      m[0] += p[0] / g.length;
      m[1] += p[1] / g.length;
      m[2] += p[2] / g.length;
    }
    err += dist(m, jpos.get(j)!) / diag;
    count++;
  }
  return { truePairs, predictedPairs: predicted, correctPairs: correct, precision, recall, f1, meanPositionError: count ? err / count : NaN };
}

function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const t = L2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / L2)) : 0;
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

/** Mean distance of the reconstructed boundary vertices to the clean curves, relative to the diagonal. */
export function boundaryError(out: PipelineOutput, clean: CurveNetwork): number {
  const diag = boundingBox(clean.curves).diagonal || 1;
  const fixed = out.positions.filter((_, i) => out.surface.fixed[i]);
  if (!fixed.length) return NaN;
  let s = 0;
  for (const p of fixed) {
    let best = Infinity;
    for (const c of clean.curves)
      for (let i = 1; i < c.points.length; i++) best = Math.min(best, pointSegmentDistance(p, c.points[i - 1], c.points[i]));
    s += best;
  }
  return s / fixed.length / diag;
}

/** Mean absolute difference of sharp-seam fold angles to a reference reconstruction, matched by sourceId. */
export function foldAngleError(out: PipelineOutput, reference: PipelineOutput): number {
  const ref = new Map(reference.metrics.seams.filter((s) => s.feature === 'sharp').map((s) => [s.sourceId, s.meanNormalAngleDeg]));
  const diffs = out.metrics.seams
    .filter((s) => s.feature === 'sharp' && ref.has(s.sourceId))
    .map((s) => Math.abs(s.meanNormalAngleDeg - ref.get(s.sourceId)!));
  return diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : NaN;
}
