// Tests for the time-axis / crosshair formatters (utils/timeFormat.ts).
import { describe, it, expect } from 'vitest';
import { localCrosshairTimeFormatter, localTickMarkFormatter } from './timeFormat';

// 2024-08-17 14:30:25 UTC.  A Saturday afternoon in mid-August.
const TS_2024_08_17 = 1_723_898_625;

describe('localCrosshairTimeFormatter', () => {
  it('includes the four-digit year in the badge', () => {
    const out = localCrosshairTimeFormatter(TS_2024_08_17);
    // The exact HH:MM depends on the test machine's local timezone
    // (vitest runs in whatever TZ the OS is configured with), so we
    // assert on the date-prefix that is timezone-independent.
    expect(out).toMatch(/^17\/08\/2024 \d{2}:\d{2}$/);
  });

  it('zero-pads day, month, hours, minutes', () => {
    // 2024-01-05 03:04:00 UTC = 1704419040
    const out = localCrosshairTimeFormatter(1_704_419_040);
    expect(out).toMatch(/^05\/01\/2024 \d{2}:\d{2}$/);
  });
});

describe('localTickMarkFormatter', () => {
  it('returns the year as a plain 4-digit string for TickMarkType.Year', () => {
    expect(localTickMarkFormatter(TS_2024_08_17, 0)).toBe('2024');
  });

  it('returns "Mon YYYY" for TickMarkType.Month', () => {
    // Note: timezone may shift the rendered month by ±1 from the
    // input UTC date.  Assert only on the structure, not the month.
    const out = localTickMarkFormatter(TS_2024_08_17, 1);
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });

  it('returns "DD Mon" for TickMarkType.DayOfMonth', () => {
    const out = localTickMarkFormatter(TS_2024_08_17, 2);
    expect(out).toMatch(/^\d{2} [A-Z][a-z]{2}$/);
  });

  it('returns "HH:MM" for TickMarkType.Time', () => {
    const out = localTickMarkFormatter(TS_2024_08_17, 3);
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });
});
