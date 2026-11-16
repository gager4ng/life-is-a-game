/** World clock: 10-minute ticks. Tick 0 is 00:00 on day 1. */
export const TICK_MINUTES = 10;
export const TICKS_PER_DAY = (24 * 60) / TICK_MINUTES;

export const dayIndex = (tick: number): number => Math.floor(tick / TICKS_PER_DAY);
export const dayNumber = (tick: number): number => dayIndex(tick) + 1;
export const minuteOfDay = (tick: number): number => (tick % TICKS_PER_DAY) * TICK_MINUTES;
export const tickAt = (dayIdx: number, minute: number): number =>
  dayIdx * TICKS_PER_DAY + Math.floor(minute / TICK_MINUTES);

export function parseHHMM(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Bad time "${s}", expected HH:MM`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes > 24 * 60 || Number(m[2]) >= 60) throw new Error(`Bad time "${s}"`);
  return minutes;
}

export function formatClock(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** [from, to) on a 24h dial; wraps past midnight when from > to. */
export function isWithin(minute: number, from: number, to: number): boolean {
  if (from === to) return true;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export function isNight(minute: number): boolean {
  return minute < 6 * 60 + 30 || minute >= 19 * 60;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CalendarDay {
  iso: string;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  weekdayName: string;
  /** 1..12 */
  month: number;
  weekend: boolean;
  label: string;
}

/** Pure calendar arithmetic in UTC; never reads the wall clock. */
export function calendar(startDate: string, dayIdx: number): CalendarDay {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) throw new Error(`Bad start date "${startDate}", expected YYYY-MM-DD`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayIdx));
  const weekday = (d.getUTCDay() + 6) % 7;
  const month = d.getUTCMonth() + 1;
  const iso = `${d.getUTCFullYear()}-${String(month).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return {
    iso,
    weekday,
    weekdayName: WEEKDAYS[weekday]!,
    month,
    weekend: weekday >= 5,
    label: `${WEEKDAYS[weekday]!} ${d.getUTCDate()} ${MONTHS[month - 1]!} ${d.getUTCFullYear()}`,
  };
}
