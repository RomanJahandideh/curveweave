import { describe, expect, it } from 'vitest';
import { repairNetwork } from '../src/geometry/repair';
import { buildSurface } from '../src/geometry/patches';
import { renderNormals, surfaceMetrics } from '../src/geometry/mesh';
import { presets } from '../src/geometry/presets';
import { dist } from '../src/geometry/vec3';
import type { CurveNetwork } from '../src/geometry/types';
import { line, net, square } from './helpers';

const surf = (n: CurveNetwork, res = 8) => {
  const r = repairNetwork(n);
  return buildSurface(r.network, r.provenance.vertexOf, res);
};

/** Two unit squares sharing the curve x = 1, optionally folded about it. */
function twoPanels(feature: 'sharp' | 'smooth', fold = 0): CurveNetwork {
  const z = Math.sin(fold);
  const x2 = 1 + Math.cos(fold);
  return net(
    [
      line('a0', [0, 0, 0], [1, 0, 0]),
      line('a2', [1, 1, 0], [0, 1, 0]),
      line('a3', [0, 1, 0], [0, 0, 0]),
      line('m', [1, 0, 0], [1, 1, 0], 8, { feature }),
      line('b0', [1, 0, 0], [x2, 0, z]),
      line('b1', [x2, 0, z], [x2, 1, z]),
      line('b2', [x2, 1, z], [1, 1, 0]),
    ],
    {
      patches: [
        { id: 'A', sides: ['a0', 'm', 'a2', 'a3'] },
        { id: 'B', sides: ['b0', 'b1', 'b2', 'm'] },
      ],
    },
  );
}

describe('surface reconstruction', () => {
  it('a Coons patch interpolates its boundary and is planar for a planar square', () => {
    const s = surf(square());
    expect(s.failures).toEqual([]);
    expect(s.positions.every((p) => Math.abs(p[2]) < 1e-12)).toBe(true);
    // Interior of a unit square Coons patch is the bilinear grid.
    const p = s.patches[0];
    const mid = p.mesh.positions[4 * 9 + 4];
    expect(dist(mid, [0.5, 0.5, 0])).toBeLessThan(1e-12);
  });

  it('fills a three-sided patch with interior vertices strictly inside', () => {
    const n = net(
      [line('t0', [0, 0, 0], [1, 0, 0]), line('t1', [1, 0, 0], [0, 1, 0]), line('t2', [0, 1, 0], [0, 0, 0])],
      { patches: [{ id: 'T', sides: ['t0', 't1', 't2'] }] },
    );
    const s = surf(n);
    expect(s.failures).toEqual([]);
    expect(s.patches[0].sides).toBe(3);
    s.positions.forEach((p, i) => {
      if (!s.fixed[i]) {
        expect(p[0]).toBeGreaterThan(0);
        expect(p[1]).toBeGreaterThan(0);
        expect(p[0] + p[1]).toBeLessThan(1);
      }
    });
    expect(surfaceMetrics(s).nonManifoldEdges).toBe(0);
  });

  it('welds patches that share a curve', () => {
    const s = surf(twoPanels('smooth'), 8);
    // Two 9x9 grids sharing one column of 9 vertices.
    expect(s.positions.length).toBe(2 * 81 - 9);
    const m = surfaceMetrics(s);
    expect(m.nonManifoldEdges).toBe(0);
    expect(m.seams).toHaveLength(1);
    expect(m.seams[0].meanNormalAngleDeg).toBeLessThan(1e-6); // coplanar, consistently oriented
  });

  it('measures the fold at a sharp seam and splits render normals there', () => {
    const fold = Math.PI / 4;
    const s = surf(twoPanels('sharp', fold), 8);
    const m = surfaceMetrics(s);
    expect(m.sharpSeamAngleDeg).toBeCloseTo(45, 6);
    const normals = renderNormals(s);
    // The seam vertex has different normals in the two patches.
    const key = 'c:m:4';
    const ga = s.patches[0].keys.indexOf(key);
    const gb = s.patches[1].keys.indexOf(key);
    const na = normals[0][ga];
    const nb = normals[1][gb];
    expect(dist(na, nb)).toBeGreaterThan(0.5);
  });

  it('reports a failure instead of filling an open boundary', () => {
    const n = square({ 's0:1': [0.3, 0, 0] }); // gap far above the tolerance
    const s = surf(n);
    expect(s.patches).toHaveLength(0);
    expect(s.failures[0].reason).toMatch(/not closed/);
  });

  it('reconstructs every preset without failures or non-manifold edges', () => {
    for (const p of presets) {
      const s = surf(p.make(), 10);
      const m = surfaceMetrics(s);
      expect(s.failures, p.name).toEqual([]);
      expect(m.nonManifoldEdges, p.name).toBe(0);
      expect(m.degenerateTriangles, p.name).toBe(0);
    }
  });
});
