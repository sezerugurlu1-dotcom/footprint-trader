// Footprint aggregation utilities
// Given a stream of aggregate trades and a candle interval, build per-candle
// per-price-level buy / sell volume.

import type { AggTrade, FootprintCandle, FootprintLevel, Interval } from '../types';
import { bucketTime } from '../binance/ws';

interface CandleBucket {
  meta: { open: number; high: number; low: number; close: number };
  levels: Map<number, FootprintLevel>;
}

function roundToTick(price: number, tick: number): number {
  if (!tick || tick === 0) return price;
  return Math.round(price / tick) * tick;
}

function tickDecimals(tick: number): number {
  if (!tick || tick === 0) return 0;
  return Math.max(0, -Math.floor(Math.log10(tick)));
}

function formatTick(price: number, decimals: number): number {
  // Avoid floating point artifacts like 1234.5000000001
  return Number(price.toFixed(decimals));
}

export class FootprintBuilder {
  // Single map per candle: fewer allocations, better cache locality.
  private buckets = new Map<number, CandleBucket>();
  private interval: Interval;
  private tick: number;
  private decimals: number;

  // Rolling window to bound memory
  private maxCandles: number;
  private tickDirty = false;

  constructor(interval: Interval, tick: number, maxCandles = 1500) {
    this.interval = interval;
    this.tick = tick;
    this.decimals = tickDecimals(tick);
    this.maxCandles = maxCandles;
  }

  setTick(tick: number) {
    if (this.tick !== tick) {
      this.tick = tick;
      this.decimals = tickDecimals(tick);
      this.tickDirty = true;
    }
  }

  /**
   * Seed the builder with historical candles (OHLC only). Used to back-fill
   * meta so a freshly received trade on a recent historical candle still
   * renders OHLC. We re-aggregate levels from `trades` if provided.
   */
  seed(candles: Array<{ time: number; open: number; high: number; low: number; close: number }>) {
    this.buckets.clear();
    for (const c of candles) {
      this.buckets.set(c.time, {
        meta: { open: c.open, high: c.high, low: c.low, close: c.close },
        levels: new Map(),
      });
    }
  }

  /** Add a single aggregate trade. Returns the candle time it belongs to. */
  addTrade(trade: AggTrade): number {
    const t = Math.floor(bucketTime(trade.ts, this.interval) / 1000);
    let bucket = this.buckets.get(t);
    if (!bucket) {
      bucket = {
        meta: { open: trade.price, high: trade.price, low: trade.price, close: trade.price },
        levels: new Map(),
      };
      this.buckets.set(t, bucket);
    } else if (this.tickDirty) {
      // rebuild this candle's levels under the new tick
      const existing = bucket.levels;
      if (existing.size) {
        const rebuilt = new Map<number, FootprintLevel>();
        for (const lvl of existing.values()) {
          const newKey = formatTick(roundToTick(lvl.price, this.tick), this.decimals);
          const cur = rebuilt.get(newKey) ?? { price: newKey, bidVol: 0, askVol: 0 };
          cur.bidVol += lvl.bidVol;
          cur.askVol += lvl.askVol;
          rebuilt.set(newKey, cur);
        }
        bucket.levels = rebuilt;
      }
    }

    bucket.meta.high = Math.max(bucket.meta.high, trade.price);
    bucket.meta.low = Math.min(bucket.meta.low, trade.price);
    bucket.meta.close = trade.price;

    const levelKey = formatTick(roundToTick(trade.price, this.tick), this.decimals);
    let level = bucket.levels.get(levelKey);
    if (!level) {
      level = { price: levelKey, bidVol: 0, askVol: 0 };
      bucket.levels.set(levelKey, level);
    }
    if (trade.isBuyerMaker) level.askVol += trade.qty;
    else level.bidVol += trade.qty;

    this.tickDirty = false;
    this.truncate();
    return t;
  }

  /**
   * Bulk-ingest a list of trades. Much faster than addTrade() in a loop
   * for historical backfill because it groups by candle and by price
   * level before mutating the maps. Trades must be roughly sorted by
   * timestamp ascending; out-of-order trades are accepted (a level
   * may briefly under-report OHLC until the next trade arrives) but
   * ascending order gives correct OHLC on the first pass.
   *
   * Returns the number of trades actually ingested.
   */
  addTrades(trades: AggTrade[]): number {
    if (!trades.length) return 0;

    // 1) Group trades by candle time bucket.
    // Use insertion order to preserve first-trade-as-open heuristic.
    const groups = new Map<number, AggTrade[]>();
    for (const tr of trades) {
      const t = Math.floor(bucketTime(tr.ts, this.interval) / 1000);
      let arr = groups.get(t);
      if (!arr) { arr = []; groups.set(t, arr); }
      arr.push(tr);
    }

    for (const [t, bucketTrades] of groups) {
      let bucket = this.buckets.get(t);
      if (!bucket) {
        const first = bucketTrades[0];
        bucket = {
          meta: { open: first.price, high: first.price, low: first.price, close: first.price },
          levels: new Map(),
        };
        this.buckets.set(t, bucket);
      }

      // 3) Aggregate levels. We rely on the caller (kline history) for
      //    canonical OHLC, so the per-trade high/low/close updates here
      //    are a fallback for candles that have no kline meta yet.
      for (const tr of bucketTrades) {
        if (tr.price > bucket.meta.high) bucket.meta.high = tr.price;
        if (tr.price < bucket.meta.low) bucket.meta.low = tr.price;
        bucket.meta.close = tr.price; // last trade in bucket order wins
        const key = formatTick(roundToTick(tr.price, this.tick), this.decimals);
        let lvl = bucket.levels.get(key);
        if (!lvl) { lvl = { price: key, bidVol: 0, askVol: 0 }; bucket.levels.set(key, lvl); }
        if (tr.isBuyerMaker) lvl.askVol += tr.qty;
        else lvl.bidVol += tr.qty;
      }
    }

    this.truncate();
    return trades.length;
  }

  /** Update candle meta from a kline push (keeps OHLC in sync with stream). */
  updateKline(c: { time: number; open: number; high: number; low: number; close: number }) {
    const t = c.time;
    const existing = this.buckets.get(t);
    const meta = existing?.meta ?? { open: c.open, high: c.high, low: c.low, close: c.close };
    meta.open = c.open;
    meta.high = c.high;
    meta.low = c.low;
    meta.close = c.close;
    if (existing) {
      existing.meta = meta;
    } else {
      this.buckets.set(t, { meta, levels: new Map() });
    }
  }

  private truncate() {
    if (this.buckets.size <= this.maxCandles) return;
    const keys = Array.from(this.buckets.keys()).sort((a, b) => a - b);
    const drop = keys.length - this.maxCandles;
    for (let i = 0; i < drop; i++) {
      this.buckets.delete(keys[i]);
    }
  }

  /**
   * Build footprint candles for a time range, sorted by time asc.
   * If `visibleRange` is provided, only return candles within [from, to).
   */
  build(visibleRange?: { from: number; to: number }): FootprintCandle[] {
    const times = Array.from(this.buckets.keys()).sort((a, b) => a - b);
    const result: FootprintCandle[] = [];
    for (const t of times) {
      if (visibleRange && (t < visibleRange.from || t >= visibleRange.to)) continue;
      const bucket = this.buckets.get(t)!;
      const levels = Array.from(bucket.levels.values()).sort((a, b) => b.price - a.price);

      let totalBid = 0, totalAsk = 0, maxVol = 0;
      for (const l of levels) {
        totalBid += l.bidVol;
        totalAsk += l.askVol;
        const sum = l.bidVol + l.askVol;
        if (sum > maxVol) maxVol = sum;
      }

      result.push({
        time: t,
        open: bucket.meta.open,
        high: bucket.meta.high,
        low: bucket.meta.low,
        close: bucket.meta.close,
        levels,
        totalBid,
        totalAsk,
        delta: totalBid - totalAsk,
        maxVol,
      });
    }
    return result;
  }

  getCandleTimeRange(): { from: number; to: number } | null {
    const keys = Array.from(this.buckets.keys());
    if (!keys.length) return null;
    keys.sort((a, b) => a - b);
    return { from: keys[0], to: keys[keys.length - 1] + 1 };
  }
}

// ─── Delta divergence detection ────────────────────────────────────────────
// Classic order-flow signal: price makes a new extreme in one direction
// while cumulative aggressive flow (delta) fails to confirm.
//
//   Bearish divergence (mark with red ▼ above the candle):
//     price makes a HIGHER HIGH across two local highs, but delta at the
//     newer high is LOWER than the previous high's delta → buyers exhausted.
//
//   Bullish divergence (mark with green ▲ below the candle):
//     price makes a LOWER LOW across two local lows, but delta at the
//     newer low is HIGHER (less negative / more positive) than the previous
//     low's delta → sellers exhausted.
//
// Local extremes are detected as pivot highs/lows with a 1-bar lookback
// on each side (so the endpoints of the window are excluded).

export type DivergenceKind = 'bearish' | 'bullish';

export interface DivergenceMarker {
  time: number;        // candle open (unix seconds)
  kind: DivergenceKind;
  priceExtreme: number;
  deltaExtreme: number;
  refPrice: number;
  refDelta: number;
}

export function detectDivergence(candles: FootprintCandle[]): DivergenceMarker[] {
  if (candles.length < 4) return [];

  // Collect pivot highs/lows (skip first and last bar to ensure a bar on
  // each side exists for the comparison).
  const pivotsHigh: Array<{ idx: number; price: number; delta: number }> = [];
  const pivotsLow:  Array<{ idx: number; price: number; delta: number }> = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const c = candles[i];
    if (c.high > candles[i - 1].high && c.high > candles[i + 1].high) {
      pivotsHigh.push({ idx: i, price: c.high, delta: c.delta });
    }
    if (c.low < candles[i - 1].low && c.low < candles[i + 1].low) {
      pivotsLow.push({ idx: i, price: c.low, delta: c.delta });
    }
  }

  const out: DivergenceMarker[] = [];

  // Bearish: compare consecutive pivot highs.
  for (let i = 1; i < pivotsHigh.length; i++) {
    const a = pivotsHigh[i - 1];
    const b = pivotsHigh[i];
    if (b.price > a.price && b.delta < a.delta) {
      out.push({
        time: candles[b.idx].time,
        kind: 'bearish',
        priceExtreme: b.price,
        deltaExtreme: b.delta,
        refPrice: a.price,
        refDelta: a.delta,
      });
    }
  }

  // Bullish: compare consecutive pivot lows.
  for (let i = 1; i < pivotsLow.length; i++) {
    const a = pivotsLow[i - 1];
    const b = pivotsLow[i];
    if (b.price < a.price && b.delta > a.delta) {
      out.push({
        time: candles[b.idx].time,
        kind: 'bullish',
        priceExtreme: b.price,
        deltaExtreme: b.delta,
        refPrice: a.price,
        refDelta: a.delta,
      });
    }
  }

  return out;
}
