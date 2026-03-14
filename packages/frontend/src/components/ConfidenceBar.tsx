export function ConfidenceBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pctRaw = max > 0 ? (value / max) * 100 : 0;
  const pct = Math.max(0, Math.min(100, pctRaw));
  const level = pct > 70 ? 'high' : pct >= 40 ? 'mid' : 'low';

  return (
    <div>
      {label && <div className="signal-explain__label" style={{ marginBottom: 4 }}>{label}</div>}
      <div className="confidence-bar">
        <div className="confidence-bar__fill" data-level={level} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
