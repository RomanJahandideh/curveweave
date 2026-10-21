# Mathematical model

Notation: a curve network is a set of polylines $c_k = (p_{k,0},\dots,p_{k,m_k})$ in $\mathbb{R}^3$. Each has an intended-curve id (`sourceId`) and a feature label in {sharp, smooth, unspecified}. $D$ is the bounding-box diagonal and $\tau = t\,D$ is the merge tolerance; $t = 0.02$ by default.

## 1. Junction repair

**Normalization.** Curves with non-finite samples, or with fewer than two distinct samples, are rejected. Consecutive samples closer than $10^{-9} D$ are removed.

**Duplicates** (intent-aware mode). Two curves are duplicates if their endpoints match pairwise within $\tau$, in either orientation, and their mean distance after resampling to 17 points is at most $\tau$. The curve not referenced by a patch, or otherwise the lexicographically later one, is removed and recorded.

**Candidates.** Every pair of endpoints $(a,b)$ on different curves with $\lVert x_a - x_b\rVert \le \tau$, found exactly with a uniform spatial hash of cell size $\tau$.

**Outgoing tangent.** $u_a$ is the unit vector from the endpoint to the point at arc length $\max(0.08\,L, s_1)$ along the curve, where $s_1$ is the first segment length. This smooths over a noisy last sample.

**Score** (lower is better):

$$
s(a,b) = w_d\,\frac{\lVert x_a-x_b\rVert}{\tau} \;+\; w_t\,\max\!\Big(0,\;1-\frac{\angle(u_a,u_b)}{\theta_{\min}}\Big),
$$

with $w_d = w_t = 1$ and $\theta_{\min} = 20^\circ$. A small angle between the *outgoing* tangents means both strokes leave the junction in the same direction, as with overlapping or side-by-side strokes, rather than meeting at a corner or continuing.

**Classification** (intent-aware mode):

- *rejected* if either endpoint is labelled keep-open or the pair is labelled keep-separate;
- *suggested* if the tangent term is positive, or if $s > 0.92$ (weak evidence);
- *automatic* otherwise.

The distance-only baseline merges every candidate.

**Clustering.** Automatic candidates, plus suggestions the user has accepted, are applied with union–find in increasing order of score. A union is refused if:

- **complete linkage fails:** some pair in the merged cluster is farther apart than $\tau$ (this prevents chaining);
- **no collapse fails:** the merged cluster would contain both ends of one curve;
- **valence is exceeded:** the cluster would have more than $V_{\max} = 6$ members. This is a soft limit: the merge becomes a suggestion that the user can accept.

**Snapping.** Each endpoint moves to its cluster mean $\bar x$. The displacement $\delta$ is blended along the curve as $\delta\,\max(0, 1 - s/(0.45L))$, so the interior shape is preserved.

**Fragment joining.** At a cluster of exactly two endpoints whose curves share `sourceId` and feature label, the curves are concatenated.

**Provenance** records, for every input endpoint, its cluster; for every curve, its snap displacement; and every join, duplicate removal and refused merge, with the reason.

## 2. Patches

A patch lists its sides as sourceIds in cyclic order. The fragments of each side are chained through graph vertices, and each side is oriented so that it starts where the previous one ends. A failure (no single chain, loop not closed, or not 3- or 4-sided) is reported and nothing is filled.

Every side curve is resampled once, uniformly in arc length, to $N$ segments. Patches sharing a curve therefore share identical boundary samples, and these are welded by key: `v:<vertex>` for corners and `c:<sourceId>:<index>` for other boundary samples.

**Four sides: bilinearly blended Coons patch.** With bottom, right, top and left boundary curves $c_0(u), c_1(v), c_2(u), c_3(v)$ and corners $P_{00}, P_{10}, P_{01}, P_{11}$:

$$
S(u,v) = (1-v)\,c_0(u) + v\,c_2(u) + (1-u)\,c_3(v) + u\,c_1(v) - \big[(1-u)(1-v)P_{00} + u(1-v)P_{10} + (1-u)v\,P_{01} + uv\,P_{11}\big],
$$

sampled at $u = i/N$, $v = j/N$, then triangulated.

**Three sides: harmonic fill.** A triangular grid $\{(i,j) : i+j \le N\}$ has its boundary on the three curves, and its interior solves $x_v = \frac{1}{|N(v)|}\sum_{u\in N(v)} x_u$ over the six-neighbour stencil. This is solved per coordinate by CG.

**Orientation.** Adjacent patches must traverse a shared curve in opposite directions. Triangle winding is flipped by breadth-first propagation, and the global sign is chosen so that normals point mostly upward.

## 3. Constrained fairing

The unknowns are the interior vertex coordinates $x \in \mathbb{R}^{3F}$; boundary vertices are fixed on the repaired curves.

$$
E_{\text{total}}(x) = \lambda_{\text{fair}}E_{\text{fair}} + \lambda_{\text{ref}}E_{\text{ref}} + \lambda_{\text{seam}}E_{\text{seam}} + \lambda_{\text{reg}}E_{\text{reg}},
$$

$$
\begin{aligned}
E_{\text{fair}} &= \sum_{v\ \text{free}} \Big\lVert x_v - \tfrac{1}{|N(v)|}\textstyle\sum_{u\in N(v)} x_u \Big\rVert^2 &&\text{(uniform umbrella Laplacian)}\\
E_{\text{ref}} &= \sum_{v\ \text{free}} \lVert x_v - x_v^0\rVert^2 &&\text{(initial Coons or harmonic fill)}\\
E_{\text{seam}} &= \sum_{\text{smooth seams}}\ \sum_{k=1}^{N-1} \lVert \bar p_{A,k} + \bar p_{B,k} - 2\,b_k \rVert^2 &&\text{(discrete second difference across the seam)}\\
E_{\text{reg}} &= \sum_{P\ \text{planar}}\ \sum_{v \in P\ \text{free}} (n_P\cdot x_v - d_P)^2 &&\text{(planarity)}
\end{aligned}
$$

- $N(v)$ is the grid stencil: four neighbours on quads, six on triangles, united across welded patches.
- $b_k$ is a seam sample; $\bar p_{A,k}$ and $\bar p_{B,k}$ are the averages of its inward grid neighbours in the two adjacent patches (one vertex on a quad, two on a triangle).
- $(n_P, d_P)$ is the PCA plane of patch $P$'s boundary. The normal is the eigenvector of the smallest eigenvalue of the 3×3 covariance, found by cyclic Jacobi. Because the boundary is fixed, the plane is fixed, so the term stays quadratic.

Every term is a sum of squared linear residuals $r_i(x) = a_i^\top x + c_i$ with weight $w_i$, so

$$
E(x) = \sum_i w_i\,(a_i^\top x + c_i)^2, \qquad \nabla E = 0 \iff (J^\top W J)\,x = -J^\top W c.
$$

$A = J^\top W J$ is applied matrix-free, as two sparse products over the stored rows. Its normal-equation form gives a bi-Laplacian operator for $E_{\text{fair}}$. For $\lambda_{\text{ref}} > 0$, $A \succeq \lambda_{\text{ref}} I$ is strictly positive definite.

**Solver.** CG with a Jacobi preconditioner ($\operatorname{diag} A = \sum_i w_i a_{ij}^2$) starts from $x^0$. At every iterate it records the relative residual $\lVert b - Ax\rVert / \lVert b\rVert$ and the total energy, recomputed from $x$. The result is *converged* only if the relative residual is at most the tolerance ($10^{-8}$ by default). If the iteration budget runs out first, the result is *not converged* and the reason is reported. A non-positive curvature $p^\top A p$, or a non-finite residual, is reported as a *failure* and the initial positions are kept.

The reported per-term values are unweighted ($E_{\text{fair}}, \dots$); the reported total is weighted.

**Sharp versus smooth seams.**

- *Sharp* seams have no coupling term. Rendering normals are split there (each patch uses its own normals), and the geometry stays welded, so there are no cracks.
- *Smooth* seams get $E_{\text{seam}}$ and averaged normals.

The fold or kink at a seam is measured as the angle between the normals of the two triangles on either side of each seam edge.

## 4. Flattening (fabrication preview)

One patch is projected onto its PCA plane, then refined by minimizing the edge-length stress

$$
E(u) = \sum_{(i,j)} \Big(\frac{\lVert u_i-u_j\rVert - L_{ij}}{L_{ij}}\Big)^2
$$

with gradient descent and Armijo backtracking. The rigid-motion gauge freedom does not affect the energy, so no vertex is pinned.

Reported diagnostics: mean and maximum relative edge-length error, mean relative triangle-area error, and inverted triangles (those whose signed area disagrees with the majority). A doubly curved patch cannot be developed without strain, and the reported distortion says how much strain remains.

## 5. Evaluation metrics

See [EXPERIMENTS.md](EXPERIMENTS.md#metrics). Junction precision and recall are computed over unordered endpoint pairs; ground truth comes from construction.
