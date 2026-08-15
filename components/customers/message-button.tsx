"use client";

/**
 * MessageButton — the ONE way this app offers to message a customer.
 *
 * Ali, 2026-08-12: *"The message feature you built is good. But I need to be
 * able to select a message from 3 options. Don't use 'I'. Use 'we'."*
 *
 * Tapping it opens a picker with three drafts (see `reorderDrafts` in
 * lib/wa.ts — the reasoning for three, and for "we", lives there). Choosing one
 * opens WhatsApp with that text already in the box. Nothing is sent by the app;
 * he reads it, edits it, and presses send himself.
 *
 * It is a component rather than two copies because the same button belongs in
 * two places — the dashboard card and the Customers "At risk" lens — and the
 * last time a pattern was copy-pasted across screens (the card recipe, the unit
 * noun) the copies drifted and the drift was invisible until Ali hit it. One
 * file, both callers.
 *
 * NO LINK WITHOUT A NUMBER WE TRUST. `whatsappLink` returns null when the
 * stored phone is not a shape we recognise, and then this renders nothing. A
 * missing button is a small inconvenience; a guessed number opens a chat with a
 * stranger and hands them a message meant for a customer.
 */

import { useState } from "react";
import { MessageCircle, Check } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { whatsappLink, reorderDrafts, waNumber, type ReorderDraft } from "@/lib/wa";
import { haptic } from "@/lib/haptics";

export function MessageButton({
  name,
  phone,
  /** "solid" for the primary row action, "quiet" inside a dense list. */
  tone = "solid",
  /**
   * Which three drafts to offer. Defaults to the reorder nudge.
   *
   * This is a PROP rather than a second component because the difference
   * between "are you running low?" and "we've changed the range" is the
   * sentences, not the interaction — the picker, the three-draft rule, the
   * "we" wording, the no-number guard and the never-send-it-ourselves promise
   * are all identical. The last time a pattern was copied across screens the
   * copies drifted invisibly, so the words vary and nothing else does.
   */
  drafts: providedDrafts,
  /** Overrides the button caption when the message is not a reorder nudge. */
  label = "Message",
}: {
  name: string;
  phone: string | null | undefined;
  tone?: "solid" | "quiet";
  drafts?: ReorderDraft[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  // Decided BEFORE anything renders: no trusted number, no button at all.
  if (!waNumber(phone)) return null;

  const drafts = providedDrafts ?? reorderDrafts(name);

  return (
    <>
      <button
        type="button"
        onClick={() => { haptic("light"); setOpen(true); }}
        aria-label={`Message ${name} on WhatsApp`}
        className="shrink-0 flex items-center gap-1.5 h-11 px-3.5 rounded-xl ios-subhead font-semibold snm-pressable"
        style={
          tone === "solid"
            ? { background: "var(--foreground)", color: "var(--background)" }
            : { background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }
        }
      >
        <MessageCircle className="h-4 w-4" />
        {label}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} variant="auto" maxWidth="max-w-md">
        <div>
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Message {name.trim().split(/\s+/)[0]}
          </p>
          {/* --foreground, not muted: this line has to be read, and it sits on
              a sheet where muted measures under the 4.5:1 floor. */}
          <p className="ios-subhead mt-1" style={{ color: "var(--foreground)", opacity: 0.8 }}>
            Pick one. It opens WhatsApp with the text ready — nothing sends until you press send.
          </p>
        </div>

        <div className="space-y-2">
          {drafts.map((d) => (
            <a
              key={d.key}
              href={whatsappLink(phone, d.text) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { haptic("success"); setOpen(false); }}
              className="block rounded-2xl px-4 py-3 snm-pressable"
              style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
                  {d.label}
                </p>
                <span className="shrink-0 flex items-center gap-1 ios-footnote" style={{ color: "var(--muted-foreground)" }}>
                  {d.hint}
                  <Check className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="ios-footnote mt-1.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                {d.text}
              </p>
            </a>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full h-12 rounded-xl ios-subhead font-semibold snm-pressable"
          style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
        >
          Cancel
        </button>
      </Sheet>
    </>
  );
}
