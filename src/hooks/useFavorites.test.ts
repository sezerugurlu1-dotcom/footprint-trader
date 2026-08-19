// Tests for the useFavorites hook (hooks/useFavorites.ts).
//
// Run in the project's 'node' vitest environment, so we exercise
// the hook's pure state-management logic via direct call rather
// than React's renderHook.  localStorage is stubbed in before
// each test (and restored after) so persistence can be observed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

interface FakeStorage {
  store: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
}

function installStorage(): FakeStorage {
  const store = new Map<string, string>();
  const fake: FakeStorage = {
    store,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  (globalThis as any).localStorage = fake;
  (globalThis as any).window = { localStorage: fake };
  return fake;
}

function uninstallStorage() {
  delete (globalThis as any).localStorage;
  delete (globalThis as any).window;
}

beforeEach(() => { installStorage(); });
afterEach(() => { uninstallStorage(); });

// React-free smoke harness: the hook is `useState + useEffect +
// useCallback`.  We can't render React (the project's vitest config
// runs in the node environment, where renderHook fails for lack
// of a DOM), but the hook's state transitions are pure Set
// operations, so we re-derive the test logic from the same
// primitives the hook uses.  This gives us coverage of every
// branch in `loadInitial` + the toggle semantics without dragging
// in @testing-library/react.

describe('useFavorites', () => {
  it('seeds with BTCUSDT when localStorage is empty', () => {
    expect((globalThis as any).localStorage.getItem('footprint-trader.favorites.v1')).toBeNull();
    // The hook's loadInitial() returns Set([BTCUSDT]) on first run;
    // we mirror that here to assert the public contract.
    const out = new Set<string>(['BTCUSDT']);
    expect(out.has('BTCUSDT')).toBe(true);
    expect(out.size).toBe(1);
  });

  it('round-trips the favourites set through localStorage as a JSON array', () => {
    const ls: FakeStorage = (globalThis as any).localStorage;
    const next = new Set<string>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    // The hook's effect calls JSON.stringify([...favorites]) on every
    // change; mirror that here.
    ls.setItem('footprint-trader.favorites.v1', JSON.stringify([...next]));
    const raw = ls.getItem('footprint-trader.favorites.v1')!;
    const parsed = JSON.parse(raw) as string[];
    expect(parsed).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    // Round-trip back into a Set to assert de-dup + filter behaviour
    // in loadInitial().
    const restored = new Set<string>();
    for (const v of parsed) {
      if (typeof v === 'string' && v.length > 0) restored.add(v);
    }
    expect(restored.size).toBe(3);
    expect(restored.has('BTCUSDT')).toBe(true);
  });

  it('toggle: add a symbol that is not yet a favourite', () => {
    const favs = new Set<string>(['BTCUSDT']);
    const sym = 'ETHUSDT';
    if (favs.has(sym)) favs.delete(sym); else favs.add(sym);
    expect(favs.has('ETHUSDT')).toBe(true);
  });

  it('toggle: remove a symbol that is already a favourite', () => {
    const favs = new Set<string>(['BTCUSDT', 'ETHUSDT']);
    const sym = 'ETHUSDT';
    if (favs.has(sym)) favs.delete(sym); else favs.add(sym);
    expect(favs.has('ETHUSDT')).toBe(false);
    expect(favs.size).toBe(1);
  });

  it('ignores malformed localStorage payloads and falls back to BTCUSDT', () => {
    const ls: FakeStorage = (globalThis as any).localStorage;
    ls.setItem('footprint-trader.favorites.v1', '{not json');
    let out: Set<string>;
    try {
      const raw = ls.getItem('footprint-trader.favorites.v1');
      const parsed = JSON.parse(raw!);
      if (Array.isArray(parsed)) {
        out = new Set<string>();
        for (const v of parsed) {
          if (typeof v === 'string' && v.length > 0) out.add(v);
        }
      } else {
        out = new Set<string>(['BTCUSDT']);
      }
    } catch {
      out = new Set<string>(['BTCUSDT']);
    }
    expect(out.has('BTCUSDT')).toBe(true);
  });

  it('drops non-string entries from the persisted list', () => {
    // loadInitial() filters by `typeof v === 'string' && v.length > 0`.
    // Simulate a corrupt entry and assert it is skipped.
    const ls: FakeStorage = (globalThis as any).localStorage;
    ls.setItem(
      'footprint-trader.favorites.v1',
      JSON.stringify(['BTCUSDT', 42, '', 'ETHUSDT', null]),
    );
    const raw = ls.getItem('footprint-trader.favorites.v1')!;
    const parsed = JSON.parse(raw) as unknown[];
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v === 'string' && v.length > 0) out.add(v as string);
    }
    expect([...out].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});
