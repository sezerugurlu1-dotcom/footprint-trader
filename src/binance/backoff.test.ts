// Tests for the Backoff helper used by all Binance WebSocket streams.

import { describe, expect, it } from 'vitest';
import { Backoff } from './backoff';

describe('Backoff', () => {
  it('starts at attempt 0', () => {
    const b = new Backoff();
    expect(b.getAttempt()).toBe(0);
  });

  it('next() doubles the base delay each call (exponential)', () => {
    // No jitter for this test so we can assert exact values
    const b = new Backoff({ baseMs: 100, maxMs: 100_000, jitter: 0 });
    expect(b.next()).toBe(100);   // attempt 0: 100 * 2^0 = 100
    expect(b.next()).toBe(200);   // attempt 1: 100 * 2^1 = 200
    expect(b.next()).toBe(400);   // attempt 2
    expect(b.next()).toBe(800);   // attempt 3
    expect(b.next()).toBe(1600);  // attempt 4
  });

  it('caps at maxMs', () => {
    const b = new Backoff({ baseMs: 1000, maxMs: 5000, jitter: 0 });
    // 1000, 2000, 4000, 5000 (capped), 5000, ...
    expect(b.next()).toBe(1000);
    expect(b.next()).toBe(2000);
    expect(b.next()).toBe(4000);
    expect(b.next()).toBe(5000);
    expect(b.next()).toBe(5000);
  });

  it('applies jitter in [-jitter, +jitter] of the computed delay', () => {
    // Use a fixed RNG so we can assert exact values deterministically.
    // The jitter scales with the CURRENT (post-exponential) delay, not the base.
    const origRandom = Math.random;
    let fake = 0.5; // 0.5 -> jitter multiplier = 0 -> exactly the delay
    Math.random = () => fake;

    try {
      const b = new Backoff({ baseMs: 1000, maxMs: 100_000, jitter: 0.2 });
      // attempt 0: exp = 1000, fake=0.5 -> j = 0          -> 1000
      expect(b.next()).toBe(1000);
      // attempt 1: exp = 2000, fake=1.0 -> j = +400        -> 2400
      fake = 1.0;
      expect(b.next()).toBe(2400);
      // attempt 2: exp = 4000, fake=0.0 -> j = -800        -> 3200
      fake = 0.0;
      expect(b.next()).toBe(3200);
    } finally {
      Math.random = origRandom;
    }
  });

  it('reset() returns attempt counter to 0', () => {
    const b = new Backoff({ baseMs: 100, jitter: 0 });
    b.next();
    b.next();
    b.next();
    expect(b.getAttempt()).toBe(3);
    b.reset();
    expect(b.getAttempt()).toBe(0);
    // After reset, next() returns the base delay again
    expect(b.next()).toBe(100);
  });

  it('never returns a negative delay (jitter cannot drive it below 0)', () => {
    // Force Math.random to 0 every time -> max negative jitter
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      const b = new Backoff({ baseMs: 100, jitter: 0.5 });
      for (let i = 0; i < 100; i++) {
        expect(b.next()).toBeGreaterThanOrEqual(0);
      }
    } finally {
      Math.random = origRandom;
    }
  });
});
