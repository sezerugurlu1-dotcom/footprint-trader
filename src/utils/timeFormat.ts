// Time formatters for lightweight-charts. The library expects all
// timestamps as UTC seconds, but the labels on the x-axis and the
// crosshair's time label need to render in the user's LOCAL timezone.
// lightweight-charts has no built-in timezone option, so we intercept
// the tick-mark and crosshair formatters and convert UTC -> local here.

import type { Time, TickMarkType } from 'lightweight-charts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(time: Time): Date {
  const t = typeof time === 'number' ? time : Number(time);
  // lightweight-charts times are in seconds (UTC). Date expects ms.
  return new Date(t * 1000);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * X-axis tick label formatter. Receives the tick mark type so we can
 * pick the right resolution. All values are in the user's local time.
 */
export function localTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  const d = toDate(time);
  switch (tickMarkType) {
    case 0: // TickMarkType.Year
      return String(d.getFullYear());
    case 1: // TickMarkType.Month
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    case 2: // TickMarkType.DayOfMonth
      return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]}`;
    case 3: // TickMarkType.Time
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    case 4: // TickMarkType.TimeWithSeconds
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    default:
      return '';
  }
}

/**
 * Crosshair horizontal-axis label (the small badge that follows the
 * cursor along the x-axis). Format: DD/MM/YYYY HH:MM in local time.
 *
 * The year is part of the badge even when it matches the current
 * year — the badge has a fixed pixel budget (~80px in our toolbar)
 * and dropping the year on "same-year" days was a footgun: the
 * user can't tell whether they're looking at a January or a
 * December print without scrolling the chart.  Showing the year
 * unconditionally is unambiguous.
 */
export function localCrosshairTimeFormatter(time: Time): string {
  const d = toDate(time);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
