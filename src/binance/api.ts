// Binance USDT-M Futures public REST API helpers
// Docs: https://binance-docs.github.io/apidocs/futures/en/

import type { AggTrade, Candle, Interval, SymbolInfo } from '../types';

const FAPI_BASE = 'https://fapi.binance.com';

const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000,
  '1w': 604_800_000, '1M': 2_592_000_000,
};

export function intervalMs(i: Interval): number { return INTERVAL_MS[i]; }

export interface FetchKlinesOpts {
  symbol: string;
  interval: Interval;
  limit?: number;       // default 500
  endTime?: number;     // ms
}

export async function fetchKlines(opts: FetchKlinesOpts): Promise<Candle[]> {
  const { symbol, interval, limit = 500, endTime } = opts;
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (endTime) params.set('endTime', String(endTime));

  const url = `${FAPI_BASE}/fapi/v1/klines?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}: ${await res.text()}`);
  const raw = await res.json();

  // Binance sometimes returns an object like {code, msg} on rate-limit /
  // 4xx errors even when res.ok is true (e.g. some gateway responses).
  // Make sure the body is actually an array of kline rows before we
  // start indexing into it.  This used to surface as a cryptic
  // "Cannot read properties of undefined (reading '0')" when the
  // response shape changed.
  if (!Array.isArray(raw)) {
    throw new Error(
      `klines: expected an array, got ${typeof raw} from ${url}` +
        (raw && typeof raw === 'object' ? ` (${JSON.stringify(raw).slice(0, 120)})` : ''),
    );
  }

  return raw.map((row, i) => {
    // Each kline row must be an array of at least 10 elements:
    //   [openTime, open, high, low, close, volume, closeTime,
    //    quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
    // We read indices 0..9, so anything shorter is a schema drift.
    if (!Array.isArray(row) || row.length < 10) {
      throw new Error(
        `klines: row[${i}] has shape ${JSON.stringify(row).slice(0, 120)}; ` +
          `expected an array of length >= 10. Binance may have changed the response schema.`,
      );
    }
    return {
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      // Field 9 = taker BUY base-asset volume.  Field 10 is the
      // matching quote-asset volume which we don't currently need.
      takerBuyVolume: Number(row[9] ?? 0),
    };
  });
}

export async function fetchExchangeInfo(): Promise<Record<string, SymbolInfo>> {
  const res = await fetch(`${FAPI_BASE}/fapi/v1/exchangeInfo`);
  if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
  const json = await res.json();
  const map: Record<string, SymbolInfo> = {};
  for (const s of json.symbols as Array<any>) {
    if (s.status !== 'TRADING' || !s.symbol.endsWith('USDT')) continue;
    const priceFilter = (s.filters as Array<any>).find((f) => f.filterType === 'PRICE_FILTER');
    const tickSize = priceFilter ? Number(priceFilter.tickSize) : 0.01;
    map[s.symbol] = {
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      pricePrecision: s.pricePrecision,
      quantityPrecision: s.quantityPrecision,
      tickSize,
    };
  }
  return map;
}

export async function fetch24hTicker(symbol: string) {
  const res = await fetch(`${FAPI_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`24hTicker ${res.status}`);
  return res.json();
}

/**
 * Fetch aggregate trades for a closed time window. Handles pagination
 * automatically by walking `startTime` forward when the response is
 * full (limit=1000) — necessary for active pairs on low timeframes
 * (a single 1m BTCUSDT candle can have 2k+ fills).
 */
export async function fetchAggTradesWindow(opts: {
  symbol: string;
  startTime: number; // ms (inclusive)
  endTime: number;   // ms (exclusive)
  maxBatches?: number; // safety cap; default 10 (10k trades)
  onBatch?: (count: number) => void;
}): Promise<AggTrade[]> {
  const { symbol, endTime, maxBatches = 10, onBatch } = opts;
  let startTime = opts.startTime;
  const limit = 1000;
  const out: AggTrade[] = [];

  for (let i = 0; i < maxBatches; i++) {
    const params = new URLSearchParams({
      symbol,
      startTime: String(startTime),
      endTime: String(endTime),
      limit: String(limit),
    });
    const url = `${FAPI_BASE}/fapi/v1/aggTrades?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`aggTrades ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as Array<any>;
    if (!rows.length) break;

    for (const r of rows) {
      out.push({
        id: r.a,
        price: Number(r.p),
        qty: Number(r.q),
        ts: r.T,
        isBuyerMaker: Boolean(r.m),
      });
    }
    onBatch?.(out.length);

    if (rows.length < limit) break;                  // exhausted
    const lastTs = Number(rows[rows.length - 1].T);
    if (lastTs >= endTime - 1) break;                // reached the end
    startTime = lastTs + 1;                          // advance window
    // small delay to be polite to the public API
    await new Promise((r) => setTimeout(r, 25));
  }
  return out;
}

/**
 * Walk BACKWARD from "now" and return the most recent N trades
 * (where N = maxBatches × limit).  Each batch is fetched with
 * `endTime` set to just before the earliest trade of the previous
 * batch, so we always make progress toward older history.
 *
 * Why this exists: Binance's aggTrades endpoint rejects queries with
 * a window wider than 2 days (error -4166), so a forward-walking
 * window over a 5-day kline history can never work.  Walking backward
 * from "now" stays within the allowed window and — more importantly —
 * gives us the *most recent* trades, which are what the chart's
 * delta bar actually wants to render.
 */
export async function fetchRecentAggTrades(opts: {
  symbol: string;
  maxBatches?: number; // safety cap; default 10 (10k trades)
  signal?: AbortSignal;
  onBatch?: (count: number) => void;
}): Promise<AggTrade[]> {
  const { symbol, maxBatches = 10, signal, onBatch } = opts;
  const limit = 1000;
  const out: AggTrade[] = [];
  let endTime: number | undefined = undefined; // first call: no time filter

  for (let i = 0; i < maxBatches; i++) {
    if (signal?.aborted) break;
    const params = new URLSearchParams({ symbol, limit: String(limit) });
    if (endTime !== undefined) params.set('endTime', String(endTime));
    const url = `${FAPI_BASE}/fapi/v1/aggTrades?${params.toString()}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`aggTrades ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as Array<any>;
    if (!rows.length) break;

    for (const r of rows) {
      out.push({
        id: r.a,
        price: Number(r.p),
        qty: Number(r.q),
        ts: r.T,
        isBuyerMaker: Boolean(r.m),
      });
    }
    onBatch?.(out.length);

    if (rows.length < limit) break;          // exhausted available history
    const firstTs = Number(rows[0].T);
    endTime = firstTs - 1;                    // step backward
    // small delay to be polite to the public API
    await new Promise((r) => setTimeout(r, 25));
  }
  return out;
}
