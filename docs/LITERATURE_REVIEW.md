# Literature review

This review records what was **verified** from each source (project page, abstract, repository README, or Crossref metadata, read in October 2026) and separates it from **CurveWeave design decisions**. Most full papers were not read in full for this first version; where a point depends only on an abstract or project page, that is stated. Any claim about a paper's internals beyond what is quoted here should be checked against the full text before it is repeated.

| Paper | What was read |
|---|---|
| SharpEdge (CGF 2026) | Project page, Crossref record, code repository README |
| True2Form (SIGGRAPH 2014) | Project page and abstract |
| SurfaceBrush (SIGGRAPH 2019) | Crossref record and abstract (OpenAlex) |
| Capturing Non-Linear Human Perspective (SIGGRAPH Asia 2025) | Project page and abstract |
| Design for Descent (SIGGRAPH Asia 2025) | Project page and abstract |
| Designing with Tension (SIGGRAPH Asia 2025) | Project page and abstract |
| CASSIE (CHI 2021) | V-Sekai fork README (MIT licence) |

---

## 1. SharpEdge: Edge Feature Surface Reconstruction From Space Curves

**Citation (verified).** X. Yu, A. Sheffer, N. Carr, Y. Gingold. *Computer Graphics Forum*, 2026, article e70581, doi:10.1111/cgf.70581 (Crossref: published online 2026-07-21). Project page: https://cragl.cs.gmu.edu/sharpedge/. Code: the project page links github.com/CraGL/SharpEdge; github.com/KrisYu/SharpEdge is also public. GitHub reports **no licence** for KrisYu/SharpEdge.

1. **Problem (verified).** Surface reconstruction from sparse 3D curve networks "remains challenging, particularly when sharp feature edges are involved". The authors note that prior methods often produce smooth surfaces that ignore sharp edges, depend on failure-prone automatic initialization, or need manual intervention.
2. **Representation (verified).** Sparse, "possibly disconnected" 3D curve networks. The repository reads OBJ files (for example `sketch/onshape_simple_mouse.obj`) and writes `.normal` files.
3. **Method (verified, from the project page).**
   - It optimizes a **two-normal field along curve edges**, with geometric constraints at curve junctions, to capture sharp feature directions.
   - It reconstructs an initial surface guided by those normals with an adapted **signed heat method**.
   - It refines the result with a **cut–remesh–optimize** pipeline that "produces fair surface patches interpolating the features".
   - The repository combines Python (`opt_edges.py`) with compiled tools built by `build_tools.sh` (`cgal_remesh`, `cut_edges`, `signed_heat_3d`) and a `signed-heat-3d` submodule.
4. **Input assumptions.** The page does not state explicit precision assumptions beyond accepting sparse and possibly disconnected networks.
5. **Evaluation (verified, qualitative).** The method was tested on "a range of 3D sketches"; the page reports that meshes "adhere closely to input curves" and recover sharp ridges and corners. The page lists no quantitative metrics.
6. **Limitations.** None are listed on the project page. Points to check in the full paper: behaviour on imprecise junctions and non-manifold configurations.
7. **Relevance to CurveWeave (design decision).**
   - CurveWeave borrows the problem framing: curve networks with explicit sharp edges, junction consistency, and fair patches that interpolate features.
   - It does **not** reproduce the two-normal field, the signed heat method or remeshing; those depend on numerical tooling that does not fit a static browser application.
   - CurveWeave addresses an earlier step that the page mentions only implicitly: **cleaning junction errors before reconstruction**, on a restricted class of patch-labelled networks.

## 2. True2Form: 3D Curve Networks from 2D Sketches via Selective Regularization

**Citation (verified).** B. Xu, W. Chang, A. Sheffer, A. Bousseau, J. McCrae, K. Singh. *ACM Transactions on Graphics* 33(4), SIGGRAPH 2014.

1. **Problem.** It "reconstructs 3D curves from typical design sketches."
2. **Representation.** 3D curve networks; the downloads include polylines and tube meshes.
3. **Method.** It progressively detects and enforces applicable regularities (the abstract names curvature, symmetry and parallelism), balancing "regularity enforcement against sketch fidelity at each step."
4. **Input assumptions.** Free-hand sketches are inherently inaccurate, and the method tolerates that.
5. **Evaluation.** A perceptual study comparing the algorithm's regularity choices with viewers' choices, reconstructions of varied sketches, and comparisons with prior art and with ground truth.
6. **Limitations.** Not stated on the page.
7. **Relevance (design decision).** CurveWeave adopts the principle of applying regularities **selectively**: a repair or constraint is accepted only when it is compatible with the evidence, and ambiguous cases go to the user.

## 3. SurfaceBrush: From Virtual Reality Drawings to Manifold Surfaces

**Citation (verified, Crossref).** E. Rosales, J. Rodriguez, A. Sheffer. *ACM Transactions on Graphics* 38(4), 2019, pp. 1–15, doi:10.1145/3306346.3322970.

1. **Problem.** Converting dense VR ribbon-stroke drawings into "user-intended manifold free-form 3D surfaces".
2. **Representation.** Stroke ribbons described by central polyline positions and normals, plus widths.
3. **Method.** It exploits local coherence between strokes: "strokes intended to be adjacent on the artist imagined surface often have similar tangent directions". Surfacing is cast as a constrained matching problem on stroke polyline vertices and edges.
4. **Input assumptions.** Dense collections of strokes, with sparsity and error patterns that differ from the inputs of other surfacing methods.
5. **Evaluation.** Not checked beyond the abstract.
6. **Limitations.** Not checked.
7. **Relevance (design decision).** The tangent-coherence observation motivates CurveWeave's **tangent-aware junction scoring**. CurveWeave applies a related intuition to endpoint repair in sparse networks, not to dense stroke matching.

## 4. Capturing Non-Linear Human Perspective in Line Drawings

**Citation (verified).** J. Yang, L. Foord-Kelcey, S. Takikawa, N. Vining, N. Mitra, A. Sheffer. SIGGRAPH Asia 2025.

1. **Problem.** "Artist-drawn sketches only loosely conform to analytical models of perspective projection."
2. **Representation.** The deviation between human and analytic perspective is encoded "as a continuous function in 3D space".
3. **Method.** It learns from a single artist sketch and matching camera view, fits a spatially continuous deviation function, and generalizes with self-augmentation.
4. **Input assumptions.** Pairs of a sketch and a shape.
5. **Evaluation.** Comparisons against alternatives (details are in the supplement, not read).
6. **Limitations.** Human drawing choices are heterogeneous and data is scarce.
7. **Relevance (design decision).** It is a reminder that **intended geometry differs from measured geometry**. CurveWeave treats input coordinates as evidence of intent, not ground truth, which is why repairs are scored and can be reversed rather than applied silently.

## 5. Design for Descent: What Makes a Shape Grammar Easy to Optimize?

**Citation (verified).** M. Kodnongbua, Z. J. Zhang, A. Schulz, N. Sharp. SIGGRAPH Asia 2025.

1. **Problem.** It asks what makes shape-grammar programs amenable to gradient-based optimization.
2. **Representation.** Shape grammars, including tree grammars "designed for descent".
3. **Method.** Stochastic Rewrite Descent, which "interleaves structural rewrites with continuous parameter updates".
4. **Evaluation.** Image fitting, text-driven generation and topology optimization, with ablations.
5. **Limitations.** Not stated on the page.
6. **Relevance (design decision).** It supports CurveWeave's choice to keep the **continuous problem quadratic** (one sparse SPD solve) and to keep discrete decisions (which junctions merge) separate and inspectable. That makes the continuous stage reliable and easy to diagnose.

## 6. Designing with Tension: Nearly-Developable Patch Layouts

**Citation (verified).** A. M. Eggler, N. Pietroni, P. Tang, M. Piovarči, B. Bickel. SIGGRAPH Asia 2025.

1. **Problem.** Approximating free-form surfaces with near-developable patches that act as tensile-like structures anchored at sparse points.
2. **Method.** A layout guided by a curvature field, refined combinatorially until performance and fabrication constraints are met.
3. **Evaluation.** Architectural surfaces and fabricated prototypes; no quantitative metrics on the page.
4. **Relevance (design decision).** It motivates CurveWeave's **optional, explicitly approximate flattening analysis**, which reports edge-length and area distortion of reconstructed panels. CurveWeave does not compute patch layouts or make structural claims.

## 7. CASSIE: Curve and Surface Sketching in Immersive Environments

**Citation (verified, from the V-Sekai fork README).** E. Yu, R. Arora, T. Stanko, J. A. Bærentzen, K. Singh, A. Bousseau. CHI 2021. The V-Sekai fork (`interactor-cassie`) is Unity/C#, MIT-licensed for the project's own code.

1. **Outputs (verified).**
   - `.curves`: 3D polylines.
   - `-input.curves`: raw, un-neatened samples.
   - `_patches.obj`: patches whose normals are not exported and whose triangle orientation is arbitrary.
   - `_graph.json`: the sketch graph.
2. **Relevance (design decision).** CurveWeave's JSON format is similar in spirit: polylines plus explicit graph and patch labels. Its importer accepts plain polyline lists, so CASSIE-style curves could be converted. No CASSIE code is reused.

---

## Established methods used in CurveWeave

These are standard techniques, not contributions:
- spatial hashing for neighbour queries;
- union–find;
- arc-length resampling;
- bilinearly blended Coons patches;
- the uniform graph Laplacian and bi-Laplacian (thin-plate) fairing;
- quadratic penalty formulations;
- Jacobi-preconditioned conjugate gradients;
- stress-majorization-style edge-length flattening (here, gradient descent with backtracking).
