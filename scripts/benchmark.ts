/**
 * CurveWeave benchmark.
 *
 *   npm run benchmark            full run (3 presets x 3 noise levels x 10 seeds x 4 methods)
 *   npm run benchmark -- --quick 2 seeds, for smoke testing
 *
 * Writes results/benchmark.csv (one row per run), results/benchmark.json,
 * results/summary.json (mean and standard deviation per group),
 * results/tables.md (generated tables) and results/charts/*.svg.
 * Every number is computed here from the runs; nothing is entered by hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { presets } from '../src/geometry/presets';
import { perturbNetwork, defaultNoise } from '../src/geometry/noise';
import type { NoiseSettings } from '../src/geometry/noise';
import { defaultPipeline, runPipeline } from '../src/geometry/pipeline';
import type { PipelineOutput, PipelineSettings } from '../src/geometry/pipeline';
import { defaultRepairSettings } from '../src/geometry/repair';
import { boundaryError, foldAngleError, scoreJunctions } from '../src/geometry/evaluate';
import { toCSV } from '../src/geometry/io';

const quick = process.argv.includes('--quick');
const SEEDS = quick ? [1, 2] : Array.from({ length: 10 }, (_, i) => i + 1);
const LEVELS = [0.5, 1, 2];
const RESOLUTION = 10;

type Method = 'unrepaired' | 'baseline' | 'proposed-no-labels' | 'proposed-labels';
const METHODS: Method[] = ['unrepaired', 'baseline', 'proposed-no-labels', 'proposed-labels'];
const METHOD_LABEL: Record<Method, string> = {
  unrepaired: 'Unrepaired',
  baseline: 'Distance-only baseline',
  'proposed-no-labels': 'Intent-aware, no labels',
  'proposed-labels': 'Intent-aware + labels',
};

function settingsFor(m: Method): PipelineSettings {
  const base = { ...defaultPipeline, resolution: RESOLUTION };
  switch (m) {
    case 'unrepaired':
      return { ...base, repair: { ...defaultRepairSettings, mode: 'baseline', tolerance: 1e-9 } };
    case 'baseline':
      return { ...base, repair: { ...defaultRepairSettings, mode: 'baseline' } };
    case 'proposed-no-labels':
      return { ...base, repair: { ...defaultRepairSettings, useDesignerConstraints: false } };
    case 'proposed-labels':
      return { ...base, repair: { ...defaultRepairSettings } };
  }
}

const noiseAt = (seed: number, level: number): NoiseSettings => ({
  ...defaultNoise,
  seed,
  jitter: defaultNoise.jitter * level,
  gap: defaultNoise.gap * level,
  overshoot: defaultNoise.overshoot * level,
  sampleNoise: defaultNoise.sampleNoise * level,
});

type Row = Record<string, string | number | boolean>;
const rows: Row[] = [];
const t0 = Date.now();

for (const preset of presets) {
  const clean = preset.make();
  const reference: PipelineOutput = runPipeline(clean, settingsFor('proposed-labels'));
  const totalPatches = clean.patches.length;
  for (const level of LEVELS)
    for (const seed of SEEDS) {
      const noisy = perturbNetwork(clean, noiseAt(seed, level));
      for (const method of METHODS) {
        const start = performance.now();
        const out = runPipeline(noisy, settingsFor(method));
        const totalMs = performance.now() - start;
        const j = scoreJunctions(noisy, clean, out.repair);
        rows.push({
          preset: preset.id,
          level,
          seed,
          method,
          precision: j.precision,
          recall: j.recall,
          f1: j.f1,
          truePairs: j.truePairs,
          predictedPairs: j.predictedPairs,
          positionError: j.meanPositionError,
          patchSuccess: out.surface.patches.length / totalPatches,
          patchesBuilt: out.surface.patches.length,
          patchesTotal: totalPatches,
          boundaryError: boundaryError(out, clean),
          nonManifoldEdges: out.metrics.nonManifoldEdges,
          degenerateEdges: out.topology.degenerateEdges,
          openEndpoints: out.topology.openEndpoints,
          suggestions: out.topology.mergesSuggested,
          foldAngleError: foldAngleError(out, reference),
          smoothSeamAngleDeg: out.metrics.smoothSeamAngleDeg,
          solverConverged: out.optimization ? out.optimization.converged : false,
          solverIterations: out.optimization?.iterations ?? 0,
          repairMs: out.timings.find((t) => t.stage === 'repair')!.millis,
          totalMs,
        });
      }
    }
  console.log(`${preset.name}: done (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// ---------------------------------------------------------------------------
// Aggregation

const metrics = ['precision', 'recall', 'f1', 'positionError', 'patchSuccess', 'boundaryError', 'nonManifoldEdges', 'foldAngleError', 'smoothSeamAngleDeg', 'repairMs', 'totalMs'] as const;
type Metric = (typeof metrics)[number];
interface Stat { mean: number; std: number; n: number }
function stat(values: number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { mean: NaN, std: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, std, n: v.length };
}
const group = (f: (r: Row) => boolean) => {
  const sel = rows.filter(f);
  return Object.fromEntries(metrics.map((m) => [m, stat(sel.map((r) => r[m] as number))])) as Record<Metric, Stat>;
};
const summary = {
  generated: new Date().toISOString(),
  commit: (() => {
    try {
      return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      return 'unknown';
    }
  })(),
  protocol: { seeds: SEEDS, levels: LEVELS, resolution: RESOLUTION, methods: METHODS, noise: defaultNoise, repair: defaultRepairSettings, optimization: defaultPipeline.optimization },
  runs: rows.length,
  byMethod: Object.fromEntries(METHODS.map((m) => [m, group((r) => r.method === m)])),
  byMethodLevel: Object.fromEntries(METHODS.map((m) => [m, Object.fromEntries(LEVELS.map((l) => [l, group((r) => r.method === m && r.level === l)]))])),
  byPresetMethod: Object.fromEntries(presets.map((p) => [p.id, Object.fromEntries(METHODS.map((m) => [m, group((r) => r.preset === p.id && r.method === m)]))])),
  solverConvergedRate: Object.fromEntries(METHODS.map((m) => {
    const sel = rows.filter((r) => r.method === m && (r.patchesBuilt as number) > 0);
    return [m, sel.length ? sel.filter((r) => r.solverConverged).length / sel.length : NaN];
  })),
};

mkdirSync('results/charts', { recursive: true });
writeFileSync('results/benchmark.csv', toCSV(rows));
writeFileSync('results/benchmark.json', JSON.stringify(rows, null, 1));
writeFileSync('results/summary.json', JSON.stringify(summary, null, 2));

// ---------------------------------------------------------------------------
// Tables

const f = (s: Stat, d = 3) => (Number.isFinite(s.mean) ? `${s.mean.toFixed(d)} ± ${s.std.toFixed(d)}` : 'n/a');
let md = `# Generated benchmark tables\n\nGenerated ${summary.generated} at commit \`${summary.commit}\` from ${rows.length} runs `;
md += `(${presets.length} presets × ${LEVELS.length} noise levels × ${SEEDS.length} seeds × ${METHODS.length} methods). Mean ± sample standard deviation.\n\n`;
md += `## All presets and noise levels\n\n| Method | Junction precision | Junction recall | Junction F1 | Position error (× diag) | Patch success | Boundary error (× diag) | Non-manifold edges | Fold-angle error (°) | Smooth-seam angle (°) | Repair ms |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const m of METHODS) {
  const s = summary.byMethod[m];
  md += `| ${METHOD_LABEL[m]} | ${f(s.precision)} | ${f(s.recall)} | ${f(s.f1)} | ${f(s.positionError, 4)} | ${f(s.patchSuccess)} | ${f(s.boundaryError, 4)} | ${f(s.nonManifoldEdges, 1)} | ${f(s.foldAngleError, 2)} | ${f(s.smoothSeamAngleDeg, 2)} | ${f(s.repairMs, 1)} |\n`;
}
md += `\n## Junction F1 by noise level\n\n| Method | ${LEVELS.map((l) => `level ${l}×`).join(' | ')} |\n|---|${LEVELS.map(() => '---').join('|')}|\n`;
for (const m of METHODS) md += `| ${METHOD_LABEL[m]} | ${LEVELS.map((l) => f(summary.byMethodLevel[m][l].f1)).join(' | ')} |\n`;
md += `\n## Patch success by noise level\n\n| Method | ${LEVELS.map((l) => `level ${l}×`).join(' | ')} |\n|---|${LEVELS.map(() => '---').join('|')}|\n`;
for (const m of METHODS) md += `| ${METHOD_LABEL[m]} | ${LEVELS.map((l) => f(summary.byMethodLevel[m][l].patchSuccess)).join(' | ')} |\n`;
md += `\n## By preset (junction F1 / patch success / fold-angle error °)\n\n| Preset | ${METHODS.map((m) => METHOD_LABEL[m]).join(' | ')} |\n|---|${METHODS.map(() => '---').join('|')}|\n`;
for (const p of presets)
  md += `| ${p.name} | ${METHODS.map((m) => {
    const s = summary.byPresetMethod[p.id][m];
    return `${s.f1.mean.toFixed(3)} / ${s.patchSuccess.mean.toFixed(3)} / ${Number.isFinite(s.foldAngleError.mean) ? s.foldAngleError.mean.toFixed(2) : 'n/a'}`;
  }).join(' | ')} |\n`;
md += `\nSolver convergence rate (runs with at least one patch): ${METHODS.map((m) => `${METHOD_LABEL[m]} ${Number.isFinite(summary.solverConvergedRate[m]) ? (100 * summary.solverConvergedRate[m]).toFixed(0) + '%' : 'n/a'}`).join('; ')}.\n`;
writeFileSync('results/tables.md', md);

// ---------------------------------------------------------------------------
// Charts (SVG, grouped bars with ±1 std whiskers)

const COLORS: Record<Method, string> = { unrepaired: '#8f9bb3', baseline: '#ffa94d', 'proposed-no-labels': '#3fb6ff', 'proposed-labels': '#2b8a3e' };
function barChart(file: string, title: string, yLabel: string, metric: Metric, yMax?: number) {
  const W = 640, H = 340, L = 60, R = 16, T = 40, B = 60;
  const groups = LEVELS.map((l) => METHODS.map((m) => summary.byMethodLevel[m][l][metric]));
  const top = yMax ?? Math.max(1e-9, ...groups.flat().map((s) => (Number.isFinite(s.mean) ? s.mean + s.std : 0))) * 1.1;
  const gw = (W - L - R) / LEVELS.length;
  const bw = (gw * 0.8) / METHODS.length;
  const Y = (v: number) => T + (H - T - B) * (1 - Math.min(v, top) / top);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">\n<rect width="100%" height="100%" fill="#ffffff"/>\n<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600">${title}</text>\n`;
  for (let k = 0; k <= 4; k++) {
    const v = (top * k) / 4;
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e7eb"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" fill="#555">${v < 0.01 && v > 0 ? v.toExponential(1) : +v.toFixed(3)}</text>\n`;
  }
  s += `<text transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" fill="#333">${yLabel}</text>\n`;
  groups.forEach((g, gi) => {
    const x0 = L + gi * gw + gw * 0.1;
    g.forEach((st, mi) => {
      if (!Number.isFinite(st.mean)) return;
      const x = x0 + mi * bw;
      s += `<rect x="${x.toFixed(1)}" y="${Y(st.mean).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(Y(0) - Y(st.mean)).toFixed(1)}" fill="${COLORS[METHODS[mi]]}"/>\n`;
      const cx = x + (bw - 2) / 2;
      s += `<line x1="${cx}" x2="${cx}" y1="${Y(Math.max(0, st.mean - st.std))}" y2="${Y(st.mean + st.std)}" stroke="#111" stroke-width="1"/>\n`;
    });
    s += `<text x="${L + gi * gw + gw / 2}" y="${H - B + 18}" text-anchor="middle">noise ${LEVELS[gi]}×</text>\n`;
  });
  METHODS.forEach((m, i) => {
    const x = L + i * ((W - L - R) / METHODS.length);
    s += `<rect x="${x}" y="${H - 22}" width="12" height="12" fill="${COLORS[m]}"/><text x="${x + 16}" y="${H - 12}">${METHOD_LABEL[m]}</text>\n`;
  });
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#333"/>\n</svg>\n`;
  writeFileSync(`results/charts/${file}`, s);
}
barChart('junction-f1.svg', 'Junction F1 vs. ground truth', 'pairwise F1', 'f1', 1);
barChart('patch-success.svg', 'Patch reconstruction success', 'fraction of patches built', 'patchSuccess', 1);
barChart('fold-angle-error.svg', 'Sharp-fold angle error vs. clean reconstruction', 'mean |Δ angle| (degrees)', 'foldAngleError');
barChart('boundary-error.svg', 'Boundary error vs. clean curves', 'mean distance (× diagonal)', 'boundaryError');
barChart('repair-runtime.svg', 'Repair runtime', 'milliseconds', 'repairMs');

console.log(`${rows.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s. Wrote results/.`);
