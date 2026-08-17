// Unit tests for the pure watchdog decision function.
//
// This covers the 4 paths (live / stale / stuck / fallback-to-poll)
// with deterministic timestamps, no fake timers required.  The
// integration with the 3 s setInterval tick in useBinanceData is
// tested manually via the dev server (see BROWSER_TEST.md).

import { describe, expect, it } from 'vitest';
import { decideWatchdog } from './watchdog';

const NOW = 1_700_000_000_000;
const STALE = 10_000;
const STUCK = 30_000;
const WS_NEVER = 15_000;

const baseArgs = {
  now: NOW,
  lastUpdateAt: NOW - 1_000, // 1 s ago \u2014 fresh
  streamOpenAt: NOW - 5_000,  // 5 s ago
  staleAfterMs: STALE,
  stuckAfterMs: STUCK,
  wsNeverDeliveredMs: WS_NEVER,
};

describe('decideWatchdog', () => {
  it('returns "set-live" when the last update is fresh', () => {
    const d = decideWatchdog(baseArgs);
    expect(d.kind).toBe('set-live');
    if (d.kind === 'set-live') expect(d.ageMs).toBe(1_000);
  });

  it('returns "set-live" exactly at the stale threshold (age = staleAfterMs)', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: NOW - STALE,
    });
    // The check is `ageMs > staleAfterMs` (strict), so age === threshold
    // is still live.
    expect(d.kind).toBe('set-live');
  });

  it('returns "set-stale" when the last update is between stale and stuck', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: NOW - 15_000,
    });
    expect(d.kind).toBe('set-stale');
    if (d.kind === 'set-stale') expect(d.ageMs).toBe(15_000);
  });

  it('returns "set-stale" exactly at the stuck threshold (age = stuckAfterMs)', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: NOW - STUCK,
    });
    // The stuck check is `ageMs > stuckAfterMs` (strict), so age ===
    // threshold is still stale, not stuck.
    expect(d.kind).toBe('set-stale');
  });

  it('returns "force-reconnect" when the last update is older than stuck', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: NOW - 60_000,
    });
    expect(d.kind).toBe('force-reconnect');
    if (d.kind === 'force-reconnect') expect(d.ageMs).toBe(60_000);
  });

  it('returns "noop" when there is no last update AND the WS has not opened', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: null,
      streamOpenAt: null,
    });
    expect(d.kind).toBe('noop');
  });

  it('returns "noop" when WS opened recently but no update yet', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: null,
      streamOpenAt: NOW - 5_000,
    });
    expect(d.kind).toBe('noop');
  });

  it('returns "fallback-to-poll" when WS opened > wsNeverDeliveredMs ago and no update', () => {
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: null,
      streamOpenAt: NOW - 20_000,
    });
    expect(d.kind).toBe('fallback-to-poll');
  });

  it('returns "fallback-to-poll" exactly at the WS threshold', () => {
    // streamOpenAt == NOW - wsNeverDeliveredMs: check is `> wsNeverDeliveredMs`
    // (strict), so this is still noop.  Just above the threshold is
    // fallback-to-poll.
    expect(
      decideWatchdog({
        ...baseArgs,
        lastUpdateAt: null,
        streamOpenAt: NOW - WS_NEVER,
      }).kind,
    ).toBe('noop');

    expect(
      decideWatchdog({
        ...baseArgs,
        lastUpdateAt: null,
        streamOpenAt: NOW - WS_NEVER - 1,
      }).kind,
    ).toBe('fallback-to-poll');
  });

  it('prefers fallback-to-poll over stale: when last is null but WS is open too long, that path wins', () => {
    // The last==null branch is checked BEFORE the age check, so a
    // never-delivered WS always falls back to poll regardless of how
    // long the stream has been "open".
    const d = decideWatchdog({
      ...baseArgs,
      lastUpdateAt: null,
      streamOpenAt: NOW - 60_000,
    });
    expect(d.kind).toBe('fallback-to-poll');
  });
});
