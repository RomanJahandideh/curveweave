/** Minimal SVG line chart (no external charting dependency). */
interface Series {
  name: string;
  values: number[];
  color: string;
}

export function LineChart({
  series,
  log = false,
  height = 120,
  title,
  xLabel = 'iteration',
  testId,
}: {
  series: Series[];
  log?: boolean;
  height?: number;
  title: string;
  xLabel?: string;
  testId?: string;
}) {
  const width = 280;
  const pad = { l: 44, r: 8, t: 18, b: 22 };
  const tf = (v: number) => (log ? Math.log10(Math.max(v, 1e-300)) : v);
  const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v) && (!log || v > 0)).map(tf));
  const n = Math.max(1, ...series.map((s) => s.values.length - 1));
  if (!all.length)
    return (
      <figure className="chart" data-testid={testId}>
        <figcaption>{title}</figcaption>
        <p className="muted">No data.</p>
      </figure>
    );
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-12) {
    hi += 0.5;
    lo -= 0.5;
  }
  const X = (i: number) => pad.l + ((width - pad.l - pad.r) * i) / n;
  const Y = (v: number) => pad.t + ((height - pad.t - pad.b) * (hi - tf(v))) / (hi - lo);
  const fmt = (v: number) => (log ? `1e${v.toFixed(0)}` : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? v.toExponential(1) : v.toFixed(2));
  return (
    <figure className="chart" data-testid={testId}>
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} className="axis" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} className="axis" />
        <text x={pad.l - 4} y={pad.t + 4} textAnchor="end" className="tick">
          {fmt(hi)}
        </text>
        <text x={pad.l - 4} y={height - pad.b} textAnchor="end" className="tick">
          {fmt(lo)}
        </text>
        <text x={width - pad.r} y={height - 6} textAnchor="end" className="tick">
          {xLabel} {n}
        </text>
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            points={s.values
              .map((v, i) => (Number.isFinite(v) && (!log || v > 0) ? `${X(i).toFixed(1)},${Y(v).toFixed(1)}` : ''))
              .filter(Boolean)
              .join(' ')}
          />
        ))}
      </svg>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
