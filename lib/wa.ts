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

/** First name only: "Hi Ibrahim shailan" reads like a form letter, which is the
 *  opposite of how this business actually talks to people. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}

/**
 * THREE drafts to choose from, not one.
 *
 * Ali, 2026-08-12: *"I need to be able to select a message from 3 options.
 * Don't use 'I'. Use 'we'."*
 *
 * WHY THREE. A single canned line is a form letter, and a form letter sent to
 * the same customer twice is worse than no message at all — these are people he
 * sells to personally through WhatsApp and Instagram, and the whole business is
 * built on that relationship. Three drafts covering three different situations
 * let him pick the one that fits the person, which is what a human would do.
 * They are deliberately different in KIND, not three rewordings of one idea:
 *
 *   check-in  — no offer at all. For a customer he does not want to push.
 *   deliver   — a concrete offer with timing. The one that converts.
 *   same      — "the usual again?". Lowest friction of the three: the customer
 *               answers yes instead of composing an order, which is the single
 *               biggest reason a repeat purchase does not happen.
 *
 * WHY "WE". Ali's instruction, and it is right for a reason worth recording:
 * "I can deliver today" is a favour from one person, and it makes the business
 * sound like one man with a scooter. "We can deliver today" is a company
 * keeping a promise — the same words his customers hear from every other
 * supplier they buy from. It also stays true when a driver makes the delivery,
 * which is what actually happens.
 *
 * All three stay non-specific about the product. He sells diapers, detergent
 * and cleaning liquid, and a message that assumes a baby would be wrong for
 * some customers.
 *
 * Nothing sends by itself. wa.me opens the chat with the chosen draft in the
 * box, and he edits and sends. An app that messaged customers on its own would
 * be a worse product and a worse relationship.
 */
export interface ReorderDraft {
  /** Short label for the picker — what SITUATION this message is for. */
  key: "check-in" | "deliver" | "same";
  label: string;
  /** One line telling him when to pick this one. */
  hint: string;
  text: string;
}

export function reorderDrafts(fullName: string): ReorderDraft[] {
  const first = firstName(fullName);
  return [
    {
      key: "check-in",
      label: "Just checking in",
      hint: "No pressure — opens the conversation",
      text: `Hi ${first}, hope you're doing well! Just checking if you're running low on anything.`,
    },
    {
      key: "deliver",
      label: "Offer delivery",
      hint: "A clear offer with a time",
      text: `Hi ${first}, hope you're well! If you're running low we can deliver today — just let us know.`,
    },
    {
      key: "same",
      label: "Same as last time",
      hint: "Easiest to say yes to",
      text: `Hi ${first}! Would you like the same as last time? We can send it over today if that works.`,
    },
  ];
}

/**
 * The default draft, for anywhere that needs one line without a picker.
 * Kept as the "offer delivery" wording — the one that actually converts.
 */
export function reorderNudge(fullName: string): string {
  return reorderDrafts(fullName)[1].text;
}
