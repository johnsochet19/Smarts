// Dependency-free chart primitives (SVG/CSS).

export function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="an-hbar">
      <span className="an-hbar__label" title={label}>{label}</span>
      <div className="an-hbar__track"><div className="an-hbar__fill" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="an-hbar__val">{value}</span>
    </div>
  );
}

export function Donut({ segments, size = 132 }: { segments: Array<{ label: string; value: number; color: string }>; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="an-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={14} />
          {total > 0 && segments.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={14}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
            );
            offset += len;
            return el;
          })}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="700" fill="var(--text)">{total}</text>
      </svg>
      <div className="an-legend">
        {segments.map((s) => (
          <div key={s.label} className="an-legend__row">
            <span className="an-legend__dot" style={{ background: s.color }} />
            <span className="bf-muted">{s.label}</span>
            <span className="bf-spacer" />
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
