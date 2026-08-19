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
import type { LineData, Time } from 'lightweight-charts';

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

// ─── Slope-coloured split ───────────────────────────────────────────────
//
// The chart paints the CVD line green when the running total is
// rising and red when it is falling.  We can't change a LineSeries'
// colour per-segment, so we split the points into two parallel
// arrays — one per colour — and draw them as two stacked series.
// The green series is drawn first (under) and the red series on
// top, so the red overwrites the green only on the segments that
// are actually down-moves.
//
// "Elbow" handling: at every direction change, the previous
// point is added to BOTH series.  That keeps each line continuous
// across the boundary and produces a sharp corner at the inflection
// instead of a dashed gap.  Without the elbow, the green line
// would visibly terminate at the last up point and the red line
// would start one tick later, leaving a 1-bar blank.

/**
 * Split a CVD series into "up" and "down" segments for slope-based
 * colouring.
 *
 * Approach: the `up` array contains EVERY point and is drawn first
 * (under); the `down` array contains only the points that are part
 * of a down-move segment (plus the elbow that bridges consecutive
 * down runs) and is drawn on top.  The result is a single
 * continuous line that changes colour at the elbow between an
 * up-move and a down-move.
 *
 * The elbow trick: when a down segment starts after an up segment,
 * the previous point (the last up point) is included in BOTH
 * series so the red line begins at the same (time, value) where
 * the green line last rendered — no 1-bar gap, no overshoot.
 *
 * Flat (equal) candles do not flip the colour — the line just
 * continues in the last established direction.  Two flat candles in
 * a row are still one continuous segment.
 */
export function splitCvdBySlope(
  points: ReadonlyArray<CvdPoint>,
): { up: LineData[]; down: LineData[] } {
  const up: LineData[] = [];
  const down: LineData[] = [];
  if (points.length === 0) return { up, down };

  // The green line is continuous across the whole range so it
  // sits underneath the red line everywhere a red line would not
  // cover.  Every point goes in `up`.
  for (const p of points) {
    up.push({ time: p.time as Time, value: p.value });
  }

  // The red line is continuous only across down-move segments.
  // We add the elbow (the previous point) at every direction
  // change into a down move so the red line meets the green line
  // exactly at the elbow and the colour transition is sharp.
  let lastDir: 'up' | 'down' | null = null;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const isDown = curr.value < prev.value;
    // Equal values continue the previous direction — they don't
    // flip the colour.  isStrictDown is true only for actual
    // down-moves.
    if (isDown) {
      if (lastDir !== 'down') {
        down.push({ time: prev.time as Time, value: prev.value });
      }
      down.push({ time: curr.time as Time, value: curr.value });
      lastDir = 'down';
    } else if (curr.value > prev.value) {
      // Up-move: don't add to down.  The green line already covers
      // this segment.
      lastDir = 'up';
    }
    // Equal: leave lastDir as-is.
  }

  return { up, down };
}
