// Tally patch-failure reasons and unmerged true pairs per method (diagnostic, not part of results).
import { presets } from '../src/geometry/presets';
import { perturbNetwork, defaultNoise } from '../src/geometry/noise';
import { defaultPipeline, runPipeline } from '../src/geometry/pipeline';
import { defaultRepairSettings } from '../src/geometry/repair';
const tally = new Map<string, number>();
for (const p of presets) for (const level of [1, 2]) for (const seed of [1, 2, 3]) {
  const n = perturbNetwork(p.make(), { ...defaultNoise, seed, jitter: defaultNoise.jitter * level, gap: defaultNoise.gap * level, overshoot: defaultNoise.overshoot * level, sampleNoise: defaultNoise.sampleNoise * level });
  for (const mode of ['baseline', 'proposed'] as const) {
    const out = runPipeline(n, { ...defaultPipeline, runSolver: false, repair: { ...defaultRepairSettings, mode } });
    for (const f of out.surface.failures) {
      const k = `${mode} L${level}: ${f.reason.replace(/[\w.#:]+(?= (is|do|has))/g, '<c>')}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    if (mode === 'proposed') for (const c of out.repair.candidates) if (c.status !== 'merged') {
      const k = `proposed L${level} candidate: ${c.reason.replace(/[\d.]+/g, '#')}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
  }
}
console.log([...tally.entries()].sort().map(([k, v]) => `${v}\t${k}`).join('\n'));

// False-positive endpoint pairs (all presets, levels 0.5x/1x/2x, seeds 1-10), split by whether a
// labelled keep-open endpoint is involved. Duplicate strokes are excluded, as in the benchmark.
import { repairNetwork } from '../src/geometry/repair';
import { endpointKey } from '../src/geometry/types';
const fp: Record<string, { labelled: number; other: number }> = {};
for (const p of presets) for (const level of [0.5, 1, 2]) for (let seed = 1; seed <= 10; seed++) {
  const n = perturbNetwork(p.make(), { ...defaultNoise, seed, jitter: defaultNoise.jitter * level, gap: defaultNoise.gap * level, overshoot: defaultNoise.overshoot * level, sampleNoise: defaultNoise.sampleNoise * level });
  const gt = new Map<string, string | null>();
  for (const c of n.curves) if (!c.id.includes('.dup')) for (const e of [0, 1] as const) gt.set(endpointKey({ curveId: c.id, end: e }), c.gtJunction?.[e] ?? null);
  const methods = { baseline: { ...defaultRepairSettings, mode: 'baseline' as const }, 'proposed-no-labels': { ...defaultRepairSettings, useDesignerConstraints: false }, 'proposed-labels': defaultRepairSettings };
  for (const [m, s] of Object.entries(methods)) {
    fp[m] ??= { labelled: 0, other: 0 };
    for (const g of repairNetwork(n, s).clusters) {
      const k = g.filter((x) => gt.has(x));
      for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
        const a = gt.get(k[i]);
        if (a != null && a === gt.get(k[j])) continue;
        if (n.constraints.keepOpen.includes(k[i]) || n.constraints.keepOpen.includes(k[j])) fp[m].labelled++;
        else fp[m].other++;
      }
    }
  }
}
console.log('\nfalse-positive endpoint pairs:', fp);
