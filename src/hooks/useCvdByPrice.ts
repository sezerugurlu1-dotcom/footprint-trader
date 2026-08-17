// CVD-by-Price series for the chart.
//
// Memoised wrapper around `computeCvdByPrice` — recomputes the
// range-bucketed cumulative delta every time the candle array
// reference changes (initial fetch, kline tick, loadMore).  The
// utility itself defaults to a UTC-day anchor, so the series resets
// to zero at every 00:00 UTC boundary, matching the "Resets every
// 1D" behaviour from the reference indicator.

import { useMemo } from 'react';
import type { Candle } from '../types';
import {
  computeCvdByPrice,
  type CvdByPriceOptions,
  type CvdByPricePoint,
} from '../utils/cvdByPrice';

export function useCvdByPrice(
  candles: ReadonlyArray<Candle>,
  options?: CvdByPriceOptions,
): CvdByPricePoint[] {
  // Depend on the candle array reference AND the bin-size / anchor
  // option values.  `options` is recreated each render, so we reach
  // through to the individual fields to keep the memo stable when
  // the caller passes the same logical config in a new object.
  const binSize = options?.binSize;
  const distribution = options?.distribution;
  const getAnchor = options?.getAnchor;
  return useMemo(
    () => computeCvdByPrice(candles, { binSize, distribution, getAnchor }),
    [candles, binSize, distribution, getAnchor],
  );
}
