// VWAP line series for the chart.
//
// Recomputes the period-anchored volume-weighted average price
// (HLC/3 typical by default) whenever the candle array changes.
// The reset boundary is user-selectable via `period` — 'session'
// (UTC-day, the original behaviour) or 'daily' / 'weekly' /
// 'monthly'.  See utils/periodAnchors.ts for the exact boundaries.
//
// Memoised on the candle reference AND the period string.  The
// candle reference is stable across re-renders unless new data
// actually arrived (handled in useBinanceData.applyCandle).

import { useMemo } from 'react';
import type { Candle } from '../types';
import { computeVwap, type VwapPoint } from '../utils/vwap';
import { getVwapAnchor, type VwapPeriod } from '../utils/periodAnchors';

export function useVwap(
  candles: ReadonlyArray<Candle>,
  period: VwapPeriod = 'session',
): VwapPoint[] {
  return useMemo(
    () => computeVwap(candles, { getAnchor: getVwapAnchor(period) }),
    [candles, period],
  );
}
