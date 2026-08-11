/**
 * WhatsApp deep links for customer follow-up.
 *
 * WHY THIS EXISTS
 *
 * Every order in this business arrives through a chat app — facebook,
 * instagram, messenger, viber, whatsapp are the only channels on record. The
 * app knows which customers have run out of what they bought, and until now
 * that knowledge ended on a screen: to act on it Ali had to read a name, find
 * the person in WhatsApp, and start a message. That friction is why follow-ups
 * do not happen, and 52 of 73 customers have never bought twice.
 *
 * A link removes the friction without removing the judgement: wa.me opens the
 * chat with a DRAFT. Nothing is sent until he taps send, and he can edit every
 * word first. An app that messages customers by itself would be a worse
 * product and a worse relationship — these are people he sells to personally.
 *
 * PHONE NUMBERS: GUESSING IS NOT ALLOWED
 *
 * wa.me needs a full international number with no punctuation. Maldives
 * numbers are stored here as 7 local digits (73 of 74 customers), with one
 * already carrying "+960". So:
 *
 *   7 digits          -> prefix 960          (a Maldives mobile)
 *   960 + 7 digits    -> use as-is
 *   anything else     -> NO LINK
 *
 * That last branch is the important one. A wrong number does not fail
 * silently — it opens a chat with a stranger and sends them a message meant
 * for a customer. When the shape is not recognised the row simply renders
 * without a button, which is a small inconvenience instead of an embarrassing
 * message to the wrong person.
 */

/** Maldives country code. Numbers are stored locally without it. */
const MV = "960";

/**
 * Full international number for wa.me, or null when the stored value is not a
 * shape we recognise. Null means "do not offer the link" — never "guess".
 */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (/^\d{7}$/.test(digits)) return MV + digits;          // local mobile
  if (/^960\d{7}$/.test(digits)) return digits;            // already qualified
  return null;                                             // unknown shape
}

/**
 * A wa.me link that opens the chat with `message` as an editable draft.
 * Returns null when the number cannot be trusted (see waNumber).
 */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const n = waNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}

/**
 * The opening line for a "you have probably run out" nudge.
 *
 * Deliberately short, warm and non-specific about the product: he sells
 * diapers, detergent and cleaning liquid, and a message that assumes a baby
 * would be wrong for some customers. It is a conversation opener, not a sales
 * script — he edits it before sending, and the point is to make starting the
 * conversation take one tap instead of five.
 *
 * First name only: "Hi Ibrahim shailan" reads like a form letter, which is the
 * opposite of how this business actually talks to people.
 */
export function reorderNudge(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] || fullName.trim();
  return `Hi ${first}, hope you're well! Just checking if you're running low — I can deliver today.`;
}
