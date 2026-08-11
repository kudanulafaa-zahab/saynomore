// WhatsApp link safety — the one check where a bug messages a stranger.
//
// The dashboard offers a one-tap "Message" button for customers who have run
// out. It builds a wa.me link from the phone number on the customer record.
// Maldives numbers are stored as 7 local digits (73 of 74 customers), one
// already carries "+960", and nothing validates what gets typed in.
//
// A wrong number does not fail visibly. It opens a chat with SOMEBODY ELSE and
// hands them a message meant for a customer. So the rule is: recognise the two
// known shapes, and refuse everything else — no link, no button, no guess.
//
// Pure logic, no browser and no database, so it runs in a second and goes
// first in CI.
//
// Usage:  npm run audit:wa

import { waNumber, whatsappLink, reorderNudge } from "../../lib/wa.ts";

const cases: [string | null, string | null, string][] = [
  ["7772367",      "9607772367", "plain 7-digit local mobile gets 960"],
  ["+9607875150",  "9607875150", "already-qualified number is kept as-is"],
  ["960 787 5150", "9607875150", "spaces are stripped"],
  ["777-2367",     "9607772367", "dashes are stripped"],
  [null,            null,        "no phone -> no link"],
  ["",              null,        "empty -> no link"],
  ["123",           null,        "too short -> NO GUESS"],
  ["12345678",      null,        "8 digits, unknown shape -> NO GUESS"],
  ["447700900000",  null,        "a foreign number -> NO GUESS"],
  ["abc",           null,        "junk -> no link"],
];

let failed = 0;
for (const [input, expected, why] of cases) {
  const got = waNumber(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${why}  (${JSON.stringify(input)} -> ${JSON.stringify(got)})`);
}

const link = whatsappLink("7772367", reorderNudge("Ibrahim shailan"));
const shapeOk = link?.startsWith("https://wa.me/9607772367?text=") ?? false;
if (!shapeOk) failed++;
console.log(`  ${shapeOk ? "✓" : "✗"} the link points at wa.me with the qualified number`);

// First name only: "Hi Ibrahim shailan" reads like a form letter, which is the
// opposite of how this business talks to people.
const nameOk = reorderNudge("Ibrahim shailan").startsWith("Hi Ibrahim,");
if (!nameOk) failed++;
console.log(`  ${nameOk ? "✓" : "✗"} the draft greets by first name only`);

// Nothing is ever sent without a person tapping send: wa.me only opens a draft.
const draftOnly = (link ?? "").includes("?text=");
if (!draftOnly) failed++;
console.log(`  ${draftOnly ? "✓" : "✗"} the message is a DRAFT (?text=), never auto-sent`);

console.log(failed === 0
  ? `\n✓ WhatsApp links — ${cases.length + 3} checks passed\n\nAll good.`
  : `\n✗ WhatsApp links — ${failed} check(s) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
