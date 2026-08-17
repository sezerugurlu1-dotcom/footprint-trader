// Cumulative Volume Delta (CVD) — time-based running total.
//
// For each candle we derive a per-candle delta from the kline's
// built-in taker-buy/sell split (Candle.takerBuyVolume is field 9
// of the Binance kline response / `V` on the @kline WebSocket frame).
// CVD is the running sum of those per-candle deltas — the cumulative
// "aggressive flow" since the anchor.
//
// Defaults to a UTC-day reset (the running total returns to 0 at
// 00:00:00 UTC of every calendar day), matching the "Resets every
// 1D" behaviour that pairs with the redesigned CVD-by-Price
// indicator.  Pass `getAnchor` to use a different boundary (e.g.
// weekly reset, session open), or pass a no-op `() => 0` to
// restore the all-time cumulative behaviour.
//
// The function is pure: same input → same output, no hidden state.
// Bounded allocations (one output point per input candle).

import type { Candle } from '../types';

export interface CvdPoint {
  time: number;   // candle open (unix seconds) — matches Candle.time
  value: number;  // cumulative delta at that candle
}

export interface CvdOptions {
  /**
   * Returns the session-anchor timestamp (unix seconds) for any
   * candle time.  Two candles sharing the same anchor contribute to
   * the same running total.  When the anchor changes, the running
   * total resets to 0.
   *
   * Defaults to the UTC calendar-day boundary (00:00:00 UTC of the
   * candle's calendar date) — the conventional "daily reset" used
   * by Binance and most charting platforms on 24/7 crypto markets.
   * Pass a custom function for a different boundary, or a no-op
   * `() => 0` to restore all-time cumulative behaviour.
   */
  getAnchor?: (timeSec: number) => number;
}

/** Default anchor: floor the candle's UTC time to 00:00:00 UTC. */
function defaultAnchor(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

/**
 * Compute CVD for each candle in `candles`.  The returned array has
 * the same length and time keys as the input.
 *
 * Per-candle delta uses the kline's taker-buy split:
 *   delta = 2 × takerBuyVolume − volume
 * which equals (taker buy vol) − (taker sell vol).  Empty input →
 * empty output.  Resets at every new session anchor (default =
 * 00:00 UTC).
 */
export function computeCvd(
  candles: ReadonlyArray<Pick<Candle, 'time' | 'takerBuyVolume' | 'volume'>>,
  options: CvdOptions = {},
): CvdPoint[] {
  const { getAnchor = defaultAnchor } = options;
  const out: CvdPoint[] = new Array(candles.length);

  let cum = 0;
  let lastAnchor = Number.NaN;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const a = getAnchor(c.time);
    if (a !== lastAnchor) {
      cum = 0;
      lastAnchor = a;
    }
    const delta = 2 * c.takerBuyVolume - c.volume;
    cum += delta;
    out[i] = { time: c.time, value: cum };
  }
  return out;
}
