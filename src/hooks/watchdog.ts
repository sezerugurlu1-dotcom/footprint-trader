// Watchdog decision logic, extracted from useBinanceData for testability.
//
// The hook runs this every 3 s.  The decision is a pure function of
// the current time and the last-update / stream-open timestamps;
// the hook only translates the decision into React state updates and
// side effects (close WS, etc.).  Keeping the decision pure means we
// can test all four paths (live / stale / stuck / fallback-to-poll)
// with deterministic timestamps, no fake timers required.

export type WatchdogDecision =
  | { kind: 'noop' }
  /** WS opened > wsNeverDeliveredMs ago and never delivered. Flip to poll. */
  | { kind: 'fallback-to-poll' }
  /** lastUpdateAt is older than stuckAfterMs. Force reconnect. */
  | { kind: 'force-reconnect'; ageMs: number }
  /** lastUpdateAt is between staleAfterMs and stuckAfterMs. Show stale. */
  | { kind: 'set-stale'; ageMs: number }
  /** lastUpdateAt is fresh. Show live. */
  | { kind: 'set-live'; ageMs: number };

export interface WatchdogArgs {
  /** Current wall time in ms (e.g. Date.now()). */
  now: number;
  /** ms-since-epoch of the most recent candle update, or null if none yet. */
  lastUpdateAt: number | null;
  /** ms-since-epoch when the WS was opened, or null if not yet opened. */
  streamOpenAt: number | null;
  /** > this many ms since lastUpdateAt -> force reconnect. */
  stuckAfterMs: number;
  /** > this many ms since lastUpdateAt -> mark stale. */
  staleAfterMs: number;
  /** > this many ms since streamOpenAt with no message -> fall back to poll. */
  wsNeverDeliveredMs: number;
}

export function decideWatchdog(args: WatchdogArgs): WatchdogDecision {
  const { now, lastUpdateAt, streamOpenAt } = args;

  // No data ever.  Two cases:
  //   1. WS hasn't opened yet \u2014 keep waiting, do nothing.
  //   2. WS has been open > wsNeverDeliveredMs but no message has
  //      landed \u2014 assume the WS is blocked in this environment
  //      and switch to the REST-poll path.
  if (lastUpdateAt == null) {
    if (streamOpenAt != null && now - streamOpenAt > args.wsNeverDeliveredMs) {
      return { kind: 'fallback-to-poll' };
    }
    return { kind: 'noop' };
  }

  const ageMs = now - lastUpdateAt;
  if (ageMs > args.stuckAfterMs) {
    return { kind: 'force-reconnect', ageMs };
  }
  if (ageMs > args.staleAfterMs) {
    return { kind: 'set-stale', ageMs };
  }
  return { kind: 'set-live', ageMs };
}
