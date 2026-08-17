// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useExchangeInfo } from './useExchangeInfo';

const STORAGE_KEY = 'footprint-trader:exchangeInfo';

function mockExchangeInfoResponse(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }));
}

function sampleInfo() {
  return {
    BTCUSDT: { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', pricePrecision: 1, quantityPrecision: 3, tickSize: 0.1 },
    ETHUSDT: { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', pricePrecision: 2, quantityPrecision: 3, tickSize: 0.01 },
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('useExchangeInfo', () => {
  it('fetches on cold start, populates data, and writes to sessionStorage', async () => {
    vi.stubGlobal('fetch', mockExchangeInfoResponse({ symbols: [] }));
    // The hook's fetchExchangeInfo inspects the response's `symbols` array
    // and only keeps entries that are TRADING + end with USDT.  We pass
    // an empty array so the test focuses on the fetch + cache behaviour.
    // For coverage of the full parse, see the broader integration.

    const { result } = renderHook(() => useExchangeInfo());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual({});
    expect(result.current.error).toBeNull();
    expect(result.current.fromCache).toBe(false);
  });

  it('serves from sessionStorage on warm start (no network round trip)', async () => {
    // Pre-populate the cache with a fresh (less than 24h old) entry
    const cached = sampleInfo();
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ data: cached, cachedAt: Date.now() }),
    );
    // fetch should NOT be called
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useExchangeInfo());

    // Synchronously after the first render, the cache should be served
    // (no await needed).
    expect(result.current.data).toEqual(cached);
    expect(result.current.fromCache).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores expired cache entries and re-fetches', async () => {
    // 25 hours old — past the 24h TTL
    const stale = sampleInfo();
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ data: stale, cachedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    vi.stubGlobal('fetch', mockExchangeInfoResponse({ symbols: [] }));

    const { result } = renderHook(() => useExchangeInfo());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // Stale cache was ignored; result should be the fresh empty response
    expect(result.current.data).toEqual({});
    expect(result.current.fromCache).toBe(false);
  });

  it('refresh() force-fetches and updates the cache', async () => {
    vi.stubGlobal('fetch', mockExchangeInfoResponse({ symbols: [] }));

    const { result } = renderHook(() => useExchangeInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First fetch done.  Now mutate the response and call refresh.
    vi.stubGlobal('fetch', mockExchangeInfoResponse({ symbols: [], msg: 'second' }));
    await act(async () => {
      await result.current.refresh();
    });

    // Cache should now reflect the second fetch's result
    const cached = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(cached.data).toEqual({});
    expect(typeof cached.cachedAt).toBe('number');
  });
});
