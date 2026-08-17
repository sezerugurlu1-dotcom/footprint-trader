// Tests for the VWAP utility (utils/vwap.ts).
import { describe, it, expect } from 'vitest';
import { computeVwap } from './vwap';

describe('computeVwap', () => {
  it('returns an empty array for empty input', () => {
    expect(computeVwap([])).toEqual([]);
  });

  it('matches HLC/3 manual calculation for a single candle', () => {
    // H=110, L=100, C=105 → TP=105; V=2 → VWAP=105.
    expect(
      computeVwap([{ time: 100, high: 110, low: 100, close: 105, volume: 2 }]),
    ).toEqual([{ time: 100, value: 105 }]);
  });

  it('accumulates within a single session', () => {
    // Two candles, same UTC day (00:00:00 UTC = unix 86400).
    const candles = [
      { time: 86_400, high: 102, low: 100, close: 101, volume: 1 }, // TP=101
      { time: 90_000, high: 104, low: 102, close: 103, volume: 2 }, // TP=103
    ];
    const out = computeVwap(candles);
    expect(out[0].value).toBe(101);
    // cumPV = 101*1 + 103*2 = 307; cumV = 3 → 102.333...
    expect(out[1].value).toBeCloseTo(307 / 3, 5);
  });

  it('resets at each UTC-day boundary', () => {
    // Day 1 (t=86_400), Day 2 (t=172_800).  Each candle sits alone
    // in its session, so VWAP equals its own typical price.
    const candles = [
      { time: 86_400, high: 110, low: 100, close: 105, volume: 1 },
      { time: 172_800, high: 220, low: 200, close: 210, volume: 1 },
    ];
    const out = computeVwap(candles);
    expect(out[0].value).toBe(105);
    expect(out[1].value).toBe(210);
  });

  it('carries the previous VWAP through a zero-volume candle', () => {
    const candles = [
      { time: 86_400, high: 110, low: 100, close: 105, volume: 1 }, // TP=105
      { time: 90_000, high: 110, low: 100, close: 106, volume: 0 }, // no advance
      { time: 93_600, high: 112, low: 100, close: 108, volume: 2 }, // TP=106.667
    ];
    const out = computeVwap(candles);
    expect(out[0].value).toBe(105);
    expect(out[1].value).toBe(105);
    // cumPV = 105*1 + (320/3)*2 = 955/3; cumV = 3 → 955/9 ≈ 106.111
    expect(out[2].value).toBeCloseTo(955 / 9, 5);
  });

  it('uses close when useCloseOnly is true', () => {
    const candles = [
      { time: 86_400, high: 110, low: 100, close: 105, volume: 1 },
    ];
    expect(
      computeVwap(candles, { useCloseOnly: true }),
    ).toEqual([{ time: 86_400, value: 105 }]);
  });

  it('respects a custom getAnchor function', () => {
    // Anchor at 0 for all candles → single session.
    const getAnchor = () => 0;
    const candles = [
      { time: 100, high: 102, low: 100, close: 101, volume: 1 },
      { time: 200, high: 104, low: 102, close: 103, volume: 2 },
    ];
    const out = computeVwap(candles, { getAnchor });
    expect(out[0].value).toBe(101);
    expect(out[1].value).toBeCloseTo(307 / 3, 5);
  });

  it('preserves the input time keys exactly', () => {
    const candles = [
      { time: 1_700_000_000, high: 10, low: 9, close: 9.5, volume: 5 },
      { time: 1_700_000_300, high: 11, low: 9.5, close: 10.5, volume: 7 },
    ];
    const out = computeVwap(candles);
    expect(out.map((p) => p.time)).toEqual([1_700_000_000, 1_700_000_300]);
  });

  it('produces a strictly-bounded output (length matches input)', () => {
    const candles = Array.from({ length: 1000 }, (_, i) => ({
      time: 86_400 + i * 60,
      high: 100 + (i % 7),
      low: 100 - (i % 5),
      close: 100 + (i % 3) - 1,
      volume: 10 + (i % 4),
    }));
    const out = computeVwap(candles);
    expect(out).toHaveLength(candles.length);
    // All values are finite numbers.
    for (const p of out) {
      expect(Number.isFinite(p.value)).toBe(true);
    }
  });
});
