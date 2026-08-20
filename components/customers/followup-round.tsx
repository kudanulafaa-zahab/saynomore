"use client";

/**
 * The follow-up round — one customer at a time, send or skip, then it ends.
 *
 * WHY A QUEUE AND NOT A LIST. The app has shown who is due a second order for
 * months and it changed nothing, because reading a list is not doing anything:
 * he still had to decide who, open a picker, choose a draft. 55 of 81 customers
 * bought once, and a repeat customer is worth MVR 1,098 against MVR 485 — so
 * the second order is the business, and it was gated behind remembering.
 *
 * A queue is different from a list in exactly three ways, and all three are the
 * point:
 *
 *   IT ENDS. Three customers, three decisions, done. A list has no bottom, so
 *   there is never a moment where the work is finished and he can stop.
 *
 *   IT REMEMBERS. Send or skip, both are logged (0188), so nobody comes back
 *   tomorrow. Without that this is a nag, and a nag gets ignored inside a
 *   fortnight — which is exactly how the old "Worth a call" briefing line died.
 *
 *   IT CAN BE ASKED WHETHER IT WORKED. The footer shows what the last 30 days
 *   of messages actually produced. That is the whole reason for building it: to
 *   find out, in three weeks, whether those 55 one-time buyers come back when
 *   asked.
 *
 * NOTHING IS SENT BY THE APP. Every draft opens WhatsApp with the text in the
 * box; he reads it, edits it, presses send. That promise is older than this
 * screen and is not weakened by automating the queue around it.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Check, SkipForward, PartyPopper } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { whatsappLink, reorderDrafts, switchDrafts, type ReorderDraft } from "@/lib/wa";
import { haptic } from "@/lib/haptics";
import {
  logFollowup, type FollowupCandidate, type FollowupResults,
} from "@/lib/queries/followups";

const mvr = (n: number) => Math.round(n).toLocaleString();

function reasonLine(c: FollowupCandidate): string {
  if (c.reason === "stranded") {
    return `Nothing left to reorder · last ordered ${c.days_since_last} days ago`;
  }
  if (c.reason === "rhythm") {
    return `Later than they usually order · ${c.days_since_last} days ago`;
  }
  return `Probably out · last ordered ${c.days_since_last} days ago`;
}

/** The drafts for this person. A stranded customer's message NAMES the
 *  replacement and its size — "are you running low?" is the wrong sentence for
 *  someone whose product is going away, because it invites them to ask for a
 *  thing we will not have. */
function draftsFor(c: FollowupCandidate): ReorderDraft[] {
  return c.reason === "stranded" && c.swap_label
    ? switchDrafts(c.name, c.swap_label, c.swap_size)
    : reorderDrafts(c.name);
}

export function FollowupRound({
  queue, results, open, onClose, onDone,
}: {
  queue: FollowupCandidate[];
  results: FollowupResults | null;
  open: boolean;
  onClose: () => void;
  /** Fired once the round is finished, so the caller can refresh. */
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const current = queue[i];
  const drafts = useMemo(() => (current ? draftsFor(current) : []), [current]);

  const advance = useCallback(() => {
    setI((n) => {
      const next = n + 1;
      if (next >= queue.length) onDone();
      return next;
    });
  }, [queue.length, onDone]);

  const record = useCallback(async (outcome: "sent" | "skipped", draftKey?: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await logFollowup(current.customer_id, current.reason, outcome, draftKey);
    } catch {
      // A failed log must not swallow the message he is about to send. Worst
      // case the person appears again tomorrow, which is recoverable; blocking
      // the send is not.
    } finally {
      setBusy(false);
      advance();
    }
  }, [current, busy, advance]);

  return (
    <Sheet open={open} onClose={onClose} variant="auto" maxWidth="max-w-md">
      {current ? (
        <>
          <div>
            <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
              Follow up · {i + 1} of {queue.length}
            </p>
            <p className="ios-page-title mt-1" style={{ color: "var(--foreground)" }}>
              {current.name}
            </p>
            {/* --foreground at 0.8, never muted: this is the reason he is being
                asked to act, and muted on a --glass-2 sheet measures under the
                4.5:1 floor. */}
            <p className="ios-subhead mt-1" style={{ color: "var(--foreground)", opacity: 0.8 }}>
              {reasonLine(current)}
            </p>
            {current.avg_order_mvr > 0 && (
              <p className="ios-subhead snm-num mt-1 font-semibold" style={{ color: "var(--foreground)" }}>
                An order from them is usually MVR {mvr(current.avg_order_mvr)}
              </p>
            )}
            {current.reason === "stranded" && current.swap_label && (
              <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                We can offer {current.swap_label}
                {current.swap_size ? ` in ${current.swap_size}` : ""} instead.
              </p>
            )}
          </div>

          <div className="space-y-2">
            {drafts.map((d) => (
              <a
                key={d.key}
                href={whatsappLink(current.phone, d.text) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { haptic("success"); void record("sent", d.key); }}
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

          {/* Skip is a first-class action, not a way out. He knows things the
              app does not — that someone is away, or was spoken to yesterday —
              and a skip is recorded so they are not put in front of him again
              tomorrow. */}
          <button
            type="button"
            onClick={() => { haptic("light"); void record("skipped"); }}
            disabled={busy}
            className="w-full h-12 rounded-xl ios-subhead font-semibold snm-pressable flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--glass-bg-2)", color: "var(--foreground)" }}
          >
            <SkipForward className="h-4 w-4" />
            Not today
          </button>
        </>
      ) : (
        <>
          <div className="text-center py-4">
            <PartyPopper className="h-7 w-7 mx-auto mb-3" style={{ color: "var(--snm-success)" }} />
            <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
              That is everyone for today
            </p>
            <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.75 }}>
              Nobody you have already contacted this week is asked again.
            </p>
          </div>

          {/* THE ANSWER TO "DID THIS WORK". Shown at the end of the round rather
              than on the dashboard, because it is the reward for finishing and
              because a conversion figure is not a daily action. */}
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
        </>
      )}
    </Sheet>
  );
}

/** The dashboard entry point: how many are due and what is at stake. Silent
 *  when the queue is empty, which is the correct answer on most days. */
export function FollowupCard({
  queue, results,
}: {
  queue: FollowupCandidate[];
  results: FollowupResults | null;
}) {
  // Refreshes ITSELF rather than taking an onDone from the caller. The
  // dashboard is a Server Component and cannot hand a function to a client
  // one — a stub like `onDone={() => {}}` type-checks and then throws at run
  // time, which is the worst kind of green.
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
            About MVR {mvr(atStake)} of orders at stake · takes a minute
          </p>
        </div>
      </button>

      <FollowupRound
        queue={queue}
        results={results}
        open={open}
        onClose={() => { setOpen(false); router.refresh(); }}
        onDone={() => router.refresh()}
      />
    </>
  );
}
