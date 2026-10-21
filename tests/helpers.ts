import type { CurveNetwork, CurveSegment, Vec3 } from '../src/geometry/types';

export function line(id: string, a: Vec3, b: Vec3, n = 8, extra: Partial<CurveSegment> = {}): CurveSegment {
  const points: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return { id, sourceId: id, points, feature: 'unspecified', ...extra };
}

export function net(curves: CurveSegment[], extra: Partial<CurveNetwork> = {}): CurveNetwork {
  return {
    version: 1,
    name: 'test',
    curves,
    patches: [],
    constraints: { keepOpen: [], keepSeparate: [], planarPatches: [] },
    ...extra,
  };
}

/** Unit square boundary as four curves meeting exactly at the corners. */
export function square(offset: Partial<Record<string, Vec3>> = {}): CurveNetwork {
  const o = (k: string, p: Vec3): Vec3 => {
    const d = offset[k] ?? [0, 0, 0];
    return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  };
  return net(
    [
      line('s0', o('s0:0', [0, 0, 0]), o('s0:1', [1, 0, 0])),
      line('s1', o('s1:0', [1, 0, 0]), o('s1:1', [1, 1, 0])),
      line('s2', o('s2:0', [1, 1, 0]), o('s2:1', [0, 1, 0])),
      line('s3', o('s3:0', [0, 1, 0]), o('s3:1', [0, 0, 0])),
    ],
    { patches: [{ id: 'p', sides: ['s0', 's1', 's2', 's3'] }] },
  );
}
