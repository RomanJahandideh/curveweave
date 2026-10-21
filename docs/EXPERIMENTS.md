# Experiments

This document fixes the benchmark protocol. Results are in [RESULTS.md](RESULTS.md); the raw outputs are in [`results/`](../results/).

## Question

Does junction repair that uses tangent compatibility, valence, complete-linkage clustering, fragment and duplicate handling, and explicit designer labels recover the intended topology of imperfect architectural curve networks better than distance-only snapping, and does that make patch reconstruction more reliable?

## Data

Three original procedural networks ([`src/geometry/presets.ts`](../src/geometry/presets.ts)):

| Preset | Curves | Patches | Features exercised |
|---|---|---|---|
| Folded Pavilion | 19 | 5 quads | four sharp folds, two columns at degree-4 junctions, a rain spout whose free end lies 0.09 units from a corner and is labelled *keep open* |
| Curved Landscape Canopy | 19 | 6 quads | seven smooth seams, two columns at degree-5 junctions |
| Fragmented Architectural Shell | 29 segments (24 intended curves) | 6 triangles + 5 quads | twelve sharp curves (lantern ribs and crease ring), six smooth legs, an open entrance bay, base arcs drawn as two fragments each, a canopy lip labelled *keep open* |

Every clean endpoint carries the id of its intended junction (`gtJunction`), or `null` when it is intentionally free. The clean network is the ground truth.

## Perturbation

[`src/geometry/noise.ts`](../src/geometry/noise.ts) applies, from a single seeded mulberry32 stream:

1. **Fragmentation:** each curve is split at its middle sample with probability 0.1. The split point gets a new ground-truth junction.
2. **Duplicate strokes:** each curve is redrawn with a small rigid offset with probability 0.05.
3. **Endpoint errors:** each end is trimmed (a gap) or extended along its tangent (an overshoot), then jittered in a random direction. The displacement is blended along 30% of the curve's arc length.
4. **Interior sample noise.**

Amplitudes are fractions of the bounding-box diagonal: jitter 0.006, gap 0.004, overshoot 0.004 and sample noise 0.0008. Each is multiplied by a **noise level** of 0.5×, 1× or 2×. The level scales the same random draws, so a given seed perturbs the same curves in the same directions at every level. The repair tolerance is 0.02 × diagonal. At level 2× the worst-case endpoint error approaches that tolerance.

## Methods

All methods use the same candidate generation (spatial hash, same tolerance) and the same downstream pipeline (patches at resolution 10, then fairing with default weights).

| Id | Description |
|---|---|
| `unrepaired` | No repair: endpoints are identified only if they coincide to within 1e-9 × diagonal. |
| `baseline` | Distance-only snapping: every candidate pair within tolerance is merged (single linkage). No tangent, valence or no-collapse checks, no fragment joining, no duplicate removal, no labels. |
| `proposed-no-labels` | Intent-aware repair with designer labels ignored. |
| `proposed-labels` | Intent-aware repair respecting the presets' *keep open* labels. |

No user decisions are simulated. Suggestions that the proposed method defers to the designer stay unmerged in the benchmark, so this setting is conservative for the proposed method.

## Protocol

Each preset is run at 3 noise levels × 10 seeds (1 to 10) × 4 methods, for **360 runs** in total. Every method sees the identical perturbed network for a given (preset, level, seed). The benchmark is deterministic: re-running it reproduces every number except the runtimes.

```
npm run benchmark            # full protocol
npm run benchmark -- --quick # 2 seeds (smoke test)
npm run diagnose             # patch-failure and non-merge reasons (seeds 1-3, levels 1x/2x); false-positive pairs by cause
```

## Metrics

| Metric | Definition |
|---|---|
| Junction precision / recall / F1 | Over all unordered pairs of evaluated endpoints. A pair is *true* if both endpoints have the same non-null ground-truth junction, and *predicted* if the method puts them in one cluster. Endpoints of duplicate strokes (`*.dup`) are excluded for every method, because they have no unique correct partner. |
| Position error | For each evaluated endpoint with a true junction: the distance from its snapped position (the mean of its cluster in the input) to the true junction position, divided by the diagonal. |
| Patch success | Patches built divided by patches specified. A patch fails if a side's fragments do not form one chain, or if consecutive sides do not share a junction. |
| Boundary error | Mean distance from reconstructed boundary vertices to the clean curves, divided by the diagonal. Built patches only. |
| Non-manifold edges | Edges shared by more than two triangles in the welded mesh. |
| Fold-angle error | Mean absolute difference, per sharp seam (matched by `sourceId`), between the fold angle and that of the proposed method on the **clean** network. Built seams only. |
| Smooth-seam angle | Mean angle between the normals of the two triangles adjacent to each smooth-seam edge after fairing. Lower means closer to tangent-continuous. |
| Solver convergence | Whether CG reached relative residual 1e-8 within 3000 iterations. |
| Runtime | Repair stage, and the whole pipeline, in milliseconds on the machine that ran the benchmark (Node 22, Windows 11). |

## Threats to validity

- **The generator and the method share assumptions.** Both were written by the same author, so the perturbations match the failure modes the method was designed for: duplicates, fragments and labelled free ends. A different noise model, or real sketches, could change the ranking.
- **Small, structured data.** Three networks with 19 to 29 curve segments are not representative of real VR or sketch data.
- **Surface metrics on different subsets.** Boundary, fold-angle and smooth-seam metrics are averaged over the patches a method managed to build, so they are not directly comparable between methods with different patch success.
- **The baseline is deliberately simple.** It is a common first approach, not the strongest possible distance-based method. A baseline with duplicate removal or fragment joining would close part of the gap.
