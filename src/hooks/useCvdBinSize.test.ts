// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Candle, SymbolInfo } from '../types';
import { useCvdBinSize } from './useCvdBinSize';

const SYMBOL: SymbolInfo = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  pricePrecision: 1,
  quantityPrecision: 3,
  tickSize: 0.1,
};

const T0 = 1_700_000_000;
const MIN15 = 15 * 60;
function mkCandle(i: number, close: number): Candle {
  return {
    time: T0 + i * MIN15,
    open: close - 1, high: close + 1, low: close - 1,
    close, volume: 10, takerBuyVolume: 5,
  };
}

const CANDLES: Candle[] = [
  mkCandle(0, 100), mkCandle(1, 102), mkCandle(2, 104), mkCandle(3, 106), mkCandle(4, 108),
];

describe('useCvdBinSize', () => {
  it('returns the manual value when mode is "manual"', () => {
    const { result } = renderHook(() =>
      useCvdBinSize({ mode: 'manual', manual: 0.5, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(result.current).toBe(0.5);
  });

  it('falls back to tickSize when manual is non-positive or non-finite', () => {
    const { result: r1 } = renderHook(() =>
      useCvdBinSize({ mode: 'manual', manual: 0, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(r1.current).toBe(SYMBOL.tickSize);

    const { result: r2 } = renderHook(() =>
      useCvdBinSize({ mode: 'manual', manual: NaN, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(r2.current).toBe(SYMBOL.tickSize);

    const { result: r3 } = renderHook(() =>
      useCvdBinSize({ mode: 'manual', manual: -1, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(r3.current).toBe(SYMBOL.tickSize);
  });

  it('returns auto * 1 for "auto" and "medium"', () => {
    const { result: a } = renderHook(() =>
      useCvdBinSize({ mode: 'auto', manual: 999, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    const { result: m } = renderHook(() =>
      useCvdBinSize({ mode: 'medium', manual: 999, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(a.current).toBe(m.current);
    // auto * 1 must be > 0
    expect(a.current).toBeGreaterThan(0);
  });

  it('returns auto * 0.25 for "fine"', () => {
    const { result: a } = renderHook(() =>
      useCvdBinSize({ mode: 'auto', manual: 999, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    const { result: f } = renderHook(() =>
      useCvdBinSize({ mode: 'fine', manual: 999, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(f.current).toBeCloseTo(a.current * 0.25, 6);
  });

  it('returns auto * 4 for "coarse"', () => {
    const { result: a } = renderHook(() =>
      useCvdBinSize({ mode: 'auto', manual: 999, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    const { result: c } = renderHook(() =>
      useCvdBinSize({ mode: 'coarse', manual: 999, symbolInfo: SYMBOL, candles: CANDLES }),
    );
    expect(c.current).toBeCloseTo(a.current * 4, 6);
  });

  it('falls back to 0.01 tick when symbolInfo is null', () => {
    const { result } = renderHook(() =>
      useCvdBinSize({ mode: 'manual', manual: 0, symbolInfo: null, candles: CANDLES }),
    );
    expect(result.current).toBe(0.01);
  });
});
