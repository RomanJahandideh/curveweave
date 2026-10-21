/** Deterministic PRNG (mulberry32). Same seed -> same sequence on every platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random unit vector (Marsaglia), driven by a given PRNG. */
export function randomUnit(rand: () => number): [number, number, number] {
  for (;;) {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const s = x * x + y * y;
    if (s >= 1 || s === 0) continue;
    const f = 2 * Math.sqrt(1 - s);
    return [x * f, y * f, 1 - 2 * s];
  }
}
