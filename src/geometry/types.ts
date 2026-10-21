/**
 * CurveWeave data model.
 *
 * The input network (CurveNetwork) is always kept unchanged; repair produces a
 * new network plus a graph and a provenance record, so every repair can be
 * inspected and reversed.
 */
import type { Vec3 } from './vec3';

export type { Vec3 };

/** Intended feature type of a curve when it is a seam between patches. */
export type FeatureType = 'sharp' | 'smooth' | 'unspecified';

/** A sample along a curve: position plus unit tangent (direction of increasing index). */
export interface CurveSample {
  p: Vec3;
  t: Vec3;
}

/**
 * One input polyline. Several segments may share a `sourceId` when an
 * intended curve was drawn (or broken) as fragments.
 */
export interface CurveSegment {
  id: string;
  /** Identity of the intended curve this segment belongs to (used by patches). */
  sourceId: string;
  points: Vec3[];
  feature: FeatureType;
  label?: string;
  /**
   * Benchmark-only ground truth: the intended junction id of each endpoint
   * (null for an intentionally free end). Ignored by all algorithms.
   */
  gtJunction?: [string | null, string | null];
}

/** Endpoint reference: curve id plus which end (0 = first point, 1 = last). */
export interface EndpointRef {
  curveId: string;
  end: 0 | 1;
}

export const endpointKey = (e: EndpointRef): string => `${e.curveId}:${e.end}`;
export function parseEndpointKey(k: string): EndpointRef {
  const i = k.lastIndexOf(':');
  return { curveId: k.slice(0, i), end: k.slice(i + 1) === '1' ? 1 : 0 };
}

/** A labelled patch: its sides are intended curves (sourceIds) in cyclic order. */
export interface PatchSpec {
  id: string;
  sides: string[];
  label?: string;
}

/** Designer-imposed constraints. Keys are endpoint keys ("curveId:end"). */
export interface DesignerConstraints {
  /** Endpoints that must stay free (e.g., an intentionally open edge). */
  keepOpen: string[];
  /** Endpoint pairs that must never be merged. */
  keepSeparate: [string, string][];
  /** Patches regularized toward planarity. */
  planarPatches: string[];
}

export interface CurveNetwork {
  version: 1;
  name: string;
  curves: CurveSegment[];
  patches: PatchSpec[];
  constraints: DesignerConstraints;
}

// ---------------------------------------------------------------------------
// Graph

export interface GraphVertex {
  id: string;
  position: Vec3;
  endpoints: EndpointRef[];
}

export interface GraphEdge {
  id: string;
  curveId: string;
  sourceId: string;
  v0: string;
  v1: string;
  samples: CurveSample[];
  feature: FeatureType;
  /** 1 for untouched input; lower when the edge was moved by a repair. */
  confidence: number;
  annotations: string[];
  label?: string;
}

/** A junction is a graph vertex together with its degree (number of incident edge ends). */
export interface GraphJunction {
  vertexId: string;
  degree: number;
}

export interface CurveGraph {
  vertices: GraphVertex[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Surfaces

export interface BoundaryLoop {
  patchId: string;
  /** Oriented side polylines, each starting where the previous one ends. */
  sides: { sourceId: string; points: Vec3[]; reversed: boolean; feature: FeatureType }[];
  /** Graph vertex ids of the corners, side i runs corner[i] -> corner[i+1]. */
  corners: string[];
}

export interface TriangleMesh {
  positions: Vec3[];
  /** Triangle vertex indices, counter-clockwise for outward normals. */
  triangles: [number, number, number][];
}

/** A patch mesh on a structured grid, before welding. */
export interface SurfacePatch {
  id: string;
  /** 4 = Coons quad grid, 3 = triangular grid. */
  sides: 3 | 4;
  /** Grid resolution per side (number of segments). */
  n: number;
  mesh: TriangleMesh;
  /** Per-vertex key used for welding shared boundary samples across patches. */
  keys: string[];
  /** True if the vertex lies on the boundary (fixed by the curves). */
  fixed: boolean[];
  /** Grid stencil neighbours of each vertex (4 for quads, 6 for triangles). */
  neighbours: number[][];
  /**
   * For each non-corner boundary vertex, the interior vertices whose average
   * is one step inward; used by the smooth-seam term.
   */
  inward: Map<number, number[]>;
  /** Boundary vertex indices of each side, ordered along the oriented side. */
  sideVertices: number[][];
  sideSources: string[];
  /** Whether each side runs against the curve's canonical orientation. */
  sideReversed: boolean[];
}

export interface CreaseConstraint {
  sourceId: string;
  feature: FeatureType;
}

/** Optional architectural regularization supported by the solver. */
export interface GeometricConstraint {
  kind: 'planarity';
  patchId: string;
}

export interface OptimizationSettings {
  lambdaFair: number;
  lambdaReference: number;
  lambdaSeam: number;
  lambdaRegularization: number;
  tolerance: number;
  maxIterations: number;
}

export interface OptimizationResult {
  converged: boolean;
  failed: boolean;
  failureReason?: string;
  iterations: number;
  /** Relative residual ||b - A x|| / ||b|| per iteration (index 0 = initial guess). */
  residualHistory: number[];
  /** Total energy E(x) per iteration, recomputed from the iterate. */
  energyHistory: number[];
  initialEnergy: number;
  finalEnergy: number;
  terms: { fair: number; reference: number; seam: number; regularization: number };
  variables: number;
  equations: number;
  millis: number;
}

export interface GeometryMetrics {
  [name: string]: number | string | boolean;
}
