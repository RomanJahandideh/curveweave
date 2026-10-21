/** Topology validation report for a repaired curve network. */
import type { CurveGraph } from './types';
import type { RepairResult } from './repair';
import { UnionFind } from './unionFind';

export interface TopologyReport {
  vertices: number;
  edges: number;
  /** Vertices where two or more edge ends meet. */
  junctions: number;
  /** Edge ends not shared with any other edge. */
  openEndpoints: number;
  /** degree -> number of vertices */
  degreeDistribution: Record<number, number>;
  connectedComponents: number;
  /** Edges whose two ends meet at the same vertex. */
  degenerateEdges: number;
  mergesApplied: number;
  mergesSuggested: number;
  mergesRejected: number;
  duplicatesRemoved: number;
  fragmentsJoined: number;
  /** Largest endpoint displacement applied by snapping (absolute units). */
  maxDisplacement: number;
}

export function degrees(graph: CurveGraph): Map<string, number> {
  const deg = new Map(graph.vertices.map((v) => [v.id, 0]));
  for (const e of graph.edges) {
    deg.set(e.v0, (deg.get(e.v0) ?? 0) + 1);
    deg.set(e.v1, (deg.get(e.v1) ?? 0) + 1);
  }
  return deg;
}

export function connectedComponents(graph: CurveGraph): number {
  const uf = new UnionFind();
  graph.vertices.forEach((v) => uf.add(v.id));
  graph.edges.forEach((e) => uf.union(e.v0, e.v1));
  return uf.groups().length;
}

export function validateTopology(r: RepairResult): TopologyReport {
  const deg = degrees(r.graph);
  const dist: Record<number, number> = {};
  for (const d of deg.values()) dist[d] = (dist[d] ?? 0) + 1;
  const count = (s: string) => r.candidates.filter((c) => c.status === s).length;
  return {
    vertices: r.graph.vertices.length,
    edges: r.graph.edges.length,
    junctions: [...deg.values()].filter((d) => d >= 2).length,
    openEndpoints: [...deg.values()].filter((d) => d === 1).length,
    degreeDistribution: dist,
    connectedComponents: connectedComponents(r.graph),
    degenerateEdges: r.graph.edges.filter((e) => e.v0 === e.v1).length,
    mergesApplied: count('merged'),
    mergesSuggested: count('suggested'),
    mergesRejected: count('rejected'),
    duplicatesRemoved: r.provenance.removedDuplicates.length,
    fragmentsJoined: r.provenance.joined.length,
    maxDisplacement: Math.max(0, ...Object.values(r.provenance.displacement)),
  };
}
