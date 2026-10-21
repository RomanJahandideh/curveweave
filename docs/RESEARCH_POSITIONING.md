# Research positioning

CurveWeave is an **independent** project by Roman Jahandideh, an MA researcher at Simon Fraser University, informed by the published literature listed in [LITERATURE_REVIEW.md](LITERATURE_REVIEW.md). It is not affiliated with, supervised by or endorsed by any of the cited authors or their institutions.

## The gap it explores

Methods that reconstruct surfaces from 3D curve networks, such as SharpEdge, take a curve network as given. Networks drawn in practice, especially quick architectural sketches and VR drawings, contain small junction errors: endpoints that almost meet, fragments of one edge, accidental duplicates, and features that look close but are intentionally separate. CurveWeave asks a narrow question about that step:

> When the designer's intent (which edges are folds, which ends are meant to stay free, which junctions are real) is made explicit, does junction repair improve, and does it make feature-preserving patch reconstruction more reliable?

## How CurveWeave differs from the cited systems

| System | Input | What CurveWeave does differently |
|---|---|---|
| SharpEdge | Sparse, possibly disconnected curve networks; automatic two-normal field and signed heat reconstruction | CurveWeave restricts the problem: patches are explicitly labelled (3- or 4-sided boundary loops) and reconstructed by Coons/harmonic interpolation plus a quadratic fairing solve. Sharp versus smooth seams are labels, not inferred normals. Its focus is the **repair stage before reconstruction**, which it measures against ground truth. It does **not** implement SharpEdge's algorithm and makes no claim to match its generality. |
| True2Form | 2D sketches lifted to 3D curves with selective regularities | CurveWeave starts from 3D curves and applies the "selective" idea to **junction repair**: a merge is automatic only when distance, tangent and valence evidence agree, and otherwise it is a suggestion. |
| SurfaceBrush | Dense VR ribbon strokes, matched using tangent coherence | CurveWeave uses tangent information to score **endpoint merges** in sparse networks; it does not surface dense strokes. |
| Designing with Tension | Free-form surfaces to near-developable layouts | CurveWeave only **measures** approximate flattening distortion of its own patches; it proposes no layouts. |

## What is established, what is adapted, and what is a hypothesis

- **Established methods:** spatial hashing, union–find, Coons patches, Laplacian and bi-Laplacian fairing, quadratic penalties, preconditioned conjugate gradients, edge-length-preserving flattening.
- **Engineering adaptations:** an interpretable junction score combining distance, tangent compatibility, valence and designer constraints; complete-linkage clustering to prevent chaining; displacement blending along arc length when snapping; a seam term that is a discrete second-difference across smooth seams; welding of patch boundaries by shared curve samples.
- **Hypothesis under test, not a claim:** that tangent-, topology- and constraint-aware repair yields fewer false merges than distance-only snapping at matched recall, and that this improves the number and quality of reconstructed patches. [RESULTS.md](RESULTS.md) reports whether this holds on the synthetic benchmark. Synthetic benchmarks can favour the assumptions built into the generator; that limitation is discussed there.

## Scope boundaries

- No arbitrary-topology reconstruction: patches must be labelled 3- or 4-sided loops.
- No inference of patch topology: unknown loops are reported, never invented.
- No claim of structural safety or fabrication-grade developability.
