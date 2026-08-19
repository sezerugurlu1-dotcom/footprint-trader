// Tests for the useCvd hook (hooks/useCvd.ts).
//
// The hook itself is a thin React useMemo wrapper around
// `computeCvd` with the anchor function selected by `period`.  We
// exercise the integration (candle data → anchor selection →
// per-candle delta → cumulative running total → period reset)
// by going through the same code path the hook uses, but without
// React's renderHook (the project's vitest.config.ts runs tests
// in the 'node' environment, which has no DOM).  The memo layer
// is trivial and well-covered by React itself.
import { describe, it, expect } from 'vitest';
import { computeCvd } from '../utils/cvd';
import { getCvdAnchor } from '../utils/periodAnchors';
import type { Candle } from '../types';

const c = (time: number, takerBuyVolume: number, volume: number): Candle => ({
  time, takerBuyVolume, volume, open: 0, high: 0, low: 0, close: 0,
});

// Mirror the hook body without React's useMemo, so we can run
// the test in the node environment.
function runAsHookWould(candles: ReadonlyArray<Candle>, period: 'daily' | 'weekly') {
  return computeCvd(candles, { getAnchor: getCvdAnchor(period) });
}

describe('useCvd', () => {
  it('with daily reset, deltas before the UTC-day boundary accumulate', () => {
    // 0 and 43200 are on the same UTC day; 86400 is the next day.
    const candles: Candle[] = [
      c(0,      8, 10),  // +6 (day 0)
      c(43_200, 8, 10),  // +6 (day 0, same session)
      c(86_400, 8, 10),  // +6 (day 1, fresh)
      c(86_460, 8, 10),  // +6 (day 1)
    ];
    const out = runAsHookWould(candles, 'daily');
    expect(out.map((p) => p.value)).toEqual([6, 12, 6, 12]);
  });

  it('with weekly reset, deltas before the Monday boundary accumulate', () => {
    // 2024-01-01 is a Monday.  Its unix timestamp is 1704067200.
    // Wednesday is +2 days, the following Monday is +7 days.
    const monday1 = 1_704_067_200;
    const wed = monday1 + 2 * 86_400;
    const monday2 = monday1 + 7 * 86_400;
    const candles: Candle[] = [
      c(monday1, 8, 10), // +6 (week 1)
      c(wed,     8, 10), // +6 (week 1, same session, accumulates)
      c(monday2, 8, 10), // +6 (week 2, fresh)
    ];
    const out = runAsHookWould(candles, 'weekly');
    expect(out[0].value).toBe(6);
    expect(out[1].value).toBe(12);
    expect(out[2].value).toBe(6);
  });

  it('returns the same output for the same period string', () => {
    const candles: Candle[] = [c(86_400, 7, 10), c(172_800, 5, 10)];
    const a = runAsHookWould(candles, 'daily');
    const b = runAsHookWould(candles, 'daily');
    expect(a).toEqual(b);
  });

  it('returns different values for different periods on the same input', () => {
    // Three candles spaced 1 day apart starting on a Monday.
    // Daily reset happens between each one; weekly reset doesn't
    // happen because all three land in the same Mon-anchored week.
    const monday = 1_704_067_200;
    const candles: Candle[] = [
      c(monday,             8, 10), // +6
      c(monday + 86_400,    8, 10), // +6
      c(monday + 2*86_400,  8, 10), // +6
    ];
    const daily  = runAsHookWould(candles, 'daily');
    const weekly = runAsHookWould(candles, 'weekly');
    // Daily: each candle sits alone in its session → 6, 6, 6.
    expect(daily.map((p) => p.value)).toEqual([6, 6, 6]);
    // Weekly: all three in the same week → 6, 12, 18.
    expect(weekly.map((p) => p.value)).toEqual([6, 12, 18]);
  });
});
