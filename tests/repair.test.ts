import { describe, expect, it } from 'vitest';
import { defaultRepairSettings, repairNetwork } from '../src/geometry/repair';
import type { RepairResult } from '../src/geometry/repair';
import { validateTopology } from '../src/geometry/validate';
import { perturbNetwork, defaultNoise } from '../src/geometry/noise';
import { normalizeNetwork } from '../src/geometry/network';
import { History } from '../src/geometry/history';
import { line, net, square } from './helpers';

describe('topology repair', () => {
  it('leaves a network with perfect junctions unchanged', () => {
    const input = square();
    const r = repairNetwork(input);
    const t = validateTopology(r);
    expect(t.vertices).toBe(4);
    expect(t.junctions).toBe(4);
    expect(t.openEndpoints).toBe(0);
    expect(t.maxDisplacement).toBe(0);
    for (const c of r.network.curves) {
      const orig = input.curves.find((x) => x.id === c.id)!;
      expect(c.points).toEqual(orig.points);
    }
  });

  it('merges nearby compatible endpoints and snaps them to one position', () => {
    const r = repairNetwork(square({ 's0:1': [0.008, 0.004, 0], 's1:0': [-0.005, 0, 0.003] }));
    const t = validateTopology(r);
    expect(t.vertices).toBe(4);
    expect(t.openEndpoints).toBe(0);
    const a = r.network.curves.find((c) => c.id === 's0')!.points.at(-1)!;
    const b = r.network.curves.find((c) => c.id === 's1')!.points[0];
    expect(a).toEqual(b);
  });

  it('does not merge endpoints labelled keep-open or keep-separate', () => {
    const base = square({ 's0:1': [0.008, 0, 0] });
    const open = repairNetwork({ ...base, constraints: { ...base.constraints, keepOpen: ['s0:1'] } });
    expect(validateTopology(open).openEndpoints).toBe(2);
    const sep = repairNetwork({ ...base, constraints: { ...base.constraints, keepSeparate: [['s1:0', 's0:1']] } });
    expect(validateTopology(sep).openEndpoints).toBe(2);
    expect(sep.candidates.find((c) => c.id === 's0:1|s1:0')!.reason).toMatch(/keep separate/);
    // The baseline ignores labels and merges.
    const b = repairNetwork(
      { ...base, constraints: { ...base.constraints, keepOpen: ['s0:1'] } },
      { ...defaultRepairSettings, mode: 'baseline' },
    );
    expect(validateTopology(b).openEndpoints).toBe(0);
  });

  it('turns near-parallel endpoints into suggestions that the user can accept', () => {
    // Continuation: outgoing tangents are opposite (180 degrees), so the merge is automatic.
    const cont = net([line('a', [0, 0, 0], [1, 0, 0]), line('b', [1.005, 0.002, 0], [2, 0, 0])]);
    expect(repairNetwork(cont).candidates[0].status).toBe('merged');
    // Hairpin: both strokes leave the meeting point in the same direction.
    const hair = net([line('a', [0, 0, 0], [1, 0, 0]), line('b', [1, 0.01, 0], [0.3, 0.1, 0])]);
    const r = repairNetwork(hair);
    const c = r.candidates.find((x) => x.id === 'a:1|b:0')!;
    expect(c.status).toBe('suggested');
    const accepted = repairNetwork(hair, defaultRepairSettings, { [c.id]: 'accept' });
    expect(accepted.candidates.find((x) => x.id === c.id)!.status).toBe('merged');
    const rejected = repairNetwork(cont, defaultRepairSettings, { 'a:1|b:0': 'reject' });
    expect(rejected.candidates[0].status).toBe('rejected');
  });

  it('is deterministic for the same input and settings', () => {
    const noisy = perturbNetwork(square(), { ...defaultNoise, seed: 7 });
    const a = repairNetwork(noisy);
    const b = repairNetwork(noisy);
    expect(JSON.stringify({ ...a, millis: 0 })).toEqual(JSON.stringify({ ...b, millis: 0 }));
  });

  it('detects and removes duplicate curves', () => {
    const n = net([
      line('a', [0, 0, 0], [1, 0, 0]),
      line('b', [1, 0, 0], [1, 1, 0]),
      line('a2', [0.001, 0.001, 0], [1.001, 0.001, 0]),
    ]);
    const r = repairNetwork(n);
    expect(r.provenance.removedDuplicates.map((d) => d.removed)).toEqual(['a2']);
    expect(r.network.curves.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('rejects merges that would collapse a short curve', () => {
    const n = net([line('tiny', [0, 0, 0], [0.01, 0, 0], 2), line('long', [0, 0.005, 0], [1, 1, 0])]);
    const r = repairNetwork(n);
    expect(validateTopology(r).degenerateEdges).toBe(0);
    expect(r.provenance.degenerateRejected).toContain('tiny');
    // The baseline has no such check.
    const b = repairNetwork(n, { ...defaultRepairSettings, mode: 'baseline' });
    expect(validateTopology(b).degenerateEdges).toBeGreaterThan(0);
  });

  it('prevents chaining across endpoints farther apart than the tolerance', () => {
    // Endpoints spaced 0.6 tolerance apart: single linkage chains all three.
    const tol = 0.02 * Math.SQRT2; // relative tolerance times the diagonal of [0,1]^2
    const s = 0.6 * tol;
    const n = net([
      line('a', [0, 0, 0], [0.5, 0.5, 0]),
      line('b', [0.5 + s, 0.5, 0], [1, 0, 0]),
      line('c', [0.5 + 2 * s, 0.5, 0], [1, 1, 0]),
    ]);
    const big = (r: RepairResult) => Math.max(...r.clusters.map((g) => g.length));
    expect(big(repairNetwork(n, { ...defaultRepairSettings, mode: 'baseline' }))).toBe(3);
    expect(big(repairNetwork(n))).toBe(2);
  });

  it('joins same-source fragments at a degree-2 junction', () => {
    const n = net([
      line('x.a', [0, 0, 0], [0.5, 0, 0], 4, { sourceId: 'x' }),
      line('x.b', [0.502, 0, 0], [1, 0, 0], 4, { sourceId: 'x' }),
    ]);
    const r = repairNetwork(n);
    expect(r.network.curves).toHaveLength(1);
    expect(r.network.curves[0].sourceId).toBe('x');
    expect(r.provenance.joined).toHaveLength(1);
  });

  it('never mutates its input', () => {
    const input = square({ 's0:1': [0.008, 0, 0] });
    const copy = JSON.parse(JSON.stringify(input));
    repairNetwork(input);
    expect(input).toEqual(copy);
  });
});

describe('normalization', () => {
  it('rejects non-finite and degenerate curves and removes duplicate samples', () => {
    const n = net([
      line('ok', [0, 0, 0], [1, 0, 0]),
      { ...line('nan', [0, 0, 0], [1, 1, 0]), points: [[0, 0, 0], [NaN, 0, 0]] },
      line('pt', [0, 0, 0], [0, 0, 0]),
      { ...line('dup', [0, 0, 0], [0, 1, 0], 2), points: [[0, 0, 0], [0, 0, 0], [0, 1, 0]] },
    ]);
    const { network, report } = normalizeNetwork(n);
    expect(report.rejectedCurves.sort()).toEqual(['nan', 'pt']);
    expect(network.curves.find((c) => c.id === 'dup')!.points).toHaveLength(2);
  });
});

describe('seeded noise', () => {
  it('is reproducible for the same seed and differs across seeds', () => {
    const s = { ...defaultNoise, fragmentProbability: 0.5 };
    const a = perturbNetwork(square(), { ...s, seed: 3 });
    const b = perturbNetwork(square(), { ...s, seed: 3 });
    const c = perturbNetwork(square(), { ...s, seed: 4 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('history', () => {
  it('supports undo and redo', () => {
    const h = new History(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.redo()).toBe(2);
    h.push(9);
    expect(h.canRedo).toBe(false);
  });
});
