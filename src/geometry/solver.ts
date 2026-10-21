/**
 * Constrained surface fairing.
 *
 *   E_total(x) = λ_fair E_fair + λ_ref E_ref + λ_seam E_seam + λ_reg E_reg
 *
 * over the interior (non-boundary) vertex coordinates x ∈ R^{3F}. Boundary
 * vertices lie on the repaired curves and are fixed. All four terms are sums
 * of squared linear residuals:
 *
 *  E_fair  = Σ_v ‖x_v − mean_{u∈N(v)} x_u‖²       (uniform umbrella Laplacian; normal
 *                                                 equations give the bi-Laplacian)
 *  E_ref   = Σ_v ‖x_v − x_v⁰‖²                    (stay near the initial Coons/harmonic fill;
 *                                                 also makes the system strictly SPD)
 *  E_seam  = Σ_seam samples ‖p̄_A + p̄_B − 2 b‖²    (smooth seams: the first interior rows on
 *                                                 either side mirror each other through b)
 *  E_reg   = Σ_v∈planar patches (n·x_v − d)²      (planarity toward the boundary's best-fit plane)
 *
 * The minimizer solves (JᵀWJ) x = −JᵀW c, solved with Jacobi-preconditioned
 * conjugate gradients. The reported energy history is recomputed from each
 * iterate and the result is marked converged only if the relative residual
 * falls below the tolerance.
 */
import type { OptimizationResult, OptimizationSettings, Vec3 } from './types';
import type { WeldedSurface } from './patches';
import { LeastSquares, conjugateGradient } from './sparse';
import { dot } from './vec3';

export const defaultOptimization: OptimizationSettings = {
  lambdaFair: 1,
  lambdaReference: 0.02,
  lambdaSeam: 1,
  lambdaRegularization: 0,
  tolerance: 1e-8,
  maxIterations: 3000,
};

export interface SolveOutput {
  positions: Vec3[];
  result: OptimizationResult;
}

/** Best-fit plane (unit normal n, offset d with n·x = d) by PCA. */
export function fitPlane(points: Vec3[]): { n: Vec3; d: number; maxDeviation: number } {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / points.length;
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
  const n = smallestEigenvector(C);
  const d = dot(n, c);
  const maxDeviation = Math.max(0, ...points.map((p) => Math.abs(dot(n, p) - d)));
  return { n, d, maxDeviation };
}

/** Cyclic Jacobi eigen-decomposition of a symmetric 3x3 matrix; returns the eigenvector of the smallest eigenvalue. */
export function smallestEigenvector(M: number[][]): Vec3 {
  const A = M.map((r) => [...r]);
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p];
        const akq = A[k][q];
        A[k][p] = cs * akp - sn * akq;
        A[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k];
        const aqk = A[q][k];
        A[p][k] = cs * apk - sn * aqk;
        A[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p];
        const vkq = V[k][q];
        V[k][p] = cs * vkp - sn * vkq;
        V[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  let m = 0;
  for (let i = 1; i < 3; i++) if (A[i][i] < A[m][m]) m = i;
  const v: Vec3 = [V[0][m], V[1][m], V[2][m]];
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
}

type Term = 'fair' | 'reference' | 'seam' | 'regularization';

/**
 * Build the least-squares rows for the four terms. Every row is added with
 * unit weight to `unit` (for reporting each term) and with its λ to the
 * system that is solved.
 */
function buildSystem(s: WeldedSurface, settings: OptimizationSettings, planarPatches: string[]) {
  const P = s.positions;
  const free = P.map((_, i) => i).filter((i) => !s.fixed[i]);
  const col = new Map(free.map((v, i) => [v, i]));
  const nVar = 3 * free.length;
  const system = new LeastSquares(nVar);
  const unit = new LeastSquares(nVar);
  const lambda: Record<Term, number> = {
    fair: settings.lambdaFair,
    reference: settings.lambdaReference,
    seam: settings.lambdaSeam,
    regularization: settings.lambdaRegularization,
  };
  const add = (term: Term, idx: number[], val: number[], c: number) => {
    unit.add(idx, val, c, 1, term);
    system.add(idx, val, c, lambda[term], term);
  };
  /** Linear combination Σ coef·x_v over vertices, coordinate d -> sparse row (fixed vertices folded into c). */
  const row = (terms: [number, number][], d: number, c0 = 0) => {
    const acc = new Map<number, number>();
    let c = c0;
    for (const [v, coef] of terms) {
      const j = col.get(v);
      if (j === undefined) c += coef * P[v][d];
      else acc.set(3 * j + d, (acc.get(3 * j + d) ?? 0) + coef);
    }
    const idx = [...acc.keys()];
    return { idx, val: idx.map((k) => acc.get(k)!), c };
  };

  for (const v of free) {
    const nb = s.neighbours[v].filter((u) => u !== v);
    for (let d = 0; d < 3; d++) {
      const f = row([[v, 1], ...nb.map((u) => [u, -1 / nb.length] as [number, number])], d);
      add('fair', f.idx, f.val, f.c);
      add('reference', [3 * col.get(v)! + d], [1], -P[v][d]);
    }
  }

  let seamRows = 0;
  for (const [sid, pis] of s.curvePatches) {
    const curve = s.curves.get(sid)!;
    if (curve.feature !== 'smooth' || pis.length !== 2) continue;
    const [pa, pb] = pis;
    const sideA = s.patches[pa].sideSources.indexOf(sid);
    const sideB = s.patches[pb].sideSources.indexOf(sid);
    const svA = s.patches[pa].sideVertices[sideA];
    const svB = s.patches[pb].sideVertices[sideB];
    for (let k = 1; k < s.n; k++) {
      const la = svA[k];
      const ga = s.globalIndex[pa][la];
      // Find the same welded vertex on side B.
      const lb = svB.find((x) => s.globalIndex[pb][x] === ga);
      if (lb === undefined) continue;
      const inA = s.patches[pa].inward.get(la)!;
      const inB = s.patches[pb].inward.get(lb)!;
      const terms: [number, number][] = [
        ...inA.map((l) => [s.globalIndex[pa][l], 1 / inA.length] as [number, number]),
        ...inB.map((l) => [s.globalIndex[pb][l], 1 / inB.length] as [number, number]),
        [ga, -2],
      ];
      for (let d = 0; d < 3; d++) {
        const r = row(terms, d);
        add('seam', r.idx, r.val, r.c);
      }
      seamRows++;
    }
  }

  const planes: { patchId: string; n: Vec3; d: number }[] = [];
  for (const pid of planarPatches) {
    const pi = s.patches.findIndex((p) => p.id === pid);
    if (pi < 0) continue;
    const g = s.globalIndex[pi];
    const boundary = g.filter((gi) => s.fixed[gi]).map((gi) => P[gi]);
    const plane = fitPlane(boundary);
    planes.push({ patchId: pid, n: plane.n, d: plane.d });
    for (const gi of new Set(g)) {
      const j = col.get(gi);
      if (j === undefined) continue;
      add('regularization', [3 * j, 3 * j + 1, 3 * j + 2], [plane.n[0], plane.n[1], plane.n[2]], -plane.d);
    }
  }
  return { system, unit, free, col, nVar, lambda, seamRows, planes };
}

export function solveSurface(
  s: WeldedSurface,
  settings: OptimizationSettings = defaultOptimization,
  planarPatches: string[] = [],
): SolveOutput {
  const t0 = performance.now();
  const { system, unit, free, nVar, lambda } = buildSystem(s, settings, planarPatches);
  const x0 = new Float64Array(nVar);
  free.forEach((v, j) => {
    for (let d = 0; d < 3; d++) x0[3 * j + d] = s.positions[v][d];
  });
  const weighted = (x: Float64Array) => system.energy(x).total;
  const energyHistory: number[] = [];
  const cg = conjugateGradient(system, x0, settings.tolerance, settings.maxIterations, (x) =>
    energyHistory.push(weighted(x)),
  );
  const positions = s.positions.map((p) => [...p] as Vec3);
  free.forEach((v, j) => {
    positions[v] = [cg.x[3 * j], cg.x[3 * j + 1], cg.x[3 * j + 2]];
  });
  const unitTerms = unit.energy(cg.x).byTerm;
  const terms = {
    fair: unitTerms.fair ?? 0,
    reference: unitTerms.reference ?? 0,
    seam: unitTerms.seam ?? 0,
    regularization: unitTerms.regularization ?? 0,
  };
  const finalEnergy =
    lambda.fair * terms.fair +
    lambda.reference * terms.reference +
    lambda.seam * terms.seam +
    lambda.regularization * terms.regularization;
  const failed = cg.failed || !positions.every((p) => p.every(Number.isFinite));
  return {
    positions: failed ? s.positions.map((p) => [...p] as Vec3) : positions,
    result: {
      converged: cg.converged && !failed,
      failed,
      failureReason: failed ? cg.failureReason ?? 'non-finite positions' : cg.converged ? undefined : cg.failureReason,
      iterations: cg.iterations,
      residualHistory: cg.residualHistory,
      energyHistory,
      initialEnergy: energyHistory[0] ?? 0,
      finalEnergy,
      terms,
      variables: nVar,
      equations: system.rows.length,
      millis: performance.now() - t0,
    },
  };
}

/** Unit-weight value of each term at the given positions (for before/after comparisons). */
export function evaluateTerms(s: WeldedSurface, positions: Vec3[], planarPatches: string[] = []) {
  const { unit, free, nVar } = buildSystem({ ...s, positions: s.positions }, defaultOptimization, planarPatches);
  const x = new Float64Array(nVar);
  free.forEach((v, j) => {
    for (let d = 0; d < 3; d++) x[3 * j + d] = positions[v][d];
  });
  const t = unit.energy(x).byTerm;
  return { fair: t.fair ?? 0, reference: t.reference ?? 0, seam: t.seam ?? 0, regularization: t.regularization ?? 0 };
}
