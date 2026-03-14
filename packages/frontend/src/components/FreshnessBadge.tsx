import { useEffect, useMemo, useState } from 'react';

export function FreshnessBadge({ lastUpdate, label }: { lastUpdate: string | null; label?: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { cls, text } = useMemo(() => {
    if (!lastUpdate) return { cls: 'freshness-badge--error', text: label || 'NO DATA' };
    const ts = new Date(lastUpdate).getTime();
    if (!Number.isFinite(ts)) return { cls: 'freshness-badge--error', text: label || 'INVALID' };
    const diff = Math.max(0, Math.floor((now - ts) / 1000));
    if (diff < 60) return { cls: 'freshness-badge--live', text: label || 'LIVE' };
    const m = Math.floor(diff / 60);
    return { cls: 'freshness-badge--stale', text: label || `${m}m ago` };
  }, [lastUpdate, label, now]);

  return <span className={`freshness-badge ${cls}`}>{text}</span>;
}
