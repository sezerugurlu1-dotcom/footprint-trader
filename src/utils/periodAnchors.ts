// Period-boundary anchor functions for reset-based indicators (VWAP, CVD, etc.).
//
// An "anchor" is a function `timeSec → anchorSec` that maps any
// candle's unix-seconds timestamp to the unix-seconds timestamp of
// the start of its period.  Two candles sharing the same anchor
// belong to the same period and contribute to the same running
// total; a change in anchor resets the running total to 0.
//
// All anchors operate in UTC so the reset boundary is stable
// regardless of the viewer's timezone.  This matches the convention
// used by Binance and most charting platforms on 24/7 crypto markets.

/** Floor `timeSec` to 00:00:00 UTC of its calendar day. */
export function dailyAnchor(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

/** Floor `timeSec` to Monday 00:00:00 UTC of its ISO week. */
export function weeklyAnchor(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat.  We want the most recent
  // Monday on or before `d`.  Sunday (0) is 6 days after Monday;
  // everything else is (getUTCDay - 1) days after Monday.
  const dayOfWeek = d.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(d.getTime());
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return Math.floor(
    Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()) / 1000,
  );
}

/** Floor `timeSec` to 00:00:00 UTC of the 1st of its calendar month. */
export function monthlyAnchor(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000,
  );
}

/** VWAP period selector.  `session` matches the original
 *  `computeVwap` default (UTC-day boundary) — kept as a named alias
 *  so the toolbar can label it explicitly. */
export type VwapPeriod = 'session' | 'daily' | 'weekly' | 'monthly';

/** Resolve a VWAP-period string to its anchor function. */
export function getVwapAnchor(period: VwapPeriod): (t: number) => number {
  switch (period) {
    case 'session':
    case 'daily':   return dailyAnchor;
    case 'weekly':  return weeklyAnchor;
    case 'monthly': return monthlyAnchor;
  }
}

/** CVD period selector.  No `session` alias here — CVD is always
 *  period-anchored. */
export type CvdPeriod = 'daily' | 'weekly';

/** Resolve a CVD-period string to its anchor function. */
export function getCvdAnchor(period: CvdPeriod): (t: number) => number {
  switch (period) {
    case 'daily':  return dailyAnchor;
    case 'weekly': return weeklyAnchor;
  }
}
