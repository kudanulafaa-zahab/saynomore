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
} from "lucide-react";
import {
  getCostingSeed, getCostingDefaults, simulateLandedCosts, listScenarios,
  saveScenario, deleteScenario,
  type CostingSeedRow, type CostingResultRow, type CostingShipmentInput,
  type CostingLineInput, type CostingScenario, type FobCurrency, type FobBasis,
} from "@/lib/queries/costing";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
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
      const [seed, saved, defaults] = await Promise.all([
        getCostingSeed(),
        listScenarios().catch(() => []),
        getCostingDefaults().catch(() => null),
      ]);
      setRows(seed.map(toRow));
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

  const totalCbm = useMemo(
    () => included.reduce((a, r) => a + num(r.qty) * num(r.cbm), 0),
    [included],
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
      const key = `${r.brand_name}|${r.model_name}`;
      if (!m.has(key)) m.set(key, { title: `${r.brand_name} · ${r.model_name}`, rows: [] });
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
    return { shipment: ship, lines };
  }

  async function run() {
    const { shipment, lines } = currentPayload();
    if (lines.length === 0) {
      toast.error("Tick the products in this container first.");
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
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium truncate" style={{ color: "var(--foreground)" }}>
          {r.variant_display}
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
  );
}

export { Ship as CostingIcon };
