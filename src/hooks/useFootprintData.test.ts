// @vitest-environment jsdom
//
// Tests for the useFootprintData hook \u2014 the dual-source (live @trade WS
// + REST backfill) per-level order-flow aggregator.  The pure
// FootprintBuilder already has 18 dedicated tests in footprint.test.ts;
// this file focuses on the hook's wire-up: builder creation, trade
// ingestion paths, and OHLC sync from the candle stream.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AggTrade, Candle, SymbolInfo } from '../types';
import { useFootprintData } from './useFootprintData';

const TEST_SYMBOL: SymbolInfo = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  pricePrecision: 1,
  quantityPrecision: 3,
  tickSize: 0.1,
};

// ─── Mocks ───────────────────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() { /* no-op */ }
  fireMessage(payload: object) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

function makeAggTrade(overrides: Partial<AggTrade> = {}): AggTrade {
  return {
    id: 1,
    price: 100,
    qty: 1,
    ts: 1_700_000_000_000,
    isBuyerMaker: false,
    ...overrides,
  };
}

// T0 must be a 15m boundary in epoch-seconds, otherwise the trade's
// bucketTime() will land in a different candle than the one we seed
// the builder with, and the test will report no delta.
//   1_699_999_200 / 900 = 1_888_888 (clean)
const T0 = 1_699_999_200_000; // ms
const T0_SEC = T0 / 1000;     // sec
const MIN15 = 15 * 60 * 1000;
function makeCandleRow(i: number, overrides: Partial<Candle> = {}): Candle {
  return {
    time: Math.floor((T0 + i * MIN15) / 1000),
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 102 + i,
    volume: 10,
    takerBuyVolume: 5,
    ...overrides,
  };
}

function mockBackfillEmpty() {
  return vi.fn(async (url: string) => {
    if (!url.includes('/fapi/v1/aggTrades')) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFootprintData', () => {
  it('returns a null builder when symbol is null', () => {
    const { result } = renderHook(() =>
      useFootprintData(null, '15m', []),
    );
    expect(result.current.builder).toBeNull();
  });

  it('creates a builder on first symbol+interval render', async () => {
    vi.stubGlobal('fetch', mockBackfillEmpty());
    const { result } = renderHook(() =>
      useFootprintData(TEST_SYMBOL, '15m', []),
    );
    await waitFor(() => {
      expect(result.current.builder).not.toBeNull();
    });
    expect(result.current.stats.ready).toBe(false);
  });

  it('seeds the builder with the initial candle set (OHLC back-fill)', async () => {
    vi.stubGlobal('fetch', mockBackfillEmpty());
    const initialCandles = [
      makeCandleRow(0),
      makeCandleRow(1),
    ];
    const { result } = renderHook(() =>
      useFootprintData(TEST_SYMBOL, '15m', initialCandles),
    );
    await waitFor(() => expect(result.current.builder).not.toBeNull());

    // After the builder is seeded, build() should return the OHLC of the
    // last two candles (no trades yet, so levels are empty).
    const built = result.current.builder!.build();
    expect(built).toHaveLength(2);
    expect(built[1].open).toBe(101);
    expect(built[1].close).toBe(103);
  });

  it('updates stats when a live trade arrives via WS', async () => {
    vi.stubGlobal('fetch', mockBackfillEmpty());
    const { result } = renderHook(() =>
      useFootprintData(TEST_SYMBOL, '15m', [makeCandleRow(0)]),
    );
    await waitFor(() => expect(result.current.builder).not.toBeNull());

    // Fire an aggressive buy trade (isBuyerMaker=false) at the latest
    // candle's time.
    const candleTimeMs = T0;
    const trade = makeAggTrade({
      id: 42,
      price: 100,
      qty: 10,
      ts: candleTimeMs + 1000, // 1s after the candle open
      isBuyerMaker: false,
    });
    // The hook's @trade WS path consumes m.t (or m.a) and m.p/q/T/m
    MockWebSocket.instances[0]?.fireMessage({
      t: trade.id, p: String(trade.price), q: String(trade.qty),
      T: trade.ts, m: trade.isBuyerMaker,
    });

    // Stats are throttled (250ms) so wait for the recompute
    await waitFor(() => {
      expect(result.current.stats.currentDelta).toBeGreaterThan(0);
    }, { timeout: 2000 });
    expect(result.current.stats.ready).toBe(true);
  });

  it('updates stats when backfill trades arrive', async () => {
    // fetchRecentAggTrades expects Binance's raw aggTrades response:
    // an array of objects shaped { a, p, q, T, m }.
    const backfillTrades = [
      { a: 1, p: '100', q: '5', T: T0,       m: false }, // aggressive buy  +5
      { a: 2, p: '101', q: '3', T: T0 + 100, m: true  }, // aggressive sell +3
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.includes('/fapi/v1/aggTrades')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      return { ok: true, status: 200, json: async () => backfillTrades };
    }));

    const { result } = renderHook(() =>
      useFootprintData(TEST_SYMBOL, '15m', [makeCandleRow(0)]),
    );
    await waitFor(() => {
      expect(result.current.stats.ready).toBe(true);
    });
    // 5 - 3 = 2 (buy - sell)
    expect(result.current.stats.currentDelta).toBe(2);
  });

  it('builds a new builder when the symbol changes (no carry-over of state)', async () => {
    vi.stubGlobal('fetch', mockBackfillEmpty());
    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: SymbolInfo | null }) =>
        useFootprintData(symbol, '15m', []),
      { initialProps: { symbol: TEST_SYMBOL as SymbolInfo | null } },
    );
    await waitFor(() => expect(result.current.builder).not.toBeNull());
    const firstBuilder = result.current.builder;

    const NEW_SYMBOL: SymbolInfo = { ...TEST_SYMBOL, symbol: 'ETHUSDT' };
    rerender({ symbol: NEW_SYMBOL });

    await waitFor(() => {
      expect(result.current.builder).not.toBe(firstBuilder);
    });
  });

  it('returns maxMinByTime keyed by candle open time', async () => {
    vi.stubGlobal('fetch', mockBackfillEmpty());
    const { result } = renderHook(() =>
      useFootprintData(TEST_SYMBOL, '15m', [makeCandleRow(0), makeCandleRow(1)]),
    );
    await waitFor(() => expect(result.current.builder).not.toBeNull());

    // No trades yet, so maxMinByTime should be empty (no level data).
    // After a trade, the entry for the matching candle time should appear.
    MockWebSocket.instances[0]?.fireMessage({
      t: 1, p: '100', q: '5', T: T0 + 100, m: false,
    });
    await waitFor(() => {
      expect(result.current.maxMinByTime[T0_SEC]).toBeDefined();
    }, { timeout: 2000 });
  });
});
