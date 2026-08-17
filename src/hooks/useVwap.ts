// VWAP line series for the chart.
//
// Recomputes the session-anchored volume-weighted average price
// (UTC-day reset, HLC/3 typical) whenever the candle array changes.
// Memoised on the candle reference, which is stable across re-
// renders unless new data actually arrived.

import { useMemo } from 'react';
import type { Candle } from '../types';
import { computeVwap, type VwapPoint } from '../utils/vwap';

export function useVwap(candles: ReadonlyArray<Candle>): VwapPoint[] {
  return useMemo(() => computeVwap(candles), [candles]);
}
