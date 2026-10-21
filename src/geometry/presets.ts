/**
 * Original procedural architectural presets. Each returns a clean network
 * whose endpoints coincide exactly at their intended junctions, plus
 * benchmark ground truth (`gtJunction`). Noise is applied separately
 * (see noise.ts), so the clean network is also the ground truth.
 */
import type { CurveNetwork, CurveSegment, FeatureType, PatchSpec, Vec3 } from './types';
import { add, lerp, norm, scale } from './vec3';

const SAMPLES = 16;

class Builder {
  pts = new Map<string, Vec3>();
  curves: CurveSegment[] = [];
  patches: PatchSpec[] = [];
  keepOpen: string[] = [];
  point(id: string, p: Vec3) {
    this.pts.set(id, p);
  }
  /** Curve from junction a to junction b; `shape(t)` must return exact endpoints at t = 0, 1. */
  curve(id: string, a: string, b: string, feature: FeatureType, shape?: (t: number) => Vec3, label?: string) {
    const A = this.pts.get(a)!;
    const B = this.pts.get(b)!;
    const f = shape ?? ((t: number) => lerp(A, B, t));
    const points: Vec3[] = [];
    for (let i = 0; i <= SAMPLES; i++) points.push(i === 0 ? [...A] : i === SAMPLES ? [...B] : f(i / SAMPLES));
    this.curves.push({ id, sourceId: id, points, feature, gtJunction: [a, b], label });
  }
  /** A curve whose ends are intentionally free (gtJunction null). */
  freeCurve(id: string, A: Vec3, B: Vec3, label: string) {
    const points: Vec3[] = [];
    for (let i = 0; i <= SAMPLES; i++) points.push(lerp(A, B, i / SAMPLES));
    this.curves.push({ id, sourceId: id, points, feature: 'unspecified', gtJunction: [null, null], label });
  }
  /** Split an existing curve into two fragments sharing its sourceId (as drawn). */
  fragment(id: string) {
    const i = this.curves.findIndex((c) => c.id === id);
    const c = this.curves[i];
    const mid = SAMPLES / 2;
    const j = `${id}#mid`;
    this.curves.splice(
      i,
      1,
      { ...c, id: `${id}.1`, points: c.points.slice(0, mid + 1), gtJunction: [c.gtJunction![0], j] },
      { ...c, id: `${id}.2`, points: c.points.slice(mid), gtJunction: [j, c.gtJunction![1]] },
    );
  }
  build(name: string): CurveNetwork {
    return {
      version: 1,
      name,
      curves: this.curves,
      patches: this.patches,
      constraints: { keepOpen: this.keepOpen, keepSeparate: [], planarPatches: [] },
    };
  }
}

/** Folded plate roof: alternating ridge/valley fold lines, arched along their length, on two columns. */
export function foldedPavilion(): CurveNetwork {
  const b = new Builder();
  const folds = 6;
  const width = 1.3;
  const L = 4;
  const z = (i: number) => (i % 2 === 0 ? 2.4 : 1.5) + 0.08 * i;
  for (let i = 0; i < folds; i++) {
    b.point(`f${i}a`, [i * width, 0, z(i)]);
    b.point(`f${i}b`, [i * width, L, z(i) + 0.2]);
  }
  for (let i = 0; i < folds; i++) {
    const A = b.pts.get(`f${i}a`)!;
    const B = b.pts.get(`f${i}b`)!;
    const inner = i > 0 && i < folds - 1;
    b.curve(`fold${i}`, `f${i}a`, `f${i}b`, inner ? 'sharp' : 'unspecified', (t) =>
      add(lerp(A, B, t), [0, 0, 0.45 * Math.sin(Math.PI * t)]),
    );
  }
  for (let i = 0; i < folds - 1; i++) {
    b.curve(`front${i}`, `f${i}a`, `f${i + 1}a`, 'unspecified');
    b.curve(`back${i}`, `f${i}b`, `f${i + 1}b`, 'unspecified');
    b.patches.push({ id: `panel${i}`, sides: [`front${i}`, `fold${i + 1}`, `back${i}`, `fold${i}`], label: `panel ${i + 1}` });
  }
  // Columns under two valley corners.
  for (const [id, j] of [
    ['colA', 'f1a'],
    ['colB', 'f3b'],
  ] as const) {
    const top = b.pts.get(j)!;
    b.point(`${id}base`, [top[0], top[1], 0]);
    b.curve(id, j, `${id}base`, 'unspecified', undefined, 'column');
  }
  // A rain spout that starts just beside a valley corner and must stay free.
  const c = b.pts.get('f3a')!;
  b.freeCurve('spout', add(c, [0.05, 0.06, -0.04]), add(c, [0.15, -0.6, -0.5]), 'rain spout (kept open)');
  b.keepOpen.push('spout:0');
  return b.build('Folded Pavilion');
}

/** Undulating canopy on a 3 x 2 grid of quad panels with smooth seams and two tree columns. */
export function curvedCanopy(): CurveNetwork {
  const b = new Builder();
  const h = (x: number, y: number) => 2 + 0.55 * Math.sin(1.1 * x) * Math.cos(0.8 * y) + 0.12 * x;
  const S = (x: number, y: number): Vec3 => [x, y, h(x, y)];
  const nx = 3;
  const ny = 2;
  const dx = 2.2;
  const dy = 2;
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) b.point(`g${i}_${j}`, S(i * dx, j * dy));
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i < nx; i++) {
      const inner = j > 0 && j < ny;
      b.curve(`u${i}_${j}`, `g${i}_${j}`, `g${i + 1}_${j}`, inner ? 'smooth' : 'unspecified', (t) => {
        const x = (i + t) * dx;
        const y = j * dy + 0.18 * Math.sin(Math.PI * t) * (j === 1 ? 1 : 0.4);
        return S(x, y);
      });
    }
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j < ny; j++) {
      const inner = i > 0 && i < nx;
      b.curve(`w${i}_${j}`, `g${i}_${j}`, `g${i}_${j + 1}`, inner ? 'smooth' : 'unspecified', (t) => {
        const y = (j + t) * dy;
        const x = i * dx - 0.15 * Math.sin(Math.PI * t);
        return S(x, y);
      });
    }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      b.patches.push({
        id: `cell${i}_${j}`,
        sides: [`u${i}_${j}`, `w${i + 1}_${j}`, `u${i}_${j + 1}`, `w${i}_${j}`],
        label: `canopy cell ${i + 1},${j + 1}`,
      });
  for (const i of [1, 2]) {
    const top = b.pts.get(`g${i}_1`)!;
    b.point(`trunk${i}`, [top[0], top[1], 0]);
    b.curve(`tree${i}`, `g${i}_1`, `trunk${i}`, 'unspecified', (t) => add(lerp(top, [top[0], top[1], 0], t), [0.25 * Math.sin(Math.PI * t), 0, 0]), 'column');
  }
  return b.build('Curved Landscape Canopy');
}

/**
 * Faceted shell on a hexagonal plan: a raised lantern of six triangular facets
 * (sharp crease ring) over a ring of quad panels; one bay left open as an
 * entrance. Base arcs are drawn as two fragments each.
 */
export function fragmentedShell(): CurveNetwork {
  const b = new Builder();
  const R = 4;
  const m = 6;
  const center: Vec3 = [0, 0, 0];
  const onSphere = (theta: number, phi: number, r: number): Vec3 => [
    r * Math.sin(theta) * Math.cos(phi),
    r * Math.sin(theta) * Math.sin(phi),
    r * Math.cos(theta),
  ];
  b.point('apex', [0, 0, R * 1.18]);
  for (let i = 0; i < m; i++) {
    const phi = (2 * Math.PI * i) / m;
    b.point(`r${i}`, onSphere((32 * Math.PI) / 180, phi, R));
    b.point(`b${i}`, onSphere((78 * Math.PI) / 180, phi + 0.08, R));
  }
  // Great-circle-like interpolation on spheres about `center` with radius blending.
  const arc = (A: Vec3, B: Vec3) => (t: number) => {
    const p = lerp(A, B, t);
    const r = (1 - t) * norm(A) + t * norm(B);
    return scale(p, r / Math.max(norm(add(p, center)), 1e-12));
  };
  for (let i = 0; i < m; i++) {
    const k = (i + 1) % m;
    const P = (id: string) => b.pts.get(id)!;
    b.curve(`rib${i}`, 'apex', `r${i}`, 'sharp', (t) => lerp(P('apex'), P(`r${i}`), t));
    b.curve(`ring${i}`, `r${i}`, `r${k}`, 'sharp', arc(P(`r${i}`), P(`r${k}`)));
    b.curve(`leg${i}`, `r${i}`, `b${i}`, 'smooth', arc(P(`r${i}`), P(`b${i}`)));
    b.patches.push({ id: `lantern${i}`, sides: [`rib${i}`, `ring${i}`, `rib${k}`], label: `lantern facet ${i + 1}` });
  }
  for (let i = 1; i < m; i++) {
    const k = (i + 1) % m;
    b.curve(`base${i}`, `b${i}`, `b${k}`, 'unspecified', arc(b.pts.get(`b${i}`)!, b.pts.get(`b${k}`)!));
    b.patches.push({ id: `bay${i}`, sides: [`leg${i}`, `base${i}`, `leg${k}`, `ring${i}`], label: `bay ${i}` });
  }
  for (let i = 1; i < m; i++) b.fragment(`base${i}`);
  // A short canopy lip at the entrance that must not be snapped onto the leg foot.
  const foot = b.pts.get('b0')!;
  b.freeCurve('lip', add(foot, [0.06, -0.07, 0.08]), add(foot, [0.9, -1.1, 0.5]), 'entrance lip (kept open)');
  b.keepOpen.push('lip:0');
  return b.build('Fragmented Architectural Shell');
}

export const presets: { id: string; name: string; make: () => CurveNetwork }[] = [
  { id: 'folded-pavilion', name: 'Folded Pavilion', make: foldedPavilion },
  { id: 'curved-canopy', name: 'Curved Landscape Canopy', make: curvedCanopy },
  { id: 'fragmented-shell', name: 'Fragmented Architectural Shell', make: fragmentedShell },
];
