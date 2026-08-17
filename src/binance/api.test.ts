// Tests for the binance/api.ts fetchKlines shape validation.  These run
// in the default node environment (no DOM needed).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKlines } from './api';

function makeKlineRow(openTimeMs: number, takerBuyVolume: number): Array<string | number> {
  return [
    openTimeMs,
    '100', '105', '95', '102',
    '10',
    openTimeMs,
    '1020',
    '50',
    String(takerBuyVolume),
    String(takerBuyVolume * 102),
    '0',
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchKlines — shape validation', () => {
  it('returns parsed candles for a valid response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [
        makeKlineRow(1_700_000_000_000, 4),
        makeKlineRow(1_700_000_900_000, 6),
      ],
    })));

    const candles = await fetchKlines({ symbol: 'BTCUSDT', interval: '15m' });
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ open: 100, close: 102, volume: 10, takerBuyVolume: 4 });
    expect(candles[0].time).toBe(1_700_000_000);
    expect(candles[1].takerBuyVolume).toBe(6);
  });

  it('throws with a clear message when the response is not an array (e.g. error object)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ code: -1003, msg: 'TOO_MANY_REQUESTS' }),
    })));

    await expect(
      fetchKlines({ symbol: 'BTCUSDT', interval: '15m' }),
    ).rejects.toThrow(/expected an array/i);
  });

  it('throws when a kline row is shorter than the expected 10 elements (schema drift)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [
        // valid row, then a row that's too short
        makeKlineRow(1, 1),
        ['2', '100', '105', '95'], // only 4 elements
      ],
    })));

    await expect(
      fetchKlines({ symbol: 'BTCUSDT', interval: '15m' }),
    ).rejects.toThrow(/row\[1\].*expected an array of length/i);
  });

  it('throws when a kline row is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => [
        makeKlineRow(1, 1),
        { weird: 'object' },
      ],
    })));

    await expect(
      fetchKlines({ symbol: 'BTCUSDT', interval: '15m' }),
    ).rejects.toThrow(/row\[1\]/);
  });
});
