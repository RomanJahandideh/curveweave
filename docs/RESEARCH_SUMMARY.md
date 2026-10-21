# Research summary

**CurveWeave: intent-aware repair of architectural curve networks before surface reconstruction.**
Roman Jahandideh, independent research prototype, 2026.

## Motivation

Architects increasingly sketch form directly in 3D and need surfaces that respect the intent of the lines: which edges are folds, which are smooth, which ends stay open. Published reconstruction methods such as SharpEdge (Computer Graphics Forum, 2026) take a curve network as given. Drawn networks are imperfect: endpoints almost meet, edges arrive in fragments, strokes are doubled, and nearby features may be intentionally separate. Geometry alone cannot tell an accidental gap from a deliberate one. CurveWeave studies that repair step.

## Question

When the designer's intent is made explicit, does junction repair recover the intended topology more reliably, and does that make feature-preserving patch reconstruction succeed more often? Intent here means feature labels, *keep open* and *keep separate* labels, and patch labels.

## Approach

CurveWeave combines established techniques in a transparent browser-based pipeline.

- **Repair.** Each candidate endpoint pair gets an interpretable score from distance and outgoing-tangent angle; designer labels are hard constraints. Complete-linkage and no-collapse checks prevent chained or degenerate junctions, and ambiguous merges become suggestions rather than silent decisions. Fragments are joined, duplicates removed, and every decision is recorded with its reason.
- **Surfaces.** Labelled 4-sided patches use Coons interpolation; 3-sided patches use a harmonic fill. Patches are welded along shared curves.
- **Fairing.** An explicit quadratic energy (fairness, closeness to the initial fill, a smooth-seam term, optional planarity) is solved by preconditioned conjugate gradients, with residual and energy recorded from the actual iterates. Sharp seams keep their fold; smooth seams approach tangent continuity.
- **Fabrication preview.** A single-patch flattening reports its distortion.

## Evaluation

Three original procedural networks (a folded pavilion, a curved canopy, a fragmented shell) are perturbed with seeded noise of known ground truth. Four methods are compared over 360 runs: no repair, distance-only snapping, and intent-aware repair with and without labels.

- **Labels.** With designer labels, pairwise junction precision is 0.998, against 0.965 for distance-only snapping. Nearly all of the baseline's false merges are intentionally free ends that lie within tolerance of a corner.
- **Patches.** Patch success rises from 0.74 to 0.92. Diagnostics attribute the gain to fragment and duplicate handling rather than to better junction decisions.
- **Weaknesses.** Tangent-based scoring alone did not reduce false merges. At the highest noise level the intent-aware method is more conservative and loses recall, because it defers ambiguous merges to a designer, and no designer was simulated.

## Contribution and limits

CurveWeave is an engineering study, not a new published algorithm. Its contributions are:

- an open, inspectable implementation of intent-aware junction repair, linked to patch reconstruction;
- an honest synthetic benchmark with reproducible seeds;
- an interactive tool in which every repair decision can be explained, overridden and undone.

Its limits are significant: patches must be labelled, the data is synthetic and author-generated, there is no user study, and there is no comparison with published systems such as SharpEdge, nor any claim to match them.

Next steps: real VR and sketch data, a stronger baseline, automatic patch-loop detection, and a study of how designers use suggestions and labels.

CurveWeave is not affiliated with, supervised by or endorsed by the authors of the works it cites or their institutions.
