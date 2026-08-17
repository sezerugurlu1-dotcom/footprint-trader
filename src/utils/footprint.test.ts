// Tests for FootprintBuilder (utils/footprint.ts)
import { describe, it, expect } from 'vitest';
import { FootprintBuilder } from './footprint';
import type { AggTrade } from '../types';

// Helper to build a trade quickly
function tr(
  ts: number,
  price: number,
  qty: number,
  isBuyerMaker: boolean,
  id = ts,
): AggTrade {
  return { id, price, qty, ts, isBuyerMaker };
}

describe('FootprintBuilder', () => {
  describe('addTrade / basic bucketing', () => {
    it('creates a candle bucket on the first trade', () => {
      const b = new FootprintBuilder('1m', 0.1);
      const t = b.addTrade(tr(60_000, 100.0, 1, false));
      expect(t).toBe(60); // 60_000 ms / 60_000 = 1, floored
      const out = b.build();
      expect(out).toHaveLength(1);
      expect(out[0].time).toBe(60);
      expect(out[0].open).toBe(100);
      expect(out[0].close).toBe(100);
      expect(out[0].high).toBe(100);
      expect(out[0].low).toBe(100);
    });

    it('aggregates bid vs ask volume per price level', () => {
      const b = new FootprintBuilder('1m', 0.1);
      // 100.05 / 0.1 = 1000.5 → Math.round (half-to-even) → 1000 → 100.0
      // 100.15 / 0.1 = 1001.5 → Math.round (half-to-even) → 1002 → 100.2
      // Two aggressive buys (isBuyerMaker=false) at 100.05
      b.addTrade(tr(60_000, 100.05, 2, false));
      b.addTrade(tr(60_500, 100.05, 3, false));
      // One aggressive sell (isBuyerMaker=true) at 100.05
      b.addTrade(tr(60_999, 100.05, 1, true));
      // Sells at 100.15
      b.addTrade(tr(60_000, 100.15, 4, true));

      const c = b.build()[0];
      expect(c.levels).toHaveLength(2);
      const top = c.levels[0];     // 100.2 (desc by price)
      const bot = c.levels[1];     // 100.0
      expect(top.price).toBe(100.2);
      expect(top.bidVol).toBe(0);
      expect(top.askVol).toBe(4);
      expect(bot.price).toBe(100);
      expect(bot.bidVol).toBe(5);
      expect(bot.askVol).toBe(1);
    });

    it('groups trades from different minutes into separate candles', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.addTrade(tr(60_000, 100, 1, false));
      b.addTrade(tr(120_000, 200, 1, true));
      const out = b.build();
      expect(out).toHaveLength(2);
      expect(out[0].close).toBe(100);
      expect(out[1].close).toBe(200);
    });

    it('computes totalBid/totalAsk/delta correctly', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.addTrade(tr(60_000, 100, 5, false)); // bid +5
      b.addTrade(tr(60_500, 100, 2, true));  // ask +2
      const c = b.build()[0];
      expect(c.totalBid).toBe(5);
      expect(c.totalAsk).toBe(2);
      expect(c.delta).toBe(3);
      // max(bid+ask) per level = max(5+2) = 7
      expect(c.maxVol).toBe(7);
    });
  });

  describe('roundToTick / formatTick', () => {
    it('rounds prices to the configured tick', () => {
      const b = new FootprintBuilder('1m', 0.5);
      b.addTrade(tr(60_000, 100.3, 1, false));
      // 100.3 / 0.5 = 200.6 → 201 → 201 * 0.5 = 100.5
      const c = b.build()[0];
      expect(c.levels[0].price).toBe(100.5);
    });

    it('strips floating-point artifacts via formatTick', () => {
      const b = new FootprintBuilder('1m', 0.01);
      b.addTrade(tr(60_000, 0.1 + 0.2, 1, false)); // 0.30000000000000004
      const c = b.build()[0];
      expect(c.levels[0].price).toBe(0.3);
    });

    it('handles tick=0 (passthrough at the roundToTick layer; formatTick still snaps to 0 decimals)', () => {
      const b = new FootprintBuilder('1m', 0);
      b.addTrade(tr(60_000, 123.456789, 1, false));
      const c = b.build()[0];
      // roundToTick skips with tick=0, but formatTick toFixed(0) snaps to integer.
      expect(c.levels[0].price).toBe(123);
    });
  });

  describe('addTrades (bulk)', () => {
    it('ingests a large batch in insertion order, computing OHLC from first/last', () => {
      const b = new FootprintBuilder('1m', 0.1);
      const trades = [
        tr(60_000, 100, 1, false),
        tr(60_100, 105, 2, true),   // new high
        tr(60_200, 95,  1, false),  // new low
        tr(60_500, 102, 3, true),   // close
      ];
      b.addTrades(trades);
      const c = b.build()[0];
      expect(c.open).toBe(100);
      expect(c.high).toBe(105);
      expect(c.low).toBe(95);
      expect(c.close).toBe(102);
    });

    it('handles zero trades gracefully', () => {
      const b = new FootprintBuilder('1m', 0.1);
      expect(b.addTrades([])).toBe(0);
      expect(b.build()).toHaveLength(0);
    });
  });

  describe('seed', () => {
    it('pre-populates OHLC meta for known candles', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.seed([{ time: 60, open: 100, high: 110, low: 99, close: 105 }]);
      const c = b.build()[0];
      expect(c.open).toBe(100);
      expect(c.high).toBe(110);
      expect(c.low).toBe(99);
      expect(c.close).toBe(105);
      expect(c.levels).toEqual([]);
    });
  });

  describe('updateKline', () => {
    it('overrides meta and ensures a bucket exists', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.updateKline({ time: 60, open: 1, high: 2, low: 0.5, close: 1.5 });
      const c = b.build()[0];
      expect(c.open).toBe(1);
      expect(c.close).toBe(1.5);
    });
  });

  describe('truncate (rolling window)', () => {
    it('drops oldest candles when exceeding maxCandles', () => {
      const b = new FootprintBuilder('1m', 0.1, 3);
      b.seed([1, 2, 3, 4, 5].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1 })));
      // Adding any new trade triggers truncate.
      // Trade ts=6*60_000 ms → bucketTime=360_000 ms → candle time = floor(360_000/1000) = 360.
      b.addTrade(tr(6 * 60_000, 1, 1, false));
      const times = b.build().map((c) => c.time);
      // Should keep the 3 most recent (candles 4, 5, 360).
      expect(times).toEqual([4, 5, 360]);
    });
  });

  describe('build (range filter)', () => {
    it('returns only candles within visibleRange', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.seed([10, 20, 30, 40].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1 })));
      const out = b.build({ from: 15, to: 35 });
      expect(out.map((c) => c.time)).toEqual([20, 30]);
    });

    it('sorts results ascending by time', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.seed([30, 10, 20].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1 })));
      expect(b.build().map((c) => c.time)).toEqual([10, 20, 30]);
    });

    it('sorts levels descending by price', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.addTrade(tr(60_000, 100, 1, false));
      b.addTrade(tr(60_500, 102, 1, false));
      b.addTrade(tr(60_700, 101, 1, false));
      const c = b.build()[0];
      expect(c.levels.map((l) => l.price)).toEqual([102, 101, 100]);
    });
  });

  describe('getCandleTimeRange', () => {
    it('returns null on empty builder', () => {
      expect(new FootprintBuilder('1m', 0.1).getCandleTimeRange()).toBeNull();
    });

    it('returns the [min, max+1] span', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.seed([100, 50, 200].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1 })));
      const r = b.getCandleTimeRange();
      expect(r).toEqual({ from: 50, to: 201 });
    });
  });

  describe('setTick', () => {
    it('rebuilds existing level keys on next addTrade', () => {
      const b = new FootprintBuilder('1m', 0.1);
      b.addTrade(tr(60_000, 100.05, 1, false));
      b.addTrade(tr(60_500, 100.15, 1, false));
      b.setTick(1.0);
      b.addTrade(tr(60_999, 100.25, 1, false));
      const c = b.build()[0];
      // All prior levels collapse to 100 (under tick=1.0), plus the new one at 100
      const total = c.levels.reduce((s, l) => s + l.bidVol, 0);
      expect(total).toBe(3);
      expect(c.levels).toHaveLength(1);
      expect(c.levels[0].price).toBe(100);
    });
  });
});
