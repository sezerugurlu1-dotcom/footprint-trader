// CVD line series for the chart.
//
// Cumulative Volume Delta — the running sum of per-candle
// taker-buy-vs-sell deltas, reset at a period boundary.  Renders
// as a single line on its own chart pane (the price scale it lives
// on is delta-units, not price-units).
//
// The per-candle delta uses the kline's built-in taker-buy split
// (Candle.takerBuyVolume is field 9 of the Binance kline response
// and `V` on the @kline WebSocket frame):
//
//   delta = 2 × takerBuyVolume − volume
//
// which equals (taker buy vol) − (taker sell vol).  Positive means
// net buy pressure; negative means net sell pressure.
//
// The period is user-selectable ('daily' or 'weekly').  When the
// user changes the period, the running total starts fresh from the
// current candle's anchor — there's no historical lookback that
// aggregates across the old period, because the user expects the
// line to start from 0 at the new boundary.
//
// Memoised on the candle array reference and the period string.
// The candle reference is stable across re-renders unless new
// data actually arrived (handled in useBinanceData.applyCandle).

import { useMemo } from 'react';
import type { Candle } from '../types';
import { computeCvd, type CvdPoint } from '../utils/cvd';
import { getCvdAnchor, type CvdPeriod } from '../utils/periodAnchors';

export function useCvd(
  candles: ReadonlyArray<Candle>,
  period: CvdPeriod,
): CvdPoint[] {
  return useMemo(
    () => computeCvd(candles, { getAnchor: getCvdAnchor(period) }),
    [candles, period],
  );
}
