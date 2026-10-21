/** Curve utilities: validation, normalization, tangents, arc length, resampling. */
import type { CurveNetwork, CurveSample, CurveSegment, EndpointRef } from './types';
import type { Vec3 } from './vec3';
import { add, dist, isFiniteVec, lerp, normalize, scale, sub } from './vec3';

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
  diagonal: number;
}

export function boundingBox(curves: CurveSegment[]): BoundingBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of curves)
    for (const p of c.points)
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], diagonal: 0 };
  return { min, max, diagonal: dist(min, max) };
}

export interface NormalizationReport {
  /** Characteristic scale: bounding-box diagonal. */
  scale: number;
  rejectedCurves: string[];
  removedSamples: number;
  /** For each kept curve, indices of original samples that were kept. */
  keptIndices: Map<string, number[]>;
}

/**
 * Step A of repair: reject curves with non-finite coordinates or fewer than two
 * distinct samples, and drop consecutive duplicate samples (within eps * scale).
 * Returns a new network; the input is not mutated.
 */
export function normalizeNetwork(net: CurveNetwork, epsRelative = 1e-9): { network: CurveNetwork; report: NormalizationReport } {
  const finite = net.curves.filter((c) => c.points.every(isFiniteVec));
  const rejected = net.curves.filter((c) => !c.points.every(isFiniteVec)).map((c) => c.id);
  const bb = boundingBox(finite);
  const eps = Math.max(bb.diagonal * epsRelative, 1e-12);
  const keptIndices = new Map<string, number[]>();
  let removed = 0;
  const curves: CurveSegment[] = [];
  for (const c of finite) {
    const keep: number[] = [];
    c.points.forEach((p, i) => {
      if (keep.length === 0 || dist(p, c.points[keep[keep.length - 1]]) > eps) keep.push(i);
      else removed++;
    });
    if (keep.length < 2) {
      rejected.push(c.id);
      continue;
    }
    keptIndices.set(c.id, keep);
    curves.push({ ...c, points: keep.map((i) => [...c.points[i]] as Vec3) });
  }
  return {
    network: { ...net, curves },
    report: { scale: bb.diagonal, rejectedCurves: rejected, removedSamples: removed, keptIndices },
  };
}

export function arcLengths(points: Vec3[]): number[] {
  const s = [0];
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + dist(points[i - 1], points[i]));
  return s;
}

export const curveLength = (points: Vec3[]): number => arcLengths(points).at(-1) ?? 0;

/** Unit tangents by central differences (one-sided at the ends). */
export function tangents(points: Vec3[]): Vec3[] {
  const n = points.length;
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    return normalize(sub(b, a));
  });
}

export function samples(points: Vec3[]): CurveSample[] {
  const t = tangents(points);
  return points.map((p, i) => ({ p, t: t[i] }));
}

/** Point at arc length s (clamped) by linear interpolation. */
export function pointAt(points: Vec3[], s: number, lengths = arcLengths(points)): Vec3 {
  const total = lengths[lengths.length - 1];
  if (s <= 0) return [...points[0]] as Vec3;
  if (s >= total) return [...points[points.length - 1]] as Vec3;
  let lo = 0;
  let hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = lengths[hi] - lengths[lo];
  return lerp(points[lo], points[hi], seg > 0 ? (s - lengths[lo]) / seg : 0);
}

/** Resample to `segments + 1` points uniformly spaced in arc length. Endpoints are exact. */
export function resample(points: Vec3[], segments: number): Vec3[] {
  const L = arcLengths(points);
  const total = L[L.length - 1];
  const out: Vec3[] = [];
  for (let k = 0; k <= segments; k++) {
    if (k === 0) out.push([...points[0]] as Vec3);
    else if (k === segments) out.push([...points[points.length - 1]] as Vec3);
    else out.push(pointAt(points, (total * k) / segments, L));
  }
  return out;
}

export function endpointPosition(c: CurveSegment, end: 0 | 1): Vec3 {
  return end === 0 ? c.points[0] : c.points[c.points.length - 1];
}

/**
 * Outgoing unit tangent at an endpoint: direction from the endpoint into the
 * curve, estimated over a short arc (fraction of the curve length) so that a
 * noisy last sample does not dominate.
 */
export function outgoingTangent(c: CurveSegment, end: 0 | 1, fraction = 0.08): Vec3 {
  const pts = end === 0 ? c.points : [...c.points].reverse();
  const L = arcLengths(pts);
  const s = Math.max(L[L.length - 1] * fraction, L[Math.min(1, L.length - 1)]);
  return normalize(sub(pointAt(pts, s, L), pts[0]));
}

/**
 * Move one end of a polyline by `delta`, blending the displacement linearly to
 * zero over `blend` arc length so the interior shape is preserved.
 */
export function displaceEnd(points: Vec3[], end: 0 | 1, delta: Vec3, blend: number): Vec3[] {
  const pts = end === 0 ? points : [...points].reverse();
  const L = arcLengths(pts);
  const moved = pts.map((p, i) => {
    const w = blend > 0 ? Math.max(0, 1 - L[i] / blend) : i === 0 ? 1 : 0;
    return add(p, scale(delta, w));
  });
  return end === 0 ? moved : moved.reverse();
}

export function allEndpoints(curves: CurveSegment[]): EndpointRef[] {
  return curves.flatMap((c) => [
    { curveId: c.id, end: 0 as const },
    { curveId: c.id, end: 1 as const },
  ]);
}

/** Mean distance between two polylines after resampling both to n points (orientation-aware). */
export function meanPolylineDistance(a: Vec3[], b: Vec3[], n = 16): number {
  const ra = resample(a, n);
  const rb = resample(b, n);
  const fwd = ra.reduce((s, p, i) => s + dist(p, rb[i]), 0) / ra.length;
  const rev = ra.reduce((s, p, i) => s + dist(p, rb[rb.length - 1 - i]), 0) / ra.length;
  return Math.min(fwd, rev);
}
