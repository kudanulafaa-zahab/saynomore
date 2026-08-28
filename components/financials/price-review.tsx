"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TrendingDown, ShieldCheck, Store, Check, X } from "lucide-react";
import {
  getPriceReview,
  setSellingPrices,
  type PriceReviewRow,
} from "@/lib/queries/price-review";
import { getCurrentUserRole } from "@/lib/queries/products";
import { mvr, mvr2 } from "@/lib/money";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { BodyPortal } from "@/components/ui/body-portal";

/* ── Price review after an arrival ──────────────────────────────────────────
 *
 * Ali, 2026-08-27, the morning after SH-2026-002 landed:
 *   *"For me to set the selling price with the best profit how do I see it?
 *    Is there an easy way? ... Also how do I know compared the 001 shipment
 *    price."*
 *
 * The answer was: he could not. Margin Watch sits directly below this panel
 * and reported "No price is below cost" on the day Sosoft went from 40% margin
 * to 10% — true, and useless, because it can only compare a price with a
 * target margin and a target margin is set on two products out of thirty-six.
 *
 * Every figure on this screen is computed in Postgres (get_price_review,
 * migration 0213), including the unit noun and the stock label. This file
 * renders them and calls one writer. It does no money arithmetic of any kind,
 * which is why there is no total in the header: summing rufiyaa across rows in
 * TypeScript is exactly the hard rule that keeps this app honest.
 *
 * PACKS, CARTONS AND BOTTLES — NEVER PIECES. `unit_noun` comes from the
 * product's category, so a Sosoft row says "bottle" and a diaper row says
 * "pack". Nothing here guesses a unit word.
 */

const NEEDS_ACTION = new Set(["below_cost", "raise", "capped_by_market"]);

type Tier = "unit" | "carton";

/** The date as Ali reads it: "27 Aug". */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-MV", { day: "numeric", month: "short" });
}

/** The word for the tier being shown. A carton is a carton everywhere; the
 *  smaller unit is whatever the product is actually sold as. */
function tierWord(r: PriceReviewRow, tier: Tier): string {
  return tier === "carton" ? "carton" : r.unit_noun;
}

function priceFor(r: PriceReviewRow, tier: Tier): number | null {
  return tier === "carton" ? r.price_carton : r.price_unit;
}
function costFor(r: PriceReviewRow, tier: Tier, which: "prev" | "this"): number | null {
  if (tier === "carton") return which === "prev" ? r.prev_cost_carton : r.this_cost_carton;
  return which === "prev" ? r.prev_cost_unit : r.this_cost_unit;
}
function suggestionFor(r: PriceReviewRow, tier: Tier): number | null {
  return tier === "carton" ? r.suggested_carton : r.suggested_unit;
}

/** Which tier a row can be shown in. A pack-only SKU has no carton price and
 *  must never be offered one (the units rule, and set_selling_prices refuses
 *  it in Postgres too). */
function tierAvailable(r: PriceReviewRow, tier: Tier): boolean {
  return tier === "carton" ? r.sells_carton : r.sells_pack;
}

/* ── The editor ───────────────────────────────────────────────────────────
 * Opened from a row, prefilled with the suggestion where there is one. It
 * exists for the case the suggestion cannot answer: `capped_by_market`, where
 * the arithmetic price is above what the shops charge and Ali has to make a
 * judgement rather than accept a number.
 */
function PriceSheet({
  row, tier, onClose, onSaved,
}: {
  row: PriceReviewRow;
  tier: Tier;
  onClose: () => void;
  onSaved: () => void;
}) {
  const suggestion = suggestionFor(row, tier);
  const current = priceFor(row, tier);
  const cost = costFor(row, tier, "this");
  const [value, setValue] = useState(String(suggestion ?? current ?? ""));
  const [saving, setSaving] = useState(false);
  useBodyScrollLock(true);

  const typed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(typed) && typed > 0;
  const atLoss = valid && cost != null && typed < cost;
  // The margin this price would earn, echoed live so the number he types is
  // never a number he has to trust blindly.
  const marginPct = valid && cost != null && typed > 0
    ? Math.round(((typed - cost) / typed) * 1000) / 10
    : null;
  const word = tierWord(row, tier);

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      await setSellingPrices({
        skuId: row.sku_id,
        priceUnit: tier === "unit" ? typed : null,
        priceCarton: tier === "carton" ? typed : null,
        allowBelowCost: atLoss,
        reason: `Price review after ${row.this_reference}`,
      });
      toast.success(`${row.full_path} — MVR ${mvr(typed)} per ${word}`);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BodyPortal>
      <div
        className="fixed inset-0 z-[200] snm-scrim-in"
        style={{ background: "var(--scrim-bg)", backdropFilter: "var(--scrim-blur)", WebkitBackdropFilter: "var(--scrim-blur)" }}
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-[201] snm-sheet-in" style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
        <div
          className="mx-2 mb-2 rounded-3xl overflow-hidden"
          style={{ background: "var(--glass-bg-2)", backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)", boxShadow: "var(--glass-shadow-lg)" }}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-[3px] rounded-full" style={{ background: "var(--muted-foreground)", opacity: 0.3 }} />
          </div>

          <div className="px-5 pt-3 pb-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>{row.full_path}</p>
                <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                  Price of ONE {word}
                </p>
              </div>
              <button onClick={onClose} className="snm-pressable shrink-0 rounded-full p-1.5" style={{ background: "var(--glass-bg-1)" }} aria-label="Close">
                <X className="h-4 w-4" style={{ color: "var(--foreground)" }} />
              </button>
            </div>

            {/* The field's NAME is the label above, never the placeholder — the
                placeholder carries the FORMAT only (CLAUDE.md, contrast). */}
            <div>
              <p className="label-caps mb-1.5" style={{ color: "var(--foreground)", opacity: 0.8 }}>
                Selling price per {word} (MVR)
              </p>
              <input
                className="snm-input h-12 rounded-xl px-4 ios-subhead w-full snm-num"
                style={{ background: "var(--glass-bg-1)" }}
                inputMode="decimal"
                value={value}
                placeholder={String(suggestion ?? 0)}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>

            <div className="rounded-xl px-3.5 py-3 space-y-1" style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
              <p className="ios-footnote snm-num" style={{ color: "var(--foreground)" }}>
                Costs you <strong>MVR {mvr2(cost)}</strong> per {word} on {row.this_reference}
              </p>
              {marginPct != null && (
                <p className="ios-footnote snm-num" style={{ color: atLoss ? "var(--snm-error)" : "var(--foreground)" }}>
                  {atLoss
                    ? <>This price <strong>loses MVR {mvr2(cost! - typed)}</strong> on every {word}</>
                    : <>Earns <strong>MVR {mvr2(typed - cost!)}</strong> per {word} · {marginPct}% margin</>}
                </p>
              )}
              {row.market_unit_mvr != null && tier === "unit" && (
                <p className="ios-footnote snm-num" style={{ color: "var(--foreground)", opacity: 0.8 }}>
                  {row.market_competitor} charges MVR {mvr(row.market_unit_mvr)} per {word}
                </p>
              )}
            </div>

            <button
              onClick={save}
              disabled={!valid || saving}
              className="snm-pressable w-full h-12 rounded-2xl ios-subhead font-semibold"
              style={{
                background: atLoss ? "var(--snm-error)" : "var(--foreground)",
                color: atLoss ? "#fff" : "var(--background)",
                opacity: !valid || saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : atLoss ? `Set at a loss — MVR ${mvr(typed)}` : `Set MVR ${mvr(typed)} per ${word}`}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

/* ── The panel ────────────────────────────────────────────────────────────── */
export function PriceReview({ shipmentId }: { shipmentId?: string }) {
  const [rows, setRows] = useState<PriceReviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [canFix, setCanFix] = useState(false);
  const [tier, setTier] = useState<Tier>("unit");
  const [applying, setApplying] = useState<string | null>(null);
  const [editing, setEditing] = useState<PriceReviewRow | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  function load() {
    return Promise.all([getPriceReview(shipmentId), getCurrentUserRole()])
      .then(([r, role]) => {
        setRows(r);
        setCanFix(role === "admin" || role === "manager");
      })
      .catch(() => setFailed(true));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPriceReview(shipmentId), getCurrentUserRole()])
      .then(([r, role]) => {
        if (cancelled) return;
        setRows(r);
        setCanFix(role === "admin" || role === "manager");
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [shipmentId]);

  async function accept(r: PriceReviewRow) {
    setApplying(r.sku_id);
    try {
      // Both units move together where the product sells both, so a carton can
      // never drift out of step with the pack it is made of.
      await setSellingPrices({
        skuId: r.sku_id,
        priceUnit: r.sells_pack ? r.suggested_unit : null,
        priceCarton: r.sells_carton ? r.suggested_carton : null,
        reason: `Price review after ${r.this_reference} — margin restored to ${r.margin_before_pct}%`,
      });
      toast.success(`${r.full_path} repriced`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(null);
    }
  }

  // A failure to load is stated, not hidden behind an empty panel that reads
  // as "nothing to do" — the same fix the follow-up round needed (0212).
  if (failed) {
    return (
      <div className="glass-panel p-4 mb-5">
        <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>Price review didn&apos;t load</p>
        <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.8 }}>
          Pull down to try again — this is not the same as having nothing to reprice.
        </p>
      </div>
    );
  }

  if (rows === null) {
    return (
      <div className="glass-panel p-5 mb-5">
        <div className="snm-skel h-2.5 w-40 rounded-full mb-3" />
        <div className="snm-skel h-9 rounded-xl" />
      </div>
    );
  }

  // Nothing has ever been received: not a state worth a panel.
  if (rows.length === 0) return null;

  const shipment = rows[0].this_reference;
  const received = shortDate(rows[0].this_received_on);
  const action = rows.filter((r) => NEEDS_ACTION.has(r.verdict));
  const settled = rows.filter((r) => !NEEDS_ACTION.has(r.verdict));
  const bothTiers = rows.some((r) => r.sells_pack) && rows.some((r) => r.sells_carton);

  return (
    <div className="glass-panel p-5 mb-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="label-caps" style={{ color: "var(--muted-foreground)" }}>Price review</p>
        <span className="ios-caption1 font-semibold snm-num" style={{ color: "var(--foreground)", opacity: 0.75 }}>
          {shipment} · {received}
        </span>
      </div>

      {action.length === 0 ? (
        <div className="flex items-center gap-3 mt-2">
          <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: "var(--snm-success)" }} />
          <p className="ios-footnote" style={{ color: "var(--foreground)", opacity: 0.85 }}>
            Nothing to reprice after {shipment}. Every product that landed costs what it did last time,
            or its price already moved with the cost.
          </p>
        </div>
      ) : (
        <p className="ios-footnote mb-3" style={{ color: "var(--foreground)", opacity: 0.85 }}>
          {action.length} product{action.length === 1 ? "" : "s"} cost more than on the arrival before.
          Your price stayed where it was, so the difference came out of your profit.
        </p>
      )}

      {/* Pack/Carton — one pill, switching every money figure below together.
          An unselected pill carries a CHOICE, so it is real foreground text on
          a filled surface, never muted-on-transparent. */}
      {bothTiers && action.length > 0 && (
        <div className="flex gap-2 mb-3">
          {(["unit", "carton"] as Tier[]).map((t) => {
            const on = tier === t;
            const label = t === "carton" ? "Per carton" : `Per ${rows.find((r) => r.sells_pack)?.unit_noun ?? "pack"}`;
            return (
              <button
                key={t}
                onClick={() => setTier(t)}
                className="snm-pressable rounded-full px-3.5 py-1.5 ios-footnote font-semibold flex items-center gap-1.5"
                style={{
                  background: on ? "var(--foreground)" : "var(--glass-bg-1)",
                  color: on ? "var(--background)" : "var(--foreground)",
                  border: "0.5px solid var(--glass-border-lo)",
                }}
              >
                {on && <Check className="h-3.5 w-3.5" />}
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        {action.map((r) => {
          // A row shown in a tier it does not sell would be a price he can
          // never charge. Fall back to the one it does.
          const t: Tier = tierAvailable(r, tier) ? tier : (r.sells_pack ? "unit" : "carton");
          const word = tierWord(r, t);
          const prev = costFor(r, t, "prev");
          const now = costFor(r, t, "this");
          const price = priceFor(r, t);
          const suggestion = suggestionFor(r, t);
          const capped = r.verdict === "capped_by_market";
          const losing = r.verdict === "below_cost";
          const tone = losing ? "var(--snm-error)" : "var(--snm-warning)";

          return (
            <div
              key={r.sku_id}
              className="rounded-xl px-3.5 py-3"
              style={{ background: "var(--muted)", border: "0.5px solid var(--glass-border-lo)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}
                >
                  {capped ? <Store className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>{r.full_path}</p>

                  {/* THE COMPARISON HE ASKED FOR, named on both sides. */}
                  <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)", opacity: 0.85 }}>
                    Cost per {word} MVR {mvr2(prev)} → <strong>{mvr2(now)}</strong>
                    {r.prev_reference && <> · {r.prev_reference} → {r.this_reference}</>}
                  </p>

                  {/* Rufiyaa first, percentage second. */}
                  <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)" }}>
                    You charge MVR {mvr(price)}
                    {r.profit_now_unit != null && r.profit_lost_unit != null && t === (r.sells_pack ? "unit" : "carton") && (
                      <> — earning <strong style={{ color: tone }}>MVR {mvr2(r.profit_now_unit)}</strong> per {word}, MVR {mvr2(r.profit_lost_unit)} less than before</>
                    )}
                  </p>

                  {r.margin_before_pct != null && r.margin_now_pct != null && (
                    <p className="ios-footnote snm-num mt-0.5" style={{ color: "var(--foreground)", opacity: 0.8 }}>
                      Margin {r.margin_before_pct}% → <strong style={{ color: tone }}>{r.margin_now_pct}%</strong> · {r.stock_label} in stock
                    </p>
                  )}

                  {/* THE HONEST REFUSAL. Restoring the margin is arithmetic;
                      whether the price is sellable is not, and a suggestion
                      above the shelf price is worse than no suggestion. */}
                  {capped && (
                    <p className="ios-footnote snm-num mt-1.5" style={{ color: "var(--snm-warning)" }}>
                      Putting {r.margin_before_pct}% back needs MVR {mvr(suggestion)} per {word}, but{" "}
                      {r.market_competitor} is at MVR {mvr(r.market_unit_mvr)}. Raising the price is not the answer here.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-2.5">
                    {!capped && suggestion != null && canFix && (
                      <button
                        onClick={() => accept(r)}
                        disabled={applying === r.sku_id}
                        className="snm-pressable rounded-full px-3.5 py-1.5 ios-footnote font-semibold snm-num"
                        style={{ background: "var(--foreground)", color: "var(--background)", opacity: applying === r.sku_id ? 0.5 : 1 }}
                      >
                        {applying === r.sku_id ? "Setting…" : `Set MVR ${mvr(suggestion)} per ${word}`}
                      </button>
                    )}
                    {canFix && (
                      <button
                        onClick={() => { setTier(t); setEditing(r); }}
                        className="snm-pressable rounded-full px-3.5 py-1.5 ios-footnote font-semibold"
                        style={{ background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
                      >
                        {capped ? "Set a price" : "Choose another price"}
                      </button>
                    )}
                  </div>

                  {/* What the button will actually do to the OTHER unit, said
                      before it is tapped rather than discovered afterwards. */}
                  {!capped && canFix && r.sells_pack && r.sells_carton
                    && r.suggested_unit != null && r.suggested_carton != null && (
                    <p className="ios-caption1 snm-num mt-1.5" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                      Sets both: MVR {mvr(r.suggested_unit)} per {r.unit_noun} and MVR {mvr(r.suggested_carton)} per carton
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* The products that need nothing, including the one that looked after
          itself — folded away, but never silently dropped. */}
      {settled.length > 0 && (
        <button
          onClick={() => setShowSettled((v) => !v)}
          className="snm-pressable mt-3 ios-footnote font-semibold"
          style={{ color: "var(--snm-brand-text)" }}
        >
          {showSettled ? "Hide" : `${settled.length} more that need nothing`}
        </button>
      )}
      {showSettled && (
        <div className="space-y-1.5 mt-2">
          {settled.map((r) => (
            <div key={r.sku_id} className="flex items-baseline justify-between gap-3">
              <p className="ios-footnote truncate" style={{ color: "var(--foreground)", opacity: 0.85 }}>{r.full_path}</p>
              <p className="ios-caption1 snm-num shrink-0" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                {r.verdict === "repriced"
                  ? `price already set · now ${r.margin_now_pct}%`
                  : r.verdict === "auto_adjusted"
                  ? `price moved with the cost · ${r.margin_now_pct}%`
                  : r.verdict === "cheaper" ? "cheaper than last time"
                  : r.verdict === "no_change" ? "same cost as last time"
                  : r.verdict === "first_arrival" ? "first arrival — nothing to compare"
                  : "no selling price"}
              </p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PriceSheet
          row={editing}
          tier={tierAvailable(editing, tier) ? tier : (editing.sells_pack ? "unit" : "carton")}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
