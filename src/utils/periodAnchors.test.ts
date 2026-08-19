// Tests for the period-boundary anchor functions (utils/periodAnchors.ts).
import { describe, it, expect } from 'vitest';
import {
  dailyAnchor,
  weeklyAnchor,
  monthlyAnchor,
  getVwapAnchor,
  getCvdAnchor,
} from './periodAnchors';

describe('dailyAnchor', () => {
  it('floors to 00:00:00 UTC of the candle\'s date', () => {
    // 2024-01-15 12:34:56 UTC = 1705322096
    const t = 1_705_322_096;
    const d = new Date(t * 1000);
    expect(d.getUTCHours()).toBe(12); // sanity: not midnight
    const anchor = dailyAnchor(t);
    const a = new Date(anchor * 1000);
    expect(a.getUTCFullYear()).toBe(2024);
    expect(a.getUTCMonth()).toBe(0);  // January (0-indexed)
    expect(a.getUTCDate()).toBe(15);
    expect(a.getUTCHours()).toBe(0);
    expect(a.getUTCMinutes()).toBe(0);
    expect(a.getUTCSeconds()).toBe(0);
  });

  it('puts 00:00:00 UTC exactly on the boundary', () => {
    // 2024-01-15 00:00:00 UTC = 1705276800
    const t = 1_705_276_800;
    expect(dailyAnchor(t)).toBe(t);
  });
});

describe('weeklyAnchor', () => {
  it('puts a Monday at 00:00 UTC exactly on the boundary', () => {
    // 2024-01-01 is a Monday.  Its unix timestamp is 1704067200.
    const monday = 1_704_067_200;
    expect(weeklyAnchor(monday)).toBe(monday);
  });

  it('puts Wednesday, Friday, Sunday on the same Monday\'s boundary', () => {
    const monday = 1_704_067_200;
    const day = 86_400;
    expect(weeklyAnchor(monday + 1 * day)).toBe(monday); // Tue
    expect(weeklyAnchor(monday + 2 * day)).toBe(monday); // Wed
    expect(weeklyAnchor(monday + 3 * day)).toBe(monday); // Thu
    expect(weeklyAnchor(monday + 4 * day)).toBe(monday); // Fri
    expect(weeklyAnchor(monday + 5 * day)).toBe(monday); // Sat
    expect(weeklyAnchor(monday + 6 * day)).toBe(monday); // Sun
  });

  it('rolls back Sunday (UTC day 0) to the previous Monday', () => {
    // 2024-01-07 is a Sunday.
    const sunday = 1_704_067_200 + 6 * 86_400;
    const d = new Date(sunday * 1000);
    expect(d.getUTCDay()).toBe(0); // sanity: it's a Sunday
    expect(weeklyAnchor(sunday)).toBe(1_704_067_200); // the prior Monday
  });

  it('rolls forward to a new Monday for any time after it', () => {
    // 2024-01-08 is the next Monday.  Tuesday onwards maps to it.
    const monday2 = 1_704_067_200 + 7 * 86_400;
    const tue = monday2 + 86_400;
    expect(weeklyAnchor(tue)).toBe(monday2);
  });
});

describe('monthlyAnchor', () => {
  it('puts midnight on the 1st exactly on the boundary', () => {
    // 2024-02-01 00:00 UTC = 1706745600
    const t = 1_706_745_600;
    expect(monthlyAnchor(t)).toBe(t);
  });

  it('puts mid-month dates on the 1st of that month', () => {
    // 2024-02-15 12:00 UTC = 1708003200
    const t = 1_708_003_200;
    const anchor = monthlyAnchor(t);
    const a = new Date(anchor * 1000);
    expect(a.getUTCFullYear()).toBe(2024);
    expect(a.getUTCMonth()).toBe(1);   // February
    expect(a.getUTCDate()).toBe(1);
    expect(a.getUTCHours()).toBe(0);
  });

  it('rolls over month boundaries', () => {
    // 2024-01-31 23:59:59 UTC and 2024-02-01 00:00:00 UTC belong
    // to different months.
    const jan31 = Date.UTC(2024, 0, 31, 23, 59, 59) / 1000;
    const feb01 = Date.UTC(2024, 1, 1, 0, 0, 0) / 1000;
    expect(monthlyAnchor(jan31)).not.toBe(monthlyAnchor(feb01));
    expect(monthlyAnchor(jan31)).toBe(Date.UTC(2024, 0, 1) / 1000);
    expect(monthlyAnchor(feb01)).toBe(feb01);
  });
});

describe('getVwapAnchor', () => {
  it('maps each period to the right anchor function', () => {
    // We can't easily assert "the same function reference" without
    // exporting them, so we test behaviour: two candles in the same
    // weekly bucket accumulate, two candles in different weeks reset.
    const monday = 1_704_067_200;

    const session = getVwapAnchor('session');
    const daily = getVwapAnchor('daily');
    const weekly = getVwapAnchor('weekly');
    const monthly = getVwapAnchor('monthly');

    // Session and daily are UTC-day aligned, so they disagree for
    // these particular timestamps only if they fall across a
    // day boundary.  In our case the timestamps are exactly
    // 1 day apart from each other, so session and daily treat
    // all three as the same anchor (the first two are the same
    // day in UTC if the Monday is a UTC day boundary; we
    // verified above that getUTCDay=1 → 1704067200 is 2024-01-01
    // 00:00 UTC, so +86400 is 2024-01-02 00:00 UTC — a new
    // day).  session/daily reset on that boundary; weekly does
    // not.
    expect(session(monday)).toBe(daily(monday));
    expect(session(monday + 86_400)).not.toBe(session(monday));
    expect(weekly(monday)).toBe(weekly(monday + 86_400));
    expect(weekly(monday)).not.toBe(weekly(monday + 7 * 86_400));
    expect(monthly(monday)).toBe(monthly(monday + 86_400));
    expect(monthly(monday)).toBe(monthly(monday + 7 * 86_400));
  });
});

describe('getCvdAnchor', () => {
  it('maps each period to the right anchor function', () => {
    const monday = 1_704_067_200;
    const daily = getCvdAnchor('daily');
    const weekly = getCvdAnchor('weekly');
    expect(daily(monday)).toBe(daily(monday));
    expect(daily(monday + 86_400)).not.toBe(daily(monday));
    expect(weekly(monday)).toBe(weekly(monday + 86_400));
    expect(weekly(monday)).not.toBe(weekly(monday + 7 * 86_400));
  });
});
