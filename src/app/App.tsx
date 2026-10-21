import { useCallback, useMemo, useRef, useState } from 'react';
import type { CurveNetwork, FeatureType, OptimizationSettings } from '../geometry/types';
import { endpointKey } from '../geometry/types';
import type { RepairSettings } from '../geometry/repair';
import { defaultRepairSettings } from '../geometry/repair';
import { defaultOptimization } from '../geometry/solver';
import type { PipelineSettings } from '../geometry/pipeline';
import { runPipeline } from '../geometry/pipeline';
import { presets } from '../geometry/presets';
import { perturbNetwork } from '../geometry/noise';
import { History } from '../geometry/history';
import { flattenMetrics, networkToJSON, parseNetwork, toCSV, toGLB, toOBJ } from '../geometry/io';
import type { FlattenResult } from '../geometry/flatten';
import { flattenPatch, flattenToSVG } from '../geometry/flatten';
import type { EditState, NoiseUi, Selection } from './state';
import { applyEdits, download, editFromNetwork, noiseFromUi, slug } from './state';
import type { ViewOptions } from './Viewport';
import { Viewport, featureColor } from './Viewport';
import { LineChart } from './Chart';

const num = (v: number, d = 3) => (Number.isFinite(v) ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(d)) : '—');

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  log = false,
  format = (v: number) => num(v),
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  log?: boolean;
  format?: (v: number) => string;
  testId?: string;
}) {
  const toS = (v: number) => (log ? Math.log10(Math.max(v, 10 ** min)) : v);
  const fromS = (s: number) => (log ? 10 ** s : s);
  return (
    <label className="slider">
      <span>
        {label} <b>{format(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? (max - min) / 100}
        value={toS(value)}
        onChange={(e) => onChange(fromS(Number(e.target.value)))}
        data-testid={testId}
      />
    </label>
  );
}

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} /> {label}
    </label>
  );
}

export function App() {
  const [presetId, setPresetId] = useState(presets[0].id);
  const [base, setBase] = useState<CurveNetwork>(() => presets[0].make());
  const [noise, setNoise] = useState<NoiseUi>({ enabled: true, seed: 1, level: 1 });
  const [repairSettings, setRepairSettings] = useState<RepairSettings>(defaultRepairSettings);
  const [opt, setOpt] = useState<OptimizationSettings>(defaultOptimization);
  const [resolution, setResolution] = useState(12);
  const [runSolver, setRunSolver] = useState(true);
  const [view, setView] = useState<ViewOptions>({
    showInput: false,
    showCurves: true,
    showSurface: true,
    showWireframe: false,
    showJunctions: true,
    showCandidates: true,
    faired: true,
    colorBy: 'patch',
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [candidateFilter, setCandidateFilter] = useState<'open' | 'all'>('open');
  const [flat, setFlat] = useState<{ patchId: string; result: FlattenResult } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const history = useRef(new History<EditState>(editFromNetwork(base)));
  const [edit, setEditState] = useState<EditState>(history.current.current);
  const commit = useCallback((next: EditState) => {
    history.current.push(next);
    setEditState(next);
  }, []);
  const undo = () => setEditState(history.current.undo());
  const redo = () => setEditState(history.current.redo());

  const loadNetwork = (n: CurveNetwork, id: string) => {
    setPresetId(id);
    setBase(n);
    history.current = new History(editFromNetwork(n));
    setEditState(history.current.current);
    setSelection(null);
    setFlat(null);
  };

  const input = useMemo(() => (noise.enabled ? perturbNetwork(base, noiseFromUi(noise)) : base), [base, noise]);
  const network = useMemo(() => applyEdits(input, edit), [input, edit]);
  const settings: PipelineSettings = useMemo(
    () => ({ repair: repairSettings, optimization: opt, resolution, runSolver }),
    [repairSettings, opt, resolution, runSolver],
  );
  const out = useMemo(() => runPipeline(network, settings, edit.decisions), [network, settings, edit.decisions]);

  const setRepair = (p: Partial<RepairSettings>) => setRepairSettings((s) => ({ ...s, ...p }));
  const setO = (p: Partial<OptimizationSettings>) => setOpt((s) => ({ ...s, ...p }));
  const setV = (p: Partial<ViewOptions>) => setView((s) => ({ ...s, ...p }));

  const candidates = out.repair.candidates.filter((c) => candidateFilter === 'all' || c.status !== 'merged');
  const selCurve = selection?.kind === 'curve' ? selection.sourceId : null;
  const selPatch = selection?.kind === 'patch' ? selection.id : null;
  const selCand = selection?.kind === 'candidate' ? out.repair.candidates.find((c) => c.id === selection.id) : undefined;
  const curveFeature = selCurve ? network.curves.find((c) => c.sourceId === selCurve)?.feature : undefined;
  const curveSegments = selCurve ? input.curves.filter((c) => c.sourceId === selCurve) : [];

  const setDecision = (id: string, d: 'accept' | 'reject' | null) => {
    const decisions = { ...edit.decisions };
    if (d) decisions[id] = d;
    else delete decisions[id];
    commit({ ...edit, decisions });
  };
  const toggleKeepSeparate = (a: string, b: string) => {
    const has = edit.keepSeparate.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    commit({
      ...edit,
      keepSeparate: has ? edit.keepSeparate.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))) : [...edit.keepSeparate, [a, b]],
    });
  };
  const toggleKeepOpen = (k: string) =>
    commit({ ...edit, keepOpen: edit.keepOpen.includes(k) ? edit.keepOpen.filter((x) => x !== k) : [...edit.keepOpen, k] });
  const setFeature = (sid: string, f: FeatureType) => commit({ ...edit, features: { ...edit.features, [sid]: f } });
  const togglePlanar = (pid: string) =>
    commit({
      ...edit,
      planarPatches: edit.planarPatches.includes(pid) ? edit.planarPatches.filter((x) => x !== pid) : [...edit.planarPatches, pid],
    });

  const name = slug(base.name);
  const metricsDoc = () => ({
    network: base.name,
    noise: noise.enabled ? noiseFromUi(noise) : null,
    repairSettings,
    optimizationSettings: opt,
    resolution,
    topology: out.topology,
    patchFailures: out.surface.failures,
    initialSurface: out.initialMetrics,
    surface: out.metrics,
    optimization: out.optimization
      ? { ...out.optimization, residualHistory: out.optimization.residualHistory, energyHistory: out.optimization.energyHistory }
      : null,
    timings: out.timings,
  });

  const onImport = async (file: File) => {
    try {
      const n = parseNetwork(await file.text());
      setImportError(null);
      setNoise((s) => ({ ...s, enabled: false }));
      loadNetwork(n, 'import');
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  const doFlatten = (pid: string) => {
    const pi = out.surface.patches.findIndex((p) => p.id === pid);
    if (pi < 0) return;
    const P = out.surface.globalIndex[pi].map((gi) => out.positions[gi]);
    setFlat({ patchId: pid, result: flattenPatch(P, out.surface.patches[pi].mesh.triangles) });
  };

  const o = out.optimization;
  const failures = out.surface.failures;
  const stage = (ok: boolean, warn: boolean) => (ok ? (warn ? 'warn' : 'ok') : 'fail');

  return (
    <div className="app">
      <header className="top">
        <h1>
          CurveWeave <small>intent-aware curve-network repair and surface reconstruction</small>
        </h1>
        <div className="top-actions">
          <button onClick={undo} disabled={!history.current.canUndo} data-testid="undo">
            Undo
          </button>
          <button onClick={redo} disabled={!history.current.canRedo} data-testid="redo">
            Redo
          </button>
          <a href="https://github.com/RomanJahandideh/curveweave" target="_blank" rel="noreferrer">
            Source
          </a>
        </div>
      </header>

      <aside className="panel left" aria-label="Constraints">
        <section>
          <h2>Input</h2>
          <label className="field">
            Preset
            <select
              value={presetId}
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (p) loadNetwork(p.make(), p.id);
              }}
              data-testid="preset"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {presetId === 'import' && <option value="import">{base.name}</option>}
            </select>
          </label>
          <label className="field file">
            Import network JSON
            <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </label>
          {importError && <p className="error">Import failed: {importError}</p>}
          <Check label="Apply seeded sketch noise" checked={noise.enabled} onChange={(v) => setNoise({ ...noise, enabled: v })} testId="noise" />
          {noise.enabled && (
            <>
              <label className="field inline">
                Seed
                <input type="number" value={noise.seed} min={0} onChange={(e) => setNoise({ ...noise, seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} data-testid="seed" />
              </label>
              <Slider label="Noise level" value={noise.level} min={0} max={3} step={0.1} onChange={(v) => setNoise({ ...noise, level: v })} format={(v) => `${v.toFixed(1)}×`} />
            </>
          )}
        </section>

        <section>
          <h2>Topology repair</h2>
          <div className="seg" role="radiogroup">
            {(['baseline', 'proposed'] as const).map((m) => (
              <button key={m} className={repairSettings.mode === m ? 'on' : ''} onClick={() => setRepair({ mode: m })} data-testid={`mode-${m}`}>
                {m === 'baseline' ? 'Distance-only baseline' : 'Intent-aware'}
              </button>
            ))}
          </div>
          <Slider label="Tolerance (× diagonal)" value={repairSettings.tolerance} min={0.002} max={0.06} step={0.001} onChange={(v) => setRepair({ tolerance: v })} testId="tolerance" />
          {repairSettings.mode === 'proposed' && (
            <>
              <Slider label="Min junction angle" value={repairSettings.minJunctionAngleDeg} min={0} max={60} step={1} onChange={(v) => setRepair({ minJunctionAngleDeg: v })} format={(v) => `${v.toFixed(0)}°`} />
              <Slider label="Max valence" value={repairSettings.maxValence} min={2} max={10} step={1} onChange={(v) => setRepair({ maxValence: v })} format={(v) => v.toFixed(0)} />
              <Check label="Respect designer labels" checked={repairSettings.useDesignerConstraints} onChange={(v) => setRepair({ useDesignerConstraints: v })} testId="use-labels" />
              <Check label="Join same-curve fragments" checked={repairSettings.joinFragments} onChange={(v) => setRepair({ joinFragments: v })} />
              <Check label="Remove duplicate strokes" checked={repairSettings.removeDuplicates} onChange={(v) => setRepair({ removeDuplicates: v })} />
            </>
          )}
        </section>

        <section>
          <h2>
            Merge candidates <span className="count">{out.repair.candidates.length}</span>
          </h2>
          <div className="seg small">
            <button className={candidateFilter === 'open' ? 'on' : ''} onClick={() => setCandidateFilter('open')}>
              Unmerged
            </button>
            <button className={candidateFilter === 'all' ? 'on' : ''} onClick={() => setCandidateFilter('all')}>
              All
            </button>
          </div>
          <ul className="candidates" data-testid="candidates">
            {candidates.length === 0 && <li className="muted">None.</li>}
            {candidates.map((c) => (
              <li key={c.id} className={`${c.status} ${selCand === c ? 'selected' : ''}`}>
                <button className="link" onClick={() => setSelection({ kind: 'candidate', id: c.id })}>
                  <code>{c.a}</code> ↔ <code>{c.b}</code>
                </button>
                <span className={`badge ${c.status}`}>{c.status}</span>
                <div className="reason">{c.reason}</div>
                <div className="terms">
                  d {(c.terms.distance * 100).toFixed(0)}% tol · angle {c.angleDeg.toFixed(0)}° · score {c.score.toFixed(2)}
                </div>
                <div className="row">
                  <button onClick={() => setDecision(c.id, 'accept')} disabled={edit.decisions[c.id] === 'accept'}>
                    Accept
                  </button>
                  <button onClick={() => setDecision(c.id, 'reject')} disabled={edit.decisions[c.id] === 'reject'}>
                    Reject
                  </button>
                  {edit.decisions[c.id] && <button onClick={() => setDecision(c.id, null)}>Reset</button>}
                  <button onClick={() => toggleKeepSeparate(c.a, c.b)} title="Designer label: never merge this pair">
                    {edit.keepSeparate.some(([x, y]) => (x === c.a && y === c.b) || (x === c.b && y === c.a)) ? 'Unlabel' : 'Keep separate'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Selection</h2>
          {!selection && <p className="muted">Click a curve, patch or candidate in the viewport.</p>}
          {selCurve && (
            <div data-testid="curve-inspector">
              <p>
                Curve <code>{selCurve}</code> ({curveSegments.length} input segment{curveSegments.length === 1 ? '' : 's'})
              </p>
              <div className="seg small">
                {(['sharp', 'smooth', 'unspecified'] as const).map((f) => (
                  <button key={f} className={curveFeature === f ? 'on' : ''} style={{ borderColor: featureColor[f] }} onClick={() => setFeature(selCurve, f)}>
                    {f}
                  </button>
                ))}
              </div>
              {curveSegments.flatMap((c) =>
                ([0, 1] as const).map((end) => {
                  const k = endpointKey({ curveId: c.id, end });
                  return <Check key={k} label={`Keep ${k} open`} checked={edit.keepOpen.includes(k)} onChange={() => toggleKeepOpen(k)} />;
                }),
              )}
            </div>
          )}
          {selPatch && (
            <div data-testid="patch-inspector">
              <p>
                Patch <code>{selPatch}</code> {base.patches.find((p) => p.id === selPatch)?.label}
              </p>
              <Check label="Planarity regularization" checked={edit.planarPatches.includes(selPatch)} onChange={() => togglePlanar(selPatch)} />
              <button onClick={() => doFlatten(selPatch)} data-testid="flatten">
                Flatten for fabrication
              </button>
            </div>
          )}
          {selCand && (
            <p>
              Candidate <code>{selCand.id}</code>: {selCand.status}. {selCand.reason}.
            </p>
          )}
        </section>

        <section>
          <h2>Surface and solver</h2>
          <Slider label="Patch resolution" value={resolution} min={4} max={24} step={1} onChange={(v) => setResolution(Math.round(v))} format={(v) => v.toFixed(0)} />
          <Check label="Run constrained fairing" checked={runSolver} onChange={setRunSolver} testId="run-solver" />
          <Slider label="λ fair" value={opt.lambdaFair} min={-3} max={2} log onChange={(v) => setO({ lambdaFair: v })} />
          <Slider label="λ reference" value={opt.lambdaReference} min={-4} max={1} log onChange={(v) => setO({ lambdaReference: v })} />
          <Slider label="λ smooth seam" value={opt.lambdaSeam} min={-3} max={2} log onChange={(v) => setO({ lambdaSeam: v })} />
          <Slider label="λ planarity" value={opt.lambdaRegularization} min={-3} max={3} log onChange={(v) => setO({ lambdaRegularization: v })} testId="lambda-reg" />
          <Slider label="CG tolerance" value={opt.tolerance} min={-12} max={-2} log onChange={(v) => setO({ tolerance: v })} />
          <Slider label="Max iterations" value={opt.maxIterations} min={1} max={5000} step={1} onChange={(v) => setO({ maxIterations: Math.round(v) })} format={(v) => v.toFixed(0)} testId="max-iter" />
          {edit.planarPatches.length > 0 && opt.lambdaRegularization === 0 && <p className="muted">Planar patches are labelled but λ planarity is 0.</p>}
        </section>
      </aside>

      <main className="viewport">
        <Viewport input={input} out={out} view={view} selection={selection} onSelect={setSelection} />
        <div className="view-toggles">
          <Check label="Input strokes" checked={view.showInput} onChange={(v) => setV({ showInput: v })} />
          <Check label="Curves" checked={view.showCurves} onChange={(v) => setV({ showCurves: v })} />
          <Check label="Surface" checked={view.showSurface} onChange={(v) => setV({ showSurface: v })} testId="show-surface" />
          <Check label="Wireframe" checked={view.showWireframe} onChange={(v) => setV({ showWireframe: v })} />
          <Check label="Junctions" checked={view.showJunctions} onChange={(v) => setV({ showJunctions: v })} />
          <Check label="Candidates" checked={view.showCandidates} onChange={(v) => setV({ showCandidates: v })} />
          <Check label="Faired" checked={view.faired} onChange={(v) => setV({ faired: v })} />
          <Check label="Colour patches" checked={view.colorBy === 'patch'} onChange={(v) => setV({ colorBy: v ? 'patch' : 'uniform' })} />
        </div>
        <div className="legend-overlay">
          <span><i style={{ background: featureColor.sharp }} />sharp</span>
          <span><i style={{ background: featureColor.smooth }} />smooth</span>
          <span><i style={{ background: featureColor.unspecified }} />unspecified</span>
          <span><i style={{ background: '#ff4d6d' }} />open end</span>
          <span><i style={{ background: '#ffa94d' }} />suggested merge</span>
        </div>
      </main>

      <aside className="panel right" aria-label="Metrics">
        <section>
          <h2>Topology</h2>
          <table className="kv" data-testid="topology">
            <tbody>
              <tr><td>Junctions</td><td>{out.topology.junctions}</td></tr>
              <tr><td>Open endpoints</td><td>{out.topology.openEndpoints}</td></tr>
              <tr><td>Edges / vertices</td><td>{out.topology.edges} / {out.topology.vertices}</td></tr>
              <tr><td>Components</td><td>{out.topology.connectedComponents}</td></tr>
              <tr><td>Merged / suggested / rejected</td><td>{out.topology.mergesApplied} / {out.topology.mergesSuggested} / {out.topology.mergesRejected}</td></tr>
              <tr><td>Fragments joined</td><td>{out.topology.fragmentsJoined}</td></tr>
              <tr><td>Duplicates removed</td><td>{out.topology.duplicatesRemoved}</td></tr>
              <tr><td>Degenerate edges</td><td>{out.topology.degenerateEdges}</td></tr>
              <tr><td>Max snap displacement</td><td>{num(out.topology.maxDisplacement)}</td></tr>
              <tr><td>Degree distribution</td><td>{Object.entries(out.topology.degreeDistribution).map(([d, n]) => `${d}:${n}`).join(' ')}</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2>Surface</h2>
          <table className="kv" data-testid="surface-metrics">
            <thead><tr><th /><th>initial</th><th>{o ? 'faired' : 'final'}</th></tr></thead>
            <tbody>
              <tr><td>Patches built / failed</td><td colSpan={2}>{out.metrics.patches} / {out.metrics.failedPatches}</td></tr>
              <tr><td>Non-manifold edges</td><td colSpan={2}>{out.metrics.nonManifoldEdges}</td></tr>
              <tr><td>Smooth-seam normal angle</td><td>{num(out.initialMetrics.smoothSeamAngleDeg, 2)}°</td><td>{num(out.metrics.smoothSeamAngleDeg, 2)}°</td></tr>
              <tr><td>Sharp-seam fold angle</td><td>{num(out.initialMetrics.sharpSeamAngleDeg, 2)}°</td><td>{num(out.metrics.sharpSeamAngleDeg, 2)}°</td></tr>
              <tr><td>Min triangle angle</td><td>{num(out.initialMetrics.minTriangleAngleDeg, 1)}°</td><td>{num(out.metrics.minTriangleAngleDeg, 1)}°</td></tr>
              <tr><td>Area</td><td>{num(out.initialMetrics.area, 2)}</td><td>{num(out.metrics.area, 2)}</td></tr>
            </tbody>
          </table>
          {failures.length > 0 && (
            <ul className="failures" data-testid="failures">
              {failures.map((f) => (
                <li key={f.patchId}>
                  <code>{f.patchId}</code>: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>Optimization</h2>
          {!o && <p className="muted">{runSolver ? 'No patches to optimize.' : 'Fairing is off: showing the initial Coons / harmonic fill.'}</p>}
          {o && (
            <>
              <p className={o.converged ? 'ok-text' : o.failed ? 'error' : 'warn-text'} data-testid="solver-status">
                {o.converged ? `Converged in ${o.iterations} iterations` : o.failed ? `Failed: ${o.failureReason}` : `Not converged: ${o.failureReason}`}
              </p>
              <table className="kv">
                <tbody>
                  <tr><td>Variables / equations</td><td>{o.variables} / {o.equations}</td></tr>
                  <tr><td>E_total (weighted) initial → final</td><td>{num(o.initialEnergy)} → {num(o.finalEnergy)}</td></tr>
                  <tr><td>E_fair (unweighted)</td><td>{num(o.terms.fair)}</td></tr>
                  <tr><td>E_ref (unweighted)</td><td>{num(o.terms.reference)}</td></tr>
                  <tr><td>E_seam (unweighted)</td><td>{num(o.terms.seam)}</td></tr>
                  <tr><td>E_reg planarity (unweighted)</td><td>{num(o.terms.regularization)}</td></tr>
                  <tr><td>Solve time</td><td>{o.millis.toFixed(0)} ms</td></tr>
                </tbody>
              </table>
              <LineChart title="Relative residual ‖b − Ax‖ / ‖b‖" series={[{ name: 'residual', values: o.residualHistory, color: '#3fb6ff' }]} log testId="residual-chart" />
              <LineChart title="Total energy per iteration" series={[{ name: 'E_total', values: o.energyHistory, color: '#9be564' }]} />
            </>
          )}
        </section>
        {flat && (
          <section data-testid="flatten-panel">
            <h2>Flattening: {flat.patchId}</h2>
            <table className="kv">
              <tbody>
                <tr><td>Mean / max edge distortion</td><td>{(100 * flat.result.meanEdgeDistortion).toFixed(2)}% / {(100 * flat.result.maxEdgeDistortion).toFixed(2)}%</td></tr>
                <tr><td>Mean area distortion</td><td>{(100 * flat.result.meanAreaDistortion).toFixed(2)}%</td></tr>
                <tr><td>Inverted triangles</td><td>{flat.result.invertedTriangles}</td></tr>
                <tr><td>Iterations</td><td>{flat.result.iterations}</td></tr>
              </tbody>
            </table>
            <button onClick={() => download(`${name}-${flat.patchId}-flat.svg`, flattenToSVG(flat.result, `${base.name} ${flat.patchId}`), 'image/svg+xml')}>
              Download SVG
            </button>
          </section>
        )}
      </aside>

      <footer className="pipeline" aria-label="Pipeline">
        <ol className="stages">
          <li className={stage(true, out.topology.openEndpoints > 0 && out.topology.mergesSuggested > 0)}>
            <b>1 · Repair</b>
            <span>{repairSettings.mode === 'proposed' ? 'intent-aware' : 'distance-only'}, {out.topology.mergesApplied} merged, {out.topology.mergesSuggested} suggested</span>
            <em>{out.timings.find((t) => t.stage === 'repair')?.millis.toFixed(1)} ms</em>
          </li>
          <li className={stage(out.topology.degenerateEdges === 0, out.topology.openEndpoints > 0)}>
            <b>2 · Validate</b>
            <span>{out.topology.junctions} junctions, {out.topology.openEndpoints} open ends, {out.topology.degenerateEdges} degenerate</span>
            <em>{out.timings.find((t) => t.stage === 'validate')?.millis.toFixed(1)} ms</em>
          </li>
          <li className={stage(out.surface.patches.length > 0, failures.length > 0)} data-testid="stage-patches">
            <b>3 · Patches</b>
            <span>{out.surface.patches.length} built, {failures.length} failed, {out.surface.positions.length} vertices</span>
            <em>{out.timings.find((t) => t.stage === 'patches')?.millis.toFixed(1)} ms</em>
          </li>
          <li className={o ? stage(!o.failed, !o.converged) : 'idle'}>
            <b>4 · Fairing</b>
            <span>{o ? (o.converged ? `converged, ${o.iterations} it` : o.failed ? 'failed' : `stopped at ${o.iterations} it`) : 'off'}</span>
            <em>{o ? `${o.millis.toFixed(0)} ms` : ''}</em>
          </li>
          <li className="ok">
            <b>5 · Export</b>
            <span className="exports">
              <button onClick={() => download(`${name}-input.json`, networkToJSON(network), 'application/json')}>Original JSON</button>
              <button onClick={() => download(`${name}-repaired.json`, networkToJSON(out.repair.network), 'application/json')}>Repaired JSON</button>
              <button disabled={!out.surface.patches.length} onClick={() => download(`${name}.obj`, toOBJ(out.surface, out.positions, base.name), 'text/plain')} data-testid="export-obj">OBJ</button>
              <button disabled={!out.surface.patches.length} onClick={() => download(`${name}.glb`, toGLB(out.surface, out.positions), 'model/gltf-binary')}>GLB</button>
              <button onClick={() => download(`${name}-metrics.json`, JSON.stringify(metricsDoc(), null, 2), 'application/json')}>Metrics JSON</button>
              <button
                onClick={() =>
                  download(
                    `${name}-metrics.csv`,
                    toCSV(flattenMetrics({ topology: out.topology, surface: out.metrics, optimization: o ? { ...o, residualHistory: undefined, energyHistory: undefined } : null }).map(([k, v]) => ({ metric: k, value: v }))),
                    'text/csv',
                  )
                }
              >
                Metrics CSV
              </button>
            </span>
          </li>
        </ol>
      </footer>
    </div>
  );
}
