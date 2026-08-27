// The follow-up round — who is due a message, and did it work.
//
// 55 of 81 customers bought once. A repeat customer is worth MVR 1,098 against
// MVR 485 for one who does not come back, and the 26 who repeat make 52% of the
// revenue. The app already knew who was due; what it could not do was act.
//
// Every figure here is computed in Postgres (0188). This file only carries it.

import { supabase } from "@/lib/supabase";

export type FollowupReason = "ran_out" | "rhythm" | "stranded";

export interface FollowupCandidate {
  customer_id: string;
  name: string;
  phone: string;
  /** Why they are due. The message depends on it: a "we changed the range"
   *  offer is not a "are you running low" nudge. */
  reason: FollowupReason;
  days_since_last: number;
  /** Whole days past the point this customer became DUE — 0 means they fell due
   *  today, 40 means long past their own rhythm and a message is a long shot.
   *  Derived from the same thresholds `at_risk` is computed from (0212), so the
   *  two cannot drift apart. Drives the order: the biggest order still likely
   *  to come back, rather than the biggest order full stop. */
  overdue_days: number;
  /** ONE typical order from this customer — what is at stake this cycle, not
   *  their lifetime value, which would put every old customer at the top. */
  avg_order_mvr: number;
  /** Set only for `stranded`: the replacement their message names, and its
   *  size. "Same size as before" is the whole of what makes a swap easy to
   *  accept. */
  swap_label: string | null;
  swap_size: string | null;
}

export interface FollowupResults {
  sent_count: number;
  skipped_count: number;
  ordered_count: number;
  revenue_mvr: number;
  expected_mvr: number;
  reply_rate_pct: number;
}

export async function getFollowupQueue(limit = 10): Promise<FollowupCandidate[]> {
  const { data, error } = await supabase.rpc("get_followup_queue", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as FollowupCandidate[];
}

/** Records the decision — sent or skipped. Both hold the seven-day cooldown,
 *  because a skip is an answer too. */
export async function logFollowup(
  customerId: string,
  reason: FollowupReason,
  outcome: "sent" | "skipped",
  draftKey?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("log_customer_followup", {
    p_customer_id: customerId,
    p_reason: reason,
    p_outcome: outcome,
    p_draft_key: draftKey ?? null,
  });
  if (error) throw error;
}

/** Of the people we messaged, how many came back and what was it worth. The
 *  point of the round is to be answerable. */
export async function getFollowupResults(days = 30): Promise<FollowupResults | null> {
  const { data, error } = await supabase.rpc("get_followup_results", { p_days: days });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as FollowupResults | null;
}
