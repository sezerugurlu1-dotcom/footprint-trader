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
 * Crosshair horizontal-axis label (the small "12:35" badge that follows
 * the cursor along the x-axis). Format: DD/MM HH:MM in local time.
 */
export function localCrosshairTimeFormatter(time: Time): string {
  const d = toDate(time);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
