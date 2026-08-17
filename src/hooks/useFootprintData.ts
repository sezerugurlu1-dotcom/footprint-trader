// Wires Binance aggregate trades into a FootprintBuilder and exposes
// rolling per-candle delta stats for the chart's bottom stats bar.
//
// Pipeline:
//   AggTradeStream  (live @trade WS)  ─┐
//   fetchAggTradesWindow  (REST backfill) ─┴─→ FootprintBuilder → Δ stats
//
// Stats cover the last `lastN` candles (default 20):
//   currentDelta  — buy vol − sell vol of the most recent candle
//   maxDelta      — max delta in the window
//   minDelta      — min delta in the window
//   candleCount   — how many candles the stats are computed over
//   ready         — false until the first batch of trades (or backfill
//                   attempt) has landed, so the bar can show a loader
//
// Volume for the bar comes from the kline stream (see App.tsx →
// ChartView → DeltaStatsBar) — we only deal in deltas here, which are
// not available from kline data alone.
//
// Two effects:
//   1. [symbol, interval, tick] — create builder, open live @trade WS,
//      install a 1s stats ticker.  Re-created on symbol/interval change
//      so live state is never carried across symbols (delta is per-pair).
//   2. [builder, symbol, interval, candles-availability] — once the
//      kline history is loaded, fetch aggTrades for that window and
//      bulk-ingest them.  Guarded by a ref so we only backfill once per
//      symbol+interval, even if candles keeps growing via loadMore().

import { useEffect, useRef, useState } from 'react';
import type { Candle, Interval, SymbolInfo } from '../types';
import { fetchRecentAggTrades } from '../binance/api';
import { AggTradeStream } from '../binance/ws';
import { FootprintBuilder } from '../utils/footprint';

export interface DeltaStats {
  currentDelta: number;
  maxDelta: number;
  minDelta: number;
  candleCount: number;
  ready: boolean;
  /** Map of candle-open-time (unix seconds) → per-candle delta.
   *  Used by the chart's per-candle delta histogram.  Only includes
   *  candles that have at least one trade ingested; candles that the
   *  backfill didn't reach (older history) are absent from the map. */
  deltaByTime: Record<number, number>;
  /** Map of candle-open-time → { max, min } delta across the candle's
   *  individual price levels (i.e. the most positive and most negative
   *  per-level deltas inside that candle).  Used by the per-candle
   *  "Footprint Summary" table at the bottom of the chart.  Absent
   *  when the candle has no trade data (backfill didn't reach it). */
  maxMinByTime: Record<number, { max: number; min: number }>;
}

const EMPTY: DeltaStats = {
  currentDelta: 0,
  maxDelta: 0,
  minDelta: 0,
  candleCount: 0,
  ready: false,
  deltaByTime: {},
  maxMinByTime: {},
};

const STATS_THROTTLE_MS = 250;   // coalesce rapid trade bursts
const STATS_TICKER_MS = 1000;    // fallback for in-place mutations
const BACKFILL_BATCHES = 50;     // 50 × 1000 = up to 50k recent trades

export function useFootprintData(
  symbolInfo: SymbolInfo | null,
  interval: Interval,
  candles: Candle[],
  lastN: number = 20,
) {
  const symbol = symbolInfo?.symbol ?? null;
  const tick = symbolInfo?.tickSize ?? 0.01;

  const [builder, setBuilder] = useState<FootprintBuilder | null>(null);
  const [stats, setStats] = useState<DeltaStats>(EMPTY);

  // Refs that don't drive re-renders.
  const streamRef = useRef<AggTradeStream | null>(null);
  const updatedThroughRef = useRef<number>(0);
  // Ref → function so the backfill effect (separate closure) can ask
  // the live-stream effect for a stats recompute after trades land.
  const requestStatsRef = useRef<() => void>(() => {});
  // Guard so we only backfill once per symbol+interval pair.
  const backfilledKeyRef = useRef<string | null>(null);

  // (1) Builder + live @trade stream.
  useEffect(() => {
    if (!symbol) {
      setBuilder(null);
      setStats(EMPTY);
      return;
    }

    const b = new FootprintBuilder(interval, tick);
    updatedThroughRef.current = 0;
    backfilledKeyRef.current = null;
    setBuilder(b);
    setStats(EMPTY);

    // If candles happen to already be loaded at the time the effect
    // runs (e.g. a re-render where symbol didn't change but the parent
    // re-mounted), seed immediately.
    if (candles.length) {
      b.seed(
        candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
      );
      updatedThroughRef.current = candles.length;
    }

    // Stats recompute pipeline.
    let pending = false;
    const recompute = () => {
      const all = b.build();
      if (!all.length) {
        setStats((s) => ({ ...s, ready: true }));
        return;
      }
      const slice = all.slice(-lastN);
      const last = slice[slice.length - 1];
      let maxDelta = -Infinity;
      let minDelta = Infinity;
      for (const c of slice) {
        if (c.delta > maxDelta) maxDelta = c.delta;
        if (c.delta < minDelta) minDelta = c.delta;
      }
      if (maxDelta === -Infinity) maxDelta = 0;
      if (minDelta === Infinity) minDelta = 0;

      // Build a time → delta map for the chart's per-candle histogram.
      // Only candles that have actually received trades are included;
      // empty buckets in the builder get delta=0 but we still include
      // them so the chart can render a zero-bar for the current candle
      // before its first trade arrives.
      const deltaByTime: Record<number, number> = {};
      // Per-candle max/min delta across individual price levels.  Same
      // coverage rules as deltaByTime: present only when the backfill
      // has actually ingested trades for that candle's price levels.
      const maxMinByTime: Record<number, { max: number; min: number }> = {};
      for (const c of all) {
        deltaByTime[c.time] = c.delta;
        if (c.levels.length === 0) continue;
        let lvlMax = -Infinity;
        let lvlMin = Infinity;
        for (const l of c.levels) {
          const d = l.bidVol - l.askVol;
          if (d > lvlMax) lvlMax = d;
          if (d < lvlMin) lvlMin = d;
        }
        if (lvlMax === -Infinity) lvlMax = 0;
        if (lvlMin === Infinity) lvlMin = 0;
        maxMinByTime[c.time] = { max: lvlMax, min: lvlMin };
      }

      setStats({
        currentDelta: last.delta,
        maxDelta,
        minDelta,
        candleCount: slice.length,
        ready: true,
        deltaByTime,
        maxMinByTime,
      });
    };
    const requestStats = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        recompute();
      }, STATS_THROTTLE_MS);
    };
    requestStatsRef.current = requestStats;

    // Live per-trade stream.  Each trade is added synchronously, then
    // we ask the throttled stats ticker for a recompute.
    const stream = new AggTradeStream(symbol);
    streamRef.current = stream;
    stream.on((t) => {
      b.addTrade(t);
      requestStats();
    });
    stream.connect();

    const statsId = window.setInterval(requestStats, STATS_TICKER_MS);

    return () => {
      clearInterval(statsId);
      stream.close();
      streamRef.current = null;
      requestStatsRef.current = () => {};
    };
  }, [symbol, interval, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // (2) Backfill.  Runs when the builder is ready and `candles` has
  // transitioned from empty to non-empty (the boolean dep stops the
  // effect from re-firing on every kline tick).  Guarded by a ref so
  // loadMore() — which grows candles — does not re-backfill.
  const candlesAvailable = candles.length > 0;
  useEffect(() => {
    if (!builder || !symbol || !candlesAvailable) return;
    const key = `${symbol}|${interval}`;
    if (backfilledKeyRef.current === key) return;
    backfilledKeyRef.current = key;

    // Backfill: walk backward from "now" and ingest the most recent
    // N trades.  This is the only way to populate the most recent
    // candles' levels — Binance rejects aggTrades windows > 2 days
    // (error -4166) and a forward walk over a 5-day kline window
    // would return the OLDEST 10k trades, not the ones we care about.
    (async () => {
      try {
        const trades = await fetchRecentAggTrades({
          symbol,
          maxBatches: BACKFILL_BATCHES,
        });
        builder.addTrades(trades);
        requestStatsRef.current();
      } catch (e) {
        console.warn('[footprint] backfill failed', e);
        setStats((s) => ({ ...s, ready: true, candleCount: 0 }));
      }
    })();
  }, [builder, symbol, interval, candlesAvailable, candles]);

  // (3) Keep OHLC meta in sync with new kline updates.  Touches only
  // candles we haven't seen yet, so steady-state cost is one
  // updateKline() per new candle.
  useEffect(() => {
    if (!builder || !candles.length) {
      updatedThroughRef.current = 0;
      return;
    }
    const start = Math.min(updatedThroughRef.current, candles.length);
    for (let i = start; i < candles.length; i++) {
      builder.updateKline(candles[i]);
    }
    updatedThroughRef.current = candles.length;
  }, [builder, candles]);

  return { builder, stats, maxMinByTime: stats.maxMinByTime };
}
