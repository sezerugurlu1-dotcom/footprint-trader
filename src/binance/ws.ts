// WebSocket streams for Binance USDT-M Futures
// Combined streams endpoint: wss://fstream.binance.com/stream?streams=...

import type { Interval, AggTrade, Candle } from '../types';
import { intervalMs } from './api';

type Listener<T> = (msg: T) => void;

// Minimal shape of a depth-stream update; we only consume top-N levels.
export interface DepthSnapshot {
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
}

// Minimal shape of a 24h ticker-stream update.
export interface TickerStreamSnapshot {
  c: string;  // last price
  P: string;  // price change percent
  h: string;  // 24h high
  l: string;  // 24h low
  v: string;  // base volume
  q: string;  // quote volume
  o: string;  // open price
}

export class KlineStream {
  private ws: WebSocket | null = null;
  private listeners: Set<Listener<Candle>> = new Set();
  private symbol: string;
  private interval: Interval;
  private generation = 0; // bumped on each (re)connect; used to ignore stale sockets after force-reconnect
  private messageCount = 0;
  private lastError: string | null = null;

  constructor(symbol: string, interval: Interval) {
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
  }

  getMessageCount(): number { return this.messageCount; }
  getLastError(): string | null { return this.lastError; }

  connect() {
    this.close();
    const gen = ++this.generation;
    const stream = `${this.symbol}@kline_${this.interval}`;
    const url = `wss://fstream.binance.com/ws/${stream}`;
    console.log(`[kline] connecting to ${url} (gen=${gen})`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (gen !== this.generation) return;
      console.log(`[kline] socket open gen=${gen}`);
    };
    ws.onmessage = (ev) => {
      if (gen !== this.generation) return;
      try {
        const m = JSON.parse(ev.data);
        const k = m.k;
        if (!k) return;
        this.messageCount++;
        const candle: Candle = {
          time: Math.floor(k.t / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
          // k.V = taker BUY base-asset volume (uppercase V on the WS
          // frame, field 9 on the REST response).  Falls back to 0 if
          // the server ever omits it.
          takerBuyVolume: Number(k.V ?? 0),
        };
        this.listeners.forEach((cb) => cb(candle));
      } catch (e) {
        this.lastError = String(e);
      }
    };

    ws.onerror = (e) => {
      this.lastError = 'socket error';
      console.warn(`[kline] error gen=${gen}`, e);
    };
    ws.onclose = (ev) => {
      console.log(`[kline] closed gen=${gen} code=${ev.code} reason=${ev.reason || '(none)'} (delivered ${this.messageCount} msgs)`);
      if (gen !== this.generation) return; // replaced by a newer connect()
      this.ws = null;
      setTimeout(() => this.connect(), 2000);
    };
  }

  on(cb: Listener<Candle>) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  close() {
    if (this.ws) {
      this.generation++; // invalidate any in-flight onmessage/onclose
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export class AggTradeStream {
  private ws: WebSocket | null = null;
  private listeners: Set<Listener<AggTrade>> = new Set();
  private symbol: string;

  constructor(symbol: string) {
    this.symbol = symbol.toLowerCase();
  }

  connect() {
    this.close();
    // Use @trade (per-trade stream) instead of @aggTrade.
    // @aggTrade has been returning zero messages on Binance USDT-M Futures
    // as of 2026-08 — it connects but never delivers payloads. @trade
    // provides the same fields (p, q, T, m) and is actually preferable
    // for footprint aggregation since it gives per-trade granularity
    // instead of pre-aggregated fills.
    const stream = `${this.symbol}@trade`;
    const url = `wss://fstream.binance.com/ws/${stream}`;
    this.ws = new WebSocket(url);

    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        const trade: AggTrade = {
          // @trade uses 't' (trade id); @aggTrade uses 'a'. Accept either.
          id: Number(m.t ?? m.a ?? 0),
          price: Number(m.p),
          qty: Number(m.q),
          ts: Number(m.T),
          isBuyerMaker: Boolean(m.m),
        };
        this.listeners.forEach((cb) => cb(trade));
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => { /* close will trigger reconnect */ };
  }

  on(cb: Listener<AggTrade>) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Partial-book depth stream. P2 #11: replaces 1s REST polling.
 * 100ms update cadence is plenty for a top-10 ladder UI.
 *
 * Notes:
 *  - @depth<levels>@100ms: top-N levels, 100ms updates.
 *  - We don't manage a local order book from the diff stream
 *    (@depth) — partial-book gives us absolute snapshots directly,
 *    which is what the UI renders.
 */
export class DepthStream {
  private ws: WebSocket | null = null;
  private listeners: Set<Listener<DepthSnapshot>> = new Set();
  private symbol: string;
  private levels: 5 | 10 | 20;

  constructor(symbol: string, levels: 5 | 10 | 20 = 10) {
    this.symbol = symbol.toLowerCase();
    this.levels = levels;
  }

  connect() {
    this.close();
    const stream = `${this.symbol}@depth${this.levels}@100ms`;
    const url = `wss://fstream.binance.com/ws/${stream}`;
    this.ws = new WebSocket(url);

    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        const snap: DepthSnapshot = {
          bids: (m.bids as string[][]).map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
          asks: (m.asks as string[][]).map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
        };
        this.listeners.forEach((cb) => cb(snap));
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => { /* close will trigger reconnect */ };
  }

  on(cb: Listener<DepthSnapshot>) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * 24h ticker stream. P3 #21: pushes 1s updates, replaces 5s REST polling.
 * Stream: <symbol>@ticker
 */
export class TickerStream {
  private ws: WebSocket | null = null;
  private listeners: Set<Listener<TickerStreamSnapshot>> = new Set();
  private symbol: string;

  constructor(symbol: string) {
    this.symbol = symbol.toLowerCase();
  }

  connect() {
    this.close();
    const url = `wss://fstream.binance.com/ws/${this.symbol}@ticker`;
    this.ws = new WebSocket(url);

    this.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data) as TickerStreamSnapshot;
        this.listeners.forEach((cb) => cb(m));
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => { /* close will trigger reconnect */ };
  }

  on(cb: Listener<TickerStreamSnapshot>) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

// Keep aggregate trades aligned to a candle interval
export function bucketTime(ts: number, interval: Interval): number {
  const ms = intervalMs(interval);
  return Math.floor(ts / ms) * ms;
}
