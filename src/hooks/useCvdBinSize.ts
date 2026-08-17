// CVD-by-Price bin size derivation.
//
// The user's bin-size preset (auto / fine / medium / coarse / manual)
// is resolved into a concrete price-bin number by combining:
//   1. The auto-derived bin from the candle range + symbol tick
//   2. A preset multiplier (or 1 for "auto")
//   3. A manual override (when the preset is "manual")
//
// Pulled out of App.tsx so the formula lives in one place and is
// testable without rendering the whole App.

import { useMemo } from 'react';
import type { Candle, SymbolInfo } from '../types';
import { autoBinSize } from '../utils/cvdByPrice';
import type { CvdBinMode } from '../utils/cvdByPrice.types';
import { CVD_BIN_MULTIPLIER } from '../utils/cvdByPrice.types';

export interface UseCvdBinSizeArgs {
  mode: CvdBinMode;
  manual: number;
  symbolInfo: SymbolInfo | null;
  candles: ReadonlyArray<Candle>;
}

export function useCvdBinSize({
  mode,
  manual,
  symbolInfo,
  candles,
}: UseCvdBinSizeArgs): number {
  return useMemo(() => {
    const tick = symbolInfo?.tickSize ?? 0.01;
    if (mode === 'manual') {
      return Number.isFinite(manual) && manual > 0 ? manual : tick;
    }
    const auto = autoBinSize(candles, { tickSize: tick, targetBins: 80 });
    const mult = mode === 'auto' ? 1 : CVD_BIN_MULTIPLIER[mode];
    return auto * mult;
  }, [mode, manual, symbolInfo, candles]);
}
