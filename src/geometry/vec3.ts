/** Minimal 3D vector algebra on plain tuples (no allocation-heavy classes). */
export type Vec3 = [number, number, number];

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const isFiniteVec = (a: Vec3): boolean =>
  Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

/** Unit vector; returns [0,0,0] for (near) zero input instead of NaN. */
export function normalize(a: Vec3, eps = 1e-15): Vec3 {
  const n = norm(a);
  return n > eps ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/** Angle in radians between two vectors; 0 if either is degenerate. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const na = norm(a);
  const nb = norm(b);
  if (na < 1e-15 || nb < 1e-15) return 0;
  const c = Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
  return Math.acos(c);
}

export const clone = (a: Vec3): Vec3 => [a[0], a[1], a[2]];
