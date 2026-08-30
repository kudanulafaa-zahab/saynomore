"use client";

/**
 * Product Card — one screen that answers "tell me about this product".
 *
 * Ali, 2026-08-12: *"a new module where I can get all details about an sku when
 * I search… It's just an easy way for me to know about a product… It must be
 * really simple interface."*
 *
 * WHY IT EXISTS RATHER THAN DUPLICATING A SCREEN. To understand one product he
 * had to open Shipments (what he paid), Price Lists (what he charges),
 * Inventory (what is left), Market (what rivals charge) and Reports (what it
 * earned). Every figure existed; none of them sat together. This is the
 * consolidation — "item card" is what retail ERP has called it for decades.
 *
 * IT CALCULATES NOTHING. Every number arrives from `get_product_card`
 * (migration 0178). Hard rule 1, and more practically: a fact sheet that did
 * its own arithmetic would become a fifth opinion about margin, and the only
 * reason this page is worth trusting is that it agrees with the ledger.
 *
 * SIMPLE MEANS TABLES. He asked for tabular, and he was right: label on the
 * left, number on the right, one row per fact, no charts. A table is readable
 * in five seconds on a phone and needs no legend.
 *
 * UNITS. Packs and cartons only. The rival's price arrives from Postgres
 * already converted into OUR pack size, so nothing here ever prints a piece
 * price — which is the standing rule, and also simply how he thinks.
 */

import { SearchField } from "@/components/ui/search-field";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, PackagePlus, ArrowLeft } from "lucide-react";
import { CARD_ROUNDED } from "@/lib/surfaces";
import { listSkusFlat, compareSkusForDisplay, type SkuFullRow } from "@/lib/queries/products";
import { listStockLevels, type StockLevel } from "@/lib/queries/inventory";
import { getProductCard, type ProductCard } from "@/lib/queries/product-card";
import { useOnMount } from "@/lib/use-on-mount";
import { SkeletonRows } from "@/components/layout/page-skeleton";

/** Money, the way a trader reads it: thousands separated, two decimals only
 *  when they carry meaning. */
import { mvr } from "@/lib/money";

/** Same formatter, named for a COUNT rather than money — the two differ only
 *  in their default decimals, which each call site passes anyway. */
const num = mvr;
function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MV", { day: "numeric", month: "short", year: "numeric" });
}

/* ── The one row shape used by every table on this page ── */
function Row({
  label, value, tone, strong, hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  strong?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5"
      style={{ borderTop: "0.5px solid var(--glass-border-lo)" }}>
      <div className="min-w-0">
        {/* --foreground at 0.75, never --muted-foreground: on a card, muted
            measures under the 4.5:1 floor, and a label you cannot read makes
            the number beside it meaningless. */}
        <p className="ios-subhead" style={{ color: "var(--foreground)", opacity: 0.75 }}>{label}</p>
        {hint && (
          <p className="ios-footnote mt-0.5" style={{ color: "var(--foreground)", opacity: 0.55 }}>{hint}</p>
        )}
      </div>
      <p className={`snm-num ios-subhead shrink-0 text-right ${strong ? "font-bold" : "font-semibold"}`}
        style={{ color: tone ?? "var(--foreground)" }}>
        {value}
      </p>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={CARD_ROUNDED}>
      <div className="px-4 pt-3.5 pb-2.5">
        <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>{title}</p>
        {note && (
          <p className="ios-footnote mt-1" style={{ color: "var(--foreground)", opacity: 0.7 }}>{note}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function ProductCardView() {
  const [skus, setSkus] = useState<SkuFullRow[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [card, setCard] = useState<ProductCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  // /product-card?sku=<id> opens straight to that card — the route Products'
  // "Full details" button uses. Adding a link without honouring the parameter
  // is the exact bug that made ?tab=receive a dead end for a week, so it is
  // read here and covered by the audit.
  const wantedSku = useSearchParams().get("sku");

  useOnMount(async () => {
    try {
      const [s, lv] = await Promise.all([
        listSkusFlat(),
        listStockLevels().catch(() => [] as StockLevel[]),
      ]);
      setSkus(s);
      setLevels(lv);
      if (wantedSku && s.some((x) => x.id === wantedSku)) {
        setCard(await getProductCard(wantedSku));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  });

  const stockBySku = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of levels) m.set(l.sku_id, (m.get(l.sku_id) ?? 0) + Number(l.qty_pieces ?? 0));
    return m;
  }, [levels]);

  // Product lists stay grouped by product — Ali's standing rule. Searching
  // filters; it never flattens a detergent in between two diaper sizes.
  const grouped = useMemo(() => {
    const term = q.trim().toLowerCase();
    const matched = term
      ? skus.filter((s) => [s.brand_name, s.model_name, s.variant_display ?? "", s.internal_code]
          .join(" ").toLowerCase().includes(term))
      : skus;
    const byBrand = new Map<string, SkuFullRow[]>();
    for (const s of [...matched].sort(compareSkusForDisplay)) {
      const k = s.brand_name ?? "—";
      (byBrand.get(k) ?? byBrand.set(k, []).get(k)!).push(s);
    }
    return [...byBrand.entries()];
  }, [skus, q]);

  async function open(sku: SkuFullRow) {
    setCardLoading(true);
    try {
      setCard(await getProductCard(sku.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCardLoading(false);
    }
  }

  if (loading) return <SkeletonRows rows={6} />;

  /* ── The card itself ── */
  if (card) {
    const c = card.cost;
    const p = card.price;
    const r = card.rival;
    const rc = card.rival_carton;
    const inc = card.incoming;
    const packsInStock = card.pack.pcs_per_pack > 0
      ? card.stock.pieces / card.pack.pcs_per_pack : 0;
    const cartonsInStock = card.pack.pcs_per_pack * card.pack.packs_per_carton > 0
      ? card.stock.pieces / (card.pack.pcs_per_pack * card.pack.packs_per_carton) : 0;

    // Supplier price movement between the last arrival and the one on the water.
    // Shown because it is the number that moves the margin next, and it can
    // move the OPPOSITE way to the foreign price when the rate shifts.
    const fobShiftPct = inc?.fob_mvr_per_carton && inc?.last_fob_mvr_per_carton
      ? ((inc.fob_mvr_per_carton - inc.last_fob_mvr_per_carton) / inc.last_fob_mvr_per_carton) * 100
      : null;

    return (
      <div className="space-y-3 pb-28 lg:pb-10">
        <button
          onClick={() => setCard(null)}
          className="flex items-center gap-1.5 ios-subhead font-semibold snm-pressable"
          style={{ color: "var(--snm-brand-text)" }}
        >
          <ArrowLeft className="h-4 w-4" />
          All products
        </button>

        <div>
          <h1 className="ios-page-title">{card.model}</h1>
          <p className="ios-subhead mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
            {card.brand}{card.variant ? ` · ${card.variant}` : ""} · {card.category}
          </p>
          <p className="ios-footnote snm-num mt-1" style={{ color: "var(--muted-foreground)" }}>
            {card.internal_code}{card.is_active ? "" : " · INACTIVE"}
          </p>
        </div>

        {/* ── Pack configuration. The SKU code encodes it, but nobody should
               have to decode a code. ── */}
        <Section title="Pack">
          <Row label="One pack holds" value={`${num(card.pack.pcs_per_pack)} ${card.unit_noun === "pack" ? "pieces" : card.unit_noun + "s"}`} />
          <Row label="One carton holds" value={`${num(card.pack.packs_per_carton)} packs`} />
          {card.pack.length_cm != null && (
            <Row label="Carton size"
              value={`${num(card.pack.length_cm, 0)} × ${num(card.pack.width_cm, 0)} × ${num(card.pack.height_cm, 0)} cm`}
              hint={card.pack.cbm_per_carton ? `${Number(card.pack.cbm_per_carton).toFixed(3)} CBM — decides its share of freight` : undefined} />
          )}
          {Number(card.pack.duty_rate_pct ?? 0) > 0 && (
            <Row label="Import duty" value={`${num(card.pack.duty_rate_pct, 2)}%`} />
          )}
        </Section>

        {/* ── COST. Every component, so the total can be checked by adding the
               rows above it. That is exactly what the audit does. ── */}
        {c ? (
          <Section
            title="What it costs you"
            note={`From the last shipment received — ${c.shipment_ref}, ${day(c.received_at)}. The exchange rate locks when a shipment is received, so this is a fact about that arrival.`}
          >
            <Row label={`Supplier price (${c.fob_currency})`}
              value={`${num(c.fob_per_carton, 0)} / carton`}
              hint={c.fx_rate ? `at ${c.fx_rate} to MVR` : undefined} />
            <Row label={`Supplier price, ${num(c.qty_cartons)} carton${c.qty_cartons === 1 ? "" : "s"}`} value={`MVR ${mvr(c.fob_mvr)}`} />
            <Row label="+ Freight share" value={`MVR ${mvr(c.freight_mvr)}`} />
            <Row label="+ Local charges" value={`MVR ${mvr(c.local_mvr)}`} />
            <Row label="+ Duty" value={`MVR ${mvr(c.duty_mvr)}`} />
            <Row label="Landed, total" value={`MVR ${mvr(c.landed_total_mvr)}`} strong />
            <Row label="Landed, per carton" value={`MVR ${mvr(c.per_carton_mvr)}`} strong />
            <Row label="Landed, per pack" value={`MVR ${mvr(c.per_pack_mvr)}`} strong />
          </Section>
        ) : (
          <Section title="What it costs you"
            note="Nothing received yet, so there is no landed cost. Receive stock and the cost is whatever you paid.">
            <Row label="Landed cost" value="Not known yet" tone="var(--snm-warning)" />
          </Section>
        )}

        {/* ── PRICE AND PROFIT, in the units actually sold. Money first,
               percentage second (Seat 4). ── */}
        <Section title="What you charge, and what you keep">
          <Row label="Sell one pack" value={`MVR ${mvr(p.per_pack_mvr)}`} />
          <Row label="Costs you" value={`MVR ${mvr(p.pack_cost_mvr)}`} />
          <Row label="You keep, per pack"
            value={p.pack_profit_mvr == null ? "—" : `${p.pack_profit_mvr >= 0 ? "+" : ""}MVR ${mvr(p.pack_profit_mvr)}`}
            strong
            tone={p.pack_profit_mvr == null ? undefined : p.pack_profit_mvr >= 0 ? "var(--snm-success)" : "var(--snm-error)"}
            hint={p.pack_margin_pct == null ? undefined : `${num(p.pack_margin_pct, 1)}% margin`} />
          <Row label="Sell one carton" value={`MVR ${mvr(p.per_carton_mvr)}`} />
          <Row label="Costs you" value={`MVR ${mvr(p.carton_cost_mvr)}`} />
          <Row label="You keep, per carton"
            value={p.carton_profit_mvr == null ? "—" : `${p.carton_profit_mvr >= 0 ? "+" : ""}MVR ${mvr(p.carton_profit_mvr)}`}
            strong
            tone={p.carton_profit_mvr == null ? undefined : p.carton_profit_mvr >= 0 ? "var(--snm-success)" : "var(--snm-error)"}
            hint={p.carton_margin_pct == null ? undefined : `${num(p.carton_margin_pct, 1)}% margin`} />
          {p.carton_discount_mvr != null && Number(p.carton_discount_mvr) !== 0 && (
            <Row label="Buying a carton instead of loose packs"
              value={`saves them MVR ${mvr(Math.abs(Number(p.carton_discount_mvr)))}`}
              tone="var(--snm-warning)"
              hint={Number(p.carton_discount_mvr) > 0
                ? "so a carton earns you that much less than the same packs sold singly"
                : "a carton earns you MORE than the same packs sold singly"} />
          )}
        </Section>

        {/* ── THE RIVAL. Their price converted to our pack size in Postgres, so
               no piece figure ever reaches this screen. ── */}
        {r && (
          <Section
            title="Against the competition"
            note={`${r.competitor}, seen ${day(r.observed_date)}${r.days_old > 45 ? ` — ${r.days_old} days ago, worth checking again` : ""}.`}
          >
            <Row label={`Their price (${num(r.their_pack_size)} per pack)`} value={`MVR ${mvr(r.their_price_mvr)}`} />
            <Row label="Their price for a pack your size" value={`MVR ${mvr(r.their_price_at_our_pack_size)}`} />
            <Row label="Your pack price" value={`MVR ${mvr(r.our_price_mvr)}`} />
            {r.we_are_cheaper_by_mvr != null && (
              <Row
                label={Number(r.we_are_cheaper_by_mvr) >= 0 ? "You are cheaper by" : "You are dearer by"}
                value={`MVR ${mvr(Math.abs(Number(r.we_are_cheaper_by_mvr)))}`}
                strong
                tone={Number(r.we_are_cheaper_by_mvr) >= 0 ? "var(--snm-success)" : "var(--snm-warning)"}
                hint={r.we_are_cheaper_by_pct == null ? undefined : `${num(Math.abs(Number(r.we_are_cheaper_by_pct)), 1)}%`}
              />
            )}
          </Section>
        )}

        {/* ── THEIR CARTON RATE. A separate section on purpose.
               Ali, 2026-08-30: rivals discount on carton sales. That is a
               price for a different buyer — a shop buying a case, not a
               shopper buying a pack — and it is discounted per piece by
               definition. Folded into the section above it would drag the
               headline down and argue for a price cut that was never needed
               (migration 0223). Their carton composition is stated because
               theirs can differ from ours. ── */}
        {rc && (
          <Section
            title="Their carton rate"
            note={`What ${rc.competitor} charges a shop for a case, seen ${day(rc.observed_date)}${rc.days_old > 45 ? ` — ${rc.days_old} days ago, worth checking again` : ""}. A carton is always cheaper per pack than a single pack, so this is compared only against your own carton price.`}
          >
            <Row
              label="Their carton"
              value={`${num(rc.their_packs_per_carton, 0)} × ${num(rc.their_pack_size, 0)}`}
              hint={rc.their_packs_per_carton !== card.pack.packs_per_carton || rc.their_pack_size !== card.pack.pcs_per_pack
                ? `Yours is ${num(card.pack.packs_per_carton, 0)} × ${num(card.pack.pcs_per_pack, 0)} — the figures below are converted to your carton so they are the same goods`
                : undefined}
            />
            <Row label="Their carton price" value={`MVR ${mvr(rc.their_price_mvr)}`} />
            <Row label="Their price for a carton your size" value={`MVR ${mvr(rc.their_price_at_our_carton_size)}`} />
            <Row label="Your carton price" value={rc.our_price_mvr == null ? "Not set" : `MVR ${mvr(rc.our_price_mvr)}`} />
            {rc.we_are_cheaper_by_mvr != null && (
              <Row
                label={Number(rc.we_are_cheaper_by_mvr) >= 0 ? "You are cheaper by" : "You are dearer by"}
                value={`MVR ${mvr(Math.abs(Number(rc.we_are_cheaper_by_mvr)))}`}
                strong
                tone={Number(rc.we_are_cheaper_by_mvr) >= 0 ? "var(--snm-success)" : "var(--snm-warning)"}
                hint={rc.we_are_cheaper_by_pct == null ? undefined : `${num(Math.abs(Number(rc.we_are_cheaper_by_pct)), 1)}%`}
              />
            )}
          </Section>
        )}

        {/* ── STOCK, in trade units. Never a piece count. ── */}
        <Section title="Stock">
          <Row label="On hand"
            value={card.stock.in_stock
              ? `${num(cartonsInStock, 1)} cartons (${num(packsInStock, 0)} packs)`
              : "None"}
            strong
            tone={card.stock.in_stock ? undefined : "var(--snm-error)"} />
          {card.stock.by_godown.map((g) => (
            <Row key={g.godown} label={g.godown}
              value={`${num(g.pieces / Math.max(1, card.pack.pcs_per_pack), 0)} packs`} />
          ))}
          {!card.stock.in_stock && (
            <div className="px-4 py-3">
              <Link href={`/stock-ops?tab=receive&sku=${card.sku_id}`}
                className="h-11 rounded-xl ios-subhead font-semibold snm-pressable flex items-center justify-center gap-1.5"
                style={{ background: "var(--foreground)", color: "var(--background)" }}>
                <PackagePlus className="h-4 w-4" />
                Receive stock
              </Link>
            </div>
          )}
        </Section>

        {/* ── ON THE WATER. The number that moves the margin next. ── */}
        {inc && (
          <Section title="On the way"
            note={`${inc.shipment_ref}${inc.expected_date ? `, expected ${day(inc.expected_date)}` : ""}.`}>
            <Row label="Arriving" value={`${num(inc.qty_cartons)} cartons`} strong />
            <Row label={`Supplier price (${inc.fob_currency})`} value={`${num(inc.fob_per_carton, 0)} / carton`}
              hint={inc.fx_rate ? `at ${inc.fx_rate} to MVR` : undefined} />
            <Row label="In rufiyaa, per carton" value={`MVR ${mvr(inc.fob_mvr_per_carton)}`} />
            <Row label="Last time" value={`MVR ${mvr(inc.last_fob_mvr_per_carton)}`} />
            {fobShiftPct != null && (
              <Row
                label={fobShiftPct >= 0 ? "So it costs you more" : "So it costs you less"}
                value={`${fobShiftPct >= 0 ? "+" : ""}${num(fobShiftPct, 1)}%`}
                strong
                tone={fobShiftPct >= 0 ? "var(--snm-warning)" : "var(--snm-success)"}
                hint="freight and duty are only known when it is received, so the final landed cost will differ"
              />
            )}
          </Section>
        )}

        {/* ── WHAT IT HAS EARNED. Packs, never pieces. ── */}
        <Section title="What it has earned" note="Confirmed and delivered orders only — a draft is not a sale.">
          <Row label="Sold" value={`${num(card.sales.packs_sold, 1)} packs`} />
          <Row label="Orders" value={num(card.sales.orders)} />
          <Row label="Customers who bought it" value={num(card.sales.customers)} />
          <Row label="Revenue" value={`MVR ${mvr(card.sales.revenue_mvr)}`} />
          <Row label="Gross profit" value={`MVR ${mvr(card.sales.gross_profit_mvr)}`} strong
            tone={Number(card.sales.gross_profit_mvr) >= 0 ? "var(--snm-success)" : "var(--snm-error)"} />
          <Row label="Last sold" value={day(card.sales.last_sold_at)} />
        </Section>

        {cardLoading && <p className="ios-subhead text-center" style={{ color: "var(--muted-foreground)" }}>Loading…</p>}
      </div>
    );
  }

  /* ── The list ── */
  return (
    <div className="space-y-4 pb-28 lg:pb-10">
      <div>
        <h1 className="ios-page-title">Product Card</h1>
        <p className="ios-subhead mt-0.5" style={{ color: "var(--foreground)", opacity: 0.75 }}>
          Everything about one product, on one screen.
        </p>
      </div>

      <SearchField value={q} onChange={setQ} label="Search products" placeholder="Search products…" />

      {grouped.length === 0 ? (
        <p className="ios-subhead px-1 py-8 text-center" style={{ color: "var(--muted-foreground)" }}>
          No products match that.
        </p>
      ) : (
        grouped.map(([brand, rows]) => (
          <div key={brand} className="rounded-2xl overflow-hidden" style={CARD_ROUNDED}>
            <p className="label-caps text-[12px] px-4 py-2.5" style={{ color: "var(--muted-foreground)", borderBottom: "0.5px solid var(--glass-border-lo)" }}>
              {brand} · {rows.length} SKU{rows.length === 1 ? "" : "s"}
            </p>
            {rows.map((s, i) => {
              const st = stockBySku.get(s.id) ?? 0;
              return (
                <button key={s.id} onClick={() => open(s)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left snm-pressable"
                  style={{ borderTop: i > 0 ? "0.5px solid var(--glass-border-lo)" : undefined }}>
                  <div className="flex-1 min-w-0">
                    <p className="ios-subhead font-semibold truncate" style={{ color: "var(--foreground)" }}>
                      {s.model_name}
                      {s.variant_display && (
                        <span className="font-normal" style={{ color: "var(--muted-foreground)" }}> · {s.variant_display}</span>
                      )}
                    </p>
                    <p className="ios-footnote mt-0.5" style={{ color: "var(--foreground)", opacity: 0.7 }}>
                      {s.pcs_per_pack} per pack × {s.packs_per_carton} per carton
                      {st <= 0 ? " · no stock" : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
