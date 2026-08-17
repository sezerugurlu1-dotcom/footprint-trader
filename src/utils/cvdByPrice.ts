// CVD-by-Price (redesign of the time-based CVD).
//
// Same per-candle delta source as the time-based CVD (the kline's
// built-in taker-buy split: `delta = 2 * takerBuyVolume - volume`),
// but the running total is bucketed by PRICE instead of by candle.
//
// For every input candle we route its per-candle delta into the
// price-bin that contains the candle's close (rounded to `binSize`)
// and keep a per-bin cumulative total.  At every new session anchor
// (default: 00:00 UTC of each calendar day) all bins reset to zero,
// giving the indicator a fresh "session profile" each day — exactly
// what the reference image shows (green zones = positive cumulative
// delta, purple zones = negative, with one value-label per bin).
//
// Output shape is one point per (candle × price-bin that the candle
// contributed to).  In practice most candles contribute to one bin
// (their close), so the output is roughly one point per input
// candle.  Rendering-wise this maps cleanly onto lightweight-charts'
// HistogramSeries, where each point becomes a vertical bar drawn at
// the candle's time with the per-bin cumulative delta as its value.
// A green/red colour is attached per point so the chart can paint
// positive bars differently from negative ones, matching the visual
// language of the reference image.
//
// The function is pure: same input → same output, no hidden state.
// Allocations are bounded (one output point per input candle).

import type { Candle } from '../types';

export interface CvdByPricePoint {
  /** Candle open (unix seconds) — matches Candle.time. */
  time: number;
  /**
   * The price-bin the candle's close was routed to (close rounded
   * to the nearest multiple of `binSize`).
   */
  price: number;
  /**
   * Cumulative delta for this price-bin within the current session.
   * Positive ⇒ net buy pressure at that price; negative ⇒ net sell.
   * Resets to 0 at every new session anchor.
   */
  delta: number;
  /** Bin size that was used for this run (echoed for the renderer). */
  binSize: number;
}

export interface CvdByPriceOptions {
  /**
   * Price-bin size in price units.  Trades within `[p - binSize/2,
   * p + binSize/2)` share the same bin.  Defaults to `1`; pass the
   * symbol's `tickSize` for one-tick granularity, or a larger value
   * for chunkier profiles.
   */
  binSize?: number;

  /**
   * Returns the session-anchor timestamp (unix seconds) for any
   * candle time.  Two candles sharing an anchor belong to the same
   * session; when the anchor changes, all per-bin cumulative totals
   * reset to 0.  Defaults to the UTC calendar-day boundary
   * (00:00:00 UTC of the candle's calendar date) — matching the
   * "Resets every 1D" behaviour shown in the reference image and
   * the convention used by Binance / most charting platforms on
   * 24/7 crypto markets.
   */
  getAnchor?: (timeSec: number) => number;

  /**
   * How a candle's per-candle delta is distributed across price
   * bins.  The default `'close'` routes the whole delta to the bin
   * that contains the candle's close — fast and matches the
   * reference image, which labels the value at the close price.
   * `'mid'` averages over the bin containing the close AND the bin
   * containing the candle midpoint, which gives a slightly smoother
   * profile when a candle straddles a bin boundary.
   */
  distribution?: 'close' | 'mid';
}

/** Default anchor: floor the candle's UTC time to 00:00:00 UTC. */
function defaultAnchor(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

function defaultBinSize(): number {
  return 1;
}

/**
 * Compute CVD-by-Price for each candle in `candles`.  The returned
 * array has the same length as the input; each output point is the
 * cumulative delta for the price-bin the candle contributed to, in
 * the current session.
 *
 * Behaviour at the edges:
 *  - Empty input → empty output.
 *  - A candle's per-candle delta is `2 * takerBuyVolume - volume`,
 *    same definition as the time-based CVD.
 *  - When `binSize <= 0` or non-finite, the function falls back to
 *    `1` so we never crash on bad config.
 *  - `binSize` is reflected in every output point (`point.binSize`)
 *    so the renderer can pick a colour/label scheme tied to it.
 *  - All bins reset to 0 at every new session anchor.
 *  - Out-of-order candles are accepted but not reordered — the bin
 *    totals follow the input order, which matches what the chart
 *    will draw at each candle's time.
 *  - The function is pure: same input → same output, no hidden
 *    state.  Allocations are bounded (one output point per input
 *    candle, one `Map<bin,delta>` per session).
 */
export function computeCvdByPrice(
  candles: ReadonlyArray<
    // `high` and `low` are only required when `distribution === 'mid'`
    // (used to compute the HLC/3 mid-price).  Candles with just
    // OHLC-stripped taker-buy data still work for the default
    // `'close'` distribution — TypeScript will accept the wider
    // shape either way.
    Pick<Candle, 'time' | 'close' | 'high' | 'low' | 'takerBuyVolume' | 'volume'>
  >,
  options: CvdByPriceOptions = {},
): CvdByPricePoint[] {
  const {
    binSize = defaultBinSize(),
    getAnchor = defaultAnchor,
    distribution = 'close',
  } = options;

  const safeBin = Number.isFinite(binSize) && binSize > 0 ? binSize : 1;
  const out: CvdByPricePoint[] = new Array(candles.length);

  // map<priceBin, cumDelta> — recreated at every new session anchor.
  // A plain Map keeps bin insertion in price order (the first time
  // a price-bin is touched), which is useful for any downstream
  // render that wants to walk bins top-to-bottom.
  let cumByBin = new Map<number, number>();
  let lastAnchor = Number.NaN;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const anchor = getAnchor(c.time);
    if (anchor !== lastAnchor) {
      cumByBin = new Map();
      lastAnchor = anchor;
    }

    const perCandleDelta = 2 * c.takerBuyVolume - c.volume;
    const closeBin = Math.round(c.close / safeBin) * safeBin;

    if (distribution === 'mid' && c.high !== c.low) {
      // Half to the close-bin, half to the mid-bin.  This is a
      // cheap smoothing when a candle straddles a bin boundary —
      // it never under-counts volume at either side of the close.
      const midPrice = (c.high + c.low + c.close) / 3;
      const midBin = Math.round(midPrice / safeBin) * safeBin;

      if (midBin === closeBin) {
        // Single-bin case: do NOT split — that would halve the
        // per-candle delta and quietly under-report by 50% on
        // candles that don't straddle a bin boundary.
        cumByBin.set(
          closeBin,
          (cumByBin.get(closeBin) ?? 0) + perCandleDelta,
        );
      } else {
        const half = perCandleDelta / 2;
        cumByBin.set(closeBin, (cumByBin.get(closeBin) ?? 0) + half);
        cumByBin.set(midBin, (cumByBin.get(midBin) ?? 0) + half);
      }
      out[i] = {
        time: c.time,
        price: closeBin,
        delta: cumByBin.get(closeBin) ?? 0,
        binSize: safeBin,
      };
    } else {
      cumByBin.set(closeBin, (cumByBin.get(closeBin) ?? 0) + perCandleDelta);
      out[i] = {
        time: c.time,
        price: closeBin,
        delta: cumByBin.get(closeBin) ?? 0,
        binSize: safeBin,
      };
    }
  }
  return out;
}

// ─── Auto bin size ─────────────────────────────────────────────────────────
//
// Picking a bin size is a tuning parameter that depends on the symbol
// and the chart's zoom level.  This helper derives a sensible value
// from the candle data itself: it targets a fixed number of bins
// across the visible range and rounds the result up to a multiple of
// `tickSize` so the profile is stable as price drifts.
//
// It is exported so the chart layer can call it once per render and
// cache the result, rather than re-deriving it inside the hot loop of
// `computeCvdByPrice`.

export interface AutoBinSizeOptions {
  /** Symbol tick size (price step).  The result is always a
   *  multiple of this value.  Required. */
  tickSize: number;
  /** Target number of bins across the visible range.  Default 80,
   *  which keeps the histogram dense but still readable. */
  targetBins?: number;
  /** A "soft floor" multiplier for the resulting bin size.  Some
   *  symbols (e.g. XAUUSD at 0.01 tick) would otherwise pick a bin
   *  size in the same order of magnitude as the tick itself, which
   *  over-resolves the profile.  Default 4 (= result is always
   *  ≥ 4 ticks wide).  Pass 1 to disable. */
  minTickMultiplier?: number;
}

/**
 * Derive a sensible price-bin size from the candles' range and the
 * symbol's tick.  Pure: same input → same output.
 *
 * Returns `tickSize` itself when:
 *  - `candles` is empty (no price range to measure)
 *  - all candles share the same close (range = 0)
 *  - the input `tickSize` is non-finite or non-positive
 *  - the resulting size would round down below 1 tick
 */
export function autoBinSize(
  candles: ReadonlyArray<Pick<Candle, 'close'>>,
  options: AutoBinSizeOptions,
): number {
  const { tickSize, targetBins = 80, minTickMultiplier = 4 } = options;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 1;
  if (candles.length === 0) return Math.max(tickSize, minTickMultiplier * tickSize);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const c of candles) {
    if (!Number.isFinite(c.close)) continue;
    if (c.close < min) min = c.close;
    if (c.close > max) max = c.close;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Math.max(tickSize, minTickMultiplier * tickSize);
  }

  const range = max - min;
  // raw = range / targetBins, then round up to a multiple of tickSize.
  const raw = range / targetBins;
  const ticks = Math.max(minTickMultiplier, Math.ceil(raw / tickSize));
  return ticks * tickSize;
}
