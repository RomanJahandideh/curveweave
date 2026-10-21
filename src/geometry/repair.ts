/**
 * Curve-network junction repair.
 *
 * Two modes share the same candidate generation so they can be compared on
 * identical inputs:
 *  - baseline: distance-only snapping (single linkage, every pair within
 *    tolerance is merged; no further checks).
 *  - proposed: each candidate gets an interpretable score from distance,
 *    tangent compatibility, valence and designer constraints. Merges are
 *    applied greedily in score order with a complete-linkage check and a
 *    no-collapse check; ambiguous candidates become suggestions that the user
 *    must accept.
 *
 * The function is pure: the input network is never mutated and every repair
 * is recorded in `provenance`, so any decision can be reversed by re-running
 * with a different `decisions` map.
 */
import type { CurveGraph, CurveNetwork, CurveSegment, EndpointRef, GraphEdge, GraphVertex } from './types';
import { endpointKey, parseEndpointKey } from './types';
import type { Vec3 } from './vec3';
import { angleBetween, dist, sub } from './vec3';
import {
  allEndpoints,
  curveLength,
  displaceEnd,
  endpointPosition,
  meanPolylineDistance,
  normalizeNetwork,
  outgoingTangent,
  samples,
} from './network';
import { SpatialHash } from './spatialHash';
import { UnionFind } from './unionFind';

export type RepairMode = 'baseline' | 'proposed';

export interface RepairSettings {
  mode: RepairMode;
  /** Merge radius as a fraction of the bounding-box diagonal. */
  tolerance: number;
  /**
   * Outgoing tangents closer than this angle (degrees) indicate overlapping or
   * side-by-side features; such merges become suggestions.
   */
  minJunctionAngleDeg: number;
  /** Largest junction valence accepted automatically. */
  maxValence: number;
  /** Respect designer keep-open / keep-separate labels. */
  useDesignerConstraints: boolean;
  /** Score weights. score = wD * (d / tol) + wT * tangentTerm. */
  weights: { distance: number; tangent: number };
  /** Candidates with score above this (but otherwise valid) become suggestions. */
  suggestThreshold: number;
  /** Join same-source fragments meeting at a degree-2 junction. */
  joinFragments: boolean;
  /** Detect and remove duplicate edges. */
  removeDuplicates: boolean;
}

export const defaultRepairSettings: RepairSettings = {
  mode: 'proposed',
  tolerance: 0.02,
  minJunctionAngleDeg: 20,
  maxValence: 6,
  useDesignerConstraints: true,
  weights: { distance: 1, tangent: 1 },
  suggestThreshold: 0.92,
  joinFragments: true,
  removeDuplicates: true,
};

export type CandidateStatus = 'auto' | 'suggested' | 'rejected';

export interface RepairCandidate {
  id: string;
  a: string;
  b: string;
  distance: number;
  /** Angle between the two outgoing tangents, degrees. */
  angleDeg: number;
  score: number;
  terms: { distance: number; tangent: number };
  /** Classification before user decisions and greedy checks. */
  initialStatus: CandidateStatus;
  /** Final outcome after greedy clustering and user decisions. */
  status: 'merged' | 'suggested' | 'rejected';
  reason: string;
}

export type Decisions = Record<string, 'accept' | 'reject'>;

export interface RepairProvenance {
  /** endpoint key -> graph vertex id */
  vertexOf: Record<string, string>;
  /** curve id -> largest endpoint displacement applied by snapping */
  displacement: Record<string, number>;
  /** [joined curve id, first part, second part] */
  joined: [string, string, string][];
  removedDuplicates: { removed: string; keptAs: string; meanDistance: number }[];
  degenerateRejected: string[];
}

export interface RepairResult {
  settings: RepairSettings;
  tolerance: number; // absolute
  scale: number;
  input: CurveNetwork;
  network: CurveNetwork;
  graph: CurveGraph;
  candidates: RepairCandidate[];
  clusters: string[][];
  provenance: RepairProvenance;
  millis: number;
}

const pairId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function repairNetwork(
  inputNet: CurveNetwork,
  settings: RepairSettings = defaultRepairSettings,
  decisions: Decisions = {},
): RepairResult {
  const t0 = performance.now();
  const { network: net, report } = normalizeNetwork(inputNet);
  const scale = report.scale || 1;
  const tol = settings.tolerance * scale;

  // --- Duplicate removal (before clustering, so duplicates do not create
  // spurious near-parallel candidates) ------------------------------------------
  const removedDuplicates: RepairProvenance['removedDuplicates'] = [];
  let input = net.curves;
  if (settings.mode === 'proposed' && settings.removeDuplicates) {
    const patchSources = new Set(net.patches.flatMap((p) => p.sides));
    // Prefer curves referenced by patches, then lexicographic id.
    const ordered = [...input].sort(
      (x, y) => Number(patchSources.has(y.sourceId)) - Number(patchSources.has(x.sourceId)) || (x.id < y.id ? -1 : 1),
    );
    const remove = new Set<string>();
    for (let i = 0; i < ordered.length; i++) {
      if (remove.has(ordered[i].id)) continue;
      const a = ordered[i];
      const a0 = endpointPosition(a, 0);
      const a1 = endpointPosition(a, 1);
      for (let j = i + 1; j < ordered.length; j++) {
        const b = ordered[j];
        if (remove.has(b.id)) continue;
        const b0 = endpointPosition(b, 0);
        const b1 = endpointPosition(b, 1);
        const endsMatch =
          (dist(a0, b0) <= tol && dist(a1, b1) <= tol) || (dist(a0, b1) <= tol && dist(a1, b0) <= tol);
        if (!endsMatch) continue;
        const md = meanPolylineDistance(a.points, b.points);
        if (md <= tol) {
          remove.add(b.id);
          removedDuplicates.push({ removed: b.id, keptAs: a.id, meanDistance: md });
        }
      }
    }
    input = input.filter((c) => !remove.has(c.id));
  }
  const curves = new Map(input.map((c) => [c.id, c]));
  const endpoints = allEndpoints(input);
  const pos = new Map<string, Vec3>();
  const tan = new Map<string, Vec3>();
  for (const e of endpoints) {
    const c = curves.get(e.curveId)!;
    pos.set(endpointKey(e), endpointPosition(c, e.end));
    tan.set(endpointKey(e), outgoingTangent(c, e.end));
  }

  // --- Step B: candidate generation (shared by both modes) -----------------
  const hash = new SpatialHash<string>(Math.max(tol, 1e-12));
  for (const e of endpoints) hash.insert(pos.get(endpointKey(e))!, endpointKey(e));
  const keepOpen = new Set(settings.useDesignerConstraints ? net.constraints.keepOpen : []);
  const keepSeparate = new Set(
    settings.useDesignerConstraints ? net.constraints.keepSeparate.map(([a, b]) => pairId(a, b)) : [],
  );
  const seen = new Set<string>();
  const candidates: RepairCandidate[] = [];
  for (const e of endpoints) {
    const ka = endpointKey(e);
    for (const { item: kb, d } of hash.query(pos.get(ka)!, tol)) {
      if (kb === ka) continue;
      const id = pairId(ka, kb);
      if (seen.has(id)) continue;
      seen.add(id);
      const ea = parseEndpointKey(ka);
      const eb = parseEndpointKey(kb);
      if (ea.curveId === eb.curveId) continue; // never close a curve onto itself
      const [a, b] = ka < kb ? [ka, kb] : [kb, ka];
      const angleDeg = (angleBetween(tan.get(a)!, tan.get(b)!) * 180) / Math.PI;
      const distTerm = d / tol;
      const tanTerm =
        settings.mode === 'proposed' ? Math.max(0, 1 - angleDeg / settings.minJunctionAngleDeg) : 0;
      const score = settings.weights.distance * distTerm + settings.weights.tangent * tanTerm;
      let initialStatus: CandidateStatus = 'auto';
      let reason = 'within tolerance';
      if (settings.mode === 'proposed') {
        if (keepOpen.has(a) || keepOpen.has(b)) {
          initialStatus = 'rejected';
          reason = 'designer label: endpoint kept open';
        } else if (keepSeparate.has(id)) {
          initialStatus = 'rejected';
          reason = 'designer label: keep separate';
        } else if (tanTerm > 0) {
          initialStatus = 'suggested';
          reason = `near-parallel outgoing tangents (${angleDeg.toFixed(1)}°): possible overlap or side-by-side features`;
        } else if (score > settings.suggestThreshold) {
          initialStatus = 'suggested';
          reason = `weak evidence: distance ${(distTerm * 100).toFixed(0)}% of tolerance`;
        } else {
          reason = `compatible: distance ${(distTerm * 100).toFixed(0)}% of tolerance, angle ${angleDeg.toFixed(0)}°`;
        }
      }
      candidates.push({
        id,
        a,
        b,
        distance: d,
        angleDeg,
        score,
        terms: { distance: distTerm, tangent: tanTerm },
        initialStatus,
        status: 'rejected',
        reason,
      });
    }
  }
  candidates.sort((x, y) => x.score - y.score || x.distance - y.distance || (x.id < y.id ? -1 : 1));

  // --- Step C: clustering ---------------------------------------------------
  const uf = new UnionFind();
  for (const e of endpoints) uf.add(endpointKey(e));
  const members = new Map<string, string[]>(endpoints.map((e) => [endpointKey(e), [endpointKey(e)]]));
  const degenerateRejected: string[] = [];

  const tryUnion = (c: RepairCandidate, checks: boolean): { ok: boolean; why?: string; soft?: boolean } => {
    const ra = uf.find(c.a);
    const rb = uf.find(c.b);
    if (ra === rb) return { ok: true };
    const merged = [...members.get(ra)!, ...members.get(rb)!];
    if (checks) {
      // Complete linkage: the merged cluster must stay within the tolerance.
      for (let i = 0; i < merged.length; i++)
        for (let j = i + 1; j < merged.length; j++)
          if (dist(pos.get(merged[i])!, pos.get(merged[j])!) > tol)
            return { ok: false, why: 'would chain endpoints farther apart than the tolerance' };
      // No collapse: both ends of one curve may not share a junction.
      const curvesIn = new Set<string>();
      for (const k of merged) {
        const cid = parseEndpointKey(k).curveId;
        if (curvesIn.has(cid)) {
          degenerateRejected.push(cid);
          return { ok: false, why: `would collapse curve ${cid} to a point or loop` };
        }
        curvesIn.add(cid);
      }
      if (merged.length > settings.maxValence)
        return { ok: false, soft: true, why: `junction valence ${merged.length} exceeds ${settings.maxValence}` };
    }
    const r = uf.union(c.a, c.b);
    members.set(r, merged);
    return { ok: true };
  };

  for (const c of candidates) {
    const decision = decisions[c.id];
    if (settings.mode === 'baseline') {
      if (decision === 'reject') {
        c.status = 'rejected';
        c.reason = 'rejected by user';
        continue;
      }
      tryUnion(c, false);
      c.status = 'merged';
      continue;
    }
    if (decision === 'reject') {
      c.status = 'rejected';
      c.reason = 'rejected by user';
      continue;
    }
    const wanted = decision === 'accept' ? c.initialStatus !== 'rejected' : c.initialStatus === 'auto';
    if (!wanted) {
      c.status = c.initialStatus === 'rejected' ? 'rejected' : 'suggested';
      continue;
    }
    const r = tryUnion(c, true);
    if (r.ok) {
      c.status = 'merged';
      if (decision === 'accept') c.reason = `accepted by user (${c.reason})`;
    } else if (r.soft && decision !== 'accept') {
      c.status = 'suggested';
      c.reason = r.why!;
    } else if (r.soft && decision === 'accept') {
      // The user explicitly accepts a high-valence junction.
      const ra = uf.find(c.a);
      const rb = uf.find(c.b);
      const merged = [...members.get(ra)!, ...members.get(rb)!];
      members.set(uf.union(c.a, c.b), merged);
      c.status = 'merged';
      c.reason = `accepted by user despite ${r.why}`;
    } else {
      c.status = 'rejected';
      c.reason = r.why!;
    }
  }

  // --- Snapping ---------------------------------------------------------------
  const clusters = uf.groups();
  const target = new Map<string, Vec3>();
  for (const g of clusters) {
    const m: Vec3 = [0, 0, 0];
    for (const k of g) {
      const p = pos.get(k)!;
      m[0] += p[0] / g.length;
      m[1] += p[1] / g.length;
      m[2] += p[2] / g.length;
    }
    for (const k of g) target.set(k, m);
  }
  const displacement: Record<string, number> = {};
  let working: CurveSegment[] = input.map((c) => {
    let pts = c.points;
    const L = curveLength(pts);
    let maxD = 0;
    for (const end of [0, 1] as const) {
      const k = endpointKey({ curveId: c.id, end });
      const delta = sub(target.get(k)!, pos.get(k)!);
      const dn = Math.hypot(...delta);
      maxD = Math.max(maxD, dn);
      if (dn > 0) pts = displaceEnd(pts, end, delta, 0.45 * L);
    }
    displacement[c.id] = maxD;
    return { ...c, points: pts };
  });

  // Cluster id per endpoint key (stable naming by sorted first member).
  const clusterOf = new Map<string, number>();
  clusters.forEach((g, i) => g.forEach((k) => clusterOf.set(k, i)));

  // --- Fragment joining -------------------------------------------------------
  const joined: [string, string, string][] = [];
  if (settings.mode === 'proposed' && settings.joinFragments) {
    let changed = true;
    while (changed) {
      changed = false;
      const ends = new Map<number, EndpointRef[]>();
      for (const c of working)
        for (const end of [0, 1] as const) {
          const ci = clusterOf.get(endpointKey({ curveId: c.id, end }))!;
          if (!ends.has(ci)) ends.set(ci, []);
          ends.get(ci)!.push({ curveId: c.id, end });
        }
      for (const [, refs] of [...ends.entries()].sort((x, y) => x[0] - y[0])) {
        if (refs.length !== 2) continue;
        const [ra, rb] = refs;
        if (ra.curveId === rb.curveId) continue;
        const ca = working.find((c) => c.id === ra.curveId)!;
        const cb = working.find((c) => c.id === rb.curveId)!;
        if (ca.sourceId !== cb.sourceId || ca.feature !== cb.feature) continue;
        // Orient: ca must end at the junction, cb must start there.
        const pa = ra.end === 1 ? ca.points : [...ca.points].reverse();
        const pb = rb.end === 0 ? cb.points : [...cb.points].reverse();
        const id = `${ca.id}+${cb.id}`;
        const merged: CurveSegment = {
          ...ca,
          id,
          points: [...pa, ...pb.slice(1)],
          gtJunction: [
            (ra.end === 1 ? ca.gtJunction?.[0] : ca.gtJunction?.[1]) ?? null,
            (rb.end === 0 ? cb.gtJunction?.[1] : cb.gtJunction?.[0]) ?? null,
          ],
        };
        // Register endpoint clusters for the new curve.
        clusterOf.set(endpointKey({ curveId: id, end: 0 }), clusterOf.get(endpointKey({ curveId: ca.id, end: ra.end === 1 ? 0 : 1 }))!);
        clusterOf.set(endpointKey({ curveId: id, end: 1 }), clusterOf.get(endpointKey({ curveId: cb.id, end: rb.end === 0 ? 1 : 0 }))!);
        working = working.filter((c) => c.id !== ca.id && c.id !== cb.id).concat(merged);
        joined.push([id, ca.id, cb.id]);
        changed = true;
        break;
      }
    }
  }

  // --- Graph --------------------------------------------------------------------
  const usedClusters = new Map<number, EndpointRef[]>();
  for (const c of working)
    for (const end of [0, 1] as const) {
      const ci = clusterOf.get(endpointKey({ curveId: c.id, end }))!;
      if (!usedClusters.has(ci)) usedClusters.set(ci, []);
      usedClusters.get(ci)!.push({ curveId: c.id, end });
    }
  const order = [...usedClusters.keys()].sort((a, b) => a - b);
  const vName = new Map(order.map((ci, i) => [ci, `v${i}`]));
  const vertexOf: Record<string, string> = {};
  const vertices: GraphVertex[] = order.map((ci) => {
    const refs = usedClusters.get(ci)!;
    const first = refs[0];
    const c = working.find((x) => x.id === first.curveId)!;
    refs.forEach((r) => (vertexOf[endpointKey(r)] = vName.get(ci)!));
    return { id: vName.get(ci)!, position: endpointPosition(c, first.end), endpoints: refs };
  });
  for (const k of pos.keys()) if (!(k in vertexOf) && clusterOf.has(k)) vertexOf[k] = vName.get(clusterOf.get(k)!) ?? '';
  const edges: GraphEdge[] = working.map((c) => {
    const annotations: string[] = [];
    if ((displacement[c.id] ?? 0) > 0) annotations.push(`endpoint snapped by ${(displacement[c.id] ?? 0).toPrecision(3)}`);
    if (joined.some((j) => j[0] === c.id)) annotations.push('joined from fragments');
    const moved = displacement[c.id] ?? 0;
    return {
      id: `e:${c.id}`,
      curveId: c.id,
      sourceId: c.sourceId,
      v0: vName.get(clusterOf.get(endpointKey({ curveId: c.id, end: 0 }))!)!,
      v1: vName.get(clusterOf.get(endpointKey({ curveId: c.id, end: 1 }))!)!,
      samples: samples(c.points),
      feature: c.feature,
      confidence: moved > 0 ? Math.max(0, 1 - moved / tol) : 1,
      annotations,
      label: c.label,
    };
  });

  return {
    settings,
    tolerance: tol,
    scale,
    input: inputNet,
    network: { ...net, curves: working },
    graph: { vertices, edges },
    candidates,
    clusters,
    provenance: {
      vertexOf,
      displacement,
      joined,
      removedDuplicates,
      degenerateRejected: [...new Set(degenerateRejected)],
    },
    millis: performance.now() - t0,
  };
}

/**
 * Graph of an unrepaired network: endpoints are identified only when they
 * coincide to within 1e-9 of the bounding-box diagonal.
 */
export function unrepairedGraph(net: CurveNetwork): RepairResult {
  return repairNetwork(net, { ...defaultRepairSettings, mode: 'baseline', tolerance: 1e-9 }, {});
}
