/** Union–find over string keys with path compression and union by size. */
export class UnionFind {
  private parent = new Map<string, string>();
  private size = new Map<string, number>();

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.size.set(x, 1);
    }
  }
  find(x: string): string {
    this.add(x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string): string {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return ra;
    // Deterministic tie-break by key keeps results reproducible.
    if (this.size.get(ra)! < this.size.get(rb)! || (this.size.get(ra) === this.size.get(rb) && ra > rb)) {
      [ra, rb] = [rb, ra];
    }
    this.parent.set(rb, ra);
    this.size.set(ra, this.size.get(ra)! + this.size.get(rb)!);
    return ra;
  }
  /** Groups keyed by root, members sorted, groups sorted by first member. */
  groups(): string[][] {
    const g = new Map<string, string[]>();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      if (!g.has(r)) g.set(r, []);
      g.get(r)!.push(k);
    }
    return [...g.values()].map((m) => m.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
}
