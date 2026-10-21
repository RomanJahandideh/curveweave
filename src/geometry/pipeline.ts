/** End-to-end pipeline: repair -> validate -> patches -> constrained fairing -> metrics. */
import type { CurveNetwork, OptimizationResult, OptimizationSettings, Vec3 } from './types';
import type { Decisions, RepairResult, RepairSettings } from './repair';
import { defaultRepairSettings, repairNetwork } from './repair';
import type { TopologyReport } from './validate';
import { validateTopology } from './validate';
import type { WeldedSurface } from './patches';
import { buildSurface } from './patches';
import type { SurfaceMetrics } from './mesh';
import { surfaceMetrics } from './mesh';
import { defaultOptimization, solveSurface } from './solver';

export interface PipelineSettings {
  repair: RepairSettings;
  optimization: OptimizationSettings;
  resolution: number;
  runSolver: boolean;
}

export const defaultPipeline: PipelineSettings = {
  repair: defaultRepairSettings,
  optimization: defaultOptimization,
  resolution: 12,
  runSolver: true,
};

export interface StageTiming {
  stage: 'repair' | 'validate' | 'patches' | 'solve' | 'metrics';
  millis: number;
}

export interface PipelineOutput {
  repair: RepairResult;
  topology: TopologyReport;
  surface: WeldedSurface;
  /** Initial (Coons / harmonic) positions, before fairing. */
  initialPositions: Vec3[];
  /** Final positions (faired if the solver ran and did not fail). */
  positions: Vec3[];
  optimization?: OptimizationResult;
  initialMetrics: SurfaceMetrics;
  metrics: SurfaceMetrics;
  timings: StageTiming[];
}

export function runPipeline(
  network: CurveNetwork,
  settings: PipelineSettings = defaultPipeline,
  decisions: Decisions = {},
): PipelineOutput {
  const timings: StageTiming[] = [];
  const time = <T>(stage: StageTiming['stage'], f: () => T): T => {
    const t0 = performance.now();
    const v = f();
    timings.push({ stage, millis: performance.now() - t0 });
    return v;
  };
  const repair = time('repair', () => repairNetwork(network, settings.repair, decisions));
  const topology = time('validate', () => validateTopology(repair));
  const surface = time('patches', () => buildSurface(repair.network, repair.provenance.vertexOf, settings.resolution));
  let positions = surface.positions;
  let optimization: OptimizationResult | undefined;
  if (settings.runSolver && surface.patches.length) {
    const out = time('solve', () => solveSurface(surface, settings.optimization, network.constraints.planarPatches));
    positions = out.positions;
    optimization = out.result;
  }
  const [initialMetrics, metrics] = time('metrics', () => [
    surfaceMetrics(surface),
    surfaceMetrics(surface, positions),
  ]);
  return {
    repair,
    topology,
    surface,
    initialPositions: surface.positions,
    positions,
    optimization,
    initialMetrics,
    metrics,
    timings,
  };
}
