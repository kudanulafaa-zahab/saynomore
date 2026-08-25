// A clearance offer knows who it is for, and what the thing is called.
//
// ── THE STATE OF THE BUSINESS THAT PROMPTED IT ──────────────────────────────
//
// The Promo Advisor lists twelve products holding MVR 32,487 of money that is
// standing still, and every row carried a "Copy post" button writing a caption
// for Facebook, Instagram or Viber. SEVEN OF THE TWELVE are lines Ali has
// discontinued: Royal Soft Boy XL/XXL, Royal Soft Girl L/M/XL, Skin Comfort
// M/XXL.
//
// CLAUDE.md, on those four dropped lines:
//
//     "Paid advertising, education messages and anything aimed at winning a NEW
//      customer must never feature a line that will not be restocked — winning
//      someone for a product about to vanish is worse than not winning them.
//      But a clearance offer to EXISTING customers is exactly right."
//
// Both halves are true of the same product at the same moment, and the only
// thing separating them is WHO IS BEING SPOKEN TO. The Promo Advisor was right
// to list them — that stock is exactly what most needs clearing — and wrong
// about the channel. It could not have been otherwise: `get_promo_suggestions`
// never told the screen which rows were discontinued, so there was nothing to
// be right with. Migration 0211 adds it.
//
// ── AND TWO WORDS THAT WERE WRONG IN PUBLIC ─────────────────────────────────
//
// The caption is the most public text this app produces, and CLAUDE.md's units
// rule covers "anything pasted into a message":
//
//   "1 pieces in every pack."  for the three products whose pack IS one item —
//                              a piece count, and not even grammatical.
//   "MVR 137/pack"             for a Body Shop TUB. `/pack` was a literal.
//
// ── WHY THIS RUNS THROUGH THE CLIPBOARD ─────────────────────────────────────
//
// The caption never appears on screen. It exists only between the tap and the
// paste, so the ONLY way to check what Ali would actually post is to read the
// clipboard after pressing the button — which is what this does.
//
// Usage:  node scripts/audit/clearance-audience.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-tAc", sql], { encoding: "utf8" }).trim();

const list = checklist("A clearance offer knows who it is for, and what the thing is called");

// ── THE FIXTURE NEEDS BOTH KINDS ON THE LIST ──────────────────────────────
// The shared fixture has slow movers but no DISCONTINUED one, so the case that
// matters would not be on screen at all. One model is dropped here — the same
// switch Ali threw on the four real lines: discontinued_at set, everything else
// untouched, because discontinued is not inactive.
// Chosen from the promo list ITSELF rather than by name. The first version
// named a model that is not on the list, so nothing became discontinued and
// every check below tested a screen with no dropped line on it — the fixture
// agreeing with itself.
const dropped = q1(`select m.id
    from get_promo_suggestions() p
    join skus s on s.id = p.sku_id
    join variants v on v.id = s.variant_id
    join product_models m on m.id = v.model_id
   where not p.discontinued
   -- THE FIRST ROW IN DISPLAY ORDER, spelled out. A bare LIMIT 1 returns an
   -- arbitrary row — it handed back the fourth, and the Promo Advisor shows
   -- three and collapses the rest, so every check below was looking for a row
   -- nobody could see. This is the function's own ORDER BY.
   order by case p.reason when 'expiring' then 0 when 'dead' then 1 else 2 end,
            p.stock_value_mvr desc
   limit 1;`);
q(`update product_models set discontinued_at = current_date where id = '${dropped}'::uuid;`);
const restore = `update product_models set discontinued_at = null where id = '${dropped}'::uuid;`;

const counts = q1(`select count(*) filter (where discontinued) || '/' || count(*)
                     from get_promo_suggestions();`);
list.ok(/^[1-9]/.test(counts) && !/^0/.test(counts),
  `the list holds at least one line that is not being restocked (${counts})`);

const b = await launch();
const { ctx, page } = await signedInPage(b, { device: "phone", scheme: "dark" });

try {
  // Clipboard read/write, so the caption can be inspected at all.
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${BASE}/competitors`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  const body = await page.locator("body").innerText();
  list.ok(/Promo advisor/i.test(body), "the Promo Advisor is on screen");

  // ── THE ROW SAYS WHICH KIND IT IS, BEFORE HE TAPS ───────────────────────
  list.ok(/Not restocking/i.test(body),
    "a line he has stopped restocking says so on the row, not after the tap");

  // ── AND THE BUTTON PROMISES THE RIGHT CHANNEL ───────────────────────────
  const msgBtn = page.getByRole("button", { name: /copy message/i }).first();
  list.is(await msgBtn.count(), 1,
    "it offers 'Copy message' — not 'Copy post', which is a public channel");

  await msgBtn.click();
  await page.waitForTimeout(1200);
  const dropText = await page.evaluate(() => navigator.clipboard.readText());

  // ── WHAT HE WOULD ACTUALLY SEND ─────────────────────────────────────────
  list.ok(!/Facebook|Instagram/i.test(dropText),
    "the message for a dropped line names no public channel");
  list.ok(/won't be bringing it in again|last batch/i.test(dropText),
    "it tells the truth: this is the last of it, so nobody is won for a product about to vanish");
  list.ok(!/\bpieces\b/i.test(dropText),
    `and it counts nothing in pieces (${dropText.replace(/\n/g, " / ").slice(0, 110)})`);
  list.ok(!/\b1 in every\b/i.test(dropText),
    "and never says '1 in every ...' for a product that IS one of the thing");

  // ── THE KEPT LINES ARE UNCHANGED, WHICH IS HALF THE POINT ───────────────
  // A guard that silenced every promo would be worse than the bug: clearing
  // stock is the job, and a line he still restocks is genuinely fine to post.
  const postBtn = page.getByRole("button", { name: /copy post/i }).first();
  list.ok(await postBtn.count() > 0,
    "a line he still restocks keeps its public post — the clearance itself is not the problem");

  await postBtn.click();
  await page.waitForTimeout(1200);
  const keptText = await page.evaluate(() => navigator.clipboard.readText());
  list.ok(/WhatsApp|Viber/i.test(keptText), "that one still invites an order");
  list.ok(!/\bpieces\b/i.test(keptText),
    `and it counts nothing in pieces either (${keptText.replace(/\n/g, " / ").slice(0, 110)})`);

  // THE PRICE IS QUOTED IN THE PRODUCT'S OWN WORD. `/pack` used to be a
  // literal, so a TUB of body butter was offered "MVR 137/pack". Asked of the
  // database rather than hardcoded here: whatever noun it reports for the row
  // the button belongs to is the noun the caption has to use — a check that
  // spelled the word itself would pass a screen that had simply been changed
  // to a different wrong literal.
  const firstKept = q1(`select promo_pack_mvr || '|' || unit_noun
                          from get_promo_suggestions()
                         where not discontinued
                         order by case reason when 'expiring' then 0
                                              when 'dead' then 1 else 2 end,
                                  stock_value_mvr desc
                         limit 1;`);
  const [kPrice, kNoun] = firstKept.split("|");
  list.ok(keptText.includes(`/${kNoun}`),
    `the price is quoted per ${kNoun}, the word this product actually uses (looked for "/${kNoun}")`);
  list.ok(keptText.includes(kPrice.replace(/\.00$/, "")),
    `and it is the promo price the engine computed, not a number the screen invented (${kPrice})`);

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}
await ctx.close(); await b.close();

// Teardown REPORTED, never allowed to swallow the run: a discontinued flag left
// behind would change what every audit after this one sees.
try {
  q(restore);
} catch (e) {
  list.ok(false, `cleanup left a product discontinued: ${String(e).split("\n")[0].slice(0, 150)}`);
}

finish(list.report());
