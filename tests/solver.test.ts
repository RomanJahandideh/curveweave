import { describe, expect, it } from 'vitest';
import { repairNetwork } from '../src/geometry/repair';
import { buildSurface } from '../src/geometry/patches';
import { defaultOptimization, evaluateTerms, fitPlane, smallestEigenvector, solveSurface } from '../src/geometry/solver';
import { LeastSquares, conjugateGradient } from '../src/geometry/sparse';
import { surfaceMetrics } from '../src/geometry/mesh';
import { presets } from '../src/geometry/presets';
import type { CurveNetwork, Vec3 } from '../src/geometry/types';
import { line, net } from './helpers';

const surf = (n: CurveNetwork, res = 8) => {
  const r = repairNetwork(n);
  return buildSurface(r.network, r.provenance.vertexOf, res);
};

/** Four boundary curves of a saddle-like, non-planar quad. */
function wavyQuad(): CurveNetwork {
  const bump = (a: Vec3, b: Vec3, h: number) => {
    const c = line('tmp', a, b, 12);
    c.points = c.points.map((p, i) => [p[0], p[1], p[2] + h * Math.sin((Math.PI * i) / 12)]);
    return c.points;
  };
  const mk = (id: string, a: Vec3, b: Vec3, h: number) => ({ ...line(id, a, b, 12), points: bump(a, b, h) });
  return net(
    [
      mk('q0', [0, 0, 0], [1, 0, 0], 0.3),
      mk('q1', [1, 0, 0], [1, 1, 0], -0.2),
      mk('q2', [1, 1, 0], [0, 1, 0], 0.25),
      mk('q3', [0, 1, 0], [0, 0, 0], -0.3),
    ],
    { patches: [{ id: 'Q', sides: ['q0', 'q1', 'q2', 'q3'] }] },
  );
}

describe('sparse conjugate gradients', () => {
  it('solves a small SPD least-squares system to tolerance', () => {
    // Rows: x0 - 1, x1 - 2, x0 - x1 (weight 2)
    const lsq = new LeastSquares(2);
    lsq.add([0], [1], -1, 1, 't');
    lsq.add([1], [1], -2, 1, 't');
    lsq.add([0, 1], [1, -1], 0, 2, 't');
    const r = conjugateGradient(lsq, new Float64Array(2), 1e-12, 50);
    // Normal equations: [3 -2; -2 3] x = [1; 2] -> x = [7/5, 8/5]
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(7 / 5, 10);
    expect(r.x[1]).toBeCloseTo(8 / 5, 10);
  });

  it('does not report convergence when the iteration budget is exhausted', () => {
    const s = surf(wavyQuad(), 12);
    const out = solveSurface(s, { ...defaultOptimization, maxIterations: 2, tolerance: 1e-14 });
    expect(out.result.converged).toBe(false);
    expect(out.result.failed).toBe(false);
    expect(out.result.iterations).toBe(2);
    expect(out.result.failureReason).toMatch(/above tolerance/);
  });
});

describe('constrained fairing', () => {
  it('decreases the total energy monotonically and converges', () => {
    const s = surf(wavyQuad(), 12);
    const out = solveSurface(s);
    expect(out.result.converged).toBe(true);
    expect(out.result.residualHistory.at(-1)!).toBeLessThanOrEqual(defaultOptimization.tolerance);
    const E = out.result.energyHistory;
    for (let i = 1; i < E.length; i++) expect(E[i]).toBeLessThanOrEqual(E[i - 1] * (1 + 1e-9) + 1e-15);
    expect(out.result.finalEnergy).toBeLessThan(out.result.initialEnergy);
  });

  it('keeps boundary vertices fixed and reduces the fairness term', () => {
    const s = surf(wavyQuad(), 12);
    const out = solveSurface(s, { ...defaultOptimization, lambdaReference: 1e-4 });
    s.positions.forEach((p, i) => {
      if (s.fixed[i]) expect(out.positions[i]).toEqual(p);
    });
    const before = evaluateTerms(s, s.positions);
    const after = evaluateTerms(s, out.positions);
    expect(after.fair).toBeLessThan(before.fair);
  });

  it('reduces the normal angle across a smooth seam', () => {
    const p = presets.find((x) => x.id === 'curved-canopy')!;
    const s = surf(p.make(), 10);
    const before = surfaceMetrics(s).smoothSeamAngleDeg;
    const out = solveSurface(s, { ...defaultOptimization, lambdaSeam: 10 });
    const after = surfaceMetrics(s, out.positions).smoothSeamAngleDeg;
    expect(out.result.converged).toBe(true);
    expect(after).toBeLessThan(before);
  });

  it('planarity regularization flattens a patch with planar boundary toward its plane', () => {
    // Planar boundary square, interior pushed out of plane by a reference to a bumped fill.
    const s = surf(wavyQuad(), 12);
    const plane = fitPlane(s.positions.filter((_, i) => s.fixed[i]));
    const dev = (P: Vec3[]) =>
      Math.max(...P.map((p, i) => (s.fixed[i] ? 0 : Math.abs(plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] - plane.d))));
    const off = solveSurface(s);
    const on = solveSurface(s, { ...defaultOptimization, lambdaRegularization: 50 }, ['Q']);
    expect(on.result.converged).toBe(true);
    expect(dev(on.positions)).toBeLessThan(dev(off.positions));
    expect(evaluateTerms(s, on.positions, ['Q']).regularization).toBeLessThan(
      evaluateTerms(s, off.positions, ['Q']).regularization,
    );
  });
});

describe('plane fitting', () => {
  it('recovers the normal of points on a tilted plane', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) pts.push([i, j, 0.5 * i - 0.25 * j + 2]);
    const { n, maxDeviation } = fitPlane(pts);
    const expected = [-0.5, 0.25, 1];
    const len = Math.hypot(...expected);
    expect(Math.abs(n[0] * expected[0] + n[1] * expected[1] + n[2] * expected[2]) / len).toBeCloseTo(1, 10);
    expect(maxDeviation).toBeLessThan(1e-9);
    expect(Math.abs(smallestEigenvector([[2, 0, 0], [0, 1, 0], [0, 0, 3]])[1])).toBeCloseTo(1, 12);
  });
});
