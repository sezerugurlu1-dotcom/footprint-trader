// Exponential backoff with jitter for WebSocket reconnects.
//
// When the network is down, the four Binance streams (kline, trade,
// depth, ticker) all drop in a burst.  Without backoff, each one
// reconnects every 2 s \u2014 a thundering herd on the same IP.  With
// exponential backoff + jitter, the reconnects fan out and the load
// on Binance drops, and on a long outage the backoff caps at `maxMs`
// so we don't drift to multi-minute waits.
//
// Used per-WS-instance: each stream has its own Backoff so a flaky
// kline stream doesn't slow down a healthy depth stream, and vice
// versa.  State is shared through the helper itself, not globally.

export interface BackoffOptions {
  /** First retry delay in ms.  Default 1000. */
  baseMs?: number;
  /** Cap on the delay.  Default 30 000 (30 s). */
  maxMs?: number;
  /** Jitter as a fraction of the computed delay.  Default 0.2 (\u00b120%). */
  jitter?: number;
}

export class Backoff {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly jitter: number;
  private attempt: number = 0;

  constructor(opts: BackoffOptions = {}) {
    this.baseMs = opts.baseMs ?? 1000;
    this.maxMs = opts.maxMs ?? 30_000;
    this.jitter = opts.jitter ?? 0.2;
  }

  /** Compute the next delay, increment the attempt counter, return ms. */
  next(): number {
    const exp = Math.min(this.baseMs * Math.pow(2, this.attempt), this.maxMs);
    // Jitter in [-jitter, +jitter] of the computed delay
    const j = exp * this.jitter * (Math.random() * 2 - 1);
    this.attempt++;
    return Math.max(0, Math.floor(exp + j));
  }

  /** Reset the attempt counter (call on successful connect). */
  reset(): void {
    this.attempt = 0;
  }

  /** Current attempt count (0 right after reset, 1 after the first next()). */
  getAttempt(): number {
    return this.attempt;
  }
}
