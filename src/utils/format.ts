// Number / volume formatting helpers

export function formatPrice(p: number, precision = 2): string {
  if (!isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(precision);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(8);
}

export function formatVolume(v: number): string {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  if (abs >= 1)   return v.toFixed(2);
  return v.toFixed(4);
}

export function formatPct(p: number): string {
  if (!isFinite(p)) return '—';
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(2)}%`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
