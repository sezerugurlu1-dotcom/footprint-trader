// User's favourite trading pairs.
//
// Persists to localStorage so the list survives a reload.  The first
// time the hook runs (no saved value) the set is seeded with
// BTCUSDT — the user's default favourite, per spec.
//
// Returns a `Set<string>` (O(1) membership) plus a stable `toggle`
// callback.  The `isFavorite` helper is a thin wrapper that doesn't
// require callers to reach into the Set's API.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'footprint-trader.favorites.v1';
const DEFAULT_FAVORITE = 'BTCUSDT';

function loadInitial(): Set<string> {
  if (typeof window === 'undefined') return new Set([DEFAULT_FAVORITE]);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set([DEFAULT_FAVORITE]);
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      // De-dupe and filter to non-empty strings.
      const out = new Set<string>();
      for (const v of parsed) {
        if (typeof v === 'string' && v.length > 0) out.add(v);
      }
      return out;
    }
  } catch {
    // localStorage may throw in private-browsing / disabled-storage
    // modes; fall through to the default and keep the hook in-memory
    // only.
  }
  return new Set([DEFAULT_FAVORITE]);
}

export interface UseFavoritesResult {
  favorites: Set<string>;
  isFavorite: (symbol: string) => boolean;
  toggle: (symbol: string) => void;
  /** Clear all favourites and re-seed with the default (BTCUSDT). */
  reset: () => void;
}

export function useFavorites(): UseFavoritesResult {
  const [favorites, setFavorites] = useState<Set<string>>(() => loadInitial());

  // Persist on every change.  Storage failures (quota, disabled) are
  // silently ignored — the in-memory state is still authoritative
  // for the current session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
    } catch {
      /* ignore */
    }
  }, [favorites]);

  const toggle = useCallback((symbol: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (symbol: string) => favorites.has(symbol),
    [favorites],
  );

  const reset = useCallback(() => {
    setFavorites(new Set([DEFAULT_FAVORITE]));
  }, []);

  return { favorites, isFavorite, toggle, reset };
}
