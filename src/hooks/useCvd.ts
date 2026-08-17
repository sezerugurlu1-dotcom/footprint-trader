// Cumulative Volume Delta line series for the chart.
//
// Computes all-time CVD from the kline's taker-buy split on every
// candle-array change.  Memoised on the candle reference, which is
// stable across re-renders unless new data actually arrived.

import { useMemo } from 'react';
import type { Candle } from '../types';
import { computeCvd, type CvdPoint } from '../utils/cvd';

export function useCvd(candles: ReadonlyArray<Candle>): CvdPoint[] {
  return useMemo(() => computeCvd(candles), [candles]);
}
