// Tests for the CVD-by-Price utility (utils/cvdByPrice.ts).
//
// Focus: bucketing by price range, daily reset behaviour, and the
// shape of the output.  The per-candle delta definition is
// shared with the time-based CVD, so we only assert it once here.

import { describe, it, expect } from 'vitest';
import { computeCvdByPrice, autoBinSize } from './cvdByPrice';

describe('computeCvdByPrice', () => {
  it('returns an empty array for empty input', () => {
    expect(computeCvdByPrice([])).toEqual([]);
  });

  it('routes a single candle to its close-bin and returns its per-candle delta', () => {
    // tb=7, vol=10 → delta = 2*7 - 10 = 4
    // close=100, binSize=10 → bin = round(100/10)*10 = 100
    const out = computeCvdByPrice(
      [{ time: 100, close: 100, takerBuyVolume: 7, volume: 10 }],
      { binSize: 10 },
    );
    expect(out).toEqual([{ time: 100, price: 100, delta: 4, binSize: 10 }]);
  });

  it('rounds close to the nearest bin (half-up via Math.round)', () => {
    // 105 / 10 = 10.5 → round = 11 → 11 * 10 = 110
    const out = computeCvdByPrice(
      [{ time: 100, close: 105, takerBuyVolume: 5, volume: 10 }],
      { binSize: 10 },
    );
    expect(out[0].price).toBe(110);
  });

  it('accumulates deltas within a price-bin across multiple candles', () => {
    // tb=8, vol=10 → +6 each; tb=3, vol=10 → -4 each
    // All closes 100 → same bin → cumulative: 6, 12, 8
    const candles = [
      { time: 100, close: 100, takerBuyVolume: 8, volume: 10 },
      { time: 200, close: 100, takerBuyVolume: 8, volume: 10 },
      { time: 300, close: 100, takerBuyVolume: 3, volume: 10 },
    ];
    const out = computeCvdByPrice(candles, { binSize: 1 });
    expect(out.map((p) => p.delta)).toEqual([6, 12, 8]);
    expect(out.every((p) => p.price === 100)).toBe(true);
  });

  it('keeps separate totals for separate price bins in the same session', () => {
    // Two bins, each with one candle.  Bin 100 gets +6, bin 110 gets -4.
    const candles = [
      { time: 100, close: 100, takerBuyVolume: 8, volume: 10 }, // +6 → bin 100
      { time: 200, close: 110, takerBuyVolume: 3, volume: 10 }, // -4 → bin 110
    ];
    const out = computeCvdByPrice(candles, { binSize: 10 });
    expect(out[0]).toMatchObject({ time: 100, price: 100, delta: 6 });
    expect(out[1]).toMatchObject({ time: 200, price: 110, delta: -4 });
  });

  it('uses UTC-day anchor by default (resets daily)', () => {
    // t=86400 is 00:00 UTC of day 2; t=86400+60 is 00:01 UTC of day 2.
    // t=86400*2 is 00:00 UTC of day 3 — new session → bins reset.
    const candles = [
      // Day 1
      { time: 0,         close: 100, takerBuyVolume: 8, volume: 10 }, // +6
      { time: 0 + 60,    close: 100, takerBuyVolume: 5, volume: 10 }, //  0
      // Day 2
      { time: 86400,     close: 100, takerBuyVolume: 8, volume: 10 }, // +6 (new day, fresh bin)
      { time: 86400 + 60,close: 100, takerBuyVolume: 5, volume: 10 }, //  0 → cum = 6
      // Day 3
      { time: 86400 * 2, close: 100, takerBuyVolume: 8, volume: 10 }, // +6 (new day, fresh bin)
    ];
    const out = computeCvdByPrice(candles, { binSize: 1 });
    expect(out.map((p) => p.delta)).toEqual([6, 6, 6, 6, 6]);
  });

  it('resets per-bin totals when the anchor changes, even within the same price', () => {
    // Custom anchor that flips at every candle: each candle starts a
    // new session, so per-bin totals are always the per-candle delta
    // and never accumulate.
    const oneShot = (_t: number) => Math.random(); // unique anchor per call
    // We need a deterministic per-candle anchor instead of Math.random:
    let counter = 0;
    const perCandle = (_t: number) => ++counter;

    const candles = [
      { time: 1, close: 100, takerBuyVolume: 8, volume: 10 }, // +6
      { time: 2, close: 100, takerBuyVolume: 8, volume: 10 }, // +6 (new session)
      { time: 3, close: 100, takerBuyVolume: 8, volume: 10 }, // +6 (new session)
    ];
    const out = computeCvdByPrice(candles, {
      binSize: 1,
      getAnchor: perCandle,
    });
    expect(out.map((p) => p.delta)).toEqual([6, 6, 6]);
    // silence the unused warning
    void oneShot;
  });

  it('groups multiple candles under a single anchor when one is supplied', () => {
    // Single anchor (anchor=0) → every candle shares a session.
    const allOne = (_t: number) => 0;
    const candles = [
      { time: 1, close: 100, takerBuyVolume: 6, volume: 10 }, // +2
      { time: 2, close: 100, takerBuyVolume: 6, volume: 10 }, // +2
      { time: 3, close: 100, takerBuyVolume: 6, volume: 10 }, // +2
    ];
    const out = computeCvdByPrice(candles, {
      binSize: 1,
      getAnchor: allOne,
    });
    expect(out.map((p) => p.delta)).toEqual([2, 4, 6]);
  });

  it('preserves the input time keys exactly', () => {
    const candles = [
      { time: 1_700_000_000, close: 100, takerBuyVolume: 5, volume: 10 },
      { time: 1_700_000_300, close: 100, takerBuyVolume: 5, volume: 10 },
    ];
    const out = computeCvdByPrice(candles, { binSize: 1 });
    expect(out.map((p) => p.time)).toEqual([1_700_000_000, 1_700_000_300]);
  });

  it('handles zero volume cleanly (delta = -volume)', () => {
    // takerBuy=0, vol=5 → delta = -5
    const candles = [
      { time: 100, close: 100, takerBuyVolume: 0, volume: 5 },
    ];
    const out = computeCvdByPrice(candles, { binSize: 1 });
    expect(out[0].delta).toBe(-5);
  });

  it('handles takerBuy == volume (delta = +volume)', () => {
    // All-taker-buy candle: delta = 2*vol - vol = +vol
    const candles = [
      { time: 100, close: 100, takerBuyVolume: 10, volume: 10 },
    ];
    const out = computeCvdByPrice(candles, { binSize: 1 });
    expect(out[0].delta).toBe(10);
  });

  it('falls back to binSize=1 on a non-positive or non-finite value', () => {
    const candles = [
      { time: 100, close: 100, takerBuyVolume: 8, volume: 10 }, // +6
    ];
    const out0 = computeCvdByPrice(candles, { binSize: 0 });
    const outNeg = computeCvdByPrice(candles, { binSize: -5 });
    const outNaN = computeCvdByPrice(candles, { binSize: Number.NaN });
    for (const o of [out0, outNeg, outNaN]) {
      expect(o[0].binSize).toBe(1);
      expect(o[0].price).toBe(100);
      expect(o[0].delta).toBe(6);
    }
  });

  it('echoes the effective binSize on every output point', () => {
    const candles = [
      { time: 1, close: 100, takerBuyVolume: 6, volume: 10 },
      { time: 2, close: 100, takerBuyVolume: 6, volume: 10 },
    ];
    const out = computeCvdByPrice(candles, { binSize: 25 });
    expect(out.every((p) => p.binSize === 25)).toBe(true);
  });

  it("'mid' distribution splits the delta across two bins when close and mid straddle", () => {
    // Force a real split: close-bin != mid-bin.
    //   binSize=20, close=110 → close-bin = round(110/20)*20 = 120.
    //   mid = (high+low+close)/3.  To round to bin 100 we need
    //   mid in [90, 110).  Pick high=130, low=50, close=110:
    //   mid = (130+50+110)/3 = 96.67 → bin = round(96.67/20)*20 = 100.
    const candles = [
      { time: 1, close: 110, high: 130, low: 50, takerBuyVolume: 8, volume: 10 },
    ];
    const out = computeCvdByPrice(candles, {
      binSize: 20,
      distribution: 'mid',
    });
    // perCandleDelta = 6, half=3 → close-bin (120) gets +3, mid-bin (100) gets +3
    expect(out[0].price).toBe(120);
    // The reported delta is the close-bin's cumulative total.
    expect(out[0].delta).toBe(3);
  });

  it("'mid' distribution leaves a single-bin candle's delta at the close-bin (no double-count)", () => {
    // close=100, mid=100 → both round to 100 → only one bin touched.
    const candles = [
      { time: 1, close: 100, high: 110, low: 90, takerBuyVolume: 8, volume: 10 },
    ];
    const out = computeCvdByPrice(candles, {
      binSize: 10,
      distribution: 'mid',
    });
    // perCandleDelta = 6 → bin 100 gets all 6 (no double-count).
    expect(out[0].delta).toBe(6);
  });

  it('produces a strictly-bounded output (length matches input)', () => {
    const candles = Array.from({ length: 1000 }, (_, i) => ({
      time: 86_400 + i * 60,
      close: 100 + (i % 7),
      takerBuyVolume: 5 + (i % 3),
      volume: 10,
    }));
    const out = computeCvdByPrice(candles, { binSize: 1 });
    expect(out).toHaveLength(candles.length);
    for (const p of out) {
      expect(Number.isFinite(p.delta)).toBe(true);
      expect(Number.isFinite(p.price)).toBe(true);
    }
  });
});

// ─── autoBinSize ────────────────────────────────────────────────────────────

describe('autoBinSize', () => {
  it('returns the tick floor when given an empty candle array', () => {
    expect(autoBinSize([], { tickSize: 0.1 })).toBe(0.4);
  });

  it('returns the tick floor when all closes are identical', () => {
    const candles = Array.from({ length: 10 }, () => ({ close: 1000 }));
    expect(autoBinSize(candles, { tickSize: 0.1 })).toBe(0.4);
  });

  it('targets roughly `targetBins` across the visible range', () => {
    // Range = 1000 - 900 = 100. 80 target bins → raw = 1.25.
    // tickSize = 0.1, so 1.25 / 0.1 = 12.5 → ceil = 13 → 1.3.
    const candles = [{ close: 900 }, { close: 1000 }];
    expect(autoBinSize(candles, { tickSize: 0.1 })).toBeCloseTo(1.3, 6);
  });

  it('always returns a positive multiple of `tickSize`', () => {
    const candles = Array.from({ length: 50 }, (_, i) => ({ close: 100 + i }));
    const tick = 0.01;
    const bin = autoBinSize(candles, { tickSize: tick });
    expect(bin).toBeGreaterThan(0);
    expect((bin / tick) % 1).toBeCloseTo(0, 9);
  });

  it('honours `minTickMultiplier` to avoid over-resolving the profile', () => {
    // Range = 1.0, 80 target bins → raw = 0.0125.  tickSize = 0.01 →
    // raw / tick = 1.25 → ceil = 2, but minTickMultiplier = 4 → 4.
    const candles = [{ close: 100 }, { close: 101 }];
    const bin = autoBinSize(candles, { tickSize: 0.01, minTickMultiplier: 4 });
    expect(bin).toBe(0.04);
  });

  it('falls back to 1 when tickSize is non-finite or non-positive', () => {
    expect(autoBinSize([{ close: 1 }, { close: 2 }], { tickSize: Number.NaN })).toBe(1);
    expect(autoBinSize([{ close: 1 }, { close: 2 }], { tickSize: 0 })).toBe(1);
    expect(autoBinSize([{ close: 1 }, { close: 2 }], { tickSize: -0.5 })).toBe(1);
  });

  it('ignores non-finite closes when measuring the range', () => {
    const candles = [
      { close: 100 },
      { close: Number.NaN },
      { close: 200 },
    ];
    const bin = autoBinSize(candles, { tickSize: 0.1 });
    // range = 100, raw = 1.25, ticks = ceil(12.5) = 13 → 1.3.
    expect(bin).toBeCloseTo(1.3, 6);
  });
});
