import { describe, expect, it } from 'vitest';
import { scoreJunctions } from '../src/geometry/evaluate';
import { defaultRepairSettings, repairNetwork } from '../src/geometry/repair';
import { foldedPavilion } from '../src/geometry/presets';
import { perturbNetwork, defaultNoise } from '../src/geometry/noise';
import type { CurveNetwork } from '../src/geometry/types';
import { line, net } from './helpers';

const gt = (n: CurveNetwork, map: Record<string, [string | null, string | null]>): CurveNetwork => ({
  ...n,
  curves: n.curves.map((c) => ({ ...c, gtJunction: map[c.id] })),
});

describe('benchmark evaluation', () => {
  it('scores a perfect repair as precision = recall = 1', () => {
    const clean = foldedPavilion();
    const s = scoreJunctions(clean, clean, repairNetwork(clean));
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.meanPositionError).toBeLessThan(1e-12);
  });

  it('counts a wrong merge as a false positive and a missed merge as a false negative', () => {
    // a and b meet at J; c's free end lies near J but must stay free.
    const n = gt(
      net([line('a', [0, 0, 0], [1, 0, 0]), line('b', [1.004, 0, 0], [1, 1, 0]), line('c', [1, -0.006, 0], [2, -1, 0])]),
      { a: [null, 'J'], b: ['J', null], c: [null, null] },
    );
    const base = scoreJunctions(n, n, repairNetwork(n, { ...defaultRepairSettings, mode: 'baseline' }));
    expect(base.truePairs).toBe(1);
    expect(base.predictedPairs).toBe(3); // a, b, c all merged
    expect(base.precision).toBeCloseTo(1 / 3, 12);
    expect(base.recall).toBe(1);
    const labelled = { ...n, constraints: { ...n.constraints, keepOpen: ['c:0'] } };
    const prop = scoreJunctions(labelled, labelled, repairNetwork(labelled));
    expect(prop.precision).toBe(1);
    expect(prop.recall).toBe(1);
    const none = scoreJunctions(n, n, repairNetwork(n, { ...defaultRepairSettings, mode: 'baseline', tolerance: 1e-9 }));
    expect(none.recall).toBe(0);
  });

  it('is deterministic for a seeded perturbation', () => {
    const clean = foldedPavilion();
    const noisy = perturbNetwork(clean, { ...defaultNoise, seed: 5 });
    expect(scoreJunctions(noisy, clean, repairNetwork(noisy))).toEqual(scoreJunctions(noisy, clean, repairNetwork(noisy)));
  });
});
