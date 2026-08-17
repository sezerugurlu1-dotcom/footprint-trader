// @vitest-environment jsdom
//
// Tests for the useBinanceData hook — the piece that owns the dual-source
// (WS + REST poll) live candle stream. Focused on the behaviours that
// have regressed in the past per DIAG.md:
//
//   - applyCandle: replace same-time, append newer, ignore older / non-last
//   - loadMore: dedup against the existing candle set
//   - reconnect: reset state without refetching
//   - initial 500-kline load via REST
//
// Network and timers are mocked so the test is fast and deterministic.
// The real Binance endpoints are never hit.
//
// Known behaviour the tests reflect (worth fixing in a follow-up):
//   - After the initial REST fetch resolves, the hook sets lastUpdateAt
//     but does NOT explicitly set status to 'live'. The status only
//     flips to 'live' when the 3 s watchdog runs and sees a fresh
//     lastUpdateAt. This is a UX wart (status stays 'connecting' for up
//     to 3 s on a fresh load) but the tests work around it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SymbolInfo } from '../types';
import { useBinanceData } from './useBinanceData';

// ─── Test fixtures ───────────────────────────────────────────────────

const TEST_SYMBOL: SymbolInfo = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  pricePrecision: 1,
  quantityPrecision: 3,
  tickSize: 0.1,
};

function makeKlineRow(
  openTimeMs: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  takerBuyVolume: number,
): Array<string | number> {
  // Matches the exact shape of Binance's /fapi/v1/klines response.
  return [
    openTimeMs,
    String(open),
    String(high),
    String(low),
    String(close),
    String(volume),
    openTimeMs,
    String(volume * close),
    0,
    String(takerBuyVolume),
    String(takerBuyVolume * close),
    '0',
  ];
}

// ─── Mocks ───────────────────────────────────────────────────────────

/**
 * Minimal WebSocket stand-in that supports the property-style handlers
 * the production code uses (ws.onopen = …). Provides helpers to fire
 * fake lifecycle events from the test.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;

  readyState = 0; // CONNECTING
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  // Test helpers ──────────────────────────────────────────
  fireOpen() { this.onopen?.(undefined); }
  fireMessage(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  fireError() { this.onerror?.(new Event('error')); }
  fireClose(code = 1000, reason = '') {
    this.onclose?.({ code, reason });
  }
}

function makeFetchReturning(klineRows: Array<Array<string | number>>) {
  return vi.fn(async (url: string) => {
    if (!url.includes('/fapi/v1/klines')) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => klineRows,
    };
  });
}

const T0 = 1_700_000_000_000; // fixed base time
const MIN15 = 15 * 60 * 1000;
function klineAt(i: number, overrides: Partial<{ open: number; high: number; low: number; close: number; volume: number; takerBuyVolume: number }> = {}) {
  return makeKlineRow(
    T0 + i * MIN15,
    overrides.open ?? 100 + i,
    overrides.high ?? 105 + i,
    overrides.low ?? 95 + i,
    overrides.close ?? 102 + i,
    overrides.volume ?? 10,
    overrides.takerBuyVolume ?? 5,
  );
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('useBinanceData — initial load', () => {
  it('populates candles from the initial fetch, exposes lastPrice, and flips status to live', async () => {
    const rows = [klineAt(0), klineAt(1), klineAt(2)];
    vi.stubGlobal('fetch', makeFetchReturning(rows));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));

    // After the fetch resolves, candles are populated and lastPrice is the
    // close of the last candle.
    await waitFor(() => {
      expect(result.current.candles).toHaveLength(3);
    });
    expect(result.current.candles[0]).toMatchObject({ open: 100, close: 102 });
    expect(result.current.candles[2]).toMatchObject({ open: 102, close: 104 });
    // klineAt(2) close = 102 + 2 = 104
    expect(result.current.lastPrice).toBe(104);
    // Status flips to 'live' immediately on initial-fetch success (no
    // 3-second watchdog wait). Regression test for the bug where the
    // hook only updated lastUpdateAt and left status at 'connecting'.
    expect(result.current.status).toBe('live');
  });

  it('surfaces a fetch error in the `error` field and does not populate candles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, text: async () => 'boom',
    })));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));

    await waitFor(() => {
      expect(result.current.error).toMatch(/500/);
    });
    expect(result.current.candles).toEqual([]);
  });

  it('surfaces an error when the initial fetch returns an empty array (no silent loading state)', async () => {
    // Regression test: an empty Binance response used to leave
    // `loading: true` forever, masking the real problem from the user.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [],
    })));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));

    await waitFor(() => {
      expect(result.current.error).toMatch(/no candles/i);
    });
    expect(result.current.candles).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

describe('useBinanceData — applyCandle via WS', () => {
  it('replaces the last candle when the WS message has the same time', async () => {
    const rows = [klineAt(0), klineAt(1)];
    vi.stubGlobal('fetch', makeFetchReturning(rows));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));
    await waitFor(() => expect(result.current.candles).toHaveLength(2));

    // A new message for the same candle (in-progress update) — klineAt(1)
    // currently has close=103. Send a message with close=999 to confirm
    // it replaces the last entry, not appends a new one.
    const openTimeMs = T0 + 1 * MIN15;
    MockWebSocket.instances[0]?.fireMessage({
      k: {
        t: openTimeMs,
        o: '102', h: '110', l: '95', c: '999',
        v: '12', V: '7',
      },
    });

    await waitFor(() => {
      const last = result.current.candles[result.current.candles.length - 1];
      expect(last.close).toBe(999);
    });
    // Still only 2 candles — replaced, not appended
    expect(result.current.candles).toHaveLength(2);
    expect(result.current.source).toBe('ws');
  });

  it('appends a new candle when the WS message has a newer time', async () => {
    const rows = [klineAt(0), klineAt(1)];
    vi.stubGlobal('fetch', makeFetchReturning(rows));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));
    await waitFor(() => expect(result.current.candles).toHaveLength(2));

    const newerOpenTimeMs = T0 + 2 * MIN15;
    MockWebSocket.instances[0]?.fireMessage({
      k: {
        t: newerOpenTimeMs,
        o: '200', h: '205', l: '198', c: '203',
        v: '50', V: '30',
      },
    });

    await waitFor(() => {
      expect(result.current.candles).toHaveLength(3);
    });
    const last = result.current.candles[2];
    expect(last.open).toBe(200);
    expect(last.close).toBe(203);
  });

  it('ignores messages for a candle older than the most recent (no insert, no replace)', async () => {
    const rows = [klineAt(0), klineAt(1), klineAt(2)];
    vi.stubGlobal('fetch', makeFetchReturning(rows));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));
    await waitFor(() => expect(result.current.candles).toHaveLength(3));

    // Send a message for candle #1 (a middle candle, not the most recent).
    // The hook only replaces the LAST candle on same-time and only appends
    // on newer-time — anything else is intentionally ignored.
    MockWebSocket.instances[0]?.fireMessage({
      k: {
        t: T0 + 1 * MIN15,
        o: '999', h: '999', l: '999', c: '999',
        v: '99', V: '99',
      },
    });

    // Give the microtask queue a turn, then assert nothing changed.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.candles).toHaveLength(3);
    // candles[1] still has its original close (klineAt(1).close = 102 + 1 = 103)
    expect(result.current.candles[1].close).toBe(103);
  });
});

describe('useBinanceData — loadMore', () => {
  it('prepends older candles and skips duplicates of the current set', async () => {
    // Initial fetch returns candles 1..3
    const initialRows = [klineAt(1), klineAt(2), klineAt(3)];
    // loadMore will request candles older than candle 1; return 0,1,2
    // (1 and 2 are duplicates — they should be skipped)
    const olderRows = [klineAt(0), klineAt(1), klineAt(2)];

    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/fapi/v1/klines')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      const params = new URL(url).searchParams;
      const hasEndTime = params.has('endTime');
      return {
        ok: true,
        status: 200,
        json: async () => (hasEndTime ? olderRows : initialRows),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));
    await waitFor(() => expect(result.current.candles).toHaveLength(3));

    // Fire loadMore
    await act(async () => {
      await result.current.loadMore();
    });

    // After: candles 0, 1, 2, 3 — only one new candle (0) was prepended
    expect(result.current.candles).toHaveLength(4);
    expect(result.current.candles[0].open).toBe(100);
    expect(result.current.candles[3].open).toBe(103);
    expect(result.current.loadingMore).toBe(false);
  });

  it('does not fetch when the candle set is empty (safe no-op)', async () => {
    // Resolve the initial fetch with an empty array.  Note: with no candles,
    // the hook's `loading` flag stays true (no error is set), but the test
    // is asserting on loadMore() specifically — it should not call fetch.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [],
    })));

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));

    // Let the initial (empty) fetch resolve.
    await new Promise((r) => setTimeout(r, 20));

    const fetchCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await result.current.loadMore();
    });
    // loadMore should be a no-op when candles.length === 0
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCount);
    expect(result.current.candles).toEqual([]);
  });
});

describe('useBinanceData — reconnect', () => {
  it('resets status, source, lastUpdateAt, messageCount without refetching', async () => {
    const rows = [klineAt(0), klineAt(1)];
    const fetchMock = makeFetchReturning(rows);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBinanceData(TEST_SYMBOL, '15m'));
    await waitFor(() => expect(result.current.candles).toHaveLength(2));

    // Deliver a WS message so messageCount > 0 before we test the reset.
    MockWebSocket.instances[0]?.fireMessage({
      k: {
        t: T0 + 1 * MIN15,
        o: '101', h: '106', l: '96', c: '103',
        v: '10', V: '5',
      },
    });
    await waitFor(() => expect(result.current.messageCount).toBeGreaterThan(0));

    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      result.current.reconnect();
    });

    expect(result.current.status).toBe('connecting');
    expect(result.current.source).toBe('none');
    expect(result.current.lastUpdateAt).toBeNull();
    expect(result.current.messageCount).toBe(0);
    // reconnect itself does not trigger a new fetch — that's the effect's job
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
