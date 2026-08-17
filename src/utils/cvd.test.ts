// Tests for the CVD utility (utils/cvd.ts).
import { describe, it, expect } from 'vitest';
import { computeCvd } from './cvd';

describe('computeCvd', () => {
  it('returns an empty array for empty input', () => {
    expect(computeCvd([])).toEqual([]);
  });

  it('computes a single-candle delta correctly', () => {
    // takerBuy = 7, volume = 10 → delta = 2*7 - 10 = 4
    expect(
      computeCvd([{ time: 100, takerBuyVolume: 7, volume: 10 }]),
    ).toEqual([{ time: 100, value: 4 }]);
  });

  it('accumulates deltas across multiple candles', () => {
    // Candle 1: tb=5, vol=10 → delta = 0
    // Candle 2: tb=8, vol=10 → delta = 6
    // Candle 3: tb=3, vol=10 → delta = -4
    // CVD: 0, 6, 2
    const candles = [
      { time: 100, takerBuyVolume: 5, volume: 10 },
      { time: 200, takerBuyVolume: 8, volume: 10 },
      { time: 300, takerBuyVolume: 3, volume: 10 },
    ];
    const out = computeCvd(candles);
    expect(out[0].value).toBe(0);
    expect(out[1].value).toBe(6);
    expect(out[2].value).toBe(2);
  });

  it('preserves the input time keys exactly', () => {
    const candles = [
      { time: 1_700_000_000, takerBuyVolume: 5, volume: 10 },
      { time: 1_700_000_300, takerBuyVolume: 5, volume: 10 },
    ];
    const out = computeCvd(candles);
    expect(out.map((p) => p.time)).toEqual([1_700_000_000, 1_700_000_300]);
  });

  it('handles zero volume cleanly (delta = -volume)', () => {
    // takerBuy=0, vol=0 → delta = 0; takerBuy=0, vol=5 → delta = -5
    const candles = [
      { time: 100, takerBuyVolume: 0, volume: 0 },
      { time: 200, takerBuyVolume: 0, volume: 5 },
    ];
    const out = computeCvd(candles);
    expect(out[0].value).toBe(0);
    expect(out[1].value).toBe(-5);
  });

  it('handles takerBuy equal to volume (delta = +volume)', () => {
    // All-taker-buy candle: delta = 2*vol - vol = +vol
    const candles = [
      { time: 100, takerBuyVolume: 10, volume: 10 },
    ];
    expect(computeCvd(candles)).toEqual([{ time: 100, value: 10 }]);
  });

  it('resets at the given anchor', () => {
    // UTC-day anchor: floor to 00:00 UTC.  Times 86400 and 86400+86400
    // are on different days, so CVD resets between them.
    const getAnchor = (t: number) => Math.floor(t / 86400) * 86400;
    const candles = [
      { time: 86400, takerBuyVolume: 8, volume: 10 },     // delta = 6
      { time: 172800, takerBuyVolume: 5, volume: 10 },    // delta = 0, NEW day
    ];
    const out = computeCvd(candles, { getAnchor });
    expect(out[0].value).toBe(6);
    expect(out[1].value).toBe(0);
  });

  it('defaults to a daily (UTC) reset', () => {
    // No `getAnchor` passed → UTC-day boundary is the default.
    // Times 0 and 43200 are on the same UTC day; 86400 is the next day.
    const candles = [
      { time: 0,      takerBuyVolume: 8, volume: 10 },  // +6 (day 0)
      { time: 43200,  takerBuyVolume: 8, volume: 10 },  // +6 (day 0, same session)
      { time: 86400,  takerBuyVolume: 8, volume: 10 },  // +6 (day 1, fresh)
      { time: 86460,  takerBuyVolume: 8, volume: 10 },  // +6 (day 1)
    ];
    const out = computeCvd(candles);
    expect(out.map((p) => p.value)).toEqual([6, 12, 6, 12]);
  });

  it('resets multiple times across many sessions', () => {
    // Single-anchor (no reset) groups everything into one bucket.
    const noReset = (t: number) => 0;
    const candles = [
      { time: 1, takerBuyVolume: 6, volume: 10 },
      { time: 2, takerBuyVolume: 6, volume: 10 },
      { time: 3, takerBuyVolume: 6, volume: 10 },
    ];
    // deltas: 2, 2, 2 → CVD: 2, 4, 6
    expect(computeCvd(candles, { getAnchor: noReset }).map((p) => p.value)).toEqual([2, 4, 6]);

    // Anchor at 0 vs 100: candles at t=1,2 share anchor 0, t=3 is anchor 100
    const splitAnchor = (t: number) => (t >= 3 ? 100 : 0);
    // After split: [2, 4, 2]
    expect(
      computeCvd(candles, { getAnchor: splitAnchor }).map((p) => p.value),
    ).toEqual([2, 4, 2]);
  });

  it('produces a strictly-bounded output (length matches input)', () => {
    const candles = Array.from({ length: 1000 }, (_, i) => ({
      time: 86_400 + i * 60,
      takerBuyVolume: 5 + (i % 3),
      volume: 10,
    }));
    const out = computeCvd(candles);
    expect(out).toHaveLength(candles.length);
    for (const p of out) {
      expect(Number.isFinite(p.value)).toBe(true);
    }
  });
});
