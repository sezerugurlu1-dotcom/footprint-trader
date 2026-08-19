// Tests for the CVD utility (utils/cvd.ts).
import { describe, it, expect } from 'vitest';
import { computeCvd, splitCvdBySlope } from './cvd';

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
    const noReset = (_t: number) => 0;
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

describe('splitCvdBySlope', () => {
  it('returns empty arrays for empty input', () => {
    const { up, down } = splitCvdBySlope([]);
    expect(up).toEqual([]);
    expect(down).toEqual([]);
  });

  it('places the first point in `up` and leaves `down` empty when only one candle', () => {
    const { up, down } = splitCvdBySlope([{ time: 100, value: 5 }]);
    expect(up).toEqual([{ time: 100, value: 5 }]);
    expect(down).toEqual([]);
  });

  it('puts every point in `up` and only the down-segment in `down` for a single up→down→up pattern', () => {
    // A=100, B=105 (up), C=102 (down), D=110 (up)
    // Up line should be A→B→C→D (4 points, continuous, drawn under).
    // Down line should be B (elbow) → C only (2 points, drawn on top).
    // Visual: A→B green, B→C red, C→D green.
    const { up, down } = splitCvdBySlope([
      { time: 0, value: 100 },
      { time: 1, value: 105 },
      { time: 2, value: 102 },
      { time: 3, value: 110 },
    ]);
    expect(up).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 105 },
      { time: 2, value: 102 },
      { time: 3, value: 110 },
    ]);
    expect(down).toEqual([
      { time: 1, value: 105 }, // elbow from the up→down transition
      { time: 2, value: 102 },
    ]);
  });

  it('emits one continuous down segment for a long down-run', () => {
    // A=100, B=98, C=95, D=92, E=110
    // Down: A→B→C→D.  Up: D→E.
    // Visual: A→D red, D→E green.
    const { up, down } = splitCvdBySlope([
      { time: 0, value: 100 },
      { time: 1, value: 98 },
      { time: 2, value: 95 },
      { time: 3, value: 92 },
      { time: 4, value: 110 },
    ]);
    // Up: every point.
    expect(up).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 98 },
      { time: 2, value: 95 },
      { time: 3, value: 92 },
      { time: 4, value: 110 },
    ]);
    // Down: A (elbow from the implicit "first" direction) + B + C + D.
    expect(down).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 98 },
      { time: 2, value: 95 },
      { time: 3, value: 92 },
    ]);
  });

  it('keeps `up` continuous across equal values (flats are not a direction)', () => {
    // A=100, B=100 (flat), C=103 (up), D=99 (down)
    // The flat at B doesn't flip the colour; it's still an up
    // segment.  D is a down move; the previous point (C) is the
    // elbow.
    const { up, down } = splitCvdBySlope([
      { time: 0, value: 100 },
      { time: 1, value: 100 },
      { time: 2, value: 103 },
      { time: 3, value: 99 },
    ]);
    expect(up).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 100 },
      { time: 2, value: 103 },
      { time: 3, value: 99 },
    ]);
    expect(down).toEqual([
      { time: 2, value: 103 }, // elbow at the up→down transition
      { time: 3, value: 99 },
    ]);
  });

  it('handles a series that opens with a down move by reusing the first point as the down elbow', () => {
    // The very first move is down — there's no prior up segment to
    // be the elbow, so the first point itself plays that role.
    // Visual: A→B→C all red.
    const { up, down } = splitCvdBySlope([
      { time: 0, value: 100 },
      { time: 1, value: 92 },
      { time: 2, value: 88 },
    ]);
    expect(up).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 92 },
      { time: 2, value: 88 },
    ]);
    expect(down).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 92 },
      { time: 2, value: 88 },
    ]);
  });

  it('always-up series puts every point in `up` and leaves `down` empty', () => {
    const { up, down } = splitCvdBySlope([
      { time: 0, value: 100 },
      { time: 1, value: 101 },
      { time: 2, value: 102 },
      { time: 3, value: 103 },
    ]);
    expect(up).toHaveLength(4);
    expect(down).toEqual([]);
  });

  it('breaks the red line at the up→down elbow for alternating segments', () => {
    // A=100, B=105 (up), C=100 (down), D=110 (up), E=95 (down)
    // Two down segments, each bridged by the elbow at the start of
    // the down move.
    const { up, down } = splitCvdBySlope([
      { time: 0, value: 100 },
      { time: 1, value: 105 },
      { time: 2, value: 100 },
      { time: 3, value: 110 },
      { time: 4, value: 95 },
    ]);
    expect(up).toEqual([
      { time: 0, value: 100 },
      { time: 1, value: 105 },
      { time: 2, value: 100 },
      { time: 3, value: 110 },
      { time: 4, value: 95 },
    ]);
    expect(down).toEqual([
      { time: 1, value: 105 }, // elbow at the first up→down
      { time: 2, value: 100 },
      { time: 3, value: 110 }, // elbow at the second up→down
      { time: 4, value: 95 },
    ]);
  });
});
