// Offline audit — does a sale survive losing signal?
//
// This is the failure mode that costs real money and makes no noise. It has
// happened here before: an offline sync bug once meant real cash was recorded
// and silently never saved, and nobody knew until the numbers disagreed.
//
// SayNoMore is an installed PWA used around the Maldives. Signal drops. When it
// does, `withOfflineFallback` puts the write in an IndexedDB queue and
// `drainQueue` replays it on reconnect. That machinery is correct-looking and,
// until this file, entirely unverified since it was written.
//
// So this drives the real thing: record a sale with the network CUT, confirm
// the app queued it rather than losing it or claiming success, restore the
// network, and confirm the queue empties and the order exists.
//
// It is separate from journey.mjs on purpose — it manipulates the browser's
// network state, and a failure here means something very different from a
// layout problem.
//
// Usage:  node scripts/audit/offline.mjs

import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const browser = await launch();
const list = checklist("Offline — a sale survives losing signal");
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "dark" });

// Everything below runs inside a try. When the offline queue is broken the app
// does not error — it just quietly does nothing, the sheet stays open, and the
// next click lands on a covered element. Left unguarded that surfaces as a
// Playwright stack trace, which tells the reader nothing about what broke.
// Verified by deliberately dropping offline writes: without this the run ends
// in "intercepts pointer events"; with it, it says the sale was not queued.
try {

async function pending() {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("saynomore-offline", 1);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("pending_writes")) return resolve(0);
      const tx = db.transaction("pending_writes", "readonly");
      const c = tx.objectStore("pending_writes").count();
      c.onsuccess = () => resolve(c.result);
      c.onerror = () => resolve(-1);
    };
    req.onerror = () => resolve(-1);
  }));
}

async function noSheet() {
  await page.waitForFunction(
    () => document.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-label="New sale"])').length === 0,
    null, { timeout: 15_000 });
  await page.waitForTimeout(250);
}

// ── Build a complete, valid order while ONLINE ─────────────────────────────
await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /new sale/i }).first().click();
// Scoped to the sheet — see the note in journey.mjs.
const newSale = page.getByRole("dialog", { name: /new sale/i });
await newSale.getByText("Ahmed Ziyad").first().click();
await page.getByRole("button", { name: /add products/i }).first().click();
await page.waitForTimeout(1500);
await page.locator("select").first().selectOption({ label: "Veesange" });
await page.waitForTimeout(1500);

await page.locator("button", { hasText: "Sosoft" }).first().click();
await page.waitForTimeout(900);
const sheet = page.getByRole("dialog", { name: /add to sale/i });
for (const c of ["Blue", "Blue", "Pink", "Pink", "Purple", "Red"]) {
  await sheet.getByRole("button", { name: `One more ${c}` }).click();
  await page.waitForTimeout(110);
}
await sheet.getByRole("button", { name: /add .*mixed carton/i }).first().click();
await noSheet();

await page.getByRole("button", { name: /review & confirm/i }).first().click();
await page.waitForTimeout(1200);

list.is(await pending(), 0, "the queue starts empty");

// ── Cut the network, then place the order ──────────────────────────────────
await ctx.setOffline(true);
await page.waitForTimeout(600);

await page.getByRole("button", { name: /place order/i }).first().click();
await page.waitForTimeout(4000);

const queued = await pending();
list.ok(queued >= 1, `the sale was QUEUED rather than lost (queue holds ${queued})`);

// The screen must say so. A sale that silently "succeeded" while offline is
// worse than an error: Ali would believe the stock had moved.
const offlineText = (await page.locator("body").innerText()).toLowerCase();
list.ok(/offline|saved|sync|queue|no (internet|connection|signal)/.test(offlineText),
  "the screen tells the user it is not live yet");

// ── Restore the network and let it drain ───────────────────────────────────
await ctx.setOffline(false);
await page.waitForTimeout(1000);
// The app drains on the browser's `online` event; fire it explicitly because
// Playwright's setOffline does not always emit one.
await page.evaluate(() => window.dispatchEvent(new Event("online")));

let drained = -1;
for (let i = 0; i < 30; i++) {
  drained = await pending();
  if (drained === 0) break;
  await page.waitForTimeout(1000);
}
list.is(drained, 0, `the queue drained once the signal came back (still holding ${drained})`);

// ── And the order is really there ──────────────────────────────────────────
await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const orders = await page.locator("body").innerText();
list.ok(/SO-\d{4}-\d+/.test(orders), "an order number is on the sales list afterwards");
list.is(page.errors.length, 0, `no uncaught page errors (${page.errors.slice(0, 2).join(" | ")})`);

} catch (err) {
  list.ok(false,
    `the offline flow did not complete: ${String(err).split("\n")[0].slice(0, 160)}\n` +
    "        (a broken queue usually shows up here — the app does nothing, the sheet\n" +
    "         stays open, and the next step has nothing to click)");
}

await ctx.close();
await browser.close();
finish(list.report());
