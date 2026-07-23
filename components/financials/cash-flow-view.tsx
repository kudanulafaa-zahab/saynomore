"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Wallet, TrendingDown, AlertTriangle, Ship, PencilLine } from "lucide-react";
import {
  getCashForecast, getCashForecastMeta, setCashBalance,
  type CashForecastMeta, type CashForecastWeek,
} from "@/lib/queries/cash";
import { getCurrentUserRole } from "@/lib/queries/products";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { BodyPortal } from "@/components/ui/body-portal";
import { haptic } from "@/lib/haptics";

const CARD: React.CSSProperties = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  backdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  WebkitBackdropFilter: "blur(calc(14px * var(--frost-b))) saturate(var(--glass-saturate))",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
};

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-MV", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (a >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}
function weekLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-MV", { day: "numeric", month: "short" });
}

export function CashFlowView() {
  const [meta, setMeta]         = useState<CashForecastMeta | null>(null);
  const [weeks, setWeeks]       = useState<CashForecastWeek[]>([]);
  const [loading, setLoading]   = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [editing, setEditing]   = useState(false);

  useEffect(() => {
    getCurrentUserRole().then((r) => setCanWrite(r === "admin" || r === "manager")).catch(() => {});
  }, []);

  // Loader pattern (skills.md): initial state is the skeleton; set false in
  // .finally so a refetch after saving swaps in place without flashing it again.
  function load() {
    let cancelled = false;
    Promise.all([getCashForecastMeta(), getCashForecast(13)])
      .then(([m, w]) => { if (!cancelled) { setMeta(m); setWeeks(w); } })
      .catch((e) => { if (!cancelled) toast.error((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }
  useEffect(() => load(), []);

  // The trough — reading the min of a Postgres-computed column is presentation,
  // not financial math (the balances themselves come from the engine).
  const trough = useMemo(() => {
    if (weeks.length === 0) return null;
    return weeks.reduce((lo, w) => (w.projected_balance_mvr < lo.projected_balance_mvr ? w : lo), weeks[0]);
  }, [weeks]);

  const firstShipmentWeek = useMemo(
    () => weeks.find((w) => w.shipment_out_mvr > 0) ?? null,
    [weeks],
  );

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  const hasOpening = meta?.has_opening ?? false;
  const opening    = Number(meta?.opening_balance_mvr ?? 0);
  const troughVal  = trough ? Number(trough.projected_balance_mvr) : 0;
  const goesNegative = hasOpening && troughVal < 0;

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── 1. Cash on hand ── */}
      <div style={{ ...CARD, borderRadius: 16, padding: 20, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Wallet style={{ width: 13, height: 13 }} /> Cash on hand
            </p>
            {hasOpening ? (
              <>
                <p className="snm-num" style={{ color: "var(--foreground)", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  MVR {fmt(opening)}
                </p>
                <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginTop: 2 }}>
                  {meta?.snapshot_age_days === 0
                    ? "Set today"
                    : `Set ${meta?.snapshot_age_days} day${meta?.snapshot_age_days === 1 ? "" : "s"} ago${(meta?.snapshot_age_days ?? 0) > 14 ? " — update it to keep the forecast honest" : ""}`}
                </p>
              </>
            ) : (
              <p style={{ color: "var(--muted-foreground)", fontSize: 14, maxWidth: 280 }}>
                Enter the cash + bank you can draw on today to turn the flow below into a real runway.
              </p>
            )}
          </div>
          {canWrite && (
            <button
              onClick={() => setEditing(true)}
              className="snm-pressable"
              style={{ flexShrink: 0, minHeight: 40, padding: "0 16px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: hasOpening ? "var(--glass-1)" : "var(--foreground)",
                color: hasOpening ? "var(--foreground)" : "var(--background)",
                border: hasOpening ? "0.5px solid var(--glass-border-lo)" : "none" }}
            >
              <PencilLine style={{ width: 14, height: 14 }} /> {hasOpening ? "Update" : "Set"}
            </button>
          )}
        </div>
      </div>

      {/* ── 2. Runway verdict ── */}
      {hasOpening && trough && (
        <div style={{ ...CARD, borderRadius: 16, padding: 20, marginBottom: 12,
          border: goesNegative ? "1px solid color-mix(in srgb, var(--snm-error) 30%, transparent)" : (CARD.border as string) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            {goesNegative
              ? <TrendingDown style={{ width: 18, height: 18, color: "var(--snm-error)", flexShrink: 0 }} />
              : <Wallet style={{ width: 18, height: 18, color: "var(--foreground)", flexShrink: 0 }} />}
            <p style={{ color: goesNegative ? "var(--snm-error)" : "var(--foreground)", fontSize: 15, fontWeight: 700 }}>
              {goesNegative ? "Cash runs short" : "You stay in the black"}
            </p>
          </div>
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, lineHeight: 1.5 }}>
            {goesNegative ? (
              <>Projected to dip to <span className="snm-num" style={{ color: "var(--snm-error)", fontWeight: 600 }}>MVR {fmt(troughVal)}</span> around the week of {weekLabel(trough.week_start)} — that&apos;s the week to watch.</>
            ) : (
              <>Lowest point over the next 13 weeks is <span className="snm-num" style={{ color: "var(--foreground)", fontWeight: 600 }}>MVR {fmt(troughVal)}</span>, around the week of {weekLabel(trough.week_start)}.</>
            )}
            {firstShipmentWeek && (
              <> Next shipment payment (<span className="snm-num">MVR {fmt(Number(firstShipmentWeek.shipment_out_mvr))}</span>) lands the week of {weekLabel(firstShipmentWeek.week_start)}.</>
            )}
          </p>
        </div>
      )}

      {/* ── 3. 13-week balance trajectory ── */}
      <div style={{ ...CARD, borderRadius: 16, padding: 20, marginBottom: 12 }}>
        <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 4 }}>
          {hasOpening ? "Projected cash — next 13 weeks" : "Net cash flow — next 13 weeks"}
        </p>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12, marginBottom: 18 }}>
          {hasOpening ? "Running balance, week by week" : "Weekly in minus out (set cash on hand for a real balance)"}
        </p>
        <BalanceBars weeks={weeks} troughWeek={trough?.week_start ?? null} showBalance={hasOpening} />
      </div>

      {/* ── 4. What the forecast assumes ── */}
      <div style={{ ...CARD, borderRadius: 16, padding: 20 }}>
        <p style={{ color: "var(--muted-foreground)", fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 12 }}>
          What this assumes
        </p>
        <Assumption label="Sales cash coming in" value={`~MVR ${fmt(Number(meta?.weekly_sales_in_mvr ?? 0))}/week`} hint="90-day average" />
        <Assumption label="Running costs going out" value={`~MVR ${fmt(Number(meta?.weekly_operating_out_mvr ?? 0))}/week`} hint="expenses + marketing, 90-day average" />
        {Number(meta?.receivables_total_mvr ?? 0) > 0 && (
          <Assumption label="Owed to you now" value={`MVR ${fmt(Number(meta?.receivables_total_mvr))}`} hint="assumed collected over the next 4 weeks" />
        )}
        {Number(meta?.undated_shipment_cost_mvr ?? 0) > 0 && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "0.5px solid var(--glass-border-lo)" }}>
            <Ship style={{ width: 14, height: 14, color: "var(--snm-warning)", flexShrink: 0, marginTop: 2 }} />
            <p style={{ color: "var(--snm-warning)", fontSize: 13, lineHeight: 1.4 }}>
              {meta?.undated_shipment_count} open shipment{(meta?.undated_shipment_count ?? 0) === 1 ? "" : "s"} worth <span className="snm-num" style={{ fontWeight: 600 }}>MVR {fmt(Number(meta?.undated_shipment_cost_mvr))}</span> {(meta?.undated_shipment_count ?? 0) === 1 ? "isn't" : "aren't"} on the timeline yet — add an expected arrival date so it counts.
            </p>
          </div>
        )}
        {Number(meta?.undated_shipment_cost_mvr ?? 0) === 0 && (meta?.undated_shipment_count ?? 0) > 0 && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "0.5px solid var(--glass-border-lo)" }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "var(--muted-foreground)", flexShrink: 0, marginTop: 2 }} />
            <p style={{ color: "var(--muted-foreground)", fontSize: 13, lineHeight: 1.4 }}>
              {meta?.undated_shipment_count} draft shipment{(meta?.undated_shipment_count ?? 0) === 1 ? "" : "s"} with no costs entered yet — add costs and an arrival date to see the bill here.
            </p>
          </div>
        )}
      </div>

      {editing && (
        <SetBalanceSheet
          current={hasOpening ? opening : null}
          onClose={() => setEditing(false)}
          onDone={() => { setEditing(false); load(); }}
        />
      )}
    </div>
  );
}

function Assumption({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ color: "var(--foreground)", fontSize: 14 }}>{label}</p>
        <p style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{hint}</p>
      </div>
      <p className="snm-num" style={{ color: "var(--foreground)", fontSize: 14, fontWeight: 600, flexShrink: 0, textAlign: "right" }}>{value}</p>
    </div>
  );
}

// ── Balance / net-flow bars — one bar per week, zero baseline in the middle ──
function BalanceBars({ weeks, troughWeek, showBalance }: {
  weeks: CashForecastWeek[];
  troughWeek: string | null;
  showBalance: boolean;
}) {
  const [tapped, setTapped] = useState<string | null>(null);
  const values = weeks.map((w) => showBalance ? Number(w.projected_balance_mvr) : Number(w.net_mvr));
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);
  const anyNeg = values.some((v) => v < 0);

  return (
    <>
      <div style={{ position: "relative", height: anyNeg ? 120 : 96 }}>
        {/* Zero baseline */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: anyNeg ? "50%" : 0, height: 0, borderTop: "1px solid color-mix(in srgb, var(--foreground) 16%, transparent)" }} />
        <div style={{ display: "flex", alignItems: "stretch", gap: 4, height: "100%" }}>
          {weeks.map((w) => {
            const v = showBalance ? Number(w.projected_balance_mvr) : Number(w.net_mvr);
            const isTrough = showBalance && troughWeek === w.week_start;
            const isTapped = tapped === w.week_start;
            const neg = v < 0;
            const h = (Math.abs(v) / maxAbs) * (anyNeg ? 50 : 100);
            const color = neg ? "var(--snm-error)"
              : isTrough ? "var(--snm-warning)"
              : "color-mix(in srgb, var(--foreground) 45%, transparent)";
            return (
              <button
                key={w.week_start}
                onClick={() => setTapped(isTapped ? null : w.week_start)}
                style={{ flex: 1, position: "relative", background: "none", border: "none", padding: 0, cursor: "pointer", touchAction: "manipulation",
                  display: "flex", flexDirection: "column", justifyContent: anyNeg ? "center" : "flex-end", height: "100%" }}
                aria-label={`Week of ${weekLabel(w.week_start)}: MVR ${fmt(v)}`}
              >
                {/* value on tap */}
                <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: anyNeg ? (neg ? "auto" : "50%") : "100%", top: anyNeg && neg ? "50%" : "auto",
                  marginBottom: !anyNeg || !neg ? 4 : 0, marginTop: anyNeg && neg ? 4 : 0,
                  fontSize: 10, fontWeight: 700, color: "var(--foreground)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                  opacity: isTapped ? 1 : 0, transition: "opacity 0.15s", pointerEvents: "none" }}>
                  {fmtShort(v)}
                </span>
                <div style={{
                  width: "100%",
                  height: `${Math.max(h, 2)}%`,
                  alignSelf: anyNeg ? (neg ? "flex-start" : "flex-end") : "stretch",
                  marginTop: anyNeg && !neg ? "auto" : 0,
                  background: (isTapped || isTrough) ? (neg ? "var(--snm-error)" : "var(--foreground)") : color,
                  borderRadius: neg ? "0 0 3px 3px" : "3px 3px 0 0",
                  transition: "background 0.15s",
                }} />
              </button>
            );
          })}
        </div>
      </div>
      {/* Sparse labels: first, middle, last week */}
      <div style={{ display: "flex", marginTop: 8 }}>
        {weeks.map((w, i) => {
          const show = i === 0 || i === Math.floor(weeks.length / 2) || i === weeks.length - 1;
          return (
            <span key={w.week_start} style={{ flex: 1, textAlign: i === 0 ? "left" : i === weeks.length - 1 ? "right" : "center",
              color: "var(--muted-foreground)", fontSize: 10 }}>
              {show ? weekLabel(w.week_start) : ""}
            </span>
          );
        })}
      </div>
    </>
  );
}

// ── Set cash-on-hand sheet ────────────────────────────────────────────────────
function SetBalanceSheet({ current, onClose, onDone }: {
  current: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  useBodyScrollLock(true);
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(current != null ? String(current) : "");
  const [asOf, setAsOf]     = useState(today);
  const [note, setNote]     = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) { toast.error("Enter the cash on hand"); return; }
    setSaving(true);
    try {
      await setCashBalance(amt, asOf || today, note);
      haptic("success");
      toast.success("Cash on hand updated");
      onDone();
    } catch (e) { haptic("error"); toast.error((e as Error).message); }
    finally { setSaving(false); }
  }

  const field = "w-full h-11 px-3 rounded-xl text-sm bg-secondary text-foreground border border-border outline-none";
  const label = "block text-xs uppercase tracking-widest text-muted-foreground mb-1.5";

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-60 flex items-end snm-scrim-in" style={{ background: "var(--scrim-bg)", touchAction: "none" }} onClick={onClose}>
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
          style={{ background: "var(--background)", borderTop: "0.5px solid var(--glass-border-lo)", boxShadow: "var(--glass-shadow-lg)", maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)", touchAction: "none" }}
        >
          <div className="shrink-0 px-5 pt-3">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-1">Cash on hand</h2>
            <p className="ios-subhead text-muted-foreground mb-4">The cash + bank you can draw on. It anchors the forecast.</p>
          </div>

          <div className="px-5 pb-4" style={{ touchAction: "pan-y" }}>
            <div className="mb-3">
              <label className={label}>Amount (MVR) *</label>
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="0.00" autoFocus className={field}
              />
            </div>
            <div className="mb-3">
              <label className={label}>As of</label>
              <input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} className={field} />
            </div>
            <div className="mb-2">
              <label className={label}>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. after paying BML" className={field} />
            </div>
          </div>

          <div className="shrink-0 flex gap-3 px-5 pt-3" style={{ borderTop: "0.5px solid var(--glass-border-lo)", paddingBottom: "max(env(safe-area-inset-bottom, 16px), var(--kb-inset))" }}>
            <button onClick={onClose} className="flex-1 h-12 rounded-xl ios-subhead text-muted-foreground bg-secondary">Cancel</button>
            <button onClick={save} disabled={saving || !amount}
              className="flex-[2] h-12 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
