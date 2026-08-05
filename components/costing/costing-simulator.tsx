"use client";

// Costing sandbox. Try a shipment on paper before committing money to it.
//
// Why it models a whole shipment rather than one SKU at a time: freight,
// duty, MPL, agent and last-mile are container costs shared across every
// line. confirm_grn splits freight and local charges by each line's share of
// total CBM, and duty by each line's FOB x duty-rate. Change one line's
// cartons and every other line's cost moves. A per-SKU "container share" box
// would give numbers that never add up to a real container, so this asks for
// the shipment costs once and apportions them the way the real GRN will.
//
// Nothing here writes to a real cost. The arithmetic is one Postgres call
// (simulate_landed_costs, migration 0135) which is a pure function.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Play, Save, Trash2, ChevronDown, Search, RotateCcw, Ship, Check,
  Plus, FlaskConical, X,
} from "lucide-react";
import {
  getCostingSeed, getCostingDefaults, simulateLandedCosts, listScenarios,
  saveScenario, deleteScenario, getCartonSizeReference,
  type CostingSeedRow, type CostingResultRow, type CostingShipmentInput,
  type CostingLineInput, type CostingScenario, type FobCurrency, type FobBasis,
  type CartonSizeReference,
} from "@/lib/queries/costing";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { BodyPortal } from "@/components/ui/body-portal";
import { haptic } from "@/lib/haptics";
import { containerLabel } from "@/lib/trade-units";
import { CONTAINER_CAPACITY_CBM, type ContainerSizeHint } from "@/lib/queries/shipments";

/* ── Formatting ─────────────────────────────────────────────────────────── */

const money = (n: number | null | undefined, dp = 2) =>
  n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

/* ── Local editing state ────────────────────────────────────────────────── */

interface Row extends CostingSeedRow {
  include: boolean;
  qty: string;
  cbm: string;
  fob: string;
  /** Whether `fob` is a per-pack or per-carton quote. Suppliers quote diapers
   *  both ways; Postgres multiplies a pack quote up by packs_per_carton. */
  fobBasis: FobBasis;
  currency: FobCurrency;
}

/** A product Ali is thinking about but does not stock. Every field here is one
 *  he can read off a supplier quote or measure off the sample carton — the
 *  same inputs the real Products and Shipments screens take, in the same
 *  order, with the same words. Nothing is inferred on his behalf. */
interface Trial {
  key: string;
  name: string;
  variant: string;
  pcsPerPack: string;
  packsPerCarton: string;
  /** Carton dimensions, entered exactly as in Products → Edit SKU. CBM is
   *  DERIVED from them (L x W x H / 1e6) and never typed — same rule as the
   *  generated column in the database. */
  lenCm: string;
  widCm: string;
  hgtCm: string;
  /** What one pack-level unit is called for this product. A 700ml bottle is a
   *  bottle, not a "pack" — the same containerLabel rule as everywhere else. */
  unitNoun: "pack" | "bottle" | "pouch";
  /** Whether it is sold by the pack as well as the carton. Drives which units
   *  the price fields offer, so the screen can never ask for a price in a unit
   *  the product isn't sold in. */
  sellsPack: boolean;
  qty: string;
  fob: string;
  fobBasis: FobBasis;
  currency: FobCurrency;
  /** Which unit the selling price below is quoted in. */
  sellUnit: FobBasis;
  sellPrice: string;
  targetMargin: string;
  dutyPct: string;
}

function trialCbm(t: Trial): number {
  const l = num(t.lenCm), w = num(t.widCm), h = num(t.hgtCm);
  return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : 0;
}

function emptyTrial(): Trial {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "", variant: "",
    pcsPerPack: "", packsPerCarton: "",
    lenCm: "", widCm: "", hgtCm: "",
    unitNoun: "pack", sellsPack: true,
    qty: "", fob: "", fobBasis: "carton", currency: "USD",
    sellUnit: "pack", sellPrice: "", targetMargin: "", dutyPct: "0",
  };
}

const EMPTY_SHIPMENT: CostingShipmentInput = {
  rate_usd_to_mvr: 0,
  rate_usd_to_idr: 0,
  shared_container: true,
  container_capacity_cbm: CONTAINER_CAPACITY_CBM["40hq"],
  total_container_freight_usd: 0,
  freight_share_usd: 0,
  customs_duty_mvr: 0,
  mpl_charges_mvr: 0,
  agent_fee_mvr: 0,
  last_mile_mvr: 0,
  insurance_mvr: 0,
  other_mvr: 0,
};

const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** Seed row → editable row. Module scope because it depends on nothing in the
 *  component; keeping it inside meant reading it before its declaration. */
function toRow(s: CostingSeedRow): Row {
  return {
    ...s,
    // NOTHING is pre-ticked. Ali: "I should tick what I want. Not untick."
    // The VALUES are pre-filled from his last shipment, which is the useful
    // half; deciding what is in the container stays his.
    include: false,
    qty: s.last_qty_cartons ? String(s.last_qty_cartons) : "",
    cbm: s.cbm_per_carton ? String(s.cbm_per_carton) : "",
    fob: s.last_fob_per_carton && s.packs_per_carton > 0
      ? String(+(s.last_fob_per_carton / s.packs_per_carton).toFixed(4))
      : "",
    // Matches the Shipments line dialog, which always opens on Pack because
    // that is how Ali is quoted. For Sosoft (1 per "pack") this reads Bottle.
    fobBasis: "pack",
    currency: s.last_fob_currency ?? "USD",
  };
}

export function CostingSimulator() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [boxes, setBoxes] = useState<CartonSizeReference[]>([]);
  const [trialDraft, setTrialDraft] = useState<Trial | null>(null);
  const [ship, setShip] = useState<CostingShipmentInput>(EMPTY_SHIPMENT);
  const [results, setResults] = useState<CostingResultRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [showCosts, setShowCosts] = useState(true);

  const [scenarios, setScenarios] = useState<CostingScenario[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CostingScenario | null>(null);

  /* ── Load ─────────────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    try {
      const [seed, saved, defaults, ref] = await Promise.all([
        getCostingSeed(),
        listScenarios().catch(() => []),
        getCostingDefaults().catch(() => null),
        getCartonSizeReference().catch(() => []),
      ]);
      setRows(seed.map(toRow));
      setBoxes(ref);
      setScenarios(saved);
      // Open on the real numbers: the most recent shipment's FX rates and
      // charges. A saved scenario, if there is one, wins over them.
      if (defaults) {
        setShip({
          rate_usd_to_mvr:   defaults.rate_usd_to_mvr   ?? 0,
          rate_usd_to_idr:   defaults.rate_usd_to_idr   ?? 0,
          shared_container:  defaults.shared_container ?? true,
          container_capacity_cbm:
            CONTAINER_CAPACITY_CBM[(defaults.container_size_hint ?? "40hq") as ContainerSizeHint],
          total_container_freight_usd: defaults.total_container_freight_usd ?? 0,
          freight_share_usd: defaults.freight_share_usd ?? 0,
          customs_duty_mvr:  defaults.customs_duty_mvr  ?? 0,
          mpl_charges_mvr:   defaults.mpl_charges_mvr   ?? 0,
          agent_fee_mvr:     defaults.agent_fee_mvr     ?? 0,
          last_mile_mvr:     defaults.last_mile_mvr     ?? 0,
          insurance_mvr:     defaults.insurance_mvr     ?? 0,
          other_mvr:         defaults.other_mvr         ?? 0,
        });
      }
      const last = saved[0];
      if (last?.payload?.shipment) setShip({ ...EMPTY_SHIPMENT, ...last.payload.shipment });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Derived ──────────────────────────────────────────────────────────── */

  const included = useMemo(
    () => rows.filter((r) => r.include && num(r.qty) > 0 && num(r.cbm) > 0),
    [rows],
  );

  // A trial only counts once it can actually be costed: a quantity, a box
  // size and a price. Half-filled ones sit in the list without distorting the
  // container.
  const includedTrials = useMemo(
    () => trials.filter((t) => num(t.qty) > 0 && trialCbm(t) > 0 && num(t.fob) > 0
                            && num(t.pcsPerPack) > 0 && num(t.packsPerCarton) > 0),
    [trials],
  );

  const totalCbm = useMemo(
    () => included.reduce((a, r) => a + num(r.qty) * num(r.cbm), 0)
        + includedTrials.reduce((a, t) => a + num(t.qty) * trialCbm(t), 0),
    [included, includedTrials],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.brand_name} ${r.model_name} ${r.variant_display}`.toLowerCase().includes(q));
  }, [rows, search]);

  // Product lists stay grouped by product — sections are products, never a
  // flat cross-catalogue list.
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; rows: Row[] }>();
    for (const r of visible) {
      const key = `${r.brand_name}|${r.model_name}`;
      if (!m.has(key)) m.set(key, { title: `${r.brand_name} · ${r.model_name}`, rows: [] });
      m.get(key)!.rows.push(r);
    }
    return [...m.values()];
  }, [visible]);

  const resultGroups = useMemo(() => {
    if (!results) return [];
    const m = new Map<string, { title: string; rows: CostingResultRow[] }>();
    for (const r of results) {
      const key = `${r.brand_name ?? ""}|${r.model_name}`;
      // A prospective product has no brand on file, so the section is just its
      // name — never the literal "null · Trial Brand".
      if (!m.has(key)) {
        m.set(key, {
          title: r.brand_name ? `${r.brand_name} · ${r.model_name}` : (r.model_name ?? "New product"),
          rows: [],
        });
      }
      m.get(key)!.rows.push(r);
    }
    return [...m.values()];
  }, [results]);

  const totals = useMemo(() => {
    if (!results) return null;
    return results.reduce(
      (a, r) => ({
        fob: a.fob + (r.fob_total_mvr ?? 0),
        freight: a.freight + (r.freight_mvr ?? 0),
        local: a.local + (r.local_mvr ?? 0),
        duty: a.duty + (r.duty_mvr ?? 0),
        landed: a.landed + (r.landed_total_mvr ?? 0),
      }),
      { fob: 0, freight: 0, local: 0, duty: 0, landed: 0 },
    );
  }, [results]);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  function patch(skuId: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.sku_id === skuId ? { ...r, ...p } : r)));
  }

  function currentPayload() {
    const lines: CostingLineInput[] = included.map((r) => ({
      key: r.sku_id,
      sku_id: r.sku_id,
      qty_cartons: num(r.qty),
      cbm_per_carton: num(r.cbm),
      // Exactly one FOB key, matching how the supplier quoted it. Postgres
      // multiplies a pack quote up by packs_per_carton.
      ...(r.fobBasis === "pack"
        ? { fob_per_pack: num(r.fob) }
        : { fob_per_carton: num(r.fob) }),
      fob_currency: r.currency,
    }));
    // Prospective products ride in the SAME array, so they take their share of
    // freight from the same pot as everything else. That is the whole point:
    // adding a new product to a shared container raises the freight bill for
    // the products already in it, and only a joint simulation shows that.
    for (const t of includedTrials) {
      const price = num(t.sellPrice) || undefined;
      lines.push({
        key: t.key,
        new_product: {
          name: t.name.trim() || "New product",
          variant_display: t.variant.trim() || undefined,
          pcs_per_pack: num(t.pcsPerPack),
          packs_per_carton: num(t.packsPerCarton),
          duty_rate_pct: num(t.dutyPct),
          // Exactly what he said it sells in, so Postgres measures margin
          // against the unit actually sold and never invents a pack tier for
          // a carton-only product.
          sellable_units: t.sellsPack ? ["pack", "carton"] : ["carton"],
          ...(t.sellUnit === "pack"
            ? { target_price_per_pack_mvr: price }
            : { target_price_per_carton_mvr: price }),
          target_margin_pct: num(t.targetMargin) || undefined,
        },
        qty_cartons: num(t.qty),
        cbm_per_carton: trialCbm(t),
        ...(t.fobBasis === "pack"
          ? { fob_per_pack: num(t.fob) }
          : { fob_per_carton: num(t.fob) }),
        fob_currency: t.currency,
      });
    }
    return { shipment: ship, lines };
  }

  async function run() {
    const { shipment, lines } = currentPayload();
    if (lines.length === 0) {
      toast.error("Tick the products in this container, or add one to try.");
      return;
    }
    if (shipment.rate_usd_to_mvr <= 0 && lines.some((l) => l.fob_currency === "USD")) {
      toast.error("Enter the USD → MVR rate.");
      return;
    }
    if (shipment.rate_usd_to_idr <= 0 && lines.some((l) => l.fob_currency === "IDR")) {
      toast.error("Enter the USD → IDR rate — an IDR price needs it.");
      return;
    }
    if (shipment.rate_usd_to_mvr <= 0 && lines.some((l) => l.fob_currency === "IDR")) {
      toast.error("Enter the USD → MVR rate — IDR converts through it.");
      return;
    }
    if (shipment.shared_container && shipment.total_container_freight_usd <= 0) {
      toast.error("Enter what the whole container's freight costs.");
      return;
    }
    setRunning(true);
    try {
      setResults(await simulateLandedCosts(shipment, lines));
      haptic("success");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function doSave() {
    const name = scenarioName.trim();
    if (!name) { toast.error("Give the scenario a name."); return; }
    setSaving(true);
    try {
      const id = await saveScenario(name, currentPayload(), scenarioId ?? undefined);
      setScenarioId(id);
      setScenarios(await listScenarios());
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function loadScenario(s: CostingScenario) {
    setScenarioId(s.id);
    setScenarioName(s.name);
    setShip({ ...EMPTY_SHIPMENT, ...s.payload.shipment });
    const byId = new Map(s.payload.lines.map((l) => [l.sku_id, l]));
    setRows((rs) =>
      rs.map((r) => {
        const l = byId.get(r.sku_id);
        return l
          ? { ...r, include: true, qty: String(l.qty_cartons), cbm: String(l.cbm_per_carton),
              // Restore the basis it was saved under — reading a pack quote
              // back as a carton quote would silently change the answer.
              fobBasis: (l.fob_per_pack != null ? "pack" : "carton") as FobBasis,
              fob: String(l.fob_per_pack ?? l.fob_per_carton ?? ""),
              currency: l.fob_currency }
          : { ...r, include: false };
      }));
    setResults(null);
    toast.success(`Loaded “${s.name}”`);
  }

  async function doDelete() {
    if (!pendingDelete) return;
    try {
      await deleteScenario(pendingDelete.id);
      if (scenarioId === pendingDelete.id) { setScenarioId(null); setScenarioName(""); }
      setScenarios(await listScenarios());
      toast.success("Deleted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPendingDelete(null);
    }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted-foreground)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Why the shipment costs are entered once */}
      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}
      >
        <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          Freight, duty and clearing are <strong style={{ color: "var(--foreground)" }}>shared container costs</strong>.
          Enter them once below and each product takes its share by volume — the same
          way your real GRN does. Nothing here changes your actual costs.
        </p>
      </div>

      {/* ── Shipment costs ─────────────────────────────────────────────── */}
      <section className="snm-card rounded-2xl p-4 space-y-4">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--foreground)" }}>The container</h2>

        <Field2
          a={{ label: "USD → MVR", value: ship.rate_usd_to_mvr, on: (v) => setShip({ ...ship, rate_usd_to_mvr: v }), step: "0.01" }}
          b={{ label: "USD → IDR", value: ship.rate_usd_to_idr, on: (v) => setShip({ ...ship, rate_usd_to_idr: v }), step: "1" }}
        />
        {/* Shared container — the same model as the Shipments cost panel.
            Your freight is a SHARE of the whole container's bill, worked out
            from how much of it your goods fill. That is why it moves when you
            add or remove cartons; a flat number could never show that. */}
        <div className="rounded-2xl p-3.5 space-y-3"
             style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={ship.shared_container}
              onChange={(e) => setShip({ ...ship, shared_container: e.target.checked })}
              className="h-5 w-5 shrink-0 accent-current"
              style={{ color: "var(--foreground)" }}
            />
            <span className="text-[15px] font-medium" style={{ color: "var(--foreground)" }}>
              Sharing the container
            </span>
          </label>

          {ship.shared_container ? (
            <>
              <div>
                <span className="block text-[11.5px] font-medium mb-1.5" style={{ color: "var(--muted-foreground)" }}>
                  Container size
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(["20ft", "40hq"] as ContainerSizeHint[]).map((sz) => {
                    const on = ship.container_capacity_cbm === CONTAINER_CAPACITY_CBM[sz];
                    return (
                      <button
                        key={sz}
                        onClick={() => setShip({ ...ship, container_capacity_cbm: CONTAINER_CAPACITY_CBM[sz] })}
                        className="h-11 rounded-xl text-[13px] font-bold"
                        style={{
                          background: on ? "var(--foreground)" : "var(--glass-bg-2)",
                          color:      on ? "var(--background)" : "var(--muted-foreground)",
                          border:     on ? "none" : "0.5px solid var(--glass-border-lo)",
                        }}
                      >
                        {sz === "20ft" ? "20 ft" : "40 HQ"}
                        <span className="ml-1.5 text-[11px] font-semibold opacity-70">
                          {CONTAINER_CAPACITY_CBM[sz]} CBM
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <NumField
                label="Whole container freight (USD)"
                value={ship.total_container_freight_usd}
                on={(v) => setShip({ ...ship, total_container_freight_usd: v })}
              />

              {/* Live share, computed the same way the Shipments panel does. */}
              {ship.total_container_freight_usd > 0 && totalCbm > 0 && (
                <div className="rounded-xl px-3 py-2.5"
                     style={{ background: "var(--glass-bg-2)", border: "0.5px solid var(--glass-border-lo)" }}>
                  <p className="snm-num text-[13.5px]" style={{ color: "var(--foreground)" }}>
                    Your share ≈ <strong>USD {money(
                      ship.total_container_freight_usd * (totalCbm / ship.container_capacity_cbm), 2)}</strong>
                  </p>
                  <p className="snm-num text-[11.5px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {totalCbm.toFixed(3)} of {ship.container_capacity_cbm} CBM —{" "}
                    {((totalCbm / ship.container_capacity_cbm) * 100).toFixed(1)}% of the container
                  </p>
                  {totalCbm > ship.container_capacity_cbm && (
                    <p className="text-[11.5px] mt-1" style={{ color: "var(--snm-warning)" }}>
                      That is more than this container holds — check the size.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <NumField
              label="My freight (USD)"
              value={ship.freight_share_usd}
              on={(v) => setShip({ ...ship, freight_share_usd: v })}
            />
          )}
        </div>

        <Field2
          a={{ label: "Customs duty (MVR)", value: ship.customs_duty_mvr, on: (v) => setShip({ ...ship, customs_duty_mvr: v }) }}
        />
        <Field2
          a={{ label: "MPL charges (MVR)", value: ship.mpl_charges_mvr, on: (v) => setShip({ ...ship, mpl_charges_mvr: v }) }}
          b={{ label: "Agent fee (MVR)", value: ship.agent_fee_mvr, on: (v) => setShip({ ...ship, agent_fee_mvr: v }) }}
        />
        <Field2
          a={{ label: "Last mile (MVR)", value: ship.last_mile_mvr, on: (v) => setShip({ ...ship, last_mile_mvr: v }) }}
          b={{ label: "Insurance (MVR)", value: ship.insurance_mvr, on: (v) => setShip({ ...ship, insurance_mvr: v }) }}
        />
        <Field2
          a={{ label: "Other (MVR)", value: ship.other_mvr, on: (v) => setShip({ ...ship, other_mvr: v }) }}
        />

        <div className="flex items-baseline justify-between pt-1">
          <span className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            {included.length} product{included.length === 1 ? "" : "s"} in this container
          </span>
          <span className="snm-num text-[15px] font-semibold" style={{ color: "var(--foreground)" }}>
            {totalCbm.toFixed(3)} CBM
          </span>
        </div>
      </section>

      {/* ── Products ───────────────────────────────────────────────────── */}
      <section className="snm-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold" style={{ color: "var(--foreground)" }}>What&apos;s in it</h2>
          <button
            onClick={() => { setRows((rs) => rs.map((r) => toRow(r))); setResults(null); }}
            className="flex items-center gap-1.5 text-[13px] font-medium snm-pressable"
            style={{ color: "var(--muted-foreground)" }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a product"
            className="w-full h-11 rounded-xl pl-9 pr-3 text-[15px] outline-none"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
          />
        </div>

        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.title} className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider px-0.5" style={{ color: "var(--muted-foreground)" }}>
                {g.title}
              </p>
              {g.rows.map((r) => (
                <LineEditor key={r.sku_id} row={r} onPatch={patch} />
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-[14px] py-6 text-center" style={{ color: "var(--muted-foreground)" }}>
              No product matches “{search}”.
            </p>
          )}
        </div>
      </section>

      {/* ── Products he does NOT stock yet ──────────────────────────────
          The decision that actually costs money is bringing something in for
          the first time. These ride in the same simulation as the catalogue
          lines, so a trial product takes its share of freight from the same
          pot — which is the only way to see that adding it makes everything
          else in the container more expensive too. ── */}
      <section className="snm-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold flex items-center gap-2" style={{ color: "var(--foreground)" }}>
              <FlaskConical className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
              Thinking about a new product
            </h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Cost it before you buy it — the quote, and the sample carton&apos;s size.
            </p>
          </div>
          <button
            onClick={() => setTrialDraft(emptyTrial())}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-semibold shrink-0 snm-pressable"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {trials.length === 0 ? (
          <p className="text-[13.5px] py-2" style={{ color: "var(--muted-foreground)" }}>
            Nothing being trialled. Add one and it joins the container above —
            you&apos;ll see what it lands at, and the most you could pay for it.
          </p>
        ) : (
          <div className="space-y-1.5">
            {trials.map((t) => {
              const ready = includedTrials.some((x) => x.key === t.key);
              return (
                <div key={t.key}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)" }}>
                  <button onClick={() => setTrialDraft(t)} className="min-w-0 flex-1 text-left snm-pressable">
                    <p className="text-[15px] font-medium truncate" style={{ color: "var(--foreground)" }}>
                      {t.name.trim() || "Untitled product"}{t.variant.trim() ? ` · ${t.variant.trim()}` : ""}
                    </p>
                    <p className="snm-num text-[12.5px]" style={{ color: ready ? "var(--muted-foreground)" : "var(--snm-warning)" }}>
                      {ready
                        ? `${num(t.qty)} cartons · ${num(t.packsPerCarton)} ${t.unitNoun}s of ${num(t.pcsPerPack)} · ${t.currency} ${t.fob} per ${t.fobBasis === "pack" ? t.unitNoun : "carton"}`
                        : "Tap to finish — needs quantity, carton size and price"}
                    </p>
                  </button>
                  <button
                    onClick={() => { setTrials((xs) => xs.filter((x) => x.key !== t.key)); setResults(null); }}
                    aria-label="Remove"
                    className="shrink-0 snm-pressable p-1.5 rounded-lg"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Run ────────────────────────────────────────────────────────── */}
      <button
        onClick={run}
        disabled={running}
        className="w-full h-[52px] rounded-2xl text-[16px] font-bold flex items-center justify-center gap-2 disabled:opacity-40 snm-pressable"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        {running ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Play className="h-4.5 w-4.5" />}
        {running ? "Working out the costs…" : "Work out the costs"}
      </button>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {results && totals && (
        <section className="space-y-3">
          <div className="snm-card rounded-2xl p-4 space-y-2.5">
            <h2 className="text-[17px] font-semibold" style={{ color: "var(--foreground)" }}>
              What this container costs you
            </h2>
            <Total label="Goods (FOB)"        value={totals.fob} />
            <Total label="Freight"            value={totals.freight} />
            <Total label="Clearing & local"   value={totals.local} />
            <Total label="Customs duty"       value={totals.duty} />
            <div className="h-px" style={{ background: "var(--glass-border-lo)" }} />
            <Total label="Landed total" value={totals.landed} strong />
          </div>

          <div className="flex items-center justify-between px-1">
            <p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Per product, versus what you pay and charge today
            </p>
            <button
              onClick={() => setShowCosts((s) => !s)}
              className="text-[13px] font-semibold snm-pressable"
              style={{ color: "var(--foreground)" }}
            >
              {showCosts ? "Show margins" : "Show costs"}
            </button>
          </div>

          {resultGroups.map((g) => (
            <div key={g.title} className="snm-card rounded-2xl p-4 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                {g.title}
              </p>
              {g.rows.map((r) => (
                <ResultRow key={r.sku_id} r={r} showCosts={showCosts} />
              ))}
            </div>
          ))}
        </section>
      )}

      {/* ── Scenarios ──────────────────────────────────────────────────── */}
      <section className="snm-card rounded-2xl p-4 space-y-3">
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--foreground)" }}>Saved scenarios</h2>
        <div className="flex gap-2">
          <input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="e.g. Jan container, supplier B"
            className="flex-1 h-11 rounded-xl px-3 text-[15px] outline-none"
            style={{ background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
          />
          <button
            onClick={doSave}
            disabled={saving}
            className="h-11 px-4 rounded-xl text-[14px] font-bold flex items-center gap-1.5 disabled:opacity-40 snm-pressable"
            style={{ background: "var(--foreground)", color: "var(--background)" }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {scenarioId ? "Update" : "Save"}
          </button>
        </div>

        {scenarios.length === 0 ? (
          <p className="text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
            Save a scenario to come back to it later.
          </p>
        ) : (
          <div className="space-y-1.5">
            {scenarios.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{
                  background: "var(--glass-bg-1)",
                  border: s.id === scenarioId
                    ? "1px solid color-mix(in srgb, var(--foreground) 30%, transparent)"
                    : "0.5px solid var(--glass-border-lo)",
                }}
              >
                <button onClick={() => loadScenario(s)} className="flex-1 min-w-0 text-left">
                  <p className="text-[15px] font-medium truncate" style={{ color: "var(--foreground)" }}>{s.name}</p>
                  <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                    {s.payload.lines?.length ?? 0} products
                  </p>
                </button>
                <button
                  onClick={() => setPendingDelete(s)}
                  aria-label={`Delete ${s.name}`}
                  className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ color: "var(--snm-error)", background: "color-mix(in srgb, var(--snm-error) 8%, transparent)" }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmSheet
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={doDelete}
        title="Delete this scenario?"
        message={`“${pendingDelete?.name ?? ""}” is only a saved what-if — none of your real costs are affected.`}
        confirmLabel="Delete"
      />

      {trialDraft && (
        <TrialSheet
          draft={trialDraft}
          boxes={boxes}
          onClose={() => setTrialDraft(null)}
          onSave={(t) => {
            setTrials((xs) => xs.some((x) => x.key === t.key)
              ? xs.map((x) => (x.key === t.key ? t : x))
              : [...xs, t]);
            setTrialDraft(null);
            setResults(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

interface FieldSpec {
  label: string;
  value: number;
  on: (v: number) => void;
  step?: string;
}

function Field2({ a, b }: { a: FieldSpec; b?: FieldSpec }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <NumField {...a} />
      {b && <NumField {...b} />}
    </div>
  );
}

function NumField({ label, value, on, step = "0.01" }: FieldSpec) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-medium mb-1.5" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value === 0 ? "" : value}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => on(parseFloat(e.target.value) || 0)}
        className="snm-num w-full h-11 rounded-xl px-3 text-[16px] font-medium outline-none"
        style={{ background: "var(--glass-bg-1)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
      />
    </label>
  );
}

function LineEditor({ row, onPatch }: { row: Row; onPatch: (id: string, p: Partial<Row>) => void }) {
  const [open, setOpen] = useState(false);
  const active = row.include;
  const qtyN = num(row.qty);
  const cbmN = num(row.cbm);
  const fobN = num(row.fob);
  // "pack" for diapers, "bottle" for a 700ml Sosoft — the noun comes from the
  // product category, never hardcoded.
  const unitNoun = containerLabel(row.unit_uom);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--glass-bg-1)",
        border: active
          ? "1px solid color-mix(in srgb, var(--foreground) 22%, transparent)"
          : "0.5px solid var(--glass-border-lo)",
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onPatch(row.sku_id, { include: e.target.checked })}
          aria-label={`Include ${row.variant_display}`}
          className="h-5 w-5 shrink-0 accent-current"
          style={{ color: "var(--foreground)" }}
        />
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left">
          <p className="text-[15px] font-medium truncate" style={{ color: "var(--foreground)" }}>
            {row.variant_display}
          </p>
          <p className="snm-num text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
            {active && row.qty ? `${row.qty} ctn · ` : ""}
            {row.pcs_per_pack}/pk × {row.packs_per_carton}/ctn
            {row.current_landed_per_piece_mvr != null && row.pcs_per_pack > 0 &&
              ` · now MVR ${money(row.current_landed_per_piece_mvr * row.pcs_per_pack, 0)}/${unitNoun}`}
          </p>
        </button>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ color: "var(--muted-foreground)", transform: open ? "rotate(180deg)" : undefined }}
        />
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Laid out like the Shipments line dialog — same order, same
              Pack/Carton toggle, same live conversion echo. Ali already knows
              that screen; a second, different one for the same job is a
              tax on him. */}
          <div className="grid grid-cols-2 gap-2.5">
            <MiniField label="Cartons"      value={row.qty} on={(v) => onPatch(row.sku_id, { qty: v })} />
            <MiniField label="CBM / carton" value={row.cbm} on={(v) => onPatch(row.sku_id, { cbm: v })} step="0.0001" />
          </div>

          {qtyN > 0 && (
            <p className="snm-num text-[11.5px] -mt-1" style={{ color: "var(--muted-foreground)" }}>
              = {(qtyN * row.packs_per_carton).toLocaleString()} {unitNoun}
              {qtyN * row.packs_per_carton === 1 ? "" : "s"}
              {cbmN > 0 && ` · ${(qtyN * cbmN).toFixed(4)} CBM`}
            </p>
          )}

          {/* Supplier price — quoted per pack (per bottle for Sosoft) or per
              carton. Postgres multiplies a pack quote up; the carton figure
              stays the basis, exactly as the real GRN stores it. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>
                Supplier price
              </span>
              <div className="flex gap-1.5">
                {(["pack", "carton"] as FobBasis[]).map((b) => {
                  const on = row.fobBasis === b;
                  return (
                    <button
                      key={b}
                      onClick={() => onPatch(row.sku_id, { fobBasis: b })}
                      className="flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-semibold"
                      style={{
                        background: on ? "var(--foreground)" : "transparent",
                        color:      on ? "var(--background)" : "var(--muted-foreground)",
                        border:     on ? "none" : "0.5px solid var(--glass-border-lo)",
                      }}
                    >
                      {on && <Check className="h-3 w-3 shrink-0" />}
                      {b === "pack" ? unitNoun.charAt(0).toUpperCase() + unitNoun.slice(1) : "Carton"}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={row.fob}
                placeholder="0"
                onFocus={(e) => e.target.select()}
                onChange={(e) => onPatch(row.sku_id, { fob: e.target.value })}
                className="snm-num flex-1 h-11 rounded-xl px-3 text-[16px] font-medium outline-none"
                style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
              />
              <div className="flex gap-1">
                {(["USD", "IDR", "MVR"] as FobCurrency[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => onPatch(row.sku_id, { currency: c })}
                    className="h-11 w-[52px] rounded-xl text-[12px] font-bold"
                    style={{
                      background: row.currency === c ? "var(--foreground)" : "var(--glass-bg-2)",
                      color:      row.currency === c ? "var(--background)" : "var(--muted-foreground)",
                      border:     row.currency === c ? "none" : "0.5px solid var(--glass-border-lo)",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {row.fobBasis === "pack" && fobN > 0 && row.packs_per_carton > 0 && (
              <p className="snm-num text-[11.5px] mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                = {(fobN * row.packs_per_carton).toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.currency} / carton
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniField({ label, value, on, step = "0.01" }: { label: string; value: string; on: (v: string) => void; step?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => on(e.target.value)}
        className="snm-num w-full h-10 rounded-lg px-2.5 text-[15px] outline-none"
        style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
      />
    </label>
  );
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={strong ? "text-[15px] font-semibold" : "text-[14px]"}
            style={{ color: strong ? "var(--foreground)" : "var(--muted-foreground)" }}>
        {label}
      </span>
      <span className={`snm-num ${strong ? "text-[19px] font-bold" : "text-[15px] font-medium"}`}
            style={{ color: "var(--foreground)" }}>
        MVR {money(value)}
      </span>
    </div>
  );
}

function ResultRow({ r, showCosts }: { r: CostingResultRow; showCosts: boolean }) {
  // The RPC compares cost per piece (the only unit comparable across pack
  // configurations); it is converted to a per-pack figure for display, because
  // that is the unit Ali buys and sells in.
  const delta = r.delta_per_piece_mvr;
  const deltaPack = delta == null ? null : delta * r.pcs_per_pack;
  // Cheaper than today is good news; the app's colour law says green means money.
  const deltaColour = delta == null || Math.abs(delta) < 0.005
    ? "var(--muted-foreground)"
    : delta < 0 ? "var(--snm-success)" : "var(--snm-error)";

  const margin = r.simulated_margin_pct;
  const marginColour = margin == null
    ? "var(--muted-foreground)"
    : margin < 0 ? "var(--snm-error)"
    : r.target_margin_pct != null && margin < r.target_margin_pct ? "var(--snm-warning)"
    : "var(--snm-success)";

  return (
    <div className="py-1.5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium truncate flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
          {r.variant_display || r.model_name}
          {r.is_new && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
              style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
              NEW
            </span>
          )}
        </p>
        <p className="snm-num text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
          {showCosts
            ? <>{r.packs_per_carton} packs of {r.pcs_per_pack} · MVR {money(r.landed_per_carton_mvr, 0)}/carton</>
            : r.selling_price_per_pack_mvr
              ? <>Sells at MVR {money(r.selling_price_per_pack_mvr, 0)}/pack</>
              : <>No selling price set</>}
        </p>
      </div>

      <div className="text-right shrink-0">
        {showCosts ? (
          <>
            <p className="snm-num text-[16px] font-semibold" style={{ color: "var(--foreground)" }}>
              MVR {money(r.landed_per_pack_mvr, 0)}
              <span className="ml-1 text-[11px] font-semibold" style={{ color: "var(--muted-foreground)" }}>/pack</span>
            </p>
            <p className="snm-num text-[12px]" style={{ color: deltaColour }}>
              {deltaPack == null || Math.abs(deltaPack) < 0.005
                ? "same as now"
                : `${deltaPack < 0 ? "−" : "+"}MVR ${money(Math.abs(deltaPack), 0)}/pack vs now`}
            </p>
          </>
        ) : (
          <>
            <p className="snm-num text-[16px] font-semibold" style={{ color: marginColour }}>
              {pct(margin)}
            </p>
            <p className="snm-num text-[12px]" style={{ color: "var(--muted-foreground)" }}>
              {r.price_for_target_pack_mvr != null
                ? `charge MVR ${money(r.price_for_target_pack_mvr, 0)}/pack ${r.price_basis === "target" ? "for target" : "to hold it"}`
                : r.current_margin_pct != null ? `${pct(r.current_margin_pct)} today` : "—"}
            </p>
          </>
        )}
      </div>
    </div>

    {/* REVERSE COSTING — the number you take into a negotiation. "It lands at
        446" is an observation; "don't pay more than USD 13.68 a carton" is a
        decision. Shown whenever there is a price and a margin to work back
        from, which for a prospective product is exactly what was entered. */}
    {r.max_fob_per_carton_usd != null && (
      <div className="mt-1.5 rounded-lg px-2.5 py-2 flex items-baseline justify-between gap-2"
        style={{ background: "color-mix(in srgb, var(--foreground) 4%, transparent)" }}>
        <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          Pay at most{r.price_basis === "target" ? " for your target margin" : " to hold this margin"}
        </span>
        <span className="text-right shrink-0">
          <span className="snm-num text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>
            USD {money(r.max_fob_per_carton_usd)}
          </span>
          <span className="snm-num text-[11px] ml-1" style={{ color: "var(--muted-foreground)" }}>/carton</span>
          {r.fob_headroom_pct != null && (
            <span className="snm-num block text-[11.5px]"
              style={{ color: r.fob_headroom_pct < 0 ? "var(--snm-error)" : "var(--snm-success)" }}>
              {r.fob_headroom_pct < 0
                ? `quote is ${Math.abs(r.fob_headroom_pct).toFixed(0)}% too dear`
                : `${r.fob_headroom_pct.toFixed(0)}% room on the quote`}
            </span>
          )}
        </span>
      </div>
    )}
    </div>
  );
}

export { Ship as CostingIcon };


/* ── Entering a product that isn't in the catalogue ──────────────────────── */
//
// Built by reading the two screens that already do this job and copying them,
// not by inventing a third pattern:
//   · Products → Edit SKU  — carton dimensions are entered as L/W/H and the
//     CBM is DERIVED and echoed. CBM is a generated column in the database and
//     is never typed; asking for it here would have been a different rule for
//     the same number. Ali measures a box; he does not compute cubic metres.
//   · Shipments → Add Product — "SUPPLIER PRICE" with a Carton/Pack pill and a
//     live "= X per carton" echo, so the number is never ambiguous about what
//     it is a price FOR.
// Same labels (.label-caps), same inputs (.snm-input), same pills, same sheet
// chrome (fixed header, one scrolling body, pinned footer) as the rest of the
// app — a second visual language for the same job is a tax on the person
// using it.

const PILL_ON: React.CSSProperties = {
  background: "var(--foreground)", color: "var(--background)", border: "none",
};
const PILL_OFF: React.CSSProperties = {
  background: "transparent", color: "var(--muted-foreground)",
  border: "0.5px solid var(--glass-border-lo)",
};

function Pills<T extends string>({ options, value, onChange }: {
  options: { v: T; l: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className="flex items-center gap-1.5 snm-pressable"
            style={{
              padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600,
              cursor: "pointer", transition: "all 0.15s", ...(on ? PILL_ON : PILL_OFF),
            }}>
            {on && <Check className="h-3 w-3 shrink-0" />}
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Caps({ children }: { children: React.ReactNode }) {
  return (
    <p className="label-caps text-[12px] mb-2" style={{ color: "var(--muted-foreground)" }}>
      {children}
    </p>
  );
}

/** Grey helper line under a field. Muted foreground on the sheet's own
 *  background — the contrast pair the rest of the app uses. */
function Hint({ children, tone }: { children: React.ReactNode; tone?: "good" }) {
  return (
    <p className="ios-subhead mt-1.5"
      style={{ color: tone === "good" ? "var(--snm-success)" : "var(--muted-foreground)" }}>
      {children}
    </p>
  );
}

function TrialSheet({ draft, boxes, onClose, onSave }: {
  draft: Trial;
  boxes: CartonSizeReference[];
  onClose: () => void;
  onSave: (t: Trial) => void;
}) {
  const [t, setT] = useState<Trial>(draft);
  const set = (p: Partial<Trial>) => setT((x) => ({ ...x, ...p }));

  const noun = t.unitNoun;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const cbm = trialCbm(t);
  const qtyN = num(t.qty);
  const ppc = num(t.packsPerCarton);
  const fobN = num(t.fob);

  // A pack quote read back as a carton price, exactly as the Shipments dialog
  // echoes it — so "10.20" can never be mistaken for the price of the order,
  // or of a piece, or of anything other than what the pill says.
  const fobPerCarton = t.fobBasis === "pack" && ppc > 0 ? fobN * ppc : fobN;

  // A carton-only product must not be offered a pack price anywhere.
  const unitOptions: { v: FobBasis; l: string }[] = t.sellsPack
    ? [{ v: "carton", l: "Carton" }, { v: "pack", l: Noun }]
    : [{ v: "carton", l: "Carton" }];

  const canSave = t.name.trim().length > 0
    && num(t.pcsPerPack) > 0 && ppc > 0 && qtyN > 0 && cbm > 0 && fobN > 0;

  const inputSty: React.CSSProperties = {
    background: "var(--glass-bg-1)", border: "0.5px solid var(--glass-border-lo)",
  };

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-60 flex items-end snm-scrim-in"
        style={{ background: "var(--scrim-bg)", touchAction: "none" }} onClick={onClose}>
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
          style={{
            background: "var(--glass-2)",
            backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)",
            height: "85dvh",
            maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
            boxShadow: "var(--glass-shadow-lg), var(--glass-inner)",
            touchAction: "none",
          }}
        >
          {/* Fixed header */}
          <div className="shrink-0 px-6 pt-3">
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "var(--glass-border)" }} />
            <h2 className="text-[20px] font-semibold text-foreground mb-1">A product you don&apos;t stock yet</h2>
            <p className="ios-subhead mb-5" style={{ color: "var(--muted-foreground)" }}>
              Copy it off the supplier&apos;s quote and measure the sample carton.
              Nothing here touches your real products.
            </p>
          </div>

          {/* One scrolling body */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-6"
            style={{ touchAction: "pan-y" }}>

            {/* Identity */}
            <div className="mb-4">
              <Caps>PRODUCT *</Caps>
              <input value={t.name} onChange={(e) => set({ name: e.target.value })}
                placeholder="Brand and model, e.g. Merries Good Skin"
                className="w-full h-12 rounded-xl px-4 ios-subhead text-foreground outline-none mb-2"
                style={inputSty} />
              <input value={t.variant} onChange={(e) => set({ variant: e.target.value })}
                placeholder="Size, e.g. XL"
                className="w-full h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                style={inputSty} />
            </div>

            {/* Pack configuration */}
            <div className="mb-4">
              <Caps>HOW IT&apos;S PACKED *</Caps>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" inputMode="numeric" min="1" value={t.pcsPerPack}
                  onChange={(e) => set({ pcsPerPack: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  placeholder={`Pieces per ${noun}`}
                  className="h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty} />
                <input type="number" inputMode="numeric" min="1" value={t.packsPerCarton}
                  onChange={(e) => set({ packsPerCarton: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  placeholder={`${Noun}s per carton`}
                  className="h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty} />
              </div>
              {num(t.pcsPerPack) > 0 && ppc > 0 && (
                <Hint>One carton = {ppc} {noun}s of {num(t.pcsPerPack)}.</Hint>
              )}
            </div>

            {/* What it is and how it's sold — drives every unit word below */}
            <div className="mb-4">
              <Caps>HOW YOU&apos;D SELL IT *</Caps>
              <div className="flex flex-wrap gap-2 mb-2">
                <Pills
                  options={[
                    { v: "pack" as const, l: "Packs" },
                    { v: "bottle" as const, l: "Bottles" },
                    { v: "pouch" as const, l: "Pouches" },
                  ]}
                  value={t.unitNoun}
                  onChange={(v) => set({ unitNoun: v })}
                />
              </div>
              <Pills
                options={[
                  { v: "both" as const, l: `${Noun}s and cartons` },
                  { v: "carton" as const, l: "Cartons only" },
                ]}
                value={t.sellsPack ? "both" : "carton"}
                onChange={(v) => {
                  const sellsPack = v === "both";
                  set({
                    sellsPack,
                    // Never leave a price field quoted in a unit the product
                    // no longer sells.
                    sellUnit: sellsPack ? t.sellUnit : "carton",
                    fobBasis: sellsPack ? t.fobBasis : "carton",
                  });
                }}
              />
              <Hint>This decides which units you&apos;re asked to price it in.</Hint>
            </div>

            {/* Carton dimensions — entered, not guessed. Same as Products. */}
            <div className="mb-4">
              <Caps>CARTON DIMENSIONS (cm) *</Caps>
              <div className="grid grid-cols-3 gap-2">
                {([["lenCm", "L"], ["widCm", "W"], ["hgtCm", "H"]] as const).map(([k, ph]) => (
                  <input key={k} type="number" inputMode="decimal" step="0.1"
                    value={t[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<Trial>)}
                    onFocus={(e) => e.target.select()}
                    placeholder={ph}
                    className="h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                    style={inputSty} />
                ))}
              </div>
              {cbm > 0
                ? <Hint tone="good">→ {cbm.toFixed(5)} CBM per carton</Hint>
                : <Hint>Measure the sample carton. This is what decides your freight share.</Hint>}

              {boxes.length > 0 && (
                <div className="mt-3">
                  <p className="ios-subhead mb-1.5" style={{ color: "var(--muted-foreground)" }}>
                    Don&apos;t have the box yet? Start from one you already ship — then
                    replace it with the real measurements before you commit.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {boxes.map((b) => {
                      const on = Math.abs(cbm - b.cbm_per_carton) < 0.00005;
                      return (
                        <button key={`${b.length_cm}x${b.width_cm}x${b.height_cm}`} type="button"
                          onClick={() => set({
                            lenCm: String(Number(b.length_cm)),
                            widCm: String(Number(b.width_cm)),
                            hgtCm: String(Number(b.height_cm)),
                          })}
                          className="snm-pressable"
                          style={{
                            padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                            cursor: "pointer", ...(on ? PILL_ON : PILL_OFF),
                          }}>
                          {b.example}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Order quantity */}
            <div className="mb-4">
              <Caps>QTY CARTONS *</Caps>
              <input type="number" inputMode="numeric" min="1" value={t.qty}
                onChange={(e) => set({ qty: e.target.value })}
                onFocus={(e) => e.target.select()}
                placeholder="How many cartons would you order?"
                className="w-full h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                style={inputSty} />
              {qtyN > 0 && ppc > 0 && (
                <Hint>
                  = {(qtyN * ppc).toLocaleString()} {noun}s
                  {cbm > 0 && ` · ${(qtyN * cbm).toFixed(4)} CBM`}
                </Hint>
              )}
            </div>

            {/* Supplier price — copied field-for-field from Shipments */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                  SUPPLIER PRICE *
                </p>
                <Pills options={unitOptions} value={t.fobBasis} onChange={(v) => set({ fobBasis: v })} />
              </div>
              <div className="flex gap-2">
                <input type="number" inputMode="decimal" value={t.fob}
                  onChange={(e) => set({ fob: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  placeholder={`Price of ONE ${t.fobBasis === "pack" ? noun : "carton"}`}
                  className="flex-1 h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty} />
                <div className="relative">
                  <select value={t.currency}
                    onChange={(e) => set({ currency: e.target.value as FobCurrency })}
                    className="h-12 rounded-xl px-3 pr-8 ios-subhead text-foreground outline-none appearance-none"
                    style={{ ...inputSty, width: 84 }}>
                    <option value="USD">USD</option>
                    <option value="IDR">IDR</option>
                    <option value="MVR">MVR</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                    style={{ color: "var(--muted-foreground)" }} />
                </div>
              </div>
              <Hint>
                {fobN > 0
                  ? <>
                      {t.currency} {fobN.toLocaleString()} for one {t.fobBasis === "pack" ? noun : "carton"}
                      {t.fobBasis === "pack" && ppc > 0 &&
                        ` = ${t.currency} ${fobPerCarton.toLocaleString(undefined, { maximumFractionDigits: 2 })} per carton`}
                      {qtyN > 0 &&
                        ` · ${t.currency} ${(fobPerCarton * qtyN).toLocaleString(undefined, { maximumFractionDigits: 0 })} for the whole order`}
                    </>
                  : <>The price of ONE {t.fobBasis === "pack" ? noun : "carton"} — not the order total.</>}
              </Hint>
            </div>

            {/* The decision inputs */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="label-caps text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                  WHAT YOU&apos;D SELL IT FOR
                </p>
                <Pills options={unitOptions} value={t.sellUnit} onChange={(v) => set({ sellUnit: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" inputMode="decimal" value={t.sellPrice}
                  onChange={(e) => set({ sellPrice: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  placeholder={`MVR per ${t.sellUnit === "pack" ? noun : "carton"}`}
                  className="h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty} />
                <input type="number" inputMode="decimal" step="0.5" value={t.targetMargin}
                  onChange={(e) => set({ targetMargin: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  placeholder="Margin you want %"
                  className="h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                  style={inputSty} />
              </div>
              <Hint>
                These two turn a cost into a decision — they give you the margin, and
                the most you could pay per carton and still get it.
              </Hint>
            </div>

            {/* Duty */}
            <div className="mb-6">
              <Caps>
                IMPORT DUTY %
              </Caps>
              <input type="number" inputMode="decimal" step="0.5" value={t.dutyPct}
                onChange={(e) => set({ dutyPct: e.target.value })}
                onFocus={(e) => e.target.select()}
                className="w-full h-12 rounded-xl px-4 ios-subhead text-foreground outline-none"
                style={inputSty} />
              <Hint>Diapers and detergents are 0% in the Maldives. Leave it at 0 unless you know otherwise.</Hint>
            </div>
          </div>

          {/* Pinned footer */}
          <div className="shrink-0 flex gap-3 px-6 pt-3"
            style={{
              paddingBottom: "max(calc(20px + env(safe-area-inset-bottom, 16px)), var(--kb-inset))",
              borderTop: "0.5px solid var(--glass-border-lo)",
            }}>
            <button onClick={onClose}
              className="flex-1 h-12 rounded-xl ios-subhead font-semibold"
              style={{ background: "var(--glass-bg-1)", color: "var(--foreground)" }}>
              Cancel
            </button>
            <button onClick={() => onSave(t)} disabled={!canSave}
              className="flex-[2] h-12 rounded-xl text-sm font-bold transition disabled:opacity-40"
              style={{ background: "var(--foreground)", color: "var(--background)" }}>
              Add to the container
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
