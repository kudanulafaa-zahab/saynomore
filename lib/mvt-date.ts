/**
 * Maldives-time calendar helpers.
 *
 * The business day is Indian/Maldives (UTC+5, no DST). Getting this wrong is
 * not cosmetic: `new Date(y, m, 1).toISOString().slice(0,10)` on a phone in
 * Malé returns the PREVIOUS day (local midnight is 19:00 UTC the day before),
 * so a "this month" P&L window silently started on the last day of the
 * previous month and pulled that day's sales, costs and write-offs into this
 * month's profit. The dashboard ran the same expression on the server in UTC
 * and got a different answer — two screens, two profits, same month.
 *
 * Every date boundary the UI sends to Postgres must come from here. The
 * database side was fixed separately (migrations 0123 / 0126 / 0130).
 */

const MVT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** `now` shifted into Maldives time, so getUTC* reads as Maldives wall-clock. */
function mvtNow(at: Date = new Date()): Date {
  return new Date(at.getTime() + MVT_OFFSET_MS);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Today's date in Maldives, as YYYY-MM-DD. */
export function mvtToday(at: Date = new Date()): string {
  return iso(mvtNow(at));
}

/** Tomorrow in Maldives — for exclusive-ish upper bounds. */
export function mvtTomorrow(at: Date = new Date()): string {
  const d = mvtNow(at);
  d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

/** First day of the current Maldives month, as YYYY-MM-DD. */
export function mvtFirstOfMonth(at: Date = new Date()): string {
  const d = mvtNow(at);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/** First and last day of the previous Maldives month. */
export function mvtLastMonthRange(at: Date = new Date()): { start: string; end: string } {
  const d = mvtNow(at);
  return {
    start: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))),
    // Day 0 of this month === last day of the previous month.
    end: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))),
  };
}
