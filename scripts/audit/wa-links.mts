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

import { waNumber, whatsappLink, reorderNudge, reorderDrafts } from "../../lib/wa.ts";

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

// THREE drafts, all in "we" (Ali, 2026-08-12: "I need to be able to select a
// message from 3 options. Don't use 'I'. Use 'we'."). Pure logic, so it belongs
// here rather than in a browser audit: the wording rule is a property of the
// text, not of the screen that renders it.
const drafts = reorderDrafts("Ibrahim shailan");
const speaksAsI = (t: string) => /\bI\b|\bI'|\bmy\b/.test(t);
const draftCases: [boolean, string][] = [
  [drafts.length === 3,                                  "three drafts are offered"],
  [new Set(drafts.map((d) => d.text)).size === 3,         "the three are actually DIFFERENT texts, not one three times"],
  [drafts.every((d) => d.text.startsWith("Hi Ibrahim")),  "each opens with the FIRST name only"],
  [!drafts.some((d) => speaksAsI(d.text)),                `no draft speaks as "I" (${drafts.find((d) => speaksAsI(d.text))?.text.slice(0, 50) ?? "none"})`],
  [drafts.some((d) => /\bwe\b/i.test(d.text)),           'the drafts speak as "we"'],
  [drafts.every((d) => d.label.trim() && d.hint.trim()),  "each is labelled and says when to use it"],
];
for (const [ok, why] of draftCases) {
  if (!ok) failed++;
  console.log(`  ${ok ? "\u2713" : "\u2717"} ${why}`);
}
if (!nameOk) failed++;
console.log(`  ${nameOk ? "✓" : "✗"} the draft greets by first name only`);

// Nothing is ever sent without a person tapping send: wa.me only opens a draft.
const draftOnly = (link ?? "").includes("?text=");
if (!draftOnly) failed++;
console.log(`  ${draftOnly ? "✓" : "✗"} the message is a DRAFT (?text=), never auto-sent`);

console.log(failed === 0
  ? `\n✓ WhatsApp links — ${cases.length + draftCases.length + 3} checks passed\n\nAll good.`
  : `\n✗ WhatsApp links — ${failed} check(s) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
