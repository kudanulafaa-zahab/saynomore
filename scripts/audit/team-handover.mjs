// A new team member can actually be told how to get in.
//
// Ali, 2026-08-29:
//   *"when I add a new user as a viewer they don't get an email invitation"*
//
// ── NO EMAIL IS SENT, AND THAT IS DELIBERATE ───────────────────────────────
//
// /api/admin/invite-user calls createUser with email_confirm: true. The
// account exists immediately with the password Ali typed, and no link is ever
// mailed — chosen so there is no email to bounce, land in spam, or hit a send
// limit for the three or four people a year he adds.
//
// ── WHAT WAS ACTUALLY BROKEN WAS THE TELLING ───────────────────────────────
//
// The screen SAID "They will receive an email to set their password", which
// was untrue, and the dialog closed on save — so the password only ever
// existed in the field he had just typed it into. The account worked and
// nobody could get into it. A viewer sat waiting for an invitation that was
// never coming.
//
// So this asserts the two halves that make the account reachable: the screen
// never promises an email, and after saving it shows the address, the email
// and the password with a way to send them.
//
// Usage:  node scripts/audit/team-handover.mjs

import { execFileSync } from "node:child_process";
import { launch, signedInPage, checklist, finish, BASE } from "./lib.mjs";

const DB = process.env.AUDIT_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const host = (() => { try { return new URL(DB).hostname; } catch { return null; } })();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? "")) {
  console.error(`REFUSING: AUDIT_DB_URL points at "${host ?? DB}", which is not local.`);
  console.error("This audit creates a login.");
  process.exit(2);
}
const q  = (sql) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { encoding: "utf8" });
const q1 = (sql) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { encoding: "utf8" }).trim();

const EMAIL = "audit-viewer@example.test";
const PW    = "Watcher-4821";

// Auth rows cascade to user_profiles; deleting the auth user is enough, and
// leaving one behind would make the next run fail on a duplicate email.
q(`delete from auth.users where email = '${EMAIL}';`);

const list = checklist("Team hand-over — a new member can be told how to get in");

const browser = await launch();
const { ctx, page } = await signedInPage(browser, { device: "phone", scheme: "dark" });

try {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // ── 1. THE SCREEN MUST NOT PROMISE AN EMAIL ─────────────────────────────
  // The whole reason he waited. One stale sentence, and the account it
  // described was working the entire time.
  const settings = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(!/receive an email/i.test(settings),
    "the team section never promises an email that is not sent");

  // "Add member" / "Add first member". It used to say "Invite", which is the
  // last word on this screen implying something gets sent.
  const add = page.getByRole("button", { name: /add (first )?member/i }).first();
  list.ok(await add.count() > 0, "there is a way to add a team member");
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await page.waitForTimeout(1200);

  const dialog = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(/nothing is emailed/i.test(dialog),
    "and the dialog says plainly that nothing is emailed");

  // ── 2. ADD A VIEWER — the exact role he used ────────────────────────────
  await page.getByLabel(/full name/i).first().fill("Audit Viewer");
  await page.getByLabel(/email/i).first().fill(EMAIL);
  await page.getByLabel(/temporary password/i).first().fill(PW);

  // The role control is a shadcn Select, not a native one: open it, pick.
  await page.getByRole("combobox").first().click();
  await page.waitForTimeout(600);
  await page.getByRole("option", { name: /viewer/i }).first().click();
  await page.waitForTimeout(400);

  // Scoped to the dialog: the trigger behind it carries the same words, and an
  // unscoped .first() would click the button that opened this form.
  await page.getByRole("dialog").getByRole("button", { name: /^add member$/i }).first().click();
  await page.waitForTimeout(4000);

  // ── 3. THE ACCOUNT IS REAL, AND IT IS A VIEWER ──────────────────────────
  list.is(q1(`select count(*)::text from auth.users where email = '${EMAIL}';`), "1",
    "the account exists straight away -- no link to click, nothing pending");
  list.is(q1(`select p.role from user_profiles p join auth.users u on u.id = p.id
              where u.email = '${EMAIL}';`), "viewer",
    "with the role that was chosen");
  // email_confirm: true is the point -- an unconfirmed account cannot sign in,
  // and there is no email coming to confirm it with.
  list.ok(q1(`select (email_confirmed_at is not null)::text from auth.users
              where email = '${EMAIL}';`) === "t",
    "and already confirmed, so they can sign in without an email they will never get");

  // ── 4. AND HE IS GIVEN SOMETHING TO SEND ────────────────────────────────
  // The half that was missing. Without this the dialog closed on save and the
  // password was gone -- a working account nobody could get into.
  const handover = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  list.ok(/their login|send .* their login/i.test(handover),
    "the dialog stays open and offers the login to send");
  list.ok(handover.includes(EMAIL), "showing the email address");
  list.ok(handover.includes(PW),
    "and the password -- the only time it is ever shown, because nothing is emailed");
  list.ok(/localhost|https?:\/\//.test(handover),
    "with the address of the app itself, read from the browser rather than hardcoded");
  list.ok(await page.getByRole("button", { name: /copy login/i }).count() > 0,
    "and one tap to copy the lot, ready to paste into WhatsApp");

  list.is(page.errors.length, 0, `no page errors (${page.errors.slice(0, 2).join(" | ")})`);
} catch (e) {
  list.ok(false, `flow failed: ${String(e).split("\n")[0].slice(0, 190)}`);
}

await ctx.close();
await browser.close();

q(`delete from auth.users where email = '${EMAIL}';`);
finish(list.report());
