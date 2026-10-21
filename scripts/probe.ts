import { presets } from '../src/geometry/presets';
import { repairNetwork } from '../src/geometry/repair';
import { validateTopology } from '../src/geometry/validate';
import { buildSurface } from '../src/geometry/patches';
import { surfaceMetrics } from '../src/geometry/mesh';
import { perturbNetwork, defaultNoise } from '../src/geometry/noise';
for (const p of presets) {
  for (const noisy of [false, true]) {
    const net = noisy ? perturbNetwork(p.make(), defaultNoise) : p.make();
    const r = repairNetwork(net);
    const t = validateTopology(r);
    const s = buildSurface(r.network, r.provenance.vertexOf);
    const m = surfaceMetrics(s);
    console.log(p.name, noisy ? 'noisy' : 'clean', JSON.stringify({ v: t.vertices, e: t.edges, open: t.openEndpoints, sug: t.mergesSuggested, rej: t.mergesRejected, dup: t.duplicatesRemoved, join: t.fragmentsJoined, deg: t.degreeDistribution }));
    console.log('   surface', JSON.stringify({ ok: m.patches, fail: s.failures, nm: m.nonManifoldEdges, degen: m.degenerateTriangles, minA: m.minTriangleAngleDeg.toFixed(1), smooth: m.smoothSeamAngleDeg.toFixed(2), sharp: m.sharpSeamAngleDeg.toFixed(2) }));
    for (const c of r.candidates.filter((c) => c.status !== 'merged')) console.log('     ', c.id, c.status, c.reason);
  }
}
import { solveSurface, defaultOptimization } from '../src/geometry/solver';
for (const p of presets) {
  const r = repairNetwork(p.make());
  const s = buildSurface(r.network, r.provenance.vertexOf, 12);
  const o = solveSurface(s, defaultOptimization);
  const m0 = surfaceMetrics(s), m1 = surfaceMetrics(s, o.positions);
  console.log(p.name, o.result.converged, o.result.iterations, o.result.variables, o.result.equations, o.result.millis.toFixed(0) + 'ms', 'smooth', m0.smoothSeamAngleDeg.toFixed(2), '->', m1.smoothSeamAngleDeg.toFixed(2), 'sharp', m0.sharpSeamAngleDeg.toFixed(2), '->', m1.sharpSeamAngleDeg.toFixed(2));
}
