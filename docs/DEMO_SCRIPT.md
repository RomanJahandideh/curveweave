# Demo script (about 5 minutes)

Live app: https://romanjahandideh.github.io/curveweave/ (or `npm run dev`).

## 1. The problem (40 s)

1. Load **Folded Pavilion**. Seeded sketch noise is on (seed 1, 1.0×).
2. Tick **Input strokes** to show the raw noisy curves (dashed). Point out that endpoints almost meet, one stroke is drawn twice, and some edges arrive in fragments.
3. Switch the repair to **Distance-only baseline**. The *Patches* stage turns amber: some patches fail, and the right panel lists the reason ("fragments … do not form a single connected chain"). The cause is the duplicate stroke, which creates a branch.

## 2. Intent-aware repair (90 s)

1. Switch to **Intent-aware**. All five panels are built, and the *Repair* stage reports the merges, fragment joins and the removed duplicate.
2. Open **Merge candidates**. Each candidate shows its distance as a fraction of the tolerance, the angle between outgoing tangents, its score, and the reason for its status.
3. Note that the rain spout's free end is *rejected* by the designer label "kept open". Untick **Respect designer labels** and watch the spout snap onto the valley corner: the false merge that the baseline also makes. Tick it again.
4. Raise **Noise level** to 2.5×. Some candidates become suggestions ("weak evidence"), and complete linkage refuses three merges ("would chain endpoints farther apart than the tolerance") instead of collapsing neighbouring junctions. Some panels now fail, with the reason listed. **Accept** a suggestion and watch the patch count and metrics update. Then set the noise level back to 1.0×.
5. Use **Undo** and **Redo** on a candidate decision.

## 3. Features and fairing (90 s)

1. Load **Fragmented Architectural Shell**. The lantern ribs and crease ring are sharp (orange); the legs are smooth (blue).
2. In the right panel, compare the smooth-seam normal angle before and after fairing (about 11° to about 2° for seed 1), and note that the sharp fold angle hardly changes.
3. Show the **residual** chart (log scale) and the **energy** chart. Both are recorded from the actual CG iterates.
4. Set **Max iterations** to 5: the status turns amber, "Not converged: relative residual … above tolerance". The app does not claim convergence it did not reach.
5. Click a curve and change its label from smooth to sharp. The seam now creases and the render normals split.

## 4. Architectural regularity and fabrication (60 s)

1. Load **Curved Landscape Canopy** and click a canopy cell. Tick **Planarity regularization** and raise **λ planarity**. E_reg falls and the panel flattens toward the plane of its boundary.
2. Click **Flatten for fabrication**. The panel reports edge and area distortion and inverted triangles. Download the SVG.

## 5. Evidence (30 s)

Open `docs/RESULTS.md`. In 360 seeded runs, designer labels raise junction precision from 0.965 to 0.998. Fragment and duplicate handling raises patch success from 0.74 to 0.92. At 2× noise the method is more conservative and loses recall. Close on [LIMITATIONS.md](LIMITATIONS.md): synthetic data, labelled patches, and no comparison with published systems.
