// Money on screen, formatted in exactly one place.
//
// ── THE REQUIREMENT, WRITTEN BEFORE THE CODE ───────────────────────────────
//
// R1  No money figure in this app renders as "0" or "NaN" when the underlying
//     value is MISSING. A missing figure reads "—".
//
//     AC1  For any real number, output is byte-identical to what each private
//          helper produced before, on a Maldives or English device.
//     AC2  null, undefined and NaN all render "—".
//     AC3  One implementation. No component declares its own.
//     AC4  A gate check fails if a private money formatter is reintroduced.
//
// ── WHY, WITH THE MEASUREMENTS ─────────────────────────────────────────────
//
// Twenty-seven private formatters existed across thirty files — `fmt`, `fmt0`,
// `fmt2`, `fmtMvr`, `fmtMoney`, `fmtShort`, `fmtInt` — every one taking a bare
// `number`. Measured against the values the app actually hands them:
//
//     fmt0(null)       ->  "0"      a missing figure displayed as MVR 0
//     fmt0(undefined)  ->  "NaN"    shown to the user, on screen
//     fmt0(NaN)        ->  "NaN"
//
// "0" is the dangerous one. A price Ali could read, sanity-check and act on,
// where the truth is "we do not know this number". The same class crashed the
// Pricing Tool outright when the value reached `.toLocaleString` on a null —
// that one at least failed loudly.
//
// LOCALE was split down the middle: seventeen files formatted money in
// `undefined` locale — meaning the VIEWER'S PHONE decides how a number reads —
// and seventeen forced "en-MV", with three files doing both. Measured:
//
//     undefined / en-MV / en-US / en-GB / dv-MV     1,234,567.89
//     ar-EG                                         ١٬٢٣٤٬٥٦٧٫٨٩
//     de-DE                                         1.234.567,89
//     hi-IN                                         12,34,567.89
//
// So on Ali's own phone there is no visible difference, and this is a
// correctness fix rather than a bug he has been living with. Said plainly
// because it would be easy to dress it up as bigger than it is.
//
// ── TWO DELIBERATE BEHAVIOUR CHANGES, BOTH FIXES ───────────────────────────
//
// The abbreviating helpers disagreed with each other, and mvrShort adopts the
// correct behaviour of the best of them rather than the average:
//
//   1. Expenses abbreviated only thousands, so MVR 2,500,000 read "2500.0K".
//      It now reads "2.5M", like everywhere else.
//   2. Most compared `n >= 1000` on the SIGNED value, so a negative never
//      abbreviated: -2,500,000 read "-2500000" in full. The threshold is now on
//      the magnitude, which is what one of the five already did.
//
// Anything below the thousand mark is grouped rather than truncated, so a
// figure never silently loses its separators at the boundary.

/** The locale money is written in, everywhere, regardless of the device. */
const LOCALE = "en-MV";

/** What a figure reads when the value is genuinely absent. An em dash, not a
 *  zero: "we do not know" and "it is nothing" are different facts, and only one
 *  of them is safe to price against. */
export const NO_VALUE = "—";

/** What every helper here accepts. STRING IS DELIBERATE and not laziness:
 *  Postgres `numeric` arrives through PostgREST as a JSON string to avoid
 *  float precision loss, so a money column reaches a component as "1234.50".
 *  Nine of the private helpers this module replaces wrapped their argument in
 *  `Number(n)` for exactly that reason — a module that only took `number`
 *  would have turned every one of those real figures into "—", which is a
 *  worse bug than the one being fixed. */
export type Money = number | string | null | undefined;

/** Coerce to a showable number, or null if there is nothing to show. Catches
 *  null and undefined together (`== null`), rejects NaN and ±Infinity via
 *  isFinite — an Infinity arrives here from a division by a zero pack size,
 *  and "∞" on a price is no more useful than "NaN" — and rejects the empty
 *  string, which `Number("")` would otherwise turn into a confident 0. */
function toNumber(n: Money): number | null {
  if (n == null) return null;
  if (typeof n === "string" && n.trim() === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Grouped money at a fixed number of decimals. The workhorse — twelve of the
 *  twenty-seven private helpers were exactly this at 0dp, and two at 2dp. */
export function mvr(n: Money, decimals = 0): string {
  const v = toNumber(n);
  if (v === null) return NO_VALUE;
  return v.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Grouped money at two decimals — the same call, named for the common case so
 *  a reader does not have to know that `2` means money-with-laari. */
export function mvr2(n: Money): string {
  return mvr(n, 2);
}

/** Grouped, at MOST `max` decimals, trailing zeros dropped.
 *
 *  This exists because `mvr2` is not a drop-in for every two-decimal call.
 *  `{ maximumFractionDigits: 2 }` with no minimum prints 1,234.5 — while
 *  `mvr2` forces 1,234.50. Those are different text on Ali's screen, so a
 *  find-and-replace across the inline calls would have silently changed real
 *  figures. Counted before writing this: nine calls use max-2-no-minimum and
 *  sixteen are a bare `toLocaleString()`, which is max 3 by definition.
 *
 *  Use it only to PRESERVE an existing display. For anything new, money is
 *  either whole rufiyaa (`mvr`) or rufiyaa and laari (`mvr2`) — a price that
 *  sometimes shows one decimal and sometimes two is a column that will not
 *  line up. */
export function mvrUpTo(n: Money, max: number): string {
  const v = toNumber(n);
  if (v === null) return NO_VALUE;
  return v.toLocaleString(LOCALE, { maximumFractionDigits: max });
}

/** A COUNT, not money — cartons, pieces, customers, batches. Same grouping and
 *  the same "—" for a missing value, but named for what it is so a reader is
 *  not told that a carton count is rufiyaa. Grouped at up to 3 decimals because
 *  that is what a bare toLocaleString() did at the call sites this replaces,
 *  and a part-carton is a real thing this app displays. */
export function count(n: Money): string {
  return mvrUpTo(n, 3);
}

/** Abbreviated for a tile or a chart axis, where the full figure would not fit.
 *  Never use it where the exact number is the point — a price, an invoice line,
 *  anything Ali types against. */
export function mvrShort(n: Money): string {
  const v = toNumber(n);
  if (v === null) return NO_VALUE;
  const magnitude = Math.abs(v);
  if (magnitude >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return mvr(v);
}

/** Rounded UP, then grouped. Used where a part unit still costs a whole one —
 *  cartons to order, for instance, where 2.1 cartons means buying 3. */
export function mvrCeil(n: Money): string {
  const v = toNumber(n);
  if (v === null) return NO_VALUE;
  return mvr(Math.ceil(v));
}
