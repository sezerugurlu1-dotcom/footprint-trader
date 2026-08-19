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
import { Backoff } from '../binance/backoff';
import { decideWatchdog } from './watchdog';

const MAX_LIVE_CANDLES = 2000;
const POLL_INTERVAL_MS = 3000;
const STALE_AFTER_MS = 10_000;
const STUCK_AFTER_MS = 30_000;
// Initial-fetch retry tuning.  A short base + jitter is fine here:
// the user is staring at a loading spinner and a single transient
// network blip shouldn't kill the chart.  We cap at 4 attempts so a
// truly dead endpoint surfaces an error in ~3.5 s instead of hanging
// forever.  Empty responses (Binance returning 200 with []) are NOT
// retried — that's a valid "no history" answer, not a network error.
// A fresh Backoff is created per effect run so the schedule doesn't
// leak across symbol changes.
const INITIAL_FETCH_MAX_ATTEMPTS = 4;

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

  // Holds the timeout id for the watchdog's force-reconnect path so the
  // effect cleanup can cancel it.  Without tracking, unmounting the
  // component mid-reconnect window left a stray setTimeout that would
  // fire setStatus() on a torn-down component.
  const reconnectTimeoutRef = useRef<number | null>(null);

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
    // Local stale flag for THIS effect run.  `cancelledRef` is a
    // shared ref that the next effect run resets to `false`, which
    // would let a stale REST promise from a previous interval apply
    // its data after the user has moved on.  A per-run `stale` flag
    // is the only way to reliably cancel the work this effect
    // started without the next run undoing it.
    let stale = false;

    // Note: we deliberately do NOT clear `candles` here.  On an
    // interval or symbol switch the user would otherwise see an
    // empty chart with a "Loading market data…" overlay for the full
    // REST round-trip (~200-500 ms on a good connection, several
    // seconds behind a flaky firewall).  Keeping the previous
    // interval's candles on screen until the new ones arrive gives
    // the user immediate feedback that the click registered and
    // avoids a jarring flash.  The `ChartView` effect also forces
    // a full `setData()` on interval change so the in-place
    // `update()` fast path can never fire for a candle from a
    // different interval (which used to throw
    // "Cannot update oldest data" from lightweight-charts).
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

    // ── 1) Initial 500 klines via REST (with retry) ────────────────
    // Transient network blips (a single dropped packet, a 502 from
    // a CDN edge, etc.) used to surface immediately as a hard error
    // and the user had to click ↻ Retry.  Retrying the initial fetch
    // up to INITIAL_FETCH_MAX_ATTEMPTS times with the same Backoff
    // helper the WS streams use, capped at ~3.5 s total, gives those
    // blips a chance to recover on their own.  The inter-attempt
    // sleep is intentionally not tracked in a ref: the `cancelledRef`
    // check at the top of the loop short-circuits on unmount, and
    // a wasted sub-4 s sleep is cheaper than the bookkeeping.
    const initialBackoff = new Backoff({ baseMs: 500, maxMs: 4_000, jitter: 0.3 });
    (async () => {
      try {
        let initial: Candle[] = [];
        for (let attempt = 0; attempt < INITIAL_FETCH_MAX_ATTEMPTS; attempt++) {
          if (stale) return;
          try {
            initial = await fetchKlines({ symbol, interval, limit: 500 });
            initialBackoff.reset();
            break;
          } catch (err) {
            if (attempt === INITIAL_FETCH_MAX_ATTEMPTS - 1) throw err;
            const delay = initialBackoff.next();
            console.warn(
              `[hook] initial kline fetch failed (attempt ${attempt + 1}/${INITIAL_FETCH_MAX_ATTEMPTS}), retrying in ${delay}ms`,
              err,
            );
            await new Promise<void>((r) => { window.setTimeout(r, delay); });
          }
        }
        if (stale) return;
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
      } catch (e) {
        if (!stale) {
          const msg = e instanceof Error ? e.message : String(e);
          stableSetError(msg);
        }
      }
    })();

    // ── 2) WebSocket kline stream (fast path) ──────────────────────────
    const openStream = () => {
      if (stale) return;
      const stream = new KlineStream(symbol, interval);
      streamRef.current = stream;
      streamOpenAtRef.current = Date.now();
      stream.on((c) => {
        if (stale) return;
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
      if (stale) return;
      try {
        const latest = await fetchKlines({ symbol, interval, limit: 2 });
        if (stale || !latest.length) return;
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
      if (stale) return;
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
          // Cancel any previous pending reopen before scheduling a new
          // one — the watchdog can fire `force-reconnect` several times
          // in a row if the new socket also stalls, and we only want
          // the most recent reopen to land.
          if (reconnectTimeoutRef.current != null) {
            window.clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
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
      // Mark THIS effect's work as stale BEFORE the next effect
      // resets `cancelledRef`.  Any in-flight async callbacks (the
      // initial REST, the first poll, the watchdog tick) check
      // `stale` and bail out cleanly instead of applying data or
      // setting state on a torn-down effect.
      stale = true;
      cancelledRef.current = true;
      if (reconnectTimeoutRef.current != null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
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
