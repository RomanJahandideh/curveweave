/**
 * Sparse weighted least squares.
 *
 * Energy E(x) = sum_r w_r (a_r . x + c_r)^2 over sparse rows a_r. The
 * minimizer solves the normal equations A x = b with A = J^T W J and
 * b = -J^T W c. A is applied matrix-free (two sparse products), and the
 * system is solved by Jacobi-preconditioned conjugate gradients.
 */

export interface LsqRow {
  idx: number[];
  val: number[];
  c: number;
  w: number;
  term: string;
}

export class LeastSquares {
  rows: LsqRow[] = [];
  constructor(public readonly n: number) {}

  add(idx: number[], val: number[], c: number, w: number, term: string): void {
    if (w <= 0) return;
    if (idx.length === 0) return;
    this.rows.push({ idx, val, c, w, term });
  }

  /** Residual of each row at x. */
  residuals(x: Float64Array): Float64Array {
    const r = new Float64Array(this.rows.length);
    this.rows.forEach((row, k) => {
      let s = row.c;
      for (let i = 0; i < row.idx.length; i++) s += row.val[i] * x[row.idx[i]];
      r[k] = s;
    });
    return r;
  }

  /** Total weighted energy and its split by term. */
  energy(x: Float64Array): { total: number; byTerm: Record<string, number> } {
    const r = this.residuals(x);
    const byTerm: Record<string, number> = {};
    let total = 0;
    this.rows.forEach((row, k) => {
      const e = row.w * r[k] * r[k];
      byTerm[row.term] = (byTerm[row.term] ?? 0) + e;
      total += e;
    });
    return { total, byTerm };
  }

  /** y = A x = J^T W J x. */
  applyA(x: Float64Array, y: Float64Array): void {
    y.fill(0);
    for (const row of this.rows) {
      let s = 0;
      for (let i = 0; i < row.idx.length; i++) s += row.val[i] * x[row.idx[i]];
      s *= row.w;
      for (let i = 0; i < row.idx.length; i++) y[row.idx[i]] += row.val[i] * s;
    }
  }

  /** b = -J^T W c. */
  rhs(): Float64Array {
    const b = new Float64Array(this.n);
    for (const row of this.rows) for (let i = 0; i < row.idx.length; i++) b[row.idx[i]] -= row.val[i] * row.w * row.c;
    return b;
  }

  diagonal(): Float64Array {
    const d = new Float64Array(this.n);
    for (const row of this.rows) for (let i = 0; i < row.idx.length; i++) d[row.idx[i]] += row.w * row.val[i] * row.val[i];
    return d;
  }
}

export interface CgResult {
  x: Float64Array;
  iterations: number;
  converged: boolean;
  failed: boolean;
  failureReason?: string;
  /** ||b - A x|| / ||b|| at each iteration, starting with the initial guess. */
  residualHistory: number[];
}

const dotv = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * Preconditioned conjugate gradients for SPD A. Reports `converged` only when
 * the relative residual actually falls below `tol`.
 * `onIterate` receives every iterate so callers can record the true energy.
 */
export function conjugateGradient(
  lsq: LeastSquares,
  x0: Float64Array,
  tol: number,
  maxIter: number,
  onIterate?: (x: Float64Array, it: number) => void,
): CgResult {
  const n = lsq.n;
  const x = Float64Array.from(x0);
  const b = lsq.rhs();
  const diag = lsq.diagonal();
  const Minv = diag.map((d) => (d > 0 ? 1 / d : 1));
  const Ax = new Float64Array(n);
  lsq.applyA(x, Ax);
  const r = b.map((bi, i) => bi - Ax[i]);
  const bnorm = Math.sqrt(dotv(b, b));
  const scale = bnorm > 0 ? bnorm : 1;
  const history = [Math.sqrt(dotv(r, r)) / scale];
  onIterate?.(x, 0);
  if (n === 0 || history[0] <= tol)
    return { x, iterations: 0, converged: true, failed: false, residualHistory: history };
  const z = r.map((ri, i) => ri * Minv[i]);
  const p = Float64Array.from(z);
  const Ap = new Float64Array(n);
  let rz = dotv(r, z);
  for (let it = 1; it <= maxIter; it++) {
    lsq.applyA(p, Ap);
    const pAp = dotv(p, Ap);
    if (!(pAp > 0)) {
      return {
        x,
        iterations: it - 1,
        converged: false,
        failed: true,
        failureReason: pAp === 0 ? 'search direction has zero curvature (singular system)' : 'matrix is not positive definite or produced NaN',
        residualHistory: history,
      };
    }
    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    const rel = Math.sqrt(dotv(r, r)) / scale;
    history.push(rel);
    onIterate?.(x, it);
    if (!Number.isFinite(rel))
      return { x, iterations: it, converged: false, failed: true, failureReason: 'residual became non-finite', residualHistory: history };
    if (rel <= tol) return { x, iterations: it, converged: true, failed: false, residualHistory: history };
    for (let i = 0; i < n; i++) z[i] = r[i] * Minv[i];
    const rzNew = dotv(r, z);
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return {
    x,
    iterations: maxIter,
    converged: false,
    failed: false,
    failureReason: `relative residual ${history.at(-1)!.toExponential(2)} above tolerance after ${maxIter} iterations`,
    residualHistory: history,
  };
}
