# Implementation plan (Phase 0)

> Written before implementation. The module list was updated after Phase 5 to match the code: the solve moved from a separate fairing.ts into solver.ts, CG lives in sparse.ts, and evaluate.ts was added for the benchmark.

## Architecture

```
src/geometry/   pure TypeScript numerical code (no React, no Three.js)
  vec3.ts        vector algebra
  types.ts       data model (Vec3, CurveSegment, CurveNetwork, Graph*, SurfacePatch, ...)
  rng.ts         seeded PRNG (mulberry32)
  network.ts     normalization, tangents, arc length, resampling
  spatialHash.ts neighbour queries
  unionFind.ts   connectivity tracking
  repair.ts      baseline (distance-only) and proposed (scored) repair
  validate.ts    junction, degree, component and duplicate statistics
  patches.ts     boundary-loop assembly, Coons and 3-sided grids
  sparse.ts      sparse least-squares rows, matrix-free normal operator, Jacobi-preconditioned CG
  solver.ts      the quadratic energy E_total, its assembly and solve, plane fitting
  mesh.ts        welded triangle mesh, normals, quality and topology metrics
  flatten.ts     approximate 2D flattening and distortion metrics
  noise.ts       seeded noise generation with ground-truth provenance
  presets.ts     three procedural architectural networks
  pipeline.ts    input -> repair -> patches -> optimization -> metrics
  io.ts          versioned JSON, OBJ, GLB and CSV export (SVG export lives in flatten.ts)
  evaluate.ts    ground-truth junction scoring and surface error metrics for the benchmark
  history.ts     undo/redo snapshots
src/app/        React + React Three Fiber interface
scripts/        benchmark runner (npm run benchmark)
tests/          Vitest unit tests;  e2e/ Playwright browser tests
docs/           research documentation;  results/ benchmark outputs
```

## Risk assessment (hard parts, identified before coding)

| Risk | Mitigation |
|---|---|
| Chained merges (A near B near C, but A far from C) | Complete-linkage check: a cluster may not exceed its diameter limit |
| Merging intentionally separate features | Tangent rule: merges that create a near-zero angle between outgoing tangents are suggestions; designer "keep open" labels block merges |
| Fragments break patch boundaries | Curves carry a `sourceId`; a patch side is the chain of curves with that `sourceId` |
| Cracks between adjacent patches | One global boundary resolution; shared curve samples are welded by key |
| Fake optimization progress | A real sparse least-squares system; energy and residual are recomputed from the iterate at each CG step; convergence only when the relative residual is below tolerance |
| 3-sided patches have no simple Coons form | A harmonic fill on a triangular grid (a well-defined linear solve), then the same fairing |
| Sharp shading versus geometric sharpness | Geometry stays welded (no cracks); only rendering normals are split at sharp seams; the fold angle is measured geometrically |
| Benchmark bias | The noise generator, ground truth and metrics are documented; the same seeds are used for all methods; limitations are reported |

## Scope boundaries

Structured, patch-labelled networks only; 3- or 4-sided loops; axis-independent planarity regularization as the single optional architectural constraint.
