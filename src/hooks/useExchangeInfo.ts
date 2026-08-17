// Cached fetch of Binance's exchangeInfo.  The 418 in this Windows test
// environment (see DIAG.md) means every reload re-hits a blocked endpoint
// for the symbol list; caching avoids that on warm loads.

import { useCallback, useEffect, useState } from 'react';
import { fetchExchangeInfo } from '../binance/api';
import type { SymbolInfo } from '../types';

const STORAGE_KEY = 'footprint-trader:exchangeInfo';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedExchangeInfo {
  data: Record<string, SymbolInfo>;
  cachedAt: number;
}

function readCache(): Record<string, SymbolInfo> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedExchangeInfo;
    if (!parsed?.data || typeof parsed.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: Record<string, SymbolInfo>): void {
  try {
    const payload: CachedExchangeInfo = { data, cachedAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage full or unavailable (private mode, etc.) — silent
  }
}

export interface UseExchangeInfoResult {
  data: Record<string, SymbolInfo> | null;
  loading: boolean;
  error: string | null;
  /** True when the data was served from sessionStorage (no network). */
  fromCache: boolean;
  /** Force-fetch from Binance and update both state and the cache. */
  refresh: () => Promise<void>;
}

export function useExchangeInfo(): UseExchangeInfoResult {
  const [data, setData] = useState<Record<string, SymbolInfo> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache();
    if (cached) {
      // Warm path — no network round trip.
      setData(cached);
      setFromCache(true);
      return;
    }
    setLoading(true);
    setFromCache(false);
    fetchExchangeInfo()
      .then((info) => {
        if (cancelled) return;
        setData(info);
        writeCache(info);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const info = await fetchExchangeInfo();
      setData(info);
      writeCache(info);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fromCache, refresh };
}
