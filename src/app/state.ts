/** Editable designer state layered on top of the input network, plus helpers. */
import type { CurveNetwork, FeatureType } from '../geometry/types';
import type { Decisions } from '../geometry/repair';
import type { NoiseSettings } from '../geometry/noise';
import { defaultNoise } from '../geometry/noise';

export interface EditState {
  decisions: Decisions;
  keepOpen: string[];
  keepSeparate: [string, string][];
  planarPatches: string[];
  /** Feature overrides by sourceId. */
  features: Record<string, FeatureType>;
}

export const editFromNetwork = (n: CurveNetwork): EditState => ({
  decisions: {},
  keepOpen: [...n.constraints.keepOpen],
  keepSeparate: n.constraints.keepSeparate.map(([a, b]) => [a, b] as [string, string]),
  planarPatches: [...n.constraints.planarPatches],
  features: {},
});

export function applyEdits(n: CurveNetwork, e: EditState): CurveNetwork {
  return {
    ...n,
    curves: n.curves.map((c) => (e.features[c.sourceId] ? { ...c, feature: e.features[c.sourceId] } : c)),
    constraints: { keepOpen: e.keepOpen, keepSeparate: e.keepSeparate, planarPatches: e.planarPatches },
  };
}

export interface NoiseUi {
  enabled: boolean;
  seed: number;
  /** Multiplier on the default perturbation amplitudes. */
  level: number;
}

export const noiseFromUi = (u: NoiseUi): NoiseSettings => ({
  ...defaultNoise,
  seed: u.seed,
  jitter: defaultNoise.jitter * u.level,
  gap: defaultNoise.gap * u.level,
  overshoot: defaultNoise.overshoot * u.level,
  sampleNoise: defaultNoise.sampleNoise * u.level,
});

export type Selection =
  | { kind: 'curve'; sourceId: string }
  | { kind: 'candidate'; id: string }
  | { kind: 'patch'; id: string }
  | null;

export function download(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
