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

// ── Display formatting ──────────────────────────────────────────────────────
//
// Everything above answers "which day is it in Malé". Everything below answers
// "how do I print a stored value". They are different problems and the app was
// getting the second one right only by luck: a bare `toLocaleDateString()` uses
// the DEVICE's timezone, which is correct while Ali's phone is in Malé and
// wrong the moment it isn't — or the moment the value is formatted during
// server rendering, where Vercel runs in UTC.
//
// There are two kinds of stored value and they need OPPOSITE treatment. Mixing
// them up shifts a date by a day in whichever direction you weren't expecting:
//
//   * An INSTANT — `created_at`, `paid_at`, `received_at`, `delivered_at`,
//     `verified_at`: a `timestamptz`. It happened at a moment in time, and the
//     calendar day it belongs to is the Malé day. Use `mvtInstant`.
//
//   * A PLAIN DAY — `expense_date`, `observed_date`, `start_date`,
//     `effective_from`, `expiry_date`, `order_by_date`: a `date` column. It has
//     no time and no timezone; "6 August" means 6 August in every timezone on
//     earth. Postgres sends it as "2026-08-06", which `new Date()` parses as
//     UTC midnight — so it must be rendered in UTC to come back out as the same
//     day. Converting one of these to Malé time would be actively wrong.
//     Use `mvtPlainDay`.

const MVT = "Indian/Maldives";

type DateStyle = Intl.DateTimeFormatOptions;

/** Yesterday in Maldives, as YYYY-MM-DD. */
export function mvtYesterday(at: Date = new Date()): string {
  const d = mvtNow(at);
  d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

/**
 * Which Maldives calendar day an INSTANT falls on, as YYYY-MM-DD.
 *
 * For grouping and for "is this today?" comparisons. Doing that with
 * `new Date(x).getDate()` uses the device's day boundary, so an order placed
 * at 00:30 in Malé reads as yesterday on a phone set to UTC — and the list
 * heading then disagrees with every total on the screen, which all come from
 * Postgres on Maldives days.
 */
export function mvtDayKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return iso(new Date(d.getTime() + MVT_OFFSET_MS));
}

/** Format a `timestamptz` on the Malé calendar, wherever the device is. */
export function mvtInstant(
  value: string | Date | null | undefined,
  opts: DateStyle = { day: "numeric", month: "short" },
): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-MV", { ...opts, timeZone: MVT });
}

/**
 * Format a `date` column ("2026-08-06") as the day it says, in every timezone.
 *
 * Rendered in UTC on purpose — not in Malé. The string parses to UTC midnight,
 * so UTC is what reads it back unchanged; shifting it to Malé (+5) would still
 * print the right day, but shifting a LOCAL-midnight parse would not, and the
 * only way to be right on every device is to keep parse and render in the same
 * zone.
 */
export function mvtPlainDay(
  value: string | null | undefined,
  opts: DateStyle = { day: "numeric", month: "short" },
): string {
  if (!value) return "";
  // Accept both "2026-08-06" and a full ISO instant, but only ever read the
  // date part, so a caller cannot accidentally pass an instant and get a
  // timezone-shifted day.
  const ymd = String(value).slice(0, 10);
  const d = new Date(ymd + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-MV", { ...opts, timeZone: "UTC" });
}
