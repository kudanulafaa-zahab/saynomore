"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { correctPackConfig, type PackConfigImpact } from "@/lib/queries/products";
import { containerLabel, type UnitUom } from "@/lib/trade-units";
import { mvr } from "@/lib/money";

/**
 * Correcting a pack size that was typed wrong.
 *
 * ── WHY THIS IS A SHEET AND NOT A FIELD ────────────────────────────────────
 *
 * Ali, 2026-08-30: *"I made a mistake for xtra kering xxxl… I can't edit in the
 * sku edit because it says stock already sold. How do I fix this and also how
 * do I fix in future incidents. Do it properly. Not adhoc."*
 *
 * The database refuses a pack-size change once a product has batches or sales,
 * and it is right to — a different pack format is a different product. What it
 * cannot see is the other case: the format was never different, it was typed
 * wrong. No business event happened; only the number the app divides by was
 * incorrect.
 *
 * That is a restatement, and the one thing a restatement must never be is
 * silent. Migration 0191 corrected this same product by hand and set it to the
 * WRONG value — nobody could see what it was about to do, because a one-off
 * migration cannot show anyone anything. This screen exists so that never
 * happens again: the impact is read out of the database, in packs and cartons
 * and rufiyaa, before a single row moves.
 *
 * ── WHAT IT LEADS WITH ─────────────────────────────────────────────────────
 *
 * Cost per pack is the carton cost divided by packs per carton — the pack SIZE
 * does not appear in it. So correcting 34 to 32 with the carton still 3 packs
 * moves no money whatsoever, and saying so first is the difference between a
 * frightening screen and a routine one. When packs-per-carton does move, that
 * is the case that re-costs, and it leads with the money instead.
 */
export function PackSizeCorrectionSheet({
  impact,
  unitUom,
  onClose,
  onDone,
}: {
  impact: PackConfigImpact;
  unitUom: string | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // The unit NOUN comes from the product. A Sosoft is a bottle, so this reads
  // "bottles in one carton" and never "packs".
  const word = containerLabel(unitUom as UnitUom | null | undefined);
  const blocked = impact.blockers.length > 0;
  const moves = impact.money_moves;

  async function submit() {
    if (reason.trim().length < 10) {
      toast.error("Say why it is being corrected — it is written into the ledger");
      return;
    }
    setSaving(true);
    try {
      const res = await correctPackConfig(
        impact.sku_id, impact.to.pcs_per_pack, impact.to.packs_per_carton, reason.trim(),
      );
      toast.success(`Corrected — now ${res.internal_code}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    // Docked: the impact list can run past a phone screen when a product sits
    // in several godowns, and this sheet must never scroll its own actions off
    // the bottom — the reason box and the confirm are the point of it.
    <Sheet
      open
      onClose={onClose}
      variant="docked"
      z={60}
      header={
        <div className="px-5 pt-4 pb-3">
          <p className="ios-page-title text-[20px]">Correct pack size</p>
          <p className="ios-footnote mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            Nothing has moved yet. This is what it would do.
          </p>
        </div>
      }
    >
      <div className="space-y-4 px-5 pb-5">
        {/* WHAT IS CHANGING, in one line he can check against a real carton. */}
        <div className="rounded-2xl px-4 py-3" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
          <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            {impact.internal_code}
          </p>
          <p className="ios-body font-semibold text-foreground mt-1">
            {impact.from.pcs_per_pack} per {word}, {impact.from.packs_per_carton} per carton
            {"  →  "}
            {impact.to.pcs_per_pack} per {word}, {impact.to.packs_per_carton} per carton
          </p>
          <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.7 }}>
            The code becomes {impact.code_after}.
          </p>
        </div>

        {blocked ? (
          <div className="rounded-2xl px-4 py-3 space-y-1.5"
            style={{ background: "color-mix(in srgb, var(--snm-error) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-error) 35%, transparent)" }}>
            <p className="ios-subhead font-semibold" style={{ color: "var(--snm-error)" }}>
              This cannot be corrected as it stands
            </p>
            {impact.blockers.map((b) => (
              <p key={b.godown} className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.85 }}>
                {b.godown}: {b.detail}. Count the stock there first.
              </p>
            ))}
          </div>
        ) : (
          <>
            {/* THE HEADLINE. Almost always "nothing", and saying so plainly is
                the whole reassurance. */}
            <div className="rounded-2xl px-4 py-3"
              style={moves
                ? { background: "color-mix(in srgb, var(--snm-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-warning) 35%, transparent)" }
                : { background: "color-mix(in srgb, var(--snm-success) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--snm-success) 30%, transparent)" }}>
              <p className="ios-subhead font-semibold"
                style={{ color: moves ? "var(--snm-warning)" : "var(--snm-success)" }}>
                {moves ? "This changes your cost per " + word : "No money changes"}
              </p>
              <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.85 }}>
                {moves
                  ? `Cost per ${word} goes from MVR ${mvr(impact.cost.cost_per_pack_now_mvr ?? 0)} to MVR ${mvr(impact.cost.cost_per_pack_after_mvr ?? 0)}, because you are changing how many ${word}s are in a carton. Check your selling prices after this.`
                  : `Cost per ${word} stays at MVR ${mvr(impact.cost.cost_per_pack_now_mvr ?? 0)}. What you paid, what you charged and what you have on the shelf are all unchanged — only the piece count behind them was wrong.`}
              </p>
            </div>

            {/* Stock, in the units he trades in. */}
            {impact.stock.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                <p className="label-caps text-[12px] px-4 pt-3 pb-1" style={{ color: "var(--muted-foreground)" }}>
                  Stock after this
                </p>
                {impact.stock.map((g) => (
                  <div key={g.godown} className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                    <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.8 }}>{g.godown}</p>
                    <p className="ios-subhead font-semibold text-foreground snm-num">
                      {g.packs} {word}{g.packs === 1 ? "" : "s"} — unchanged
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Past sales. Revenue never moves; cost of sales only moves when
                packs-per-carton does. */}
            {impact.sales.lines > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                <p className="label-caps text-[12px] px-4 pt-3 pb-1" style={{ color: "var(--muted-foreground)" }}>
                  {impact.sales.lines} past sale{impact.sales.lines === 1 ? "" : "s"}
                </p>
                <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                  <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.8 }}>What you charged</p>
                  <p className="ios-subhead font-semibold text-foreground snm-num">MVR {mvr(impact.sales.revenue_mvr)} — unchanged</p>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
                  <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.8 }}>What they cost you</p>
                  <p className="ios-subhead font-semibold snm-num"
                    style={{ color: impact.sales.cogs_now_mvr === impact.sales.cogs_after_mvr ? "var(--foreground)" : "var(--snm-warning)" }}>
                    {impact.sales.cogs_now_mvr === impact.sales.cogs_after_mvr
                      ? `MVR ${mvr(impact.sales.cogs_now_mvr)} — unchanged`
                      : `MVR ${mvr(impact.sales.cogs_now_mvr)} → ${mvr(impact.sales.cogs_after_mvr)}`}
                  </p>
                </div>
              </div>
            )}

            {/* The reason is required by the database, not just by this form —
                it is written into the ledger entry and read months later by
                whoever asks why a number moved. */}
            <div className="space-y-1.5">
              <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                WHY IS IT BEING CORRECTED *
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Counted a carton — it holds 3 packs of 32"
                aria-label="Why the pack size is being corrected"
                className="w-full rounded-xl px-4 py-3 ios-subhead text-foreground outline-none resize-none placeholder:text-muted-foreground"
                style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
              />
              <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                Written into the stock ledger next to the correction.
              </p>
            </div>
          </>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="snm-pressable flex-1 h-12 rounded-2xl ios-subhead font-semibold"
            style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)", color: "var(--foreground)" }}
          >
            Cancel
          </button>
          {!blocked && (
            <button
              onClick={submit}
              disabled={saving || reason.trim().length < 10}
              className="snm-pressable flex-1 h-12 rounded-2xl ios-subhead font-bold flex items-center justify-center gap-2 disabled:opacity-40"
              style={moves
                ? { background: "var(--snm-error)", color: "var(--background)" }
                : { background: "var(--foreground)", color: "var(--background)" }}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {moves ? "Correct and re-cost" : "Correct it"}
            </button>
          )}
        </div>

        {moves && !blocked && (
          <p className="ios-footnote flex items-start gap-1.5" style={{ color: "var(--snm-warning)" }}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            This re-costs every batch and every past sale of this product. Your margins will move.
          </p>
        )}
      </div>
    </Sheet>
  );
}
