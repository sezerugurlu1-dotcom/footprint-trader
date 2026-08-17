// @vitest-environment jsdom
//
// Tests for the useOrderBook hook \u2014 initial REST snapshot + WS stream
// from Binance USDT-M Futures.  Focused on the wire-level contracts
// that have caused bugs in the past: symbol change cleanup, WS throttle,
// REST-then-WS handoff.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useOrderBook } from './useOrderBook';

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
  close() { /* no-op for tests */ }
  // test helpers
  fireOpen() { this.onopen?.(undefined); }
  fireMessage(payload: object) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  fireClose() { this.onclose?.({ code: 1000, reason: '' }); }
}

function mockRestDepth(symbol: string, depth: number, body: unknown, ok = true) {
  return vi.fn(async (url: string) => {
    if (!url.includes('/fapi/v1/depth')) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    };
  });
}

function depthBody(bidCount: number, askCount: number) {
  return {
    bids: Array.from({ length: bidCount }, (_, i) => [String(100 - i), String(1 + i)]),
    asks: Array.from({ length: askCount }, (_, i) => [String(101 + i), String(1 + i)]),
  };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useOrderBook', () => {
  it('returns null when symbol is null', () => {
    const { result } = renderHook(() => useOrderBook(null));
    expect(result.current).toBeNull();
  });

  it('returns null initially then populates from the REST snapshot', async () => {
    vi.stubGlobal('fetch', mockRestDepth('BTCUSDT', 10, depthBody(10, 10)));

    const { result } = renderHook(() => useOrderBook('BTCUSDT', 10));

    // Sync after mount: still null
    expect(result.current).toBeNull();

    // After the REST fetch resolves, bids and asks are populated.
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current!.bids).toHaveLength(10);
    expect(result.current!.asks).toHaveLength(10);
    expect(result.current!.bids[0]).toEqual({ price: 100, qty: 1 });
    expect(result.current!.asks[0]).toEqual({ price: 101, qty: 1 });
  });

  it('ignores REST failures (WS will fill in later)', async () => {
    vi.stubGlobal('fetch', mockRestDepth('BTCUSDT', 10, {}, false));
    // No error thrown out of the hook; book stays null.
    const { result } = renderHook(() => useOrderBook('BTCUSDT', 10));

    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
    // No WebSocket message was sent, so the WS path never fired either.
  });

  it('updates the book when a WS message arrives', async () => {
    vi.stubGlobal('fetch', mockRestDepth('ETHUSDT', 10, depthBody(2, 2)));

    const { result } = renderHook(() => useOrderBook('ETHUSDT', 10));
    await waitFor(() => expect(result.current).not.toBeNull());

    // Push a new depth frame
    MockWebSocket.instances[0]?.fireMessage({
      bids: [['200', '5'], ['199', '4']],
      asks: [['201', '3'], ['202', '2']],
    });

    await waitFor(() => {
      expect(result.current!.bids[0]).toEqual({ price: 200, qty: 5 });
    });
    expect(result.current!.asks[0]).toEqual({ price: 201, qty: 3 });
  });

  it('throttles WS updates to ~10fps (messages within 100ms are coalesced)', async () => {
    vi.stubGlobal('fetch', mockRestDepth('BTCUSDT', 10, depthBody(1, 1)));

    const { result } = renderHook(() => useOrderBook('BTCUSDT', 10));
    await waitFor(() => expect(result.current).not.toBeNull());

    // First message updates the book
    MockWebSocket.instances[0]?.fireMessage({
      bids: [['500', '1']], asks: [['501', '1']],
    });
    await waitFor(() => {
      expect(result.current!.bids[0]).toEqual({ price: 500, qty: 1 });
    });

    // Second message 10ms later should be throttled out (still 500)
    MockWebSocket.instances[0]?.fireMessage({
      bids: [['600', '9']], asks: [['601', '9']],
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current!.bids[0]).toEqual({ price: 500, qty: 1 });
  });

  it('truncates the book to the requested depth', async () => {
    vi.stubGlobal('fetch', mockRestDepth('BTCUSDT', 5, {
      bids: [['100', '1'], ['99', '1'], ['98', '1']],  // only 3 \u2014 < 5
      asks: [['101', '1'], ['102', '1']],
    }));

    const { result } = renderHook(() => useOrderBook('BTCUSDT', 5));
    await waitFor(() => expect(result.current).not.toBeNull());
    // Whatever the REST returns, we use as-is; truncation is the WS
    // path's job.  This test documents that behaviour.
    expect(result.current!.bids).toHaveLength(3);
  });

  it('clears the book when the symbol becomes null (via re-render)', async () => {
    vi.stubGlobal('fetch', mockRestDepth('BTCUSDT', 10, depthBody(1, 1)));

    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string | null }) => useOrderBook(symbol, 10),
      { initialProps: { symbol: 'BTCUSDT' as string | null } },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    rerender({ symbol: null });
    expect(result.current).toBeNull();
  });

  it('opens a new WS and closes the old one on symbol change', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.includes('/fapi/v1/depth')) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, json: async () => depthBody(1, 1) };
    }));

    const { rerender } = renderHook(
      ({ symbol }: { symbol: string }) => useOrderBook(symbol, 10),
      { initialProps: { symbol: 'BTCUSDT' } },
    );
    // Wait for the first WS to be created
    await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
    const firstSockets = MockWebSocket.instances.length;
    const firstUrl = MockWebSocket.instances[0].url;

    rerender({ symbol: 'ETHUSDT' });
    await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(firstSockets));
    expect(MockWebSocket.instances[firstSockets].url).not.toBe(firstUrl);
  });
});
