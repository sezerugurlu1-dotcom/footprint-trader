// Volume-Weighted Average Price (VWAP).
//
// Standard intraday VWAP: cumulative Σ(typical × volume) / Σ(volume)
// from a session anchor, with the running totals reset at each
// new session.  On 24/7 crypto markets there is no natural open,
// so the conventional anchor is 00:00:00 UTC of each calendar day
// (the same one used by most charting platforms).
//
// Typical price is the HLC/3 average — (high + low + close) / 3 —
// which is the most common choice on bar data.
//
// The function is pure: same input → same output.  Allocations are
// bounded (one output point per input candle) and there is no
// hidden state, so callers can memoise it cheaply on the candle
// array reference.

import type { Candle } from '../types';

export interface VwapPoint {
  time: number;   // candle open (unix seconds) — matches Candle.time
  value: number;  // VWAP at that candle
}

export interface VwapOptions {
  /**
   * Returns the session-anchor timestamp (unix seconds) for any
   * candle time.  Two candles sharing the same anchor are in the
   * same session and contribute to the same running totals.
   * Defaults to UTC-day boundary (00:00:00 UTC of the candle's
   * calendar date).
   */
  getAnchor?: (timeSec: number) => number;

  /**
   * If true, use the candle's close as the typical price instead
   * of (high + low + close) / 3.  Default false (HLC/3).
   */
  useCloseOnly?: boolean;
}

/** Default anchor: floor the candle's UTC time to 00:00:00 UTC. */
function defaultAnchor(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

/**
 * Compute VWAP for each candle in `candles`.  The returned array
 * has the same length and time keys as the input.
 *
 * Behaviour at the edges:
 *  - Empty input → empty output.
 *  - A candle with `volume === 0` does not advance the cumulative
 *    totals, so its VWAP equals the previous candle's VWAP (or the
 *    close price if it is the first candle of a session).  This
 *    keeps the line continuous across low-volume prints.
 *  - Candles are assumed to be sorted by `time` ascending.  Out-of-
 *    order candles will not be reordered — their VWAP reflects only
 *    the data seen so far in array order, which matches what the
 *    chart will draw at that time.
 */
export function computeVwap(
  candles: ReadonlyArray<
    Pick<Candle, 'time' | 'high' | 'low' | 'close' | 'volume'>
  >,
  options: VwapOptions = {},
): VwapPoint[] {
  const { getAnchor = defaultAnchor, useCloseOnly = false } = options;
  const out: VwapPoint[] = new Array(candles.length);

  let cumPV = 0;                 // Σ typical × volume
  let cumV = 0;                  // Σ volume
  let lastAnchor = Number.NaN;   // current session anchor
  let lastVwap = Number.NaN;     // for volume=0 carry-forward

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const anchor = getAnchor(c.time);
    if (anchor !== lastAnchor) {
      cumPV = 0;
      cumV = 0;
      lastAnchor = anchor;
      // New session: the first candle's VWAP is its own typical
      // price (Σ typical×vol / Σ vol with one observation).
      lastVwap = Number.NaN;
    }
    const tp = useCloseOnly
      ? c.close
      : (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumV += c.volume;
    const v =
      cumV > 0
        ? cumPV / cumV
        : Number.isFinite(lastVwap)
          ? lastVwap
          : tp;
    out[i] = { time: c.time, value: v };
    lastVwap = v;
  }
  return out;
}
