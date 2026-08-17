// Order book via WS partial-depth stream (P2 #11).
// Falls back to a single REST snapshot on connect so the ladder is
// non-empty immediately, then the WS keeps it fresh at 100ms cadence.

import { useEffect, useRef, useState } from 'react';
import { DepthStream } from '../binance/ws';

const FAPI_BASE = 'https://fapi.binance.com';

export interface OrderBookLevel { price: number; qty: number; }
export interface OrderBook { bids: OrderBookLevel[]; asks: OrderBookLevel[]; }

export function useOrderBook(symbol: string | null, depth: 5 | 10 | 20 = 10): OrderBook | null {
  const [book, setBook] = useState<OrderBook | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!symbol) {
      setBook(null);
      return;
    }
    let cancelled = false;
    let stream: DepthStream | null = null;

    // 1) Initial REST snapshot so the UI has data before the first WS frame.
    (async () => {
      try {
        const res = await fetch(`${FAPI_BASE}/fapi/v1/depth?symbol=${symbol}&limit=${depth}`);
        if (!res.ok || cancelled) return;
        const j = await res.json();
        if (cancelled) return;
        setBook({
          bids: (j.bids as string[][]).map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
          asks: (j.asks as string[][]).map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
        });
      } catch { /* ignored — WS will fill in */ }
    })();

    // 2) WS stream keeps it fresh.
    stream = new DepthStream(symbol, depth);
    stream.on((snap) => {
      if (cancelled) return;
      // Throttle to ~10fps so the UI doesn't redraw at 100ms on every tick.
      const now = performance.now();
      if (now - lastUpdateRef.current < 100) return;
      lastUpdateRef.current = now;
      setBook({ bids: snap.bids.slice(0, depth), asks: snap.asks.slice(0, depth) });
    });
    stream.connect();

    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [symbol, depth]);

  return book;
}
