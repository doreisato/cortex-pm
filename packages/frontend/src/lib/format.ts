// ============================================================
// CORTEX-PM: Formatting Utilities
// ============================================================

/** Format USD amounts: $1,234.56 */
export function fmtUsd(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return '$0.00';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Format percentage: +12.5% */
export function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '0%';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

/** Format price: $0.653 */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '$0.00';
  return `$${n.toFixed(3)}`;
}

/** Format number with commas: 1,234 */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '0';
  return n.toLocaleString('en-US');
}

/** Time ago: "3m", "2h", "1d" */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '--';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Format timestamp for scanner: "14:32:08" */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '--:--:--';
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false });
}

/** Truncate string with ellipsis */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** PnL color class */
export function pnlClass(n: number): string {
  if (n > 0) return 'text-green';
  if (n < 0) return 'text-red';
  return 'text-dim';
}
