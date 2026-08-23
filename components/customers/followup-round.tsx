"use client";

/**
 * Follow-ups — the people worth a message today, all of them, on one screen.
 *
 * WHY THIS IS A LIST AND NOT A ONE-AT-A-TIME QUEUE. It was a queue for about an
 * hour. Ali, 2026-08-20: *"There's no way if I refuse to send message it
 * disappears and moves to next customer. I only can see each customer after I
 * choose or refuse. It's terrible."*
 *
 * He is right and the mistake was mine. A queue is the correct shape for work
 * that is identical and interchangeable — a stack of invoices to approve. These
 * are PEOPLE, and he knows things about them the app never will: who he spoke
 * to yesterday, who is travelling, who is annoyed with him. Deciding requires
 * seeing them together, and a design that hides the next name until the current
 * one is dealt with takes his own judgement away and calls it focus.
 *
 * What survives from the queue idea, because it was the useful half:
 *
 *   IT REMEMBERS. Send or skip, both logged (0188), so nobody is chased twice
 *   in a week. Without that this is a nag, and a nag is ignored inside a
 *   fortnight — which is how the old "Worth a call" briefing line died.
 *
 *   IT CAN BE ASKED WHETHER IT WORKED. The footer shows what the last 30 days
 *   of messages actually produced.
 *
 * NOTHING DISAPPEARS. A handled row stays where it is, marked, because a row
 * that vanishes when you touch it gives you no way to check what you just did.
 *
 * NOTHING IS SENT BY THE APP. Every draft opens WhatsApp with the text in the
 * box; he reads it, edits it, presses send.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Check, Undo2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { MessageButton } from "@/components/customers/message-button";
import { reorderDrafts, switchDrafts, type ReorderDraft } from "@/lib/wa";
import { haptic } from "@/lib/haptics";
import {
  logFollowup, type FollowupCandidate, type FollowupResults,
} from "@/lib/queries/followups";

import { mvr } from "@/lib/money";

function reasonLine(c: FollowupCandidate): string {
  if (c.reason === "stranded") {
    return `Nothing left to reorder · last ordered ${c.days_since_last} days ago`;
  }
  if (c.reason === "rhythm") {
    return `Later than they usually order · ${c.days_since_last} days ago`;
  }
  return `Probably out · last ordered ${c.days_since_last} days ago`;
}

/** A stranded customer's message NAMES the replacement and its size — "are you
 *  running low?" invites them to ask for a thing we will not have.
 *
 *  The size comes from `swap_size` and NOT from the label: 0189 took it out of
 *  `swap_label` because passing both printed "Xtra Kering M in M" in a message
 *  to a customer. */
function draftsFor(c: FollowupCandidate): ReorderDraft[] {
  return c.reason === "stranded" && c.swap_label
    ? switchDrafts(c.name, c.swap_label, c.swap_size)
    : reorderDrafts(c.name);
}

type Handled = Record<string, "sent" | "skipped">;

function FollowupRow({
  c, state, onRecord,
}: {
  c: FollowupCandidate;
  state: "sent" | "skipped" | undefined;
  onRecord: (outcome: "sent" | "skipped", draftKey?: string) => void;
}) {
  const done = state != null;
  return (
    <div
      className="rounded-2xl px-4 py-3"
      style={{
        background: "var(--glass-bg-1)",
        border: "0.5px solid var(--glass-border-lo)",
        // Marked, not removed. A row that disappears when touched leaves no way
        // to see what you just did.
        opacity: done ? 0.55 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
            {c.name}
          </p>
          {/* --foreground at 0.8, never muted: this is the reason he is being
              asked to act, and muted on a --glass-2 sheet measures under 4.5:1. */}
          <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.8 }}>
            {reasonLine(c)}
          </p>
          {c.avg_order_mvr > 0 && (
            <p className="ios-footnote snm-num font-semibold mt-0.5" style={{ color: "var(--foreground)" }}>
              Usually MVR {mvr(c.avg_order_mvr)} an order
            </p>
          )}
          {c.reason === "stranded" && c.swap_label && (
            <p className="ios-footnote mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
              Offer {c.swap_label}{c.swap_size ? ` in ${c.swap_size}` : ""}
            </p>
          )}
        </div>

        {done ? (
          <span className="shrink-0 flex items-center gap-1.5 ios-footnote font-semibold"
            style={{ color: state === "sent" ? "var(--snm-success)" : "var(--muted-foreground)" }}>
            <Check className="h-4 w-4" />
            {state === "sent" ? "Messaged" : "Not today"}
          </span>
        ) : (
          <div className="shrink-0 flex items-center gap-2">
            {/* The ONE message component, given the right words for this person
                and told which draft was picked so it can be recorded. */}
            <MessageButton
              name={c.name}
              phone={c.phone}
              tone="quiet"
              drafts={draftsFor(c)}
              onPick={(key) => onRecord("sent", key)}
            />
            <button
              type="button"
              onClick={() => { haptic("light"); onRecord("skipped"); }}
              aria-label={`Not today for ${c.name}`}
              className="h-11 w-11 rounded-xl flex items-center justify-center snm-pressable"
              style={{ background: "var(--glass-bg-2)", color: "var(--muted-foreground)" }}
            >
              <Undo2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FollowupSheet({
  queue, results, open, onClose,
}: {
  queue: FollowupCandidate[];
  results: FollowupResults | null;
  open: boolean;
  onClose: () => void;
}) {
  const [handled, setHandled] = useState<Handled>({});

  const record = useCallback(async (
    c: FollowupCandidate, outcome: "sent" | "skipped", draftKey?: string,
  ) => {
    // Marked immediately. The write is confirmation, not permission — waiting
    // on a round trip before the row responds makes a fast tap feel broken.
    setHandled((h) => ({ ...h, [c.customer_id]: outcome }));
    try {
      await logFollowup(c.customer_id, c.reason, outcome, draftKey);
    } catch {
      // A failed log must not swallow the message he is about to send. Worst
      // case the person appears again tomorrow, which is recoverable.
    }
  }, []);

  const left = queue.filter((c) => !handled[c.customer_id]).length;

  return (
    <Sheet open={open} onClose={onClose} variant="auto" maxWidth="max-w-md">
      <div>
        <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Follow up
        </p>
        <p className="ios-subhead mt-1" style={{ color: "var(--foreground)", opacity: 0.8 }}>
          {left > 0
            ? `${left} customer${left === 1 ? "" : "s"} worth a message. Nobody here has been contacted this week.`
            : "All done for today."}
        </p>
      </div>

      {/* The whole list, in one place, in the order that puts the most money
          first. He decides who — the app only says who is due. */}
      <div className="space-y-2">
        {queue.map((c) => (
          <FollowupRow
            key={c.customer_id}
            c={c}
            state={handled[c.customer_id]}
            onRecord={(outcome, draftKey) => void record(c, outcome, draftKey)}
          />
        ))}
      </div>

      {/* THE ANSWER TO "DID THIS WORK". The point of the round is to be
          answerable, not to feel busy. */}
      {results && results.sent_count > 0 && (
        <div className="rounded-2xl px-4 py-3"
          style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
          <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Last 30 days
          </p>
          <p className="ios-subhead snm-num mt-1" style={{ color: "var(--foreground)" }}>
            Messaged {results.sent_count}, {results.ordered_count} came back
            {results.revenue_mvr > 0 ? ` — MVR ${mvr(results.revenue_mvr)}` : ""}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full h-12 rounded-xl ios-subhead font-semibold snm-pressable"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        Done
      </button>
    </Sheet>
  );
}

/** The dashboard entry point: how many are due and what is at stake. Silent
 *  when the list is empty, which is the correct answer on most days. */
export function FollowupCard({
  queue, results,
}: {
  queue: FollowupCandidate[];
  results: FollowupResults | null;
}) {
  // Refreshes ITSELF rather than taking an onDone from the caller. The
  // dashboard is a Server Component and cannot hand a function to a client one
  // — a stub like `onDone={() => {}}` type-checks and then throws at run time.
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const atStake = queue.reduce((n, c) => n + Number(c.avg_order_mvr ?? 0), 0);
  if (queue.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { haptic("light"); setOpen(true); }}
        className="w-full text-left glass-panel rounded-2xl snm-pressable flex items-center gap-3"
        style={{ padding: 18 }}
      >
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "color-mix(in srgb, var(--snm-success) 12%, transparent)", color: "var(--snm-success)" }}>
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
            Follow up with {queue.length} customer{queue.length === 1 ? "" : "s"}
          </p>
          <p className="ios-footnote snm-num" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            About MVR {mvr(atStake)} of orders at stake
          </p>
        </div>
      </button>

      <FollowupSheet
        queue={queue}
        results={results}
        open={open}
        onClose={() => { setOpen(false); router.refresh(); }}
      />
    </>
  );
}
