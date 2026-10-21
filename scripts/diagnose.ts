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
