// Market data hook: 500 historical klines + dual live update path:
//   1. WebSocket (@kline stream) — fast updates when reachable
//   2. REST poll (every 3s)      — reliable fallback when WS is blocked
// Both write to the same state, so the chart stays live even if the
// network blocks WebSockets (a common pattern in some regions / behind
// certain firewalls / ISPs).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Interval, SymbolInfo } from '../types';
import { fetchKlines } from '../binance/api';
import { KlineStream } from '../binance/ws';
import { decideWatchdog } from './watchdog';

const MAX_LIVE_CANDLES = 2000;
const POLL_INTERVAL_MS = 3000;
const STALE_AFTER_MS = 10_000;
const STUCK_AFTER_MS = 30_000;

export type LiveStatus = 'connecting' | 'live' | 'stale' | 'offline';
export type LiveSource = 'ws' | 'poll' | 'none';

export interface BinanceData {
  candles: Candle[];
  lastPrice: number | null;
  status: LiveStatus;
  source: LiveSource;
  /** Convenience: `status === 'live'`. */
  connected: boolean;
  lastUpdateAt: number | null;
  messageCount: number;
  pollCount: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  reconnect: () => void;
  loadMore: () => Promise<void>;
  hasMoreHistory: boolean;
}

export function useBinanceData(symbolInfo: SymbolInfo | null, interval: Interval): BinanceData {
  const symbol = symbolInfo?.symbol ?? null;
  const [candles, setCandles] = useState<Candle[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [source, setSource] = useState<LiveSource>('none');
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Refs
  const streamRef = useRef<KlineStream | null>(null);
  const lastUpdateAtRef = useRef<number | null>(null);
  const lastMessageCountRef = useRef(0);
  const cancelledRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const streamOpenAtRef = useRef<number | null>(null);

  const candlesRef = useRef<Candle[]>([]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  const stableSetError = useCallback((msg: string | null) => setError(msg), []);

  // Helper: apply a fresh candle to the array (replace same-time, append
  // newer, dedup by time). Updates lastUpdateAt + lastPrice.
  const applyCandle = useCallback((c: Candle) => {
    const now = Date.now();
    lastUpdateAtRef.current = now;
    setLastUpdateAt(now);
    setLastPrice(c.close);
    setCandles((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.time === c.time) next[next.length - 1] = c;
      else if (!last || c.time > last.time) {
        next.push(c);
        if (next.length > MAX_LIVE_CANDLES) next.splice(0, next.length - MAX_LIVE_CANDLES);
      }
      return next;
    });
  }, []);

  const reconnect = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      console.log('[hook] manual reconnect requested');
      s.close();
      streamRef.current = null;
    }
    streamOpenAtRef.current = null;
    setStatus('connecting');
    setSource('none');
    setLastUpdateAt(null);
    lastUpdateAtRef.current = null;
    setMessageCount(0);
    lastMessageCountRef.current = 0;
  }, []);

  const loadMore = useCallback(async () => {
    const s = symbolInfo?.symbol;
    if (!s) return;
    if (loadMoreInFlightRef.current) return;
    const earliest = candlesRef.current[0];
    if (!earliest) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      const more = await fetchKlines({
        symbol: s, interval, limit: 500, endTime: earliest.time * 1000 - 1,
      });
      if (cancelledRef.current || !more.length) return;
      setCandles((prev) => {
        const seen = new Set(prev.map((c) => c.time));
        const fresh = more.filter((c) => !seen.has(c.time));
        if (!fresh.length) return prev;
        const merged = [...fresh, ...prev];
        if (merged.length > MAX_LIVE_CANDLES) merged.splice(0, merged.length - MAX_LIVE_CANDLES);
        return merged;
      });
    } catch (e: any) {
      console.warn('loadMore failed', e);
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [symbolInfo?.symbol, interval]);

  useEffect(() => {
    if (!symbol) return;
    cancelledRef.current = false;
    setCandles([]);
    setLastPrice(null);
    setStatus('connecting');
    setSource('none');
    setLastUpdateAt(null);
    setMessageCount(0);
    setPollCount(0);
    setError(null);
    lastUpdateAtRef.current = null;
    lastMessageCountRef.current = 0;
    streamOpenAtRef.current = null;

    // ── 1) Initial 500 klines via REST ─────────────────────────────────
    (async () => {
      try {
        const initial = await fetchKlines({ symbol, interval, limit: 500 });
        if (cancelledRef.current) return;
        setCandles(initial);
        setLastPrice(initial[initial.length - 1]?.close ?? null);
        // Treat the initial fetch as a "live" update so the status flips
        // off "connecting" immediately, even before any WS/poll arrives.
        // (Fix for: status stayed 'connecting' for up to 3 s on every
        // fresh load because the watchdog was the only thing flipping it.)
        const now = Date.now();
        lastUpdateAtRef.current = now;
        setLastUpdateAt(now);
        if (initial.length > 0) {
          setStatus('live');
        } else {
          // Empty response from Binance — surface a real error instead of
          // leaving `loading: true` forever (which used to mask the bug).
          stableSetError('No candles returned from Binance for this symbol/interval');
        }
      } catch (e: any) {
        if (!cancelledRef.current) stableSetError(e?.message ?? String(e));
      }
    })();

    // ── 2) WebSocket kline stream (fast path) ──────────────────────────
    const openStream = () => {
      if (cancelledRef.current) return;
      const stream = new KlineStream(symbol, interval);
      streamRef.current = stream;
      streamOpenAtRef.current = Date.now();
      stream.on((c) => {
        if (cancelledRef.current) return;
        streamOpenAtRef.current = Date.now();
        setMessageCount(stream.getMessageCount());
        setSource('ws');
        applyCandle(c);
      });
      stream.connect();
    };
    openStream();

    // ── 3) REST polling (reliable fallback, 3s) ────────────────────────
    const pollOnce = async () => {
      if (cancelledRef.current) return;
      try {
        const latest = await fetchKlines({ symbol, interval, limit: 2 });
        if (cancelledRef.current || !latest.length) return;
        setPollCount((n) => n + 1);
        setSource((prev) => (prev === 'ws' ? 'ws' : 'poll'));
        applyCandle(latest[latest.length - 1]);
      } catch {
        // ignore individual poll failures
      }
    };
    const pollId = window.setInterval(pollOnce, POLL_INTERVAL_MS);

    // ── 4) Watchdog: stale + stuck-open recovery ───────────────────────
    // The decision is delegated to a pure function (./watchdog) so
    // the policy is testable in isolation.  Here we just translate
    // the decision into React state updates and side effects.
    const watchdog = setInterval(() => {
      if (cancelledRef.current) return;
      const decision = decideWatchdog({
        now: Date.now(),
        lastUpdateAt: lastUpdateAtRef.current,
        streamOpenAt: streamOpenAtRef.current,
        stuckAfterMs: STUCK_AFTER_MS,
        staleAfterMs: STALE_AFTER_MS,
        wsNeverDeliveredMs: 15_000,
      });
      switch (decision.kind) {
        case 'noop':
          return;
        case 'fallback-to-poll':
          console.warn('[hook] WS never delivered after 15s — using REST poll only');
          setSource('poll');
          setStatus('live');
          return;
        case 'force-reconnect': {
          console.warn(`[hook] stream stuck for ${Math.round(decision.ageMs / 1000)}s — force reconnect`);
          const s = streamRef.current;
          if (s) { s.close(); streamRef.current = null; }
          setTimeout(() => {
            if (!cancelledRef.current) {
              setStatus('connecting');
              openStream();
            }
          }, 500);
          return;
        }
        case 'set-stale':
          setStatus('stale');
          return;
        case 'set-live':
          setStatus('live');
          return;
      }
    }, 3000);

    return () => {
      cancelledRef.current = true;
      clearInterval(watchdog);
      clearInterval(pollId);
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [symbol, interval, stableSetError, applyCandle]);

  return {
    candles,
    lastPrice,
    status,
    source,
    lastUpdateAt,
    messageCount,
    pollCount,
    connected: status === 'live',
    loading: Boolean(symbol) && candles.length === 0 && !error,
    loadingMore,
    error,
    reconnect,
    loadMore,
    hasMoreHistory: candles.length > 0,
  };
}
